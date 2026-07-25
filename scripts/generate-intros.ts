/**
 * generate-intros.ts
 *
 * For each section in a new manifest, calls Claude claude-sonnet-4-6 to generate
 * a spoken-register intro script (30s–3min), then synthesises it via Kokoro TTS,
 * uploads the WAV to Blossom, and publishes a kind 4200 segment with isIntro:true.
 *
 * Usage: COMPASS_NSEC=nsec1... ANTHROPIC_API_KEY=sk-... npx ts-node generate-intros.ts <issueNumber>
 */

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { SimplePool } from 'nostr-tools/pool'
import { COMPASS_PUBKEY, BLOSSOM_SERVERS, DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from './config.ts'
import { createCompassAmberSigner, type CompassSigner } from './amber-signer.ts'
import { verifyNostrEvent } from './segment-security.ts'

const ISSUE_NUMBER = parseInt(process.argv[2] ?? '0', 10)
type IntroSigner = CompassSigner & { getPublicKey: () => Promise<string> }
if (!ISSUE_NUMBER) {
  console.error('Usage: generate-intros.ts <issueNumber>')
  process.exit(1)
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── LLM intro generation ─────────────────────────────────────────────────────

async function generateIntroScript(sectionTitle: string, sectionBody: string): Promise<string> {
  const prompt = `You are writing a spoken-word radio intro for the "${sectionTitle}" segment of the Nostr Compass podcast.

The section covers:
${sectionBody.slice(0, 1500)}

Write a 30–90 second spoken intro that:
- Sounds natural and conversational, NOT like marketing copy
- Uses plain sentences, no bullet points
- Frames why this topic matters RIGHT NOW
- Ends with a brief invitation for contributors to share their perspective

Output ONLY the spoken script. No stage directions, no quotes, no commentary.`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = msg.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('No text in LLM response')
  return block.text.trim()
}

// ── Kokoro TTS ────────────────────────────────────────────────────────────────

function synthesiseWithKokoro(script: string, outPath: string): void {
  const tmpScript = join(tmpdir(), `intro-${Date.now()}.txt`)
  writeFileSync(tmpScript, script, 'utf8')

  // Requires kokoro-onnx or kokoro CLI installed on PATH
  // kokoro --text-file <path> --out <path.wav> --voice af_heart --speed 1.0
  try {
    execSync(`kokoro --text-file "${tmpScript}" --out "${outPath}" --voice af_heart --speed 1.0`, {
      stdio: 'inherit',
    })
  } catch {
    // Fallback: pyttsx3 or espeak if kokoro not available
    console.warn('Kokoro not available, falling back to espeak')
    execSync(`espeak-ng -f "${tmpScript}" -w "${outPath}" --ipa -v en-us`, { stdio: 'inherit' })
  }
}

// ── Blossom upload ────────────────────────────────────────────────────────────

async function sha256File(path: string): Promise<string> {
  const data = readFileSync(path)
  return createHash('sha256').update(data).digest('hex')
}

async function buildBlossomAuthEvent(
  sha256: string,
  size: number,
  mime: string,
  signer: IntroSigner,
) {
  const pubkey = await signer.getPublicKey()
  const unsigned = {
    kind: KINDS.BLOSSOM_AUTH,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(Math.floor(Date.now() / 1000) + 300)],
    ],
    content: `Upload ${mime} ${size} bytes`,
    pubkey,
  }
  return signer.signEvent(unsigned)
}

async function uploadToBlossom(
  wavPath: string,
  signer: IntroSigner,
): Promise<{ url: string; sha256: string; size: number; mime: string }> {
  const data = readFileSync(wavPath)
  const sha256 = createHash('sha256').update(data).digest('hex')
  const size = data.length
  const mime = 'audio/wav'

  let uploadUrl = ''
  for (const server of BLOSSOM_SERVERS) {
    try {
      const authEvent = await buildBlossomAuthEvent(sha256, size, mime, signer)
      const authHeader = Buffer.from(JSON.stringify(authEvent)).toString('base64')
      const res = await fetch(`${server}/upload`, {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
          'X-SHA-256': sha256,
          Authorization: `Nostr ${authHeader}`,
        },
        body: data,
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json() as { url?: string }
      uploadUrl = json.url ?? `${server}/${sha256}`
      break
    } catch (err) {
      console.warn(`Upload to ${server} failed:`, err)
    }
  }
  if (!uploadUrl) throw new Error('All Blossom servers failed')
  return { url: uploadUrl, sha256, size, mime }
}

// ── Segment publish ───────────────────────────────────────────────────────────

async function publishIntroSegment(
  sectionId: string,
  blob: { url: string; sha256: string; mime: string },
  durationSec: number,
  signer: IntroSigner,
): Promise<string> {
  const issueId = `${ISSUE_PREFIX}-${ISSUE_NUMBER}`
  const pubkey = await signer.getPublicKey()

  const content = JSON.stringify({
    audio: {
      url: blob.url,
      sha256: blob.sha256,
      mime: blob.mime,
      duration: durationSec,
      waveform: [],
    },
    isIntro: true,
  })

  const unsigned = {
    kind: KINDS.SEGMENT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['x', blob.sha256],
      ['section', sectionId],
      ['issue', issueId],
      ['t', issueId],
      ['alt', `AI intro for section: ${sectionId}`],
    ],
    content,
    pubkey,
  }

  const event = await signer.signEvent(unsigned)
  const pool = new SimplePool()
  await Promise.any(pool.publish(DEFAULT_RELAYS, event as Parameters<typeof pool.publish>[1]))
  const id = (event as { id: string }).id
  console.log(`Published intro segment for ${sectionId}: ${id}`)
  return id
}

// ── Manifest fetch ────────────────────────────────────────────────────────────

async function fetchManifest(issueNumber: number) {
  const pool = new SimplePool()
  const dTag = `${ISSUE_PREFIX}-${issueNumber}`
  const events = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],
    '#d': [dTag],
    limit: 50,
  })
  const event = events
    .filter(e => e.pubkey === COMPASS_PUBKEY && verifyNostrEvent(e))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]
  if (!event) throw new Error(`No manifest found for issue ${issueNumber}`)
  return JSON.parse(event.content)
}

async function publishIntroManifestRevision(
  manifest: { episodeStatus?: string; sections: Array<{ id: string; introEventId?: string | null; order?: string[] }> },
  signer: CompassSigner,
): Promise<void> {
  if (manifest.episodeStatus === 'cutting' || manifest.episodeStatus === 'published') {
    throw new Error('Refusing to overwrite a cutting or published manifest with an intro revision')
  }
  const issueId = `${ISSUE_PREFIX}-${ISSUE_NUMBER}`
  const event = await signer.signEvent({
    kind: KINDS.MANIFEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', issueId], ['title', `Logbook #${ISSUE_NUMBER}`], ['issue', issueId]],
    content: JSON.stringify(manifest),
  })
  const pool = new SimplePool()
  try {
    await Promise.any(pool.publish(DEFAULT_RELAYS, event as Parameters<typeof pool.publish>[1]))
  } finally {
    pool.close(DEFAULT_RELAYS)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const amber = createCompassAmberSigner()
  const signer = {
    getPublicKey: async () => COMPASS_PUBKEY,
    signEvent: amber.signEvent,
  }
  const manifest = await fetchManifest(ISSUE_NUMBER)

  for (const section of manifest.sections as Array<{ id: string; title: string; body?: string; introEventId?: string | null; order?: string[] }>) {
    if (section.introEventId) {
      console.log(`Section ${section.id} already has intro, skipping`)
      continue
    }

    console.log(`\nGenerating intro for: ${section.title}`)

    const script = await generateIntroScript(section.title, section.body ?? section.title)
    console.log('Script:', script.slice(0, 120) + '...')

    // ── REVIEW GATE ──────────────────────────────────────────────────────────
    // In production, pause here and present the script for review before TTS.
    // For automated runs, set SKIP_REVIEW=1 to continue without pause.
    if (!process.env.SKIP_REVIEW) {
      console.log('\nFull script:\n', script)
      console.log('\nPress Enter to synthesise, Ctrl+C to abort...')
      await new Promise<void>(resolve => process.stdin.once('data', () => resolve()))
    }

    const wavPath = join(tmpdir(), `intro-${section.id}-${Date.now()}.wav`)
    synthesiseWithKokoro(script, wavPath)

    if (!existsSync(wavPath)) {
      console.error(`WAV not created at ${wavPath}, skipping`)
      continue
    }

    const wavData = readFileSync(wavPath)
    const durationSec = wavData.length / (48000 * 2 * 2) // rough: 48kHz, 16-bit stereo

    const blob = await uploadToBlossom(wavPath, signer)
    const introEventId = await publishIntroSegment(section.id, blob, durationSec, signer)
    section.introEventId = introEventId
    section.order = [introEventId, ...(section.order ?? []).filter((id) => id !== introEventId)]
    await publishIntroManifestRevision(manifest, signer)

    console.log(`Done: ${section.id}`)
  }

  console.log('\nAll intros generated.')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

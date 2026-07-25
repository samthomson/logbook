/**
 * transcribe-missing.ts — VPS transcription fallback (TRANS-04)
 *
 * Finds segment events (kind 4200) for recent issues that have no companion
 * transcript (kind 1111 with an e-tag pointing at the segment), downloads the
 * audio, transcribes it with whisper.cpp, and publishes a companion transcript
 * event from the Compass npub.
 *
 * Client-side transcription already covers the common path (the PWA publishes
 * a transcript right after each segment); this is the backstop for clients
 * that closed before finishing, or unsupported browsers.
 *
 * Usage:
 *   COMPASS_NSEC=nsec1... npx tsx transcribe-missing.ts [--hours 48] [--model /path/ggml.bin]
 *
 * Requirements: whisper-cli (whisper.cpp) in PATH, plus a model file
 * (default: ./models/ggml-base.en.bin relative to this script).
 */

import { SimplePool } from 'nostr-tools/pool'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  COMPASS_PUBKEY,
  DEFAULT_RELAYS,
  KINDS,
  BLOSSOM_SERVERS,
} from './config.ts'
import { createCompassAmberSigner } from './amber-signer.ts'
import { getTrustedBlobCandidates, parseVerifiedSegment } from './segment-security.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MODEL = join(__dir, 'models', 'ggml-base.en.bin')

interface SegmentAudio {
  url: string
  sha256: string
  mime: string
  duration: number
}

interface SegmentContent {
  audio: SegmentAudio
  isIntro: boolean
}

function requireWhisper(modelPath: string): void {
  const result = spawnSync('whisper-cli', ['--help'], { encoding: 'utf-8' })
  if (result.error) {
    throw new Error(
      'whisper-cli not found in PATH. Install whisper.cpp: ' +
      'https://github.com/ggerganov/whisper.cpp (or set up faster-whisper and adapt this script)',
    )
  }
  if (!existsSync(modelPath)) {
    throw new Error(
      `Whisper model not found: ${modelPath}. Download one, e.g.:\n` +
      `  mkdir -p ${join(__dir, 'models')} && curl -L -o ${modelPath} \\\n` +
      `    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`,
    )
  }
}

/** Download + sha256-verify with mirror fallback (same policy as stitch.ts). */
async function downloadVerified(url: string, destPath: string, expectedSha256: string): Promise<void> {
  const candidates = getTrustedBlobCandidates(url, expectedSha256, BLOSSOM_SERVERS)

  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) { errors.push(`${candidate}: HTTP ${res.status}`); continue }
      const buffer = Buffer.from(await res.arrayBuffer())
      const actual = createHash('sha256').update(buffer).digest('hex')
      if (actual !== expectedSha256) {
        errors.push(`${candidate}: sha256 mismatch`)
        continue
      }
      writeFileSync(destPath, buffer)
      return
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`download failed:\n  ${errors.join('\n  ')}`)
}

function transcribe(audioPath: string, modelPath: string, outDir: string): string {
  // whisper-cli writes <outPrefix>.txt
  const outPrefix = join(outDir, 'transcript')
  const result = spawnSync(
    'whisper-cli',
    ['-m', modelPath, '-f', audioPath, '-otxt', '-of', outPrefix, '-np'], // -np: no prints/progress spam
    { encoding: 'utf-8', timeout: 10 * 60 * 1000 },
  )
  if (result.status !== 0) {
    throw new Error(`whisper-cli failed:\n${result.stderr ?? ''}\n${result.stdout ?? ''}`)
  }
  return readFileSync(`${outPrefix}.txt`, 'utf-8').trim()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const hoursFlag = args.indexOf('--hours')
  const hours = hoursFlag !== -1 ? parseInt(args[hoursFlag + 1], 10) : 48
  const modelFlag = args.indexOf('--model')
  const modelPath = modelFlag !== -1 ? args[modelFlag + 1] : DEFAULT_MODEL

  requireWhisper(modelPath)
  const signer = createCompassAmberSigner()
  const pool = new SimplePool()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  console.log(`[transcribe-missing] Looking for segments in the last ${hours}h…`)
  const segments = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.SEGMENT],
    since,
    limit: 500,
  })
  console.log(`[transcribe-missing] ${segments.length} segments`)

  if (!segments.length) { pool.close(DEFAULT_RELAYS); return }

  const segIds = segments.map((s) => s.id)
  const transcripts = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.TRANSCRIPT],
    '#e': segIds,
    limit: 1000,
  })
  const covered = new Set(
    transcripts.map((t) => t.tags.find((tag) => tag[0] === 'e')?.[1]).filter(Boolean),
  )
  const missing = segments.filter((s) => !covered.has(s.id))
  console.log(`[transcribe-missing] ${missing.length} segments missing transcripts`)

  const workDir = join(tmpdir(), `logbook-transcribe-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })

  let done = 0
  for (const seg of missing) {
    try {
      parseVerifiedSegment(seg, BLOSSOM_SERVERS)
      const content = JSON.parse(seg.content) as SegmentContent
      if (!content.audio?.url || !content.audio?.sha256) {
        console.warn(`  ${seg.id.slice(0, 8)}: malformed segment, skipping`)
        continue
      }
      const ext = content.audio.mime.includes('webm') ? 'webm' : 'ogg'
      const audioPath = join(workDir, `${seg.id}.${ext}`)
      await downloadVerified(content.audio.url, audioPath, content.audio.sha256)

      const text = transcribe(audioPath, modelPath, workDir)
      if (!text) {
        console.warn(`  ${seg.id.slice(0, 8)}: empty transcript, skipping`)
        continue
      }

      // Companion event: NIP-34-style scoped comment (kind 1111) per SPEC §5
      const issueTag = seg.tags.find((t) => t[0] === 'issue')?.[1] ?? ''
      const event = await signer.signEvent(
        {
          kind: KINDS.TRANSCRIPT,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', seg.id, '', 'root'],
            ['k', String(KINDS.SEGMENT)],
            ...(issueTag ? [['issue', issueTag]] : []),
            ['alt', `Transcript of Logbook segment ${seg.id.slice(0, 8)}`],
          ],
          content: text,
        },
      )
      await Promise.any(pool.publish(DEFAULT_RELAYS, event))
      done++
      console.log(`  ${seg.id.slice(0, 8)}: transcript published (${text.length} chars)`)
    } catch (err) {
      console.error(`  ${seg.id.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  rmSync(workDir, { recursive: true, force: true })
  pool.close(DEFAULT_RELAYS)
  console.log(`[transcribe-missing] Done: ${done}/${missing.length} transcribed`)
}

main().catch((err) => {
  console.error('[transcribe-missing] Fatal:', err)
  process.exit(1)
})

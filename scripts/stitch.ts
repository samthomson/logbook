/**
 * stitch.ts — VPS stitcher
 *
 * Reads a kind 34200 manifest from relay, downloads all segment audio blobs
 * from Blossom, applies EBU R128 loudness normalisation + silence trim, then
 * stitches sections together with acrossfade and encodes to mp3 128 kbps.
 *
 * Usage:
 *   COMPASS_NSEC=nsec1... node --loader ts-node/esm stitch.ts --issue logbook-31
 *   COMPASS_NSEC=nsec1... node --loader ts-node/esm stitch.ts --issue logbook-31 --dry-run
 *
 * Requirements: ffmpeg must be in PATH.
 */

import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import fetch from 'node-fetch'
import {
  COMPASS_PUBKEY,
  DEFAULT_RELAYS,
  KINDS,
  AUDIO_DIR,
  loadPrivateKey,
} from './config.ts'

// ── types ─────────────────────────────────────────────────────────────────────

interface SegmentAudio {
  url: string
  sha256: string
  mime: string
  duration: number
  waveform?: number[]
}

interface SegmentContent {
  audio: SegmentAudio
  isIntro: boolean
}

interface ManifestSection {
  id: string
  title: string
  introEventId: string | null
  order: string[]        // ordered segment event ids
  excluded: string[]     // excluded segment event ids (SPEC §2)
  reviewed: string[]
}

interface ManifestContent {
  issueRef: string
  issueNumber?: number
  title?: string
  sections: ManifestSection[]
  episodeStatus: string
  publishedRss: unknown
}

interface Segment {
  id: string
  pubkey: string
  content: SegmentContent
  createdAt: number
}

// ── ffmpeg helpers ────────────────────────────────────────────────────────────

function requireFfmpeg(): void {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' })
  if (result.error) {
    throw new Error('ffmpeg not found in PATH. Install it: apt install ffmpeg')
  }
}

function ff(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed:\n${result.stderr}`)
  }
}

/**
 * Two-pass EBU R128 loudness normalisation.
 * Returns path to normalised WAV.
 */
function loudnorm(inputPath: string, outDir: string): string {
  const outPath = join(outDir, `${basename(inputPath, '.webm')}_norm.wav`)

  // Pass 1: measure
  const pass1 = spawnSync(
    'ffmpeg',
    ['-i', inputPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf-8' },
  )
  const stderr = pass1.stderr ?? ''
  const jsonMatch = stderr.match(/\{[\s\S]*?\}/)
  if (!jsonMatch) {
    // Fallback: single-pass (less accurate but functional)
    ff(['-i', inputPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', outPath])
    return outPath
  }

  const measured = JSON.parse(jsonMatch[0]) as {
    input_i: string
    input_tp: string
    input_lra: string
    input_thresh: string
    target_offset: string
  }

  // Pass 2: apply with measured values
  const af = [
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
  ].join(':')

  ff(['-i', inputPath, '-af', af, '-ar', '48000', '-ac', '2', outPath])
  return outPath
}

/**
 * Trim leading/trailing silence.
 */
function trimSilence(inputPath: string, outDir: string): string {
  const outPath = join(outDir, `${basename(inputPath, '.wav')}_trim.wav`)
  ff([
    '-i', inputPath,
    '-af', 'silenceremove=start_periods=1:start_silence=0.5:stop_periods=1:stop_silence=0.5',
    outPath,
  ])
  return outPath
}

/**
 * Concatenate WAV files in a section using ffmpeg concat filter.
 */
function concatSection(clips: string[], outPath: string): void {
  if (clips.length === 1) {
    // Nothing to concat — just copy
    ff(['-i', clips[0], '-c', 'copy', outPath])
    return
  }

  const inputs = clips.flatMap((c) => ['-i', c])
  const filterInputs = clips.map((_, i) => `[${i}:a]`).join('')
  ff([
    ...inputs,
    '-filter_complex', `${filterInputs}concat=n=${clips.length}:v=0:a=1[out]`,
    '-map', '[out]',
    outPath,
  ])
}

/**
 * Acrossfade two WAV files together. Returns path to faded output.
 */
function acrossfade(a: string, b: string, outPath: string, duration = 0.3): void {
  ff([
    '-i', a,
    '-i', b,
    '-filter_complex', `acrossfade=d=${duration}:c1=tri:c2=tri`,
    outPath,
  ])
}

/**
 * Encode final WAV to mp3 128kbps stereo.
 */
function encodeMp3(inputPath: string, outPath: string): void {
  ff(['-i', inputPath, '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', outPath])
}

// ── download helpers ──────────────────────────────────────────────────────────

async function downloadBlob(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  writeFileSync(destPath, Buffer.from(buffer))
}

// ── relay helpers ─────────────────────────────────────────────────────────────

async function fetchManifest(issueId: string, pool: SimplePool): Promise<ManifestContent> {
  const events = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],
    '#d': [issueId],
    limit: 1,
  })

  if (!events.length) throw new Error(`No manifest found for issue ${issueId}`)

  const event = events[0]
  if (event.pubkey !== COMPASS_PUBKEY) {
    throw new Error(`Manifest pubkey mismatch: expected ${COMPASS_PUBKEY}, got ${event.pubkey}`)
  }

  return JSON.parse(event.content) as ManifestContent
}

async function fetchSegments(
  segmentIds: string[],
  pool: SimplePool,
): Promise<Map<string, Segment>> {
  if (!segmentIds.length) return new Map()

  const events = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.SEGMENT],
    ids: segmentIds,
  })

  const map = new Map<string, Segment>()
  for (const e of events) {
    try {
      const content = JSON.parse(e.content) as SegmentContent
      map.set(e.id, { id: e.id, pubkey: e.pubkey, content, createdAt: e.created_at })
    } catch {
      console.warn(`[stitch] Could not parse segment content for ${e.id}`)
    }
  }
  return map
}

// ── chapter helpers ───────────────────────────────────────────────────────────

interface Chapter {
  startTime: number
  title: string
  img?: string
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  requireFfmpeg()

  const args = process.argv.slice(2)
  const issueFlag = args.indexOf('--issue')
  if (issueFlag === -1 || !args[issueFlag + 1]) {
    console.error('Usage: stitch.ts --issue <issueId> [--dry-run]')
    process.exit(1)
  }
  const issueId = args[issueFlag + 1]
  const dryRun = args.includes('--dry-run')

  const privkey = await loadPrivateKey()

  const pool = new SimplePool()

  console.log(`[stitch] Fetching manifest for ${issueId}…`)
  const manifest = await fetchManifest(issueId, pool)

  if (manifest.episodeStatus === 'published') {
    console.log('[stitch] Episode already published. Use --force to re-stitch.')
    if (!args.includes('--force')) {
      pool.close(DEFAULT_RELAYS)
      process.exit(0)
    }
  }

  // Collect all segment ids referenced in non-excluded sections
  // A section is excluded iff all its segments are in excluded[], or it has no order
  const activeSections = manifest.sections.filter(
    (s) =>
      s.introEventId !== 'excluded' && // AdminPanel section-exclude sentinel
      s.order.some((id) => !s.excluded.includes(id)),
  )
  // Within a section, only include segments NOT in the excluded list
  const allSegmentIds = [
    ...new Set(
      activeSections.flatMap((s) => s.order.filter((id) => !s.excluded.includes(id))),
    ),
  ]

  console.log(
    `[stitch] ${activeSections.length} active sections, ${allSegmentIds.length} segments`,
  )

  const segments = await fetchSegments(allSegmentIds, pool)
  pool.close(DEFAULT_RELAYS)

  if (dryRun) {
    console.log('[stitch] Dry run — segment inventory:')
    for (const [id, seg] of segments) {
      const secs = seg.content.audio.duration.toFixed(1)
      console.log(`  ${id.slice(0, 8)} | ${secs}s | ${seg.content.audio.url}`)
    }
    return
  }

  // Working directory
  const workDir = join(tmpdir(), `logbook-stitch-${issueId}-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  console.log(`[stitch] Working in ${workDir}`)

  const chapters: Chapter[] = []
  let cursor = 0 // seconds elapsed

  const sectionWavs: string[] = []

  for (const section of activeSections) {
    console.log(`[stitch] Processing section: ${section.title}`)
    const clipWavs: string[] = []

    for (const segId of section.order) {
      if (section.excluded.includes(segId)) continue
      const seg = segments.get(segId)
      if (!seg) {
        console.warn(`[stitch] Segment ${segId} not found, skipping`)
        continue
      }

      const ext = seg.content.audio.mime.includes('webm') ? 'webm' : 'ogg'
      const rawPath = join(workDir, `${segId}.${ext}`)

      console.log(`  ↓ ${seg.content.audio.url}`)
      await downloadBlob(seg.content.audio.url, rawPath)

      const normPath = loudnorm(rawPath, workDir)
      const trimPath = trimSilence(normPath, workDir)
      clipWavs.push(trimPath)
    }

    if (!clipWavs.length) {
      console.warn(`[stitch] Section ${section.id} has no processable clips, skipping`)
      continue
    }

    // Record chapter start time
    chapters.push({ startTime: cursor, title: section.title })

    const sectionWav = join(workDir, `section-${section.id}.wav`)
    concatSection(clipWavs, sectionWav)

    // Measure section duration for chapter cursor
    const durationResult = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', sectionWav],
      { encoding: 'utf-8' },
    )
    const sectionDuration = parseFloat(durationResult.stdout.trim()) || 0
    cursor += sectionDuration

    sectionWavs.push(sectionWav)
  }

  if (!sectionWavs.length) {
    console.error('[stitch] No sections to stitch. Aborting.')
    process.exit(1)
  }

  // Acrossfade sections together
  let stitchedWav: string
  if (sectionWavs.length === 1) {
    stitchedWav = sectionWavs[0]
  } else {
    let prev = sectionWavs[0]
    for (let i = 1; i < sectionWavs.length; i++) {
      const faded = join(workDir, `faded-${i}.wav`)
      acrossfade(prev, sectionWavs[i], faded)
      prev = faded
    }
    stitchedWav = prev
  }

  // Encode to mp3
  mkdirSync(AUDIO_DIR, { recursive: true })
  const mp3Path = join(AUDIO_DIR, `${issueId}.mp3`)
  console.log(`[stitch] Encoding mp3 → ${mp3Path}`)
  encodeMp3(stitchedWav, mp3Path)

  // Write chapters JSON
  const chaptersPath = join(AUDIO_DIR, `${issueId}-chapters.json`)
  const chaptersJson = {
    version: '1.2.0',
    chapters: chapters.map((c) => ({
      startTime: Math.round(c.startTime * 1000), // milliseconds
      title: c.title,
    })),
  }
  writeFileSync(chaptersPath, JSON.stringify(chaptersJson, null, 2))
  console.log(`[stitch] Chapters → ${chaptersPath}`)

  // Cleanup working directory
  rmSync(workDir, { recursive: true, force: true })

  console.log(`[stitch] Done. Output: ${mp3Path}`)
  console.log(`[stitch] Chapters: ${chaptersPath}`)

  // Print chapter list
  for (const ch of chaptersJson.chapters) {
    const mins = Math.floor(ch.startTime / 60000)
    const secs = Math.floor((ch.startTime % 60000) / 1000)
    console.log(`  ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} — ${ch.title}`)
  }

  // CUR-01: publish kind 7 reaction (🎙️) from Compass npub on each included segment
  const includedIds = activeSections
    .flatMap(s => s.order.filter(id => !s.excluded.includes(id)))
    .filter(id => segments.has(id))
  if (includedIds.length > 0) {
    console.log(`[stitch] Publishing ${includedIds.length} kind 7 reactions...`)
    const reactPool = new SimplePool()
    for (const segId of includedIds) {
      try {
        const reaction = finalizeEvent({
          kind: KINDS.REACTION,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', segId], ['k', String(KINDS.SEGMENT)]],
          content: '🎙️',
        }, privkey)
        await Promise.any(reactPool.publish(DEFAULT_RELAYS, reaction))
      } catch {
        // fire-and-forget, don't block on reaction failures
      }
    }
    reactPool.close(DEFAULT_RELAYS)
    console.log(`[stitch] Reactions published.`)
  }
}

main().catch((err) => {
  console.error('[stitch] Fatal:', err)
  process.exit(1)
})

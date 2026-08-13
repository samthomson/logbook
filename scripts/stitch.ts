/**
 * stitch.ts — VPS stitcher
 *
 * Reads a kind 34200 manifest from relay, downloads all segment audio blobs
 * from Blossom, applies EBU R128 loudness normalisation + silence trim, then
 * stitches sections together with acrossfade and encodes to mp3 128 kbps.
 *
 * Usage (NIP-46 via COMPASS_BUNKER_URI + COMPASS_BUNKER_CLIENT_KEY):
 *   npm run stitch -- --issue logbook-31
 *   npm run stitch -- --issue logbook-31 --dry-run
 *
 * Requirements: ffmpeg must be in PATH.
 */

import { SimplePool } from 'nostr-tools/pool'
import { nip19, type NostrEvent } from 'nostr-tools'

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fetch from 'node-fetch'
import {
  COMPASS_PUBKEY,
  RELAYS,
  KINDS,
  AUDIO_DIR,
  BLOSSOM_SERVERS,
} from './config.ts'
import { uploadToBlossom } from './blossom.ts'
import { parseVerifiedSegment, verifyNostrEvent } from './segment-security.ts'
import { downloadVerifiedBlob } from './stitch-download.ts'
import { assertLockedSegmentsPresent, assertStitchableManifest, collectLockedSegmentIds, selectActiveSections } from './stitch-state.ts'
import { latestVerifiedManifest, type ManifestEvent } from './watch-state.ts'
import { manifestRevision } from './release-state.ts'
import { madeTheCutReactionTags } from './made-the-cut.ts'
import { requiredChapterTargets } from './issue-targets.ts'
import {
  acrossfade,
  assertHasAudioStream,
  concatSection,
  encodeMp3,
  loudnorm,
  requireFfmpeg,
  trimSilence,
} from './stitch-media.ts'
import { createCompassAmberSigner } from './amber-signer.ts'

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
  sectionExcluded?: boolean
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

// ── download helpers ──────────────────────────────────────────────────────────

/**
 * Download a Blossom blob and verify its sha256 against the segment event's
 * declared hash. On any failure (network, hash mismatch), rewrite the URL
 * path onto the next known Blossom server and retry. A segment whose blob
 * cannot be verified from ANY mirror is a hard error — silently skipping it
 * would ship an incomplete episode.
 */
async function downloadBlob(url: string, destPath: string, expectedSha256: string): Promise<void> {
  await downloadVerifiedBlob({
    url,
    destPath,
    expectedSha256,
    servers: BLOSSOM_SERVERS,
    fetchImpl: async (candidate, init) => fetch(candidate, init),
  })
}

// ── relay helpers ─────────────────────────────────────────────────────────────

async function fetchManifest(issueId: string, pool: SimplePool): Promise<{ manifest: ManifestContent; event: ManifestEvent }> {
  const events = await pool.querySync(RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],
    '#d': [issueId],
    limit: 50,
  })

  const event = latestVerifiedManifest(events as ManifestEvent[], issueId, {
    expectedPubkey: COMPASS_PUBKEY,
    verify: (candidate) => verifyNostrEvent(candidate as never),
  })
  if (!event) throw new Error(`No verified manifest found for issue ${issueId}`)

  return { manifest: JSON.parse(event.content) as ManifestContent, event }
}

async function fetchRequiredChapterIds(
  issueId: string,
  manifest: ManifestContent,
  pool: SimplePool,
): Promise<string[]> {
  const issueNumber = manifest.issueNumber ?? Number(issueId.match(/(\d+)$/)?.[1])
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`[stitch] Cannot determine newsletter number for ${issueId}`)
  }

  let identifier = String(issueNumber)
  try {
    const decoded = nip19.decode(manifest.issueRef)
    if (decoded.type === 'naddr') {
      const address = decoded.data
      if (address.kind === KINDS.COMPASS_ISSUE && address.pubkey === COMPASS_PUBKEY) {
        identifier = address.identifier
      }
    }
  } catch {
    // Older manifests may not have a valid naddr. The issue-number fallback is
    // deterministic; the fetched newsletter is still signature checked.
  }

  const candidates = await pool.querySync(RELAYS, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    '#d': [...new Set([identifier, String(issueNumber), issueId])],
    limit: 20,
  })
  const issue = (candidates as NostrEvent[])
    .filter((event) => event.pubkey === COMPASS_PUBKEY && verifyNostrEvent(event as never))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]
  if (!issue) throw new Error(`[stitch] No verified Compass newsletter found for ${issueId}`)

  const targets = requiredChapterTargets(issue.content, issueNumber)
  if (!targets.length) throw new Error(`[stitch] Newsletter ${issueId} has no recording chapters`)
  return targets.map((target) => target.id)
}

async function fetchSegments(
  segmentIds: string[],
  pool: SimplePool,
): Promise<Map<string, Segment>> {
  if (!segmentIds.length) return new Map()

  const events = await pool.querySync(RELAYS, {
    kinds: [KINDS.SEGMENT],
    ids: segmentIds,
  })

  const map = new Map<string, Segment>()
  for (const e of events) {
    try {
      parseVerifiedSegment(e, BLOSSOM_SERVERS)
      const content = JSON.parse(e.content) as SegmentContent
      map.set(e.id, { id: e.id, pubkey: e.pubkey, content, createdAt: e.created_at })
    } catch (err) {
      console.warn(`[stitch] Rejected untrusted segment ${e.id}: ${err instanceof Error ? err.message : String(err)}`)
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

  const signer = createCompassAmberSigner()

  const pool = new SimplePool()

  console.log(`[stitch] Fetching manifest for ${issueId}…`)
  const { manifest, event: manifestEvent } = await fetchManifest(issueId, pool)
  const force = args.includes('--force')
  const requiredChapterIds = manifest.episodeStatus === 'cutting' || force
    ? await fetchRequiredChapterIds(issueId, manifest, pool)
    : []

  const stitchState = assertStitchableManifest(manifest, {
    force,
    requiredChapterIds,
  })
  if (stitchState === 'already-published') {
    console.log('[stitch] Episode already published. Use --force to re-stitch.')
    pool.close(RELAYS)
    return
  }

  // Collect all segment ids referenced in non-excluded sections.
  const activeSections = selectActiveSections(manifest.sections)
  const allSegmentIds = collectLockedSegmentIds(activeSections)

  console.log(
    `[stitch] ${activeSections.length} active sections, ${allSegmentIds.length} segments`,
  )

  const segments = await fetchSegments(allSegmentIds, pool)
  pool.close(RELAYS)
  assertLockedSegmentsPresent(activeSections, segments)

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
        throw new Error(
          `[stitch] Segment ${segId} is in the locked manifest but not on any relay. ` +
          `Fix the manifest (exclude it) and re-lock, or restore the segment event.`,
        )
      }

      const ext = seg.content.audio.mime.includes('webm') ? 'webm' : 'ogg'
      const rawPath = join(workDir, `${segId}.${ext}`)

      console.log(`  ↓ ${seg.content.audio.url}`)
      // Hard-fail the run if the blob can't be fetched AND hash-verified from
      // any mirror — silently dropping a locked segment ships a broken episode.
      await downloadBlob(seg.content.audio.url, rawPath, seg.content.audio.sha256)
      assertHasAudioStream(rawPath)

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

  // Upload the final mp3 to Blossom — the canonical public URL for the episode
  console.log(`[stitch] Uploading mp3 to Blossom…`)
  const mp3Buffer = readFileSync(mp3Path)
  const blob = await uploadToBlossom(mp3Buffer, 'audio/mpeg', signer)
  console.log(`[stitch] Episode URL: ${blob.url} (+${blob.urls.length - 1} mirrors)`)

  // Measure duration for RSS
  const mp3Probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp3Path],
    { encoding: 'utf-8' },
  )
  const mp3Duration = parseFloat(mp3Probe.stdout.trim()) || 0

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

  // Run metadata consumed by publish-rss.ts (episode URL, hashes, contributors)
  const includedIds = activeSections
    .flatMap((s) => s.order.filter((id) => !s.excluded.includes(id)))
    .filter((id) => segments.has(id))
  const contributorPubkeys = [...new Set(includedIds.map((id) => segments.get(id)!.pubkey))]
  const metaPath = join(AUDIO_DIR, `${issueId}-run.json`)
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        issueId,
        // Release publication must use this exact verified cutting revision,
        // rather than whichever replacement happens to arrive later.
        manifest: manifestRevision(manifestEvent),
        mp3Url: blob.url,
        mp3Urls: blob.urls,
        mp3Sha256: blob.sha256,
        mp3Size: blob.size,
        durationSeconds: mp3Duration,
        chaptersUrl: null as string | null, // filled in by publish-rss after chapter upload
        segmentIds: includedIds,
        contributorPubkeys,
        stitchedAt: Math.floor(Date.now() / 1000),
      },
      null,
      2,
    ),
  )
  console.log(`[stitch] Run metadata → ${metaPath}`)

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
  if (includedIds.length > 0) {
    console.log(`[stitch] Publishing ${includedIds.length} kind 7 reactions...`)
    const reactPool = new SimplePool()
    for (const segId of includedIds) {
      try {
        const reaction = await signer.signEvent({
          kind: KINDS.REACTION,
          created_at: Math.floor(Date.now() / 1000),
          tags: madeTheCutReactionTags(segId, segments.get(segId)!.pubkey),
          content: '🎙️',
        })
        await Promise.any(reactPool.publish(RELAYS, reaction))
      } catch {
        // fire-and-forget, don't block on reaction failures
      }
    }
    reactPool.close(RELAYS)
    console.log(`[stitch] Reactions published.`)
  }
}

main().catch((err) => {
  console.error('[stitch] Fatal:', err)
  process.exit(1)
})

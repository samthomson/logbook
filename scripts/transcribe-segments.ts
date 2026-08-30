/**
 * transcribe-segments.ts — VPS transcription of every upload.
 *
 * Browser-side transcription was removed for audit cause (93cb11b); the VPS is
 * the single engine. Each sweep: collect issues that have a verified manifest
 * from a trusted producer, find their segments needing a transcript — none
 * yet, or a producer's retranscribe request newer than the one they have —
 * download the audio from the configured Blossom origins, run whisper.cpp,
 * and publish a kind 1111 companion event from the Compass npub.
 *
 * Scoping to manifest issues bounds VPS compute and bunker signatures to
 * episodes the production pipeline actually knows about; the per-sweep cap
 * keeps one backlog from monopolising a tick. Per-segment data failures
 * (malformed segment, dead mirrors, empty output) are skipped and logged;
 * signer or relay failures abort the sweep — the next tick retries and the
 * covered-set prevents duplicates.
 */

import { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { BLOSSOM_SERVERS, COMPASS_PUBKEY, RELAYS, KINDS } from './config.ts'
import type { CompassSigner, SignedNostrEvent, UnsignedNostrEvent } from './amber-signer.ts'
import { getTrustedBlobCandidates, parseVerifiedSegment, verifyNostrEvent, type VerifiedSegment } from './segment-security.ts'
import { verifiedManifestIssueIds, type ManifestEvent } from './watch-state.ts'

/** Sentence-level transcript unit; timestamps are seconds into the note. */
export interface TranscriptChunk {
  text: string
  timestamp: [number, number | null]
}

export interface TranscribeSweepDependencies {
  fetchManifests: () => Promise<NostrEvent[]>
  /** One pubkey, or the trusted producer set (Compass plus its appointees). */
  expectedPubkey: string | ReadonlySet<string>
  verify: (event: ManifestEvent) => boolean
  fetchSegments: (issueIds: string[]) => Promise<NostrEvent[]>
  fetchTranscriptEvents: (segmentIds: string[]) => Promise<NostrEvent[]>
  /** Kind 34202 retranscribe requests on the segments (producer-authored only). */
  fetchRetranscribeRequests: (segmentIds: string[]) => Promise<NostrEvent[]>
  downloadVerified: (url: string, destPath: string, sha256: string) => Promise<void>
  transcribe: (audioPath: string, workDir: string) => { text: string; chunks: TranscriptChunk[] }
  makeWorkDir: () => string
  removeWorkDir: (dir: string) => void
  signEvent: (unsigned: UnsignedNostrEvent) => Promise<SignedNostrEvent>
  publish: (event: SignedNostrEvent) => Promise<void>
}

export interface TranscribeSweepOptions {
  /** Segments transcribed per sweep; the remainder waits for the next tick. */
  maxPerSweep?: number
  /** Redo every segment's transcript regardless of coverage. Set after a
   * model bump so existing companions catch up to the new weights. */
  retranscribeAll?: boolean
}

export interface TranscribeSweepResult {
  missing: number
  transcribed: number
  skipped: number
  deferred: number
}

const emptyResult: TranscribeSweepResult = { missing: 0, transcribed: 0, skipped: 0, deferred: 0 }

/**
 * A segment is covered only by a signature-verified kind 1111 event from the
 * segment's own author or the Compass npub — the same trust tiers the PWA
 * renders. Unverified or third-party companions never suppress the sweep, so
 * spam cannot starve an episode of transcripts. Returns the newest trusted
 * companion's created_at, so a later retranscribe request can out-age it.
 */
function trustedCompanionAt(segment: NostrEvent, transcripts: NostrEvent[]): number | null {
  let newest: number | null = null
  for (const event of transcripts) {
    if (!event.tags.some(([key, value]) => key === 'e' && value === segment.id)) continue
    if (!event.tags.some(([key, value]) => key === 'k' && value === String(KINDS.SEGMENT))) continue
    if (!verifyNostrEvent(event)) continue
    if (event.pubkey !== segment.pubkey && event.pubkey !== COMPASS_PUBKEY) continue
    if (newest === null || event.created_at > newest) newest = event.created_at
  }
  return newest
}

function producerSetOf(expected: string | ReadonlySet<string>): ReadonlySet<string> {
  const set = new Set<string>(
    (typeof expected === 'string' ? [expected] : [...expected]).map((pubkey) => pubkey.toLowerCase()),
  )
  set.add(COMPASS_PUBKEY.toLowerCase())
  return set
}

/**
 * A retranscribe request is Logbook's own kind 34202 event — a command in the
 * same application family as the manifest (34200) and whitelist (34201), not a
 * Nostr social reaction. It must be signature-verified and authored by a
 * trusted producer; a request older than the companion it asked to redo is
 * already satisfied.
 */
export function isVerifiedRetranscribeRequest(
  event: NostrEvent,
  producers: ReadonlySet<string>,
): boolean {
  return event.kind === KINDS.RETRANSCRIBE
    && event.tags.some(([key, value]) => key === 'e' && value)
    && verifyNostrEvent(event)
    && producers.has(event.pubkey.toLowerCase())
}

function requestedAt(
  segment: NostrEvent,
  requests: NostrEvent[],
  producers: ReadonlySet<string>,
): number | null {
  let newest: number | null = null
  for (const event of requests) {
    if (!isVerifiedRetranscribeRequest(event, producers)) continue
    if (!event.tags.some(([key, value]) => key === 'e' && value === segment.id)) continue
    if (newest === null || event.created_at > newest) newest = event.created_at
  }
  return newest
}

function segmentIssueTag(event: NostrEvent): string | null {
  const issue = event.tags.find(([key]) => key === 'issue')?.[1]
  return typeof issue === 'string' && issue.length > 0 ? issue : null
}

export async function runTranscribeSweep(
  dependencies: TranscribeSweepDependencies,
  options: TranscribeSweepOptions = {},
): Promise<TranscribeSweepResult> {
  const maxPerSweep = options.maxPerSweep ?? 5
  const manifests = await dependencies.fetchManifests()
  const issueIds = verifiedManifestIssueIds(manifests, {
    expectedPubkey: dependencies.expectedPubkey,
    verify: dependencies.verify,
  })
  if (issueIds.length === 0) return emptyResult

  // The relay '#t' filter is advisory; scope again on the issue tag.
  const scoped = (await dependencies.fetchSegments(issueIds))
    .filter((event) => issueIds.includes(segmentIssueTag(event) ?? ''))

  const verified: { event: NostrEvent; parsed: VerifiedSegment }[] = []
  for (const event of scoped) {
    try {
      verified.push({ event, parsed: parseVerifiedSegment(event, BLOSSOM_SERVERS) })
    } catch (err) {
      console.warn(`[transcribe] ${event.id.slice(0, 8)}: rejected segment (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  const transcripts = verified.length
    ? await dependencies.fetchTranscriptEvents(verified.map(({ event }) => event.id))
    : []
  const producers = producerSetOf(dependencies.expectedPubkey)
  const requests = verified.length && !options.retranscribeAll
    ? await dependencies.fetchRetranscribeRequests(verified.map(({ event }) => event.id))
    : []
  const missing = verified.filter(({ event }) => {
    if (options.retranscribeAll) return true
    const companionAt = trustedCompanionAt(event, transcripts)
    if (companionAt === null) return true
    const requestAt = requestedAt(event, requests, producers)
    return requestAt !== null && requestAt > companionAt
  })
  if (missing.length === 0) return emptyResult

  const batch = missing.slice(0, maxPerSweep)
  const result: TranscribeSweepResult = {
    missing: missing.length,
    transcribed: 0,
    skipped: 0,
    deferred: missing.length - batch.length,
  }

  const workDir = dependencies.makeWorkDir()
  try {
    for (const { event, parsed } of batch) {
      // Data failures skip this segment; signer/relay failures propagate and
      // end the sweep so a dead bunker is not hammered once per segment.
      const ext = parsed.audio.mime.includes('webm') ? 'webm' : 'ogg'
      const audioPath = join(workDir, `${event.id}.${ext}`)
      try {
        await dependencies.downloadVerified(parsed.audio.url, audioPath, parsed.audio.sha256)
      } catch (err) {
        result.skipped++
        console.warn(`[transcribe] ${event.id.slice(0, 8)}: download failed (${err instanceof Error ? err.message : String(err)})`)
        continue
      }
      let transcript: { text: string; chunks: TranscriptChunk[] }
      try {
        transcript = dependencies.transcribe(audioPath, workDir)
      } catch (err) {
        result.skipped++
        console.warn(`[transcribe] ${event.id.slice(0, 8)}: whisper failed (${err instanceof Error ? err.message : String(err)})`)
        continue
      }
      if (!transcript.text.trim()) {
        result.skipped++
        console.warn(`[transcribe] ${event.id.slice(0, 8)}: empty transcript, skipping`)
        continue
      }

      const signed = await dependencies.signEvent({
        kind: KINDS.TRANSCRIPT,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', event.id, '', 'root'],
          ['k', String(KINDS.SEGMENT)],
          ['issue', parsed.issueId],
          ['alt', `Transcript of Logbook segment ${event.id.slice(0, 8)}`],
        ],
        content: JSON.stringify({ text: transcript.text, chunks: transcript.chunks }),
      })
      await dependencies.publish(signed)
      result.transcribed++
      console.log(`[transcribe] ${event.id.slice(0, 8)}: transcript published (${transcript.text.length} chars)`)
    }
  } finally {
    dependencies.removeWorkDir(workDir)
  }
  return result
}

// ─── whisper-cli plumbing ─────────────────────────────────────────────────────

/**
 * Parse whisper-cli's `-oj` output into sentence-level chunks. Whisper emits
 * one row per utterance with millisecond offsets; tokens are discarded —
 * word-level detail bloats the event for little value.
 */
export function parseWhisperTranscription(json: string): { text: string; chunks: TranscriptChunk[] } {
  let parsed: { transcription?: unknown }
  try {
    parsed = JSON.parse(json) as { transcription?: unknown }
  } catch {
    throw new Error('whisper JSON output is not parseable')
  }
  if (!Array.isArray(parsed.transcription)) {
    throw new Error('whisper JSON output has no transcription array')
  }
  const chunks: TranscriptChunk[] = []
  for (const row of parsed.transcription) {
    if (!row || typeof row !== 'object') continue
    const { text, offsets } = row as { text?: unknown; offsets?: { from?: unknown; to?: unknown } }
    if (typeof text !== 'string' || !text.trim()) continue
    if (
      !offsets
      || typeof offsets.from !== 'number'
      || typeof offsets.to !== 'number'
      || !Number.isFinite(offsets.from)
      || !Number.isFinite(offsets.to)
    ) {
      continue
    }
    chunks.push({
      text: text.trim(),
      timestamp: [offsets.from / 1000, offsets.to / 1000],
    })
  }
  if (chunks.length === 0) throw new Error('whisper produced no transcription segments')
  return { text: chunks.map((chunk) => chunk.text).join(' '), chunks }
}

/**
 * Fail before the watcher starts polling rather than at the first segment it
 * needs to transcribe, which could be days later.
 */
export function assertWhisperConfigured(modelPath: string): void {
  const probe = spawnSync('whisper-cli', ['--help'], { encoding: 'utf-8' })
  if (probe.error) {
    throw new Error(
      'whisper-cli not found in PATH. The worker image bakes it in; for a host run install whisper.cpp: https://github.com/ggml-org/whisper.cpp',
    )
  }
  if (!existsSync(modelPath)) {
    throw new Error(
      `Whisper model not found: ${modelPath}. Download one, e.g.:\n` +
      `  curl -L -o ${modelPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`,
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

/** whisper-cli reads flac/mp3/ogg/wav; PWA recordings are webm/opus, so every
 * clip is transcoded to 16 kHz mono WAV by the stitcher's ffmpeg first. */
function ffmpegToWav(audioPath: string, wavPath: string): void {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-vn', wavPath],
    { encoding: 'utf-8', timeout: 120_000 },
  )
  if (result.status !== 0 || !existsSync(wavPath)) {
    throw new Error(`ffmpeg decode failed:\n${result.stderr ?? ''}`)
  }
}
/** Conditions whisper's decoding toward the corpus vocabulary — domain terms
 * (Nostr, npub, sats) are exactly what small models mangle worst. */
const WHISPER_INIT_PROMPT =
  'Transcripts of Logbook, an async voice podcast about Nostr, Compass, Bitcoin, lightning, relays, npubs, and open-source software. Contributors record informal voice notes.'

function whisperTranscribe(modelPath: string): (audioPath: string, workDir: string) => { text: string; chunks: TranscriptChunk[] } {
  return (audioPath, workDir) => {
    const wavPath = join(workDir, 'audio-16k.wav')
    ffmpegToWav(audioPath, wavPath)
    // whisper-cli writes <prefix>.json; -np suppresses progress spam.
    const outPrefix = join(workDir, 'transcript')
    const result = spawnSync(
      'whisper-cli',
      ['-m', modelPath, '-f', wavPath, '-oj', '-of', outPrefix, '-np', '--prompt', WHISPER_INIT_PROMPT],
    )
    if (result.status !== 0) {
      throw new Error(`whisper-cli failed:\n${result.stderr ?? ''}\n${result.stdout ?? ''}`)
    }
    // whisper-cli exits 0 even on input it cannot decode; the missing file is
    // the only failure signal, so check it before reading.
    const jsonPath = `${outPrefix}.json`
    if (!existsSync(jsonPath)) {
      throw new Error(`whisper-cli produced no transcript json:\n${result.stdout ?? ''}`)
    }
    return parseWhisperTranscription(readFileSync(jsonPath, 'utf-8'))
  }
}

export interface TranscribeDependencyOptions {
  modelPath: string
  fetchManifests: () => Promise<NostrEvent[]>
  expectedPubkey: string | ReadonlySet<string>
  verify: (event: ManifestEvent) => boolean
  /** Backfill window start (unix seconds); omit for the live sweep. */
  since?: number
}

/** Wire the sweep to a relay pool and the Compass signer. */
export function makeTranscribeSweepDependencies(
  pool: SimplePool,
  signer: CompassSigner,
  options: TranscribeDependencyOptions,

): TranscribeSweepDependencies {
  return {
    fetchManifests: options.fetchManifests,
    expectedPubkey: options.expectedPubkey,
    verify: options.verify,
    fetchSegments: async (issueIds) => {
      const events = await pool.querySync(RELAYS, {
        kinds: [KINDS.SEGMENT],
        '#t': issueIds,
        limit: 2000,
        ...(options.since !== undefined ? { since: options.since } : {}),
      })
      return events as NostrEvent[]
    },
    fetchTranscriptEvents: async (segmentIds) => {
      const events = await pool.querySync(RELAYS, {
        kinds: [KINDS.TRANSCRIPT],
        '#e': segmentIds,
        limit: 1000,
      })
      return events as NostrEvent[]
    },
    fetchRetranscribeRequests: async (segmentIds) => {
      const events = await pool.querySync(RELAYS, {
        kinds: [KINDS.RETRANSCRIBE],
        '#e': segmentIds,
        authors: [...producerSetOf(options.expectedPubkey)],
        limit: 1000,
      })
      return events as NostrEvent[]
    },
    downloadVerified,
    transcribe: whisperTranscribe(options.modelPath),
    makeWorkDir: () => mkdtempSync(join(tmpdir(), 'logbook-transcribe-')),
    removeWorkDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    signEvent: (unsigned) => signer.signEvent(unsigned),
    publish: async (event) => {
      await Promise.any(pool.publish(RELAYS, event))
    },
  }
}

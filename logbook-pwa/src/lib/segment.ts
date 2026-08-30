import { getPool } from './pool'
/**
 * Segment publishing module.
 *
 * Builds and publishes kind 4200 segment events per SPEC.md §1.
 * Also handles companion transcript events (kind 1111).
 */

import { BLOSSOM_SERVERS, COMPASS_PUBKEY, RELAYS, KINDS, ISSUE_PREFIX } from '../config'
import type {
  NostrEvent,
  NostrSigner,
  BlobDescriptor,
  Segment,
  TranscriptChunk,
  TranscriptEvent,
} from '../types/nostr'
import { getTag, parseSegmentContent } from '../types/nostr'
import { now } from './utils'
import { filterVerified, publishToRelays } from './relay'
import { withSignerTimeout } from './signer-timeout'
import { validateTrustedBlobUrl } from './blob-trust'
import { assertEventSignedByExpected, assertExpectedSignerPubkey, assertSignerStillExpected } from './signer-identity'
import { hasReasonableEventTimestamp } from './event-time'


export interface PublishSegmentParams {
  signer: NostrSigner
  /** Authenticated principal captured when this operation was authorized. */
  expectedPubkey: string
  blob: BlobDescriptor
  duration: number
  waveform: number[]
  sectionId: string
  issueNumber: number
  respondingTo?: string
  isIntro?: boolean
  relays?: string[]
  /** Throws when the initiating auth/issue context is no longer current. */
  assertActive?: () => void
}

/**
 * Build, sign, and publish a kind 4200 segment event.
 * Returns the published event.
 */
export async function publishSegment(params: PublishSegmentParams): Promise<NostrEvent> {
  const {
    signer,
    expectedPubkey,
    blob,
    duration,
    waveform,
    sectionId,
    issueNumber,
    respondingTo,
    isIntro = false,
    relays = RELAYS,
    assertActive,
  } = params

  if (relays.length === 0) throw new Error('No relays configured')
  assertActive?.()
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertActive?.()
  assertExpectedSignerPubkey(pubkey, expectedPubkey)

  const content = JSON.stringify({
    audio: {
      url: blob.url,
      sha256: blob.sha256,
      mime: blob.mime,
      duration,
      waveform,
    },
    isIntro,
  })

  const tags: string[][] = [
    ['x', blob.sha256],
    ['section', sectionId],
    ['issue', issueId],
    // 't' tag is always indexed by relays — used as relay-level filter for fetchSegmentsForSection
    ['t', issueId],
    ['alt', isIntro ? `AI intro for section: ${sectionId}` : `Voice note on: ${sectionId}`],
  ]
  if (respondingTo) tags.push(['responding_to', respondingTo])

  const unsigned = {
    kind: KINDS.SEGMENT,
    created_at: now(),
    tags,
    content,
    pubkey,
  }

  assertActive?.()
  const event = await withSignerTimeout(signer.signEvent(unsigned), 'Signer segment signing')
  assertActive?.()
  assertEventSignedByExpected(event, expectedPubkey)
  await assertSignerStillExpected(signer, expectedPubkey, assertActive)
  await publishToRelays(event, relays)
  assertActive?.()
  return event
}

/**
 * Publish a companion transcript event (kind 1111) for an existing segment.
 * Called asynchronously after upload — the segment event is already published.
 */
export async function publishTranscript(
  segmentEvent: NostrEvent,
  transcript: string,
  signer: NostrSigner,
  expectedPubkey: string,
  relays: string[] = RELAYS,
  assertActive?: () => void,
): Promise<NostrEvent> {
  if (relays.length === 0) throw new Error('No relays configured')
  assertActive?.()
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertActive?.()
  assertExpectedSignerPubkey(pubkey, expectedPubkey)

  const tags: string[][] = [
    ['e', segmentEvent.id, '', 'root'],
    ['k', String(KINDS.SEGMENT)],
    ['alt', 'Transcript of voice note'],
  ]

  const unsigned = {
    kind: KINDS.TRANSCRIPT,
    created_at: now(),
    tags,
    content: transcript,
    pubkey,
  }

  assertActive?.()
  const event = await withSignerTimeout(signer.signEvent(unsigned), 'Signer transcript signing')
  assertActive?.()
  assertEventSignedByExpected(event, expectedPubkey)
  await assertSignerStillExpected(signer, expectedPubkey, assertActive)
  await publishToRelays(event, relays)
  assertActive?.()
  return event
}

/**
 * Fetch ALL segments for an issue in ONE relay query, grouped by section id.
 * Replaces the old per-section query pattern (N sections × same query).
 * Returns a Map<sectionId, NostrEvent[]> sorted by created_at.
 */
export async function fetchSegmentsForIssue(
  issueId: string,
  relays: string[] = RELAYS,
): Promise<Map<string, NostrEvent[]>> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    '#t': [issueId],
    limit: 2000,
  })
  const grouped = new Map<string, NostrEvent[]>()
  for (const e of selectTrustedSegmentEvents(events, issueId, BLOSSOM_SERVERS)) {
    const sectionId = e.tags.find((t) => t[0] === 'section')?.[1]
    if (!sectionId) continue
    const arr = grouped.get(sectionId) ?? []
    arr.push(e)
    grouped.set(sectionId, arr)
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
  }
  return grouped
}

/**
 * Fetch all segment events for a given section.
 *
 * Uses '#t' (issue ID) as the relay-level filter since most relays only index
 * standard single-letter tags. Results are then filtered client-side by section.
 * issueId must be provided (e.g. "logbook-1") to scope the relay query.
 */
export async function fetchSegmentsForSection(
  sectionId: string,
  issueId: string,
  relays: string[] = RELAYS,
): Promise<NostrEvent[]> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    '#t': [issueId],
    limit: 500,
  })
  // Filter client-side by section tag
  return selectTrustedSegmentEvents(events, issueId, BLOSSOM_SERVERS)
    .filter((e) => e.tags.some((t) => t[0] === 'section' && t[1] === sectionId))
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

/**
 * Fetch trusted transcript events for concrete verified segments.
 */
export async function fetchTranscripts(
  segments: Segment[],
  relays: string[] = RELAYS,
): Promise<Map<string, TranscriptEvent>> {
  if (!segments.length) return new Map()
  const segmentIds = segments.map((segment) => segment.event.id)
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.TRANSCRIPT],
    '#e': segmentIds,
  })

  return selectTrustedTranscripts(segments, events)
}

/**
 * Publish a producer's retranscribe request: Logbook's own kind 34202 event on
 * the segment — an application command like the manifest (34200), not a Nostr
 * reaction. The worker's sweep honors the newest producer request by
 * republishing the companion from the Compass npub.
 */
export async function publishRetranscribeRequest(
  segmentEvent: NostrEvent,
  signer: NostrSigner,
  expectedPubkey: string,
  relays: string[] = RELAYS,
): Promise<NostrEvent> {
  if (relays.length === 0) throw new Error('No relays configured')
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertExpectedSignerPubkey(pubkey, expectedPubkey)

  const event = await withSignerTimeout(
    signer.signEvent({
      kind: KINDS.RETRANSCRIBE,
      created_at: now(),
      tags: [['e', segmentEvent.id]],
      content: '',
      pubkey,
    }),
    'Signer retranscribe signing',
  )
  assertEventSignedByExpected(event, expectedPubkey)
  await publishToRelays(event, relays)
  return event
}
/** Newest verified producer retranscribe request per segment id. The worker
 * applies the same kind and author rules, so what this shows is what it
 * will honor. */
export function selectRetranscribeRequests(
  segments: Segment[],
  candidates: NostrEvent[],
  producers: ReadonlySet<string>,
): Map<string, number> {
  const segmentIds = new Set(segments.map((segment) => segment.event.id))
  const newest = new Map<string, number>()
  for (const event of filterVerified(candidates)) {
    if (event.kind !== KINDS.RETRANSCRIBE) continue
    if (!producers.has(event.pubkey.toLowerCase())) continue
    const segmentId = event.tags.find(([key, value]) => key === 'e' && value)?.[1]
    if (!segmentId || !segmentIds.has(segmentId)) continue
    const at = newest.get(segmentId)
    if (at === undefined || event.created_at > at) newest.set(segmentId, event.created_at)
  }
  return newest
}

export async function fetchRetranscribeRequests(
  segments: Segment[],
  producers: ReadonlySet<string>,
  relays: string[] = RELAYS,
): Promise<Map<string, number>> {
  if (!segments.length) return new Map()
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.RETRANSCRIBE],
    '#e': segments.map((segment) => segment.event.id),
    authors: [...producers],
  })
  return selectRetranscribeRequests(segments, events, producers)
}

const MAX_TRANSCRIPT_CHARS = 200_000

/** Chunk timestamps are untrusted relay content; malformed rows are dropped. */
function parseTranscriptChunks(value: unknown): TranscriptChunk[] {
  if (!Array.isArray(value)) return []
  const chunks: TranscriptChunk[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const { text, timestamp } = row as { text?: unknown; timestamp?: unknown }
    if (typeof text !== 'string' || !Array.isArray(timestamp) || timestamp.length !== 2) continue
    const [start, end] = timestamp as [unknown, unknown]
    if (typeof start !== 'number' || !Number.isFinite(start)) continue
    if (end !== null && (typeof end !== 'number' || !Number.isFinite(end))) continue
    chunks.push({ text, timestamp: [start, end] })
  }
  return chunks
}

function parseTranscriptContent(content: string): { text: string; chunks: TranscriptChunk[] } | null {
  if (content.length > MAX_TRANSCRIPT_CHARS) return null
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      const text = parsed.text
      if (typeof text !== 'string' || text.length > MAX_TRANSCRIPT_CHARS) return null
      const chunks = 'chunks' in parsed ? parseTranscriptChunks(parsed.chunks) : []
      return { text, chunks }
    }
  } catch {
    // Worker transcripts carry sentence chunks; author transcripts are plain text.
  }
  return { text: content, chunks: [] }
}

/** Select transcripts independent of relay ordering and reject forged linkage. */
export function selectTrustedTranscripts(
  segments: Segment[],
  candidates: NostrEvent[],
  fallbackAuthor = COMPASS_PUBKEY,
): Map<string, TranscriptEvent> {
  const verifiedSegmentIds = new Set(filterVerified(segments.map((segment) => segment.event)).map((event) => event.id))
  const byId = new Map(segments
    .filter((segment) => verifiedSegmentIds.has(segment.event.id))
    .map((segment) => [segment.event.id, segment]))
  const selectedPrimary = new Map<string, NostrEvent>()
  const selectedFallback = new Map<string, NostrEvent>()

  for (const event of filterVerified(candidates)) {
    if (event.kind !== KINDS.TRANSCRIPT) continue
    const eTags = event.tags.filter((tag) => tag[0] === 'e' && tag[1])
    const kTags = event.tags.filter((tag) => tag[0] === 'k' && tag[1])
    if (eTags.length !== 1 || kTags.length !== 1 || kTags[0][1] !== String(KINDS.SEGMENT)) continue
    const segmentId = eTags[0][1]
    const segment = byId.get(segmentId)
    const transcript = parseTranscriptContent(event.content)
    if (!segment || transcript === null) continue
    // A verified Compass fallback is authoritative only when the segment's
    // author has not supplied a verified companion transcript.
    const selected = event.pubkey === segment.event.pubkey
      ? selectedPrimary
      : event.pubkey === fallbackAuthor
        ? selectedFallback
        : null
    if (!selected) continue
    const previous = selected.get(segmentId)
    if (!previous || event.created_at > previous.created_at || (
      event.created_at === previous.created_at && event.id.localeCompare(previous.id) > 0
    )) selected.set(segmentId, event)
  }

  return new Map([...byId.keys()].flatMap((segmentId) => {
    const event = selectedPrimary.get(segmentId) ?? selectedFallback.get(segmentId)
    return event ? [[segmentId, event] as const] : []
  }).map(([segmentId, event]) => {
    // Re-parsing the same content that passed the selection loop's check.
    const { text, chunks } = parseTranscriptContent(event.content)!
    return [segmentId, { event, segmentEventId: segmentId, text, chunks }] as const
  }))
}

/**
 * Parse a raw kind 4200 NostrEvent into a typed Segment.
 * Returns null if the event is malformed.
 */
export function parseSegment(event: NostrEvent): Segment | null {
  const content = parseSegmentContent(event.content)
  if (!content) return null

  const sectionId = getTag(event, 'section')
  const issueId = getTag(event, 'issue')
  if (!sectionId || !issueId) return null

  // Normalize waveform to 0–1 range. SPEC.md says 0–255; this client writes
  // 0–1. Defensively downscale anything that looks like the 0–255 scale and
  // clamp every sample so out-of-range relay data can't break layout.
  if (Array.isArray(content.audio.waveform)) {
    const max = Math.max(...content.audio.waveform.map((v) => Number(v) || 0), 0)
    const scale = max > 2 ? 255 : 1
    content.audio.waveform = content.audio.waveform.map((v) => {
      const n = (Number(v) || 0) / scale
      return Math.min(1, Math.max(0, n))
    })
  } else {
    content.audio.waveform = []
  }

  return {
    event,
    audio: content.audio,
    isIntro: content.isIntro,
    sectionId,
    issueId,
    respondingTo: getTag(event, 'responding_to'),
    alt: getTag(event, 'alt'),
  }
}

/**
 * Fail closed at the relay boundary before segment metadata reaches the UI.
 * Event signatures, issue tags, hash metadata, and Blossom URL policy must all
 * agree. Invalid events cannot enter curation or a locked cut.
 */
export function selectTrustedSegmentEvents(
  events: NostrEvent[],
  expectedIssueId: string | null,
  trustedServers: readonly string[],
): NostrEvent[] {
  return filterVerified(events).filter((event) => {
    if (!hasReasonableEventTimestamp(event)) return false
    if (event.kind !== KINDS.SEGMENT) return false
    if (expectedIssueId && (
      getTag(event, 'issue') !== expectedIssueId || getTag(event, 't') !== expectedIssueId
    )) return false

    const sectionId = getTag(event, 'section')
    const tagHash = getTag(event, 'x')
    const content = parseSegmentContent(event.content)
    if (!sectionId || !tagHash || !content) return false
    const { audio } = content
    if (
      typeof audio.url !== 'string' ||
      typeof audio.sha256 !== 'string' ||
      audio.sha256 !== tagHash ||
      typeof audio.duration !== 'number' ||
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0 ||
      typeof audio.mime !== 'string'
    ) return false
    try {
      validateTrustedBlobUrl(audio.url, audio.sha256, trustedServers)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Fetch specific segment events by their event IDs.
 * Used by the episode page to load ordered segments from a manifest.
 */
export async function fetchSegmentsByIds(
  ids: string[],
  relays: string[] = RELAYS,
): Promise<NostrEvent[]> {
  if (!ids.length) return []
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    ids,
  })
  return selectTrustedSegmentEvents(events, null, BLOSSOM_SERVERS)
    .filter((event) => ids.includes(event.id))
}

/**
 * Segment publishing module.
 *
 * Builds and publishes kind 4200 segment events per SPEC.md §1.
 * Also handles companion transcript events (kind 1111).
 */

import { SimplePool } from 'nostr-tools/pool'
import { DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'
import type {
  NostrEvent,
  NostrSigner,
  BlobDescriptor,
  Segment,
  TranscriptEvent,
} from '../types/nostr'
import { getTag, parseSegmentContent } from '../types/nostr'
import { now } from './utils'

let _pool: SimplePool | null = null
function getPool(): SimplePool {
  if (!_pool) _pool = new SimplePool()
  return _pool
}

export interface PublishSegmentParams {
  signer: NostrSigner
  blob: BlobDescriptor
  duration: number
  waveform: number[]
  sectionId: string
  issueNumber: number
  respondingTo?: string   // event ID of the segment being replied to
  isIntro?: boolean
  relays?: string[]
}

/**
 * Build, sign, and publish a kind 4200 segment event.
 * Returns the published event.
 */
export async function publishSegment(params: PublishSegmentParams): Promise<NostrEvent> {
  const {
    signer,
    blob,
    duration,
    waveform,
    sectionId,
    issueNumber,
    respondingTo,
    isIntro = false,
    relays = DEFAULT_RELAYS,
  } = params

  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const pubkey = await signer.getPublicKey()

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
    ['alt', isIntro ? `AI intro for section: ${sectionId}` : `Voice note on: ${sectionId}`],
  ]

  if (respondingTo) {
    tags.push(['responding_to', respondingTo])
  }

  const unsigned = {
    kind: KINDS.SEGMENT,
    created_at: now(),
    tags,
    content,
    pubkey,
  }

  if (relays.length === 0) throw new Error('No relays configured')
  const event = await signer.signEvent(unsigned)
  const pool = getPool()
  await Promise.any(pool.publish(relays, event))
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
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent> {
  const pubkey = await signer.getPublicKey()

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

  if (relays.length === 0) throw new Error('No relays configured')
  const event = await signer.signEvent(unsigned)
  const pool = getPool()
  await Promise.any(pool.publish(relays, event))
  return event
}

/**
 * Fetch all segment events for a given section.
 * MUST include authors filter when fetching manifests — but segments are
 * authored by contributors, so we filter by section tag instead.
 */
export async function fetchSegmentsForSection(
  sectionId: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent[]> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    '#section': [sectionId],
    limit: 200,
  })
  return events.sort((a, b) => a.created_at - b.created_at)
}

/**
 * Fetch transcript events for a list of segment IDs.
 */
export async function fetchTranscripts(
  segmentIds: string[],
  relays: string[] = DEFAULT_RELAYS,
): Promise<Map<string, TranscriptEvent>> {
  if (!segmentIds.length) return new Map()
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.TRANSCRIPT],
    '#e': segmentIds,
  })

  const result = new Map<string, TranscriptEvent>()
  for (const event of events) {
    const segmentId = getTag(event, 'e')
    if (segmentId) {
      result.set(segmentId, {
        event,
        segmentEventId: segmentId,
        text: event.content,
      })
    }
  }
  return result
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
 * Fetch specific segment events by their event IDs.
 * Used by AdminPanel to load ordered segments from a manifest.
 */
export async function fetchSegmentsByIds(
  ids: string[],
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent[]> {
  if (!ids.length) return []
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    ids,
  })
  return events
}

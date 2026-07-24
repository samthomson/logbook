import type { NostrEvent } from 'nostr-tools'
import { parseVerifiedSegment, verifyNostrEvent } from './segment-security.ts'

const TRANSCRIPT_KIND = 1111
const SEGMENT_KIND = 4200
const MAX_TRANSCRIPT_CHARS = 200_000

export function assertPublishableManifest(manifest: { episodeStatus?: unknown }): void {
  if (manifest.episodeStatus !== 'cutting') {
    throw new Error('RSS publication requires the latest verified manifest to be in cutting state')
  }
}

function transcriptText(content: string): string | null {
  if (content.length > MAX_TRANSCRIPT_CHARS) return null
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      const text = (parsed as { text: unknown }).text
      return typeof text === 'string' && text.length <= MAX_TRANSCRIPT_CHARS ? text : null
    }
  } catch {
    // Historical transcript events used plain text.
  }
  return content
}

export interface TrustedReleaseMetadata {
  participantPubkeys: string[]
  transcriptBySegment: Map<string, string>
}

/** Select only release metadata cryptographically bound to included segments. */
export function selectTrustedReleaseMetadata(
  segmentIds: string[],
  segmentCandidates: NostrEvent[],
  transcriptCandidates: NostrEvent[],
  blossomServers: readonly string[],
): TrustedReleaseMetadata {
  const requestedIds = [...new Set(segmentIds)]
  const requested = new Set(requestedIds)
  const segments = new Map<string, ReturnType<typeof parseVerifiedSegment>>()

  for (const event of segmentCandidates) {
    if (!requested.has(event.id) || segments.has(event.id)) continue
    try {
      const segment = parseVerifiedSegment(event, blossomServers)
      segments.set(event.id, segment)
    } catch {
      // Fail closed below if a requested event has no verified candidate.
    }
  }
  const missing = requestedIds.filter((id) => !segments.has(id))
  if (missing.length) {
    throw new Error(`Missing verified segment event(s): ${missing.join(', ')}`)
  }

  const selectedTranscripts = new Map<string, NostrEvent>()
  for (const event of transcriptCandidates) {
    if (event.kind !== TRANSCRIPT_KIND || !verifyNostrEvent(event)) continue
    const eTags = event.tags.filter((tag) => tag[0] === 'e' && tag[1])
    const kTags = event.tags.filter((tag) => tag[0] === 'k' && tag[1])
    if (eTags.length !== 1 || kTags.length !== 1 || kTags[0][1] !== String(SEGMENT_KIND)) continue
    const segmentId = eTags[0][1]
    const segment = segments.get(segmentId)
    if (!segment || event.pubkey !== segment.event.pubkey || transcriptText(event.content) === null) continue
    const prior = selectedTranscripts.get(segmentId)
    if (!prior || event.created_at > prior.created_at || (
      event.created_at === prior.created_at && event.id.localeCompare(prior.id) > 0
    )) selectedTranscripts.set(segmentId, event)
  }

  const transcriptBySegment = new Map<string, string>()
  for (const id of requestedIds) {
    const event = selectedTranscripts.get(id)
    if (event) transcriptBySegment.set(id, transcriptText(event.content)!)
  }

  return {
    participantPubkeys: [...new Set(requestedIds.map((id) => segments.get(id)!.event.pubkey))],
    transcriptBySegment,
  }
}

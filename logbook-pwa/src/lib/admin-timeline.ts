import type { Segment } from '../types/nostr'

/**
 * The admin review queue is a read-only audit timeline of every valid recording
 * from identities currently permitted to contribute. Segment ids can arrive via
 * both legacy and current section groups, so de-duplicate before sorting.
 */
export function collectWhitelistedTimeline(
  sectionLists: Iterable<readonly Segment[]>,
  allowedPubkeys: ReadonlySet<string>,
): Segment[] {
  const byId = new Map<string, Segment>()
  for (const segments of sectionLists) {
    for (const segment of segments) {
      if (!allowedPubkeys.has(segment.event.pubkey) || byId.has(segment.event.id)) continue
      byId.set(segment.event.id, segment)
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id),
  )
}

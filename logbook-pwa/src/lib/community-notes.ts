import type { Segment } from '../types/nostr'

/**
 * Flatten loaded section lists into a deterministic, de-duplicated episode
 * index. Reading must never depend on the active signer: contributor and
 * recording permissions are write gates only.
 */
export function collectEpisodeNotes(
  sectionLists: Iterable<readonly Segment[]>,
): Segment[] {
  const byId = new Map<string, Segment>()
  for (const segments of sectionLists) {
    for (const segment of segments) {
      if (byId.has(segment.event.id)) continue
      byId.set(segment.event.id, segment)
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id),
  )
}

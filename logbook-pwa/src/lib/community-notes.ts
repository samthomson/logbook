import type { Segment } from '../types/nostr'

/**
 * Flatten loaded section lists into a deterministic, de-duplicated inbox for
 * notes from identities other than the active signer. It deliberately does
 * not consult contributor/recording permissions: those gates apply only to
 * writing; every valid relay-backed issue recording remains readable.
 */
export function collectCommunityNotes(
  sectionLists: Iterable<readonly Segment[]>,
  activePubkey: string,
): Segment[] {
  const byId = new Map<string, Segment>()
  for (const segments of sectionLists) {
    for (const segment of segments) {
      if (segment.event.pubkey === activePubkey || byId.has(segment.event.id)) continue
      byId.set(segment.event.id, segment)
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id),
  )
}

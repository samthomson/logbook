import type { NostrEvent } from '../types/nostr'

/** Select the latest revision of one addressable manifest deterministically. */
export function selectNewestManifestRevision<T extends Pick<NostrEvent, 'id' | 'created_at'>>(
  events: T[],
): T | null {
  return events.reduce<T | null>((latest, event) => {
    if (!latest) return event
    if (event.created_at !== latest.created_at) {
      return event.created_at > latest.created_at ? event : latest
    }
    return event.id > latest.id ? event : latest
  }, null)
}

/** Select one addressable-event revision without trusting relay-side filters. */
export function selectNewestAddressableRevision<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'tags'>,
>(events: T[], expectedDTag: string): T | null {
  return selectNewestManifestRevision(
    events.filter((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === expectedDTag)),
  )
}

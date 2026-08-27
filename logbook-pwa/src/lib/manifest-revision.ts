import type { EpisodeStatus, NostrEvent } from '../types/nostr'

function episodeStatusOf(event: { content?: string }): EpisodeStatus | null {
  if (typeof event.content !== 'string') return null
  try {
    const parsed = JSON.parse(event.content) as { episodeStatus?: unknown }
    if (
      parsed.episodeStatus === 'draft'
      || parsed.episodeStatus === 'cutting'
      || parsed.episodeStatus === 'published'
    ) {
      return parsed.episodeStatus
    }
  } catch {
    return null
  }
  return null
}

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

function latestPerPubkey<T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey'>>(events: T[]): T[] {
  const byPubkey = new Map<string, T[]>()
  for (const event of events) {
    const key = event.pubkey.toLowerCase()
    const group = byPubkey.get(key)
    if (group) group.push(event)
    else byPubkey.set(key, [event])
  }
  const heads: T[] = []
  for (const group of byPubkey.values()) {
    const picked = selectNewestManifestRevision(group)
    if (picked) heads.push(picked)
  }
  return heads
}

function isNewerThan<T extends Pick<NostrEvent, 'id' | 'created_at'>>(event: T, than: T): boolean {
  if (event.created_at !== than.created_at) return event.created_at > than.created_at
  return event.id > than.id
}

/**
 * Each author has one current kind 34200. Among those, a producer draft or
 * lock newer than Compass's published event is the live cut (reopen / republish).
 * An older leftover lock must not hide that publish.
 */
export function selectAuthoritativeManifestRevision<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey'> & { content?: string },
>(events: T[]): T | null {
  const heads = latestPerPubkey(events)
  const newest = selectNewestManifestRevision(heads)
  if (!newest) return null
  const published = selectNewestManifestRevision(
    heads.filter((event) => episodeStatusOf(event) === 'published'),
  )
  if (!published) return newest
  const live = selectNewestManifestRevision(
    heads.filter((event) => {
      const status = episodeStatusOf(event)
      if (status !== 'draft' && status !== 'cutting') return false
      return isNewerThan(event, published)
    }),
  )
  return live ?? published
}

/** Select one addressable-event revision without trusting relay-side filters. */
export function selectNewestAddressableRevision<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey' | 'tags'> & { content?: string },
>(events: T[], expectedDTag: string): T | null {
  return selectAuthoritativeManifestRevision(
    events.filter((event) => event.tags.some((tag) => tag[0] === 'd' && tag[1] === expectedDTag)),
  )
}

/** One newest revision per `d` tag. Relays return every replaceable revision. */
export function selectNewestPerDTag<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey' | 'tags'> & { content?: string },
>(events: T[]): T[] {
  const byD = new Map<string, T[]>()
  for (const event of events) {
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (!d) continue
    const group = byD.get(d)
    if (group) group.push(event)
    else byD.set(d, [event])
  }
  const newest: T[] = []
  for (const group of byD.values()) {
    const picked = selectAuthoritativeManifestRevision(group)
    if (picked) newest.push(picked)
  }
  return newest
}

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

function isNewerThan<T extends Pick<NostrEvent, 'id' | 'created_at'>>(event: T, than: T): boolean {
  if (event.created_at !== than.created_at) return event.created_at > than.created_at
  return event.id > than.id
}

function previousIds(event: { tags?: string[][] }): string[] {
  return (event.tags ?? [])
    .filter((tag) => tag[0] === 'previous' && typeof tag[1] === 'string' && tag[1].length > 0)
    .map((tag) => tag[1])
}

/** The recordings in the cut, ignoring publish progress Compass writes onto the same lock. */
export function cutBodyKey(content: string | undefined): string | null {
  if (typeof content !== 'string') return null
  try {
    const parsed = JSON.parse(content) as { issueRef?: unknown; sections?: unknown }
    if (!('sections' in parsed)) return null
    return JSON.stringify({ issueRef: parsed.issueRef ?? null, sections: parsed.sections })
  } catch {
    return null
  }
}

function compassProgress<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey'> & { content?: string },
>(events: T[], publishedAuthor: string): T[] {
  return events.filter((event) => (
    event.pubkey.toLowerCase() === publishedAuthor && episodeStatusOf(event) === 'cutting'
  ))
}

/**
 * Compass progress is a later cutting from the publish author; it must not hide
 * published. The leftover producer lock is the one Compass kept writing after.
 * A later producer lock of the same cut (Edit the cut → publish) is live even
 * when the published event has no previous tag.
 */
export function selectAuthoritativeManifestRevision<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey'> & { content?: string; tags?: string[][] },
>(events: T[]): T | null {
  if (events.length === 0) return null
  const published = selectNewestManifestRevision(
    events.filter((event) => episodeStatusOf(event) === 'published'),
  )
  if (!published) return selectNewestManifestRevision(events)
  const namedDead = new Set(previousIds(published))
  const publishedBody = cutBodyKey(published.content)
  const publishedAuthor = published.pubkey.toLowerCase()
  const progress = compassProgress(events, publishedAuthor)
  const live = selectNewestManifestRevision(
    events.filter((event) => {
      const status = episodeStatusOf(event)
      if (!isNewerThan(event, published) && !previousIds(event).includes(published.id)) return false
      if (status === 'draft') return true
      if (status !== 'cutting') return false
      if (namedDead.has(event.id)) return false
      if (event.pubkey.toLowerCase() === publishedAuthor) return false
      if (previousIds(event).includes(published.id)) return true
      const body = cutBodyKey(event.content)
      const sameCut = Boolean(publishedBody && body && body === publishedBody)
      if (sameCut && namedDead.size === 0) {
        if (progress.some((item) => isNewerThan(item, event))) return false
        if (progress.length === 0) return false
      }
      return true
    }),
  )
  return live ?? published
}

/** Keep every revision seen on a live subscription and re-select. */
export function foldAuthoritativeManifestRevision<
  T extends Pick<NostrEvent, 'id' | 'created_at' | 'pubkey'> & { content?: string; tags?: string[][] },
>(seen: Map<string, T>, incoming: T): T | null {
  seen.set(incoming.id, incoming)
  return selectAuthoritativeManifestRevision([...seen.values()])
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

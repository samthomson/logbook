import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { RELAYS, KINDS, RSS_PATH, STATIC_DIR } from './config.ts'
import { fetchProducerPubkeys } from './producers.ts'
import { episodeFromPublished, writeRss } from './publish-rss.ts'
import { verifyNostrEvent } from './segment-security.ts'

type PublishedEpisode = NonNullable<ReturnType<typeof episodeFromPublished>>

interface OriginFeedDependencies {
  feedExists: () => boolean
  episodeStateExists: () => boolean
  fetchProducers: (pool: SimplePool) => Promise<ReadonlySet<string>>
  queryEvents: (pool: SimplePool, producers: ReadonlySet<string>) => Promise<NostrEvent[]>
  verify: (event: NostrEvent) => boolean
  write: (episodes: PublishedEpisode[]) => void
}

const defaultDependencies: OriginFeedDependencies = {
  feedExists: () => existsSync(RSS_PATH),
  episodeStateExists: () => existsSync(join(STATIC_DIR, 'episodes.json')),
  fetchProducers: fetchProducerPubkeys,
  queryEvents: async (pool, producers) => await pool.querySync(RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [...producers],
    limit: 50,
  }),
  verify: verifyNostrEvent,
  write: writeRss,
}

/**
 * After a volume recreate the origin is empty while published episodes still
 * exist on relays. Write feed.xml from those so LOGBOOK_BASE_URL/feed.xml works
 * without re-running a cutting publish.
 */
export async function materializeOriginFeed(
  pool: SimplePool,
  overrides: Partial<OriginFeedDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.feedExists() && dependencies.episodeStateExists()) return
  const producers = await dependencies.fetchProducers(pool)
  const events = await dependencies.queryEvents(pool, producers)

  const newest = new Map<string, { created_at: number; id: string; episode: PublishedEpisode }>()
  for (const event of events) {
    if (!producers.has(event.pubkey.toLowerCase())) continue
    if (!dependencies.verify(event)) continue
    const issueId = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (!issueId) continue
    let manifest: Parameters<typeof episodeFromPublished>[1]
    try {
      manifest = JSON.parse(event.content) as Parameters<typeof episodeFromPublished>[1]
    } catch {
      continue
    }
    const episode = episodeFromPublished(issueId, manifest)
    if (!episode) continue
    const current = newest.get(issueId)
    if (current && (
      current.created_at > event.created_at
      || (current.created_at === event.created_at && current.id.localeCompare(event.id) >= 0)
    )) continue
    newest.set(issueId, { created_at: event.created_at, id: event.id, episode })
  }

  const episodes = [...newest.values()]
    .map((entry) => entry.episode)
    .filter((episode) => episode !== null)
    .sort((a, b) => b.issueNumber - a.issueNumber)
  if (!episodes.length) {
    console.warn('[watch-compass] Origin has no feed.xml and no published episodes yet')
    return
  }
  dependencies.write(episodes)
  console.log(`[watch-compass] Wrote ${RSS_PATH} (${episodes.length} episodes)`)
}

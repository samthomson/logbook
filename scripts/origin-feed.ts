import { existsSync } from 'node:fs'
import type { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { RELAYS, KINDS, RSS_PATH } from './config.ts'
import { fetchProducerPubkeys } from './producers.ts'
import { episodeFromPublished, writeRss } from './publish-rss.ts'
import { verifyNostrEvent } from './segment-security.ts'

/**
 * After a volume recreate the origin is empty while published episodes still
 * exist on relays. Write feed.xml from those so LOGBOOK_BASE_URL/feed.xml works
 * without re-running a cutting publish.
 */
export async function materializeOriginFeed(pool: SimplePool): Promise<void> {
  if (existsSync(RSS_PATH)) return
  const producers = await fetchProducerPubkeys(pool)
  const events = await pool.querySync(RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [...producers],
    limit: 50,
  }) as NostrEvent[]

  const newest = new Map<string, { created_at: number; episode: ReturnType<typeof episodeFromPublished> }>()
  for (const event of events) {
    if (!verifyNostrEvent(event)) continue
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
    if (current && current.created_at >= event.created_at) continue
    newest.set(issueId, { created_at: event.created_at, episode })
  }

  const episodes = [...newest.values()]
    .map((entry) => entry.episode)
    .filter((episode) => episode !== null)
    .sort((a, b) => b.issueNumber - a.issueNumber)
  if (!episodes.length) {
    console.warn('[watch-compass] Origin has no feed.xml and no published episodes yet')
    return
  }
  writeRss(episodes)
  console.log(`[watch-compass] Wrote ${RSS_PATH} (${episodes.length} episodes)`)
}

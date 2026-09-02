import assert from 'node:assert/strict'
import test from 'node:test'
import type { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { materializeOriginFeed } from '../origin-feed.ts'
import { coercePubDate, episodeFromPublished, rfc822 } from '../publish-rss.ts'

const publishedEvent = (
  id: string,
  issueId: string,
  issueNumber: number,
  createdAt: number,
  title = `Compass ${issueNumber}`,
): NostrEvent => ({
  id,
  pubkey: 'a'.repeat(64),
  created_at: createdAt,
  kind: 34200,
  sig: 'b'.repeat(128),
  tags: [['d', issueId]],
  content: JSON.stringify({
    issueRef: `naddr-${issueNumber}`,
    issueNumber,
    title,
    sections: [],
    episodeStatus: 'published',
    publishedRss: {
      mp3Url: `https://media.test/${issueId}.mp3`,
      publishedAt: createdAt,
    },
  }),
})

test('episodeFromPublished takes a published manifest with an mp3', () => {
  const episode = episodeFromPublished('logbook-34', {
    issueRef: 'naddr1qa',
    issueNumber: 34,
    title: 'Compass 34',
    sections: [],
    episodeStatus: 'published',
    publishedRss: {
      mp3Url: 'https://blossom.test/ep.mp3',
      mp3Size: 123456,
      durationSeconds: 187.5,
      chapters: [{ startTime: 0, title: 'Opening' }],
      chaptersUrl: 'https://blossom.test/ch.json',
      transcriptUrl: 'https://blossom.test/transcript.json',
      publishedAt: 1_700_000_000,
    },
  })
  assert.equal(episode?.issueNumber, 34)
  assert.equal(episode?.mp3Url, 'https://blossom.test/ep.mp3')
  assert.equal(episode?.mp3Size, 123456)
  assert.equal(episode?.durationSeconds, 187.5)
  assert.deepEqual(episode?.chapters, [{ startTime: 0, title: 'Opening' }])
  assert.equal(episode?.transcriptUrl, 'https://blossom.test/transcript.json')
  assert.equal(episodeFromPublished('logbook-34', {
    issueRef: 'naddr1qa',
    sections: [],
    episodeStatus: 'draft',
    publishedRss: null,
  }), null)
})

test('coercePubDate accepts a Date, unix seconds, and a JSON ISO string', () => {
  const iso = '2024-01-15T12:00:00.000Z'
  assert.equal(coercePubDate(iso).toUTCString(), new Date(iso).toUTCString())
  assert.equal(coercePubDate(new Date(iso)).toUTCString(), new Date(iso).toUTCString())
  assert.equal(coercePubDate(1_700_000_000).toUTCString(), new Date(1_700_000_000 * 1000).toUTCString())
})

test('rfc822 survives JSON.stringify of a Date, which is how episodes.json used to store pubDate', () => {
  const iso = '2024-01-15T12:00:00.000Z'
  const roundtripped = JSON.parse(JSON.stringify({ pubDate: new Date(iso) })) as { pubDate: unknown }
  assert.equal(typeof roundtripped.pubDate, 'string')
  assert.equal(rfc822(roundtripped.pubDate), new Date(iso).toUTCString())
  assert.equal(rfc822(1_700_000_000), new Date(1_700_000_000 * 1000).toUTCString())
})

test('materializeOriginFeed reconstructs all episodes and keeps the newest published revision', async () => {
  const written: Array<NonNullable<ReturnType<typeof episodeFromPublished>>>[] = []
  const events = [
    publishedEvent('old-34', 'logbook-34', 34, 100, 'Old title'),
    publishedEvent('episode-33', 'logbook-33', 33, 150),
    publishedEvent('new-34', 'logbook-34', 34, 200, 'Current title'),
    publishedEvent('z-new-34', 'logbook-34', 34, 200, 'Deterministic current title'),
    { ...publishedEvent('forged', 'logbook-99', 99, 300), pubkey: 'f'.repeat(64) },
  ]

  await materializeOriginFeed({} as SimplePool, {
    feedExists: () => false,
    episodeStateExists: () => false,
    fetchProducers: async () => new Set(['a'.repeat(64)]),
    queryEvents: async (_pool, producers) => {
      assert.deepEqual([...producers], ['a'.repeat(64)])
      return events
    },
    verify: () => true,
    write: (episodes) => written.push(episodes),
  })

  assert.equal(written.length, 1)
  assert.deepEqual(written[0].map((episode) => episode.issueNumber), [34, 33])
  assert.equal(written[0][0].issueTitle, 'Deterministic current title')
})

test('materializeOriginFeed repairs a missing episode index even when feed.xml survived', async () => {
  let queried = 0
  let writes = 0
  await materializeOriginFeed({} as SimplePool, {
    feedExists: () => true,
    episodeStateExists: () => false,
    fetchProducers: async () => new Set(['a'.repeat(64)]),
    queryEvents: async () => {
      queried += 1
      return [publishedEvent('episode-34', 'logbook-34', 34, 200)]
    },
    verify: () => true,
    write: () => { writes += 1 },
  })
  assert.equal(queried, 1)
  assert.equal(writes, 1)
})

test('materializeOriginFeed leaves a complete origin untouched', async () => {
  let queried = false
  await materializeOriginFeed({} as SimplePool, {
    feedExists: () => true,
    episodeStateExists: () => true,
    fetchProducers: async () => new Set(),
    queryEvents: async () => {
      queried = true
      return []
    },
    verify: () => true,
    write: () => assert.fail('complete origin must not be rewritten'),
  })
  assert.equal(queried, false)
})

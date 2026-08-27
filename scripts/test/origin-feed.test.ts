import assert from 'node:assert/strict'
import test from 'node:test'
import { coercePubDate, episodeFromPublished, rfc822 } from '../publish-rss.ts'

test('episodeFromPublished takes a published manifest with an mp3', () => {
  const episode = episodeFromPublished('logbook-34', {
    issueRef: 'naddr1qa',
    issueNumber: 34,
    title: 'Compass 34',
    sections: [],
    episodeStatus: 'published',
    publishedRss: {
      mp3Url: 'https://blossom.test/ep.mp3',
      chaptersUrl: 'https://blossom.test/ch.json',
      publishedAt: 1_700_000_000,
    },
  })
  assert.equal(episode?.issueNumber, 34)
  assert.equal(episode?.mp3Url, 'https://blossom.test/ep.mp3')
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { acknowledgeStaticSync, readBackHostedFeed } from '../static-sync.ts'

test('local feed output is not treated as hosted without an explicit matching upload acknowledgement', async () => {
  await assert.rejects(
    () => acknowledgeStaticSync('a'.repeat(64), async () => ({ hosted: false, feedDigest: 'a'.repeat(64) })),
    /hosted acknowledgement/,
  )
  await assert.rejects(
    () => acknowledgeStaticSync('a'.repeat(64), async () => ({ hosted: true, feedDigest: 'b'.repeat(64) })),
    /digest/i,
  )
  await assert.doesNotReject(
    () => acknowledgeStaticSync('a'.repeat(64), async () => ({ hosted: true, feedDigest: 'a'.repeat(64) })),
  )
})

test('hosted acknowledgement is the bytes read back from the public URL', async () => {
  const body = Buffer.from('<rss/>')
  await assert.rejects(
    () => readBackHostedFeed(
      'https://blossom.test/feed.xml',
      (async () => new Response(body, { status: 404 })) as typeof fetch,
    ),
    /HTTP 404/,
  )
  const ack = await readBackHostedFeed(
    'https://blossom.test/feed.xml',
    (async () => new Response(body, { status: 200 })) as typeof fetch,
  )
  assert.equal(ack.hosted, true)
  assert.equal(ack.feedDigest.length, 64)
})

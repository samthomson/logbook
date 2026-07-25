import assert from 'node:assert/strict'
import test from 'node:test'
import { acknowledgeStaticSync } from '../static-sync.ts'

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

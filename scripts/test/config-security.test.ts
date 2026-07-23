import assert from 'node:assert/strict'
import test from 'node:test'
import { generateSecretKey, nip19 } from 'nostr-tools'
import { loadPrivateKey } from '../config.ts'

test('loadPrivateKey fails closed when the Compass key is absent or does not match the configured pubkey', async () => {
  const original = process.env.COMPASS_NSEC
  try {
    delete process.env.COMPASS_NSEC
    await assert.rejects(loadPrivateKey(), /COMPASS_NSEC environment variable is not set/)

    process.env.COMPASS_NSEC = nip19.nsecEncode(generateSecretKey())
    await assert.rejects(loadPrivateKey(), /does not match the configured Compass pubkey/)
  } finally {
    if (original === undefined) delete process.env.COMPASS_NSEC
    else process.env.COMPASS_NSEC = original
  }
})

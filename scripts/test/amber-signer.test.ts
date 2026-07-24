import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { createCompassAmberSigner, validateCompassSignature } from '../amber-signer.ts'

test('validateCompassSignature accepts a valid event from the expected Compass key', () => {
  const key = generateSecretKey()
  const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'ok' }, key)
  assert.deepEqual(validateCompassSignature(event, event.pubkey), event)
})

test('validateCompassSignature rejects a wrong author and forged event', () => {
  const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'ok' }, generateSecretKey())
  assert.throws(() => validateCompassSignature(event, 'f'.repeat(64)), /unexpected public key/i)
  assert.throws(() => validateCompassSignature({ ...event, sig: '0'.repeat(128) }, event.pubkey), /invalid/i)
})

test('createCompassAmberSigner exposes the shared asynchronous signing interface', () => {
  const signer = createCompassAmberSigner()
  assert.equal(typeof signer.signEvent, 'function')
})

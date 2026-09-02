import assert from 'node:assert/strict'
import test from 'node:test'
import { requirePubkey, requireUrlList } from '../config-env.ts'

test('requirePubkey fails closed when unset or malformed', () => {
  assert.throws(() => requirePubkey(undefined, 'COMPASS_PUBKEY'), /required/)
  assert.throws(() => requirePubkey('npub1abc', 'COMPASS_PUBKEY'), /64-character hex/)
})

test('requireUrlList fails closed when unset or empty', () => {
  assert.throws(() => requireUrlList(undefined, 'RELAYS', 'ws'), /required/)
  assert.throws(() => requireUrlList(' , ', 'RELAYS', 'ws'), /at least one URL/)
  assert.throws(() => requireUrlList('ws://public.example', 'RELAYS', 'ws'), /wss:/)
})

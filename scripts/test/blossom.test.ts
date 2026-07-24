import assert from 'node:assert/strict'
import test from 'node:test'
import { validateUploadDescriptor } from '../blossom.ts'

const HASH = 'a'.repeat(64)

test('validateUploadDescriptor accepts only the local hash at a configured HTTPS Blossom origin', () => {
  assert.equal(
    validateUploadDescriptor(
      { url: `https://one.example/${HASH}.mp3`, sha256: HASH },
      HASH,
      ['https://one.example', 'https://two.example'],
    ),
    `https://one.example/${HASH}.mp3`,
  )
})

test('validateUploadDescriptor rejects mismatched hashes and untrusted response URLs', () => {
  assert.throws(
    () => validateUploadDescriptor({ url: `https://one.example/${HASH}`, sha256: 'b'.repeat(64) }, HASH, ['https://one.example']),
    /sha-?256/i,
  )
  assert.throws(
    () => validateUploadDescriptor({ url: `https://evil.example/${HASH}`, sha256: HASH }, HASH, ['https://one.example']),
    /configured Blossom origin/i,
  )
  assert.throws(
    () => validateUploadDescriptor({ url: `https://one.example/not-${HASH}`, sha256: HASH }, HASH, ['https://one.example']),
    /canonical hash path/i,
  )
})

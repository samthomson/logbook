import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
  getTrustedBlobCandidates,
  parseVerifiedSegment,
} from '../segment-security.ts'

const HASH = 'a'.repeat(64)
const SERVERS = ['https://blossom.example', 'https://mirror.example']

function signedSegment(url = `https://blossom.example/${HASH}`) {
  return finalizeEvent({
    kind: 4200,
    created_at: 1,
    tags: [['x', HASH], ['section', 'sec-example-1'], ['issue', 'logbook-1']],
    content: JSON.stringify({
      audio: { url, sha256: HASH, mime: 'audio/webm', duration: 1 },
      isIntro: false,
    }),
  }, generateSecretKey())
}

test('getTrustedBlobCandidates rewrites a valid blob path only to configured HTTPS origins', () => {
  assert.deepEqual(
    getTrustedBlobCandidates(`https://untrusted.example/${HASH}?tracking=1`, HASH, SERVERS),
    [`https://blossom.example/${HASH}`, `https://mirror.example/${HASH}`],
  )
})

test('getTrustedBlobCandidates accepts a safe filename extension and rebuilds it only under configured origins', () => {
  assert.deepEqual(
    getTrustedBlobCandidates(`https://untrusted.example/${HASH}.webm?tracking=1`, HASH, SERVERS),
    [`https://blossom.example/${HASH}.webm`, `https://mirror.example/${HASH}.webm`],
  )
})

test('getTrustedBlobCandidates rejects non-canonical hashes and paths', () => {
  assert.throws(() => getTrustedBlobCandidates('https://untrusted.example/not-a-hash', HASH, SERVERS))
  assert.throws(() => getTrustedBlobCandidates(`https://untrusted.example/${HASH}.webm/escape`, HASH, SERVERS))
  assert.throws(() => getTrustedBlobCandidates(`http://untrusted.example/${HASH}`, HASH, SERVERS))
  assert.throws(() => getTrustedBlobCandidates(`https://untrusted.example/${HASH}`, 'bad', SERVERS))
})

test('parseVerifiedSegment accepts a signed, correctly-tagged segment', () => {
  const segment = parseVerifiedSegment(signedSegment(), SERVERS)
  assert.equal(segment.audio.sha256, HASH)
  assert.equal(segment.issueId, 'logbook-1')
})

test('parseVerifiedSegment preserves legacy video/webm for mandatory stream inspection', () => {
  const legacy = finalizeEvent({
    kind: 4200,
    created_at: 1,
    tags: [['x', HASH], ['section', 'sec-example-1'], ['issue', 'logbook-1']],
    content: JSON.stringify({
      audio: { url: `https://blossom.example/${HASH}.webm`, sha256: HASH, mime: 'video/webm', duration: 1 },
      isIntro: false,
    }),
  }, generateSecretKey())
  const segment = parseVerifiedSegment(legacy, SERVERS)
  assert.equal(segment.audio.mime, 'video/webm')
})

test('parseVerifiedSegment rejects a forged signature, missing hash tag, and invalid blob URL', () => {
  const forged = { ...signedSegment(), sig: '0'.repeat(128) }
  assert.throws(() => parseVerifiedSegment(forged, SERVERS), /signature/i)

  const missingHashTag = finalizeEvent({
    kind: 4200,
    created_at: 1,
    tags: [['section', 'sec-example-1'], ['issue', 'logbook-1']],
    content: JSON.stringify({ audio: { url: `https://blossom.example/${HASH}`, sha256: HASH, mime: 'audio/webm', duration: 1 }, isIntro: false }),
  }, generateSecretKey())
  assert.throws(() => parseVerifiedSegment(missingHashTag, SERVERS), /x tag/i)

  const wrongPath = signedSegment('https://blossom.example/not-the-declared-hash')
  assert.throws(() => parseVerifiedSegment(wrongPath, SERVERS), /path/i)
})

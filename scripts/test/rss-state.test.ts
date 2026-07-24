import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { assertPublishableManifest, selectTrustedReleaseMetadata } from '../rss-state.ts'

const HASH = 'a'.repeat(64)
const SERVERS = ['https://blossom.example']

function signedSegment(secretKey = generateSecretKey()) {
  return finalizeEvent({
    kind: 4200,
    created_at: 10,
    tags: [['x', HASH], ['section', 'sec-one'], ['issue', 'logbook-31'], ['t', 'logbook-31']],
    content: JSON.stringify({
      audio: { url: `https://blossom.example/${HASH}`, sha256: HASH, mime: 'audio/webm', duration: 2 },
      isIntro: false,
    }),
  }, secretKey)
}

function transcript(segmentId: string, secretKey: Uint8Array, text: string, createdAt: number) {
  return finalizeEvent({
    kind: 1111,
    created_at: createdAt,
    tags: [['e', segmentId, '', 'root'], ['k', '4200']],
    content: text,
  }, secretKey)
}

test('assertPublishableManifest permits only a cutting manifest', () => {
  assert.doesNotThrow(() => assertPublishableManifest({ episodeStatus: 'cutting' }))
  assert.throws(() => assertPublishableManifest({ episodeStatus: 'draft' }), /cutting/i)
  assert.throws(() => assertPublishableManifest({ episodeStatus: 'published' }), /cutting/i)
})

test('release metadata accepts only verified included segments and same-author transcripts', () => {
  const key = generateSecretKey()
  const segment = signedSegment(key)
  const accepted = transcript(segment.id, key, 'newest', 20)
  const older = transcript(segment.id, key, 'older', 19)
  const wrongAuthor = transcript(segment.id, generateSecretKey(), 'forged author', 30)
  const forged = { ...accepted, id: 'f'.repeat(64) }
  const unknown = transcript('b'.repeat(64), key, 'unknown', 40)

  const selected = selectTrustedReleaseMetadata(
    [segment.id],
    [segment, { ...segment, sig: '0'.repeat(128) }],
    [older, wrongAuthor, forged, unknown, accepted],
    SERVERS,
  )

  assert.deepEqual(selected.participantPubkeys, [segment.pubkey])
  assert.equal(selected.transcriptBySegment.get(segment.id), 'newest')
})

test('release metadata rejects a requested segment that has no verified relay event', () => {
  const segment = signedSegment()
  assert.throws(() => selectTrustedReleaseMetadata(
    [segment.id],
    [{ ...segment, sig: '0'.repeat(128) }],
    [],
    SERVERS,
  ), /verified segment/i)
})

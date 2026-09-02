import assert from 'node:assert/strict'
import test from 'node:test'
import { draftAfterFailure, failureReason, SegmentFailure } from '../stitch-failure.ts'

test('a failed run hands the cut back as a draft, carrying one readable reason', () => {
  const manifest = { episodeStatus: 'cutting', sections: [{ id: 'news' }], publishedRss: null }
  const next = draftAfterFailure(manifest, new Error('Segment abc recorded no sound'), 1700)

  assert.equal(next.episodeStatus, 'draft')
  assert.deepEqual(next.sections, manifest.sections)
  assert.deepEqual(next.lastFailure, { at: 1700, reason: 'Segment abc recorded no sound' })
  // The original is untouched: the run must not mutate what it read from the relay.
  assert.equal(manifest.episodeStatus, 'cutting')
})

test('a multi-line ffmpeg dump is collapsed and capped, so the manifest stays an event', () => {
  const reason = failureReason(new Error(`ffmpeg failed:\n${'x'.repeat(2000)}`))
  assert.ok(!reason.includes('\n'))
  assert.ok(reason.length <= 400)
  assert.ok(reason.startsWith('ffmpeg failed: '))
})

test('a failure caused by one recording names it, so the page can point at it', () => {
  const failure = new SegmentFailure('A voice note in “Blossom media” recorded no sound.', 'seg-1', 'sec-blossom')
  const next = draftAfterFailure({ episodeStatus: 'cutting' }, failure, 1700)

  assert.equal(next.lastFailure.segmentId, 'seg-1')
  assert.equal(next.lastFailure.sectionId, 'sec-blossom')
  assert.ok(!next.lastFailure.reason.includes('seg-1'))
})

test('a thrown non-error still yields a reason', () => {
  assert.equal(failureReason('relay unreachable'), 'relay unreachable')
})

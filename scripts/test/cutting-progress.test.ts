import assert from 'node:assert/strict'
import test from 'node:test'
import { withReleaseProgress } from '../cutting-progress.ts'

test('release progress appends completed steps in order and clears a failed stage', () => {
  const start = {
    issueRef: 'naddr1qa',
    episodeStatus: 'cutting',
    sections: [{ id: 'news' }],
    publishedRss: { mp3Url: 'https://blossom.test/ep.mp3' },
    release: { completed: ['audio'], failed: 'chapters' as const },
    lastFailure: { at: 1, reason: 'upload failed', stage: 'chapters' as const },
  }
  const next = withReleaseProgress(start, {
    completed: ['chapters'],
    publishedRss: { chaptersUrl: 'https://blossom.test/ch.json' },
    lastFailure: null,
    failed: null,
  })
  assert.deepEqual(next.release, { completed: ['audio', 'chapters'] })
  assert.equal(next.lastFailure, null)
  assert.deepEqual(next.publishedRss, {
    mp3Url: 'https://blossom.test/ep.mp3',
    chaptersUrl: 'https://blossom.test/ch.json',
  })
})

test('release progress records a failed stage without unlocking the cut', () => {
  const next = withReleaseProgress(
    { episodeStatus: 'cutting', sections: [] },
    { lastFailure: { at: 2, reason: 'Blossom rejected the feed.', stage: 'feed' }, failed: 'feed' },
  )
  assert.equal(next.episodeStatus, 'cutting')
  assert.equal(next.release?.failed, 'feed')
  assert.equal(next.lastFailure?.reason, 'Blossom rejected the feed.')
})

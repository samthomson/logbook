import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertLockedSegmentsPresent,
  assertStitchableManifest,
  collectLockedSegmentIds,
  selectActiveSections,
  type StitchManifestSection,
} from '../stitch-state.ts'

const included: StitchManifestSection = {
  id: 'news', title: 'News', introEventId: null,
  order: ['segment-a', 'segment-b'], excluded: ['segment-b'],
}

test('stitch state requires a cutting manifest and preserves published skip semantics', () => {
  assert.equal(assertStitchableManifest({ episodeStatus: 'cutting', sections: [] }), 'run')
  assert.equal(assertStitchableManifest({ episodeStatus: 'published', sections: [] }), 'already-published')
  assert.equal(assertStitchableManifest({ episodeStatus: 'published', sections: [] }, { force: true }), 'run')
  assert.throws(
    () => assertStitchableManifest({ episodeStatus: 'draft', sections: [] }),
    /not locked\/cutting/,
  )
})

test('locked segment selection excludes omitted sections and excluded IDs', () => {
  const sections = [included, { ...included, id: 'hidden', introEventId: 'excluded', order: ['hidden-segment'] }]
  const active = selectActiveSections(sections)
  assert.deepEqual(active.map((section) => section.id), ['news'])
  assert.deepEqual(collectLockedSegmentIds(active), ['segment-a'])
})

test('missing or rejected segments fail a locked cut before any media work', () => {
  const locked = { ...included, excluded: [] }
  assert.throws(
    () => assertLockedSegmentsPresent([locked], new Map([['segment-a', {}]])),
    /Segment segment-b is in the locked manifest/,
  )
  assert.doesNotThrow(() => assertLockedSegmentsPresent([locked], new Map([['segment-a', {}], ['segment-b', {}]])))
})

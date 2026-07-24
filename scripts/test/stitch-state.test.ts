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
  assert.equal(assertStitchableManifest({ episodeStatus: 'cutting', sections: [included] }), 'run')
  assert.equal(assertStitchableManifest({ episodeStatus: 'published', sections: [] }), 'already-published')
  assert.equal(assertStitchableManifest({ episodeStatus: 'published', sections: [included] }, { force: true }), 'run')
  assert.throws(
    () => assertStitchableManifest({ episodeStatus: 'draft', sections: [] }),
    /not locked\/cutting/,
  )
})

test('release rejects any excluded or empty newsletter chapter', () => {
  const excludedChapter = { ...included, id: 'hidden', sectionExcluded: true }
  const legacyExcludedChapter = { ...included, id: 'legacy-hidden', introEventId: 'excluded' }
  const emptyChapter = { ...included, id: 'empty', order: [], excluded: [] }

  for (const section of [excludedChapter, legacyExcludedChapter, emptyChapter]) {
    assert.throws(
      () => assertStitchableManifest({ episodeStatus: 'cutting', sections: [section] }),
      /Every newsletter chapter must have an active recording/,
    )
  }
})

test('release rejects a required newsletter chapter omitted from the manifest', () => {
  assert.throws(
    () => assertStitchableManifest(
      { episodeStatus: 'cutting', sections: [included] },
      { requiredChapterIds: ['news', 'missing-chapter'] },
    ),
    /missing required chapter: missing-chapter/,
  )
})

test('locked segment selection excludes individual omitted recordings', () => {
  const sections = [included]
  const active = selectActiveSections(sections)
  assert.deepEqual(active.map((section) => section.id), ['news'])
  assert.deepEqual(collectLockedSegmentIds(active), ['segment-a'])
})

test('active section selection does not silently honor legacy chapter exclusion', () => {
  const legacy = { ...included, id: 'hidden', introEventId: 'real-intro', sectionExcluded: true }
  assert.deepEqual(selectActiveSections([included, legacy]).map((section) => section.id), ['news', 'hidden'])
  assert.equal(legacy.introEventId, 'real-intro')
})

test('missing or rejected segments fail a locked cut before any media work', () => {
  const locked = { ...included, excluded: [] }
  assert.throws(
    () => assertLockedSegmentsPresent([locked], new Map([['segment-a', {}]])),
    /Segment segment-b is in the locked manifest/,
  )
  assert.doesNotThrow(() => assertLockedSegmentsPresent([locked], new Map([['segment-a', {}], ['segment-b', {}]])))
})

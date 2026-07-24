import { describe, expect, it } from 'vitest'
import { buildInitialManifest, buildManifestTags, manifestCreatedAt } from './manifest'

describe('buildInitialManifest', () => {
  it('creates an editable draft with stable section ids and no implicit recordings', () => {
    expect(buildInitialManifest(31, 'naddr1issue', [
      { id: 'sec-project-31', title: 'Project' },
    ])).toEqual({
      issueRef: 'naddr1issue',
      episodeStatus: 'draft',
      sections: [{
        id: 'sec-project-31', title: 'Project', introEventId: null,
        sectionExcluded: false, order: [], excluded: [], reviewed: [],
      }],
      publishedRss: null,
    })
  })
})

describe('buildManifestTags', () => {
  it('records the exact base revision used for an optimistic update', () => {
    expect(buildManifestTags(31, 'a'.repeat(64))).toContainEqual(['previous', 'a'.repeat(64)])
    expect(buildManifestTags(31, null).some((tag) => tag[0] === 'previous')).toBe(false)
  })
})

describe('manifestCreatedAt', () => {
  it('advances beyond its exact base revision even during the same second', () => {
    expect(manifestCreatedAt(100, 100)).toBe(101)
    expect(manifestCreatedAt(100, 90)).toBe(100)
    expect(manifestCreatedAt(100, null)).toBe(100)
  })
})

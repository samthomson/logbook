import { describe, expect, it } from 'vitest'
import { buildInitialManifest } from './manifest'

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

import { describe, expect, it } from 'vitest'
import type { ManifestContent } from '../types/nostr'
import {
  canEditManifest,
  reorderSection,
  includeSegmentInSection,
  addSegmentSection,
  canLockEpisode,
  includeAllChapters,
  moveSectionRecording,
  toggleSectionExcluded,
  toggleSegmentExcluded,
  toggleSegmentReviewed,
} from './admin-state'
import { COMPASS_PUBKEY } from '../config'

const manifest = (): ManifestContent => ({
  issueRef: 'naddr1fixture',
  episodeStatus: 'draft',
  sections: [{
    id: 'sec-fixture-1',
    title: 'Fixture',
    introEventId: 'intro-event',
    order: ['intro-event', 'segment-a', 'segment-b'],
    excluded: [],
    reviewed: [],
    sectionExcluded: false,
  }],
  publishedRss: null,
})

describe('admin manifest invariants', () => {
  it('only permits the authoritative Compass signer to edit a draft', () => {
    expect(canEditManifest(manifest(), COMPASS_PUBKEY)).toBe(true)
    expect(canEditManifest(manifest(), 'a'.repeat(64))).toBe(false)
    expect(canEditManifest({ ...manifest(), episodeStatus: 'cutting' }, COMPASS_PUBKEY)).toBe(false)
    expect(canEditManifest({ ...manifest(), episodeStatus: 'published' }, COMPASS_PUBKEY)).toBe(false)
  })

  it('excludes a section without destroying its intro event id', () => {
    const excluded = toggleSectionExcluded(manifest(), 0)
    expect(excluded.sections[0].sectionExcluded).toBe(true)
    expect(excluded.sections[0].introEventId).toBe('intro-event')
    expect(toggleSectionExcluded(excluded, 0).sections[0].sectionExcluded).toBe(false)

    const legacy = manifest()
    legacy.sections[0].introEventId = 'excluded'
    const migrated = toggleSectionExcluded(legacy, 0)
    expect(migrated.sections[0].introEventId).toBeNull()
    expect(migrated.sections[0].sectionExcluded).toBe(false)
  })

  it('restores every newsletter chapter without mutating the saved revision', () => {
    const saved = manifest()
    saved.sections = [
      { ...saved.sections[0], sectionExcluded: true },
      { ...saved.sections[0], id: 'sec-legacy-1', title: 'Legacy', introEventId: 'excluded', sectionExcluded: undefined },
    ]

    const draft = includeAllChapters(saved, [
      { id: saved.sections[0].id, title: saved.sections[0].title },
      { id: 'sec-required-1', title: 'Required chapter' },
    ])

    expect(draft.sections.map((section) => section.sectionExcluded)).toEqual([false, false, false])
    expect(draft.sections[1]).toEqual({
      id: 'sec-required-1',
      title: 'Required chapter',
      introEventId: null,
      sectionExcluded: false,
      order: [],
      excluded: [],
      reviewed: [],
    })
    expect(draft.sections[2].introEventId).toBeNull()
    expect(saved.sections[0].sectionExcluded).toBe(true)
    expect(saved.sections[1].introEventId).toBe('excluded')
  })

  it('keeps the intro pinned at position zero during reordering', () => {
    const next = reorderSection(manifest(), 0, 'intro-event', 'segment-b')
    expect(next.sections[0].order).toEqual(['intro-event', 'segment-a', 'segment-b'])

    const moved = reorderSection(manifest(), 0, 'segment-b', 'segment-a')
    expect(moved.sections[0].order).toEqual(['intro-event', 'segment-b', 'segment-a'])
  })

  it('moves recordings with mobile-friendly step controls while keeping the intro pinned', () => {
    expect(moveSectionRecording(manifest(), 0, 'segment-b', -1).sections[0].order)
      .toEqual(['intro-event', 'segment-b', 'segment-a'])
    expect(moveSectionRecording(manifest(), 0, 'segment-a', 1).sections[0].order)
      .toEqual(['intro-event', 'segment-b', 'segment-a'])
    expect(moveSectionRecording(manifest(), 0, 'intro-event', 1).sections[0].order)
      .toEqual(['intro-event', 'segment-a', 'segment-b'])
    expect(moveSectionRecording(manifest(), 0, 'segment-b', 1).sections[0].order)
      .toEqual(['intro-event', 'segment-a', 'segment-b'])
  })

  it('permits moving to index zero when the section has no pinned intro', () => {
    const withoutIntro = manifest()
    withoutIntro.sections[0].introEventId = null
    expect(reorderSection(withoutIntro, 0, 'segment-b', 'intro-event').sections[0].order)
      .toEqual(['segment-b', 'intro-event', 'segment-a'])
  })

  it('adds an unlisted recording to the chosen cut section exactly once', () => {
    const next = includeSegmentInSection(manifest(), 0, 'segment-new')
    expect(next.sections[0].order).toEqual(['intro-event', 'segment-a', 'segment-b', 'segment-new'])
    expect(next.sections[0].excluded).toEqual([])
    expect(includeSegmentInSection(next, 0, 'segment-new').sections[0].order)
      .toEqual(['intro-event', 'segment-a', 'segment-b', 'segment-new'])
  })

  it('creates a manifest section for recordings that were not in the initial draft', () => {
    const next = addSegmentSection(manifest(), {
      id: 'sec-new-31', title: 'New project', segmentIds: ['segment-new', 'segment-new-2'],
    })
    expect(next.sections.at(-1)).toMatchObject({
      id: 'sec-new-31', title: 'New project', order: ['segment-new', 'segment-new-2'], excluded: [], reviewed: [],
    })
  })

  it('refuses to lock an empty episode for export', () => {
    expect(canLockEpisode(manifest())).toBe(true)
    expect(canLockEpisode({ ...manifest(), sections: [{ ...manifest().sections[0], order: [] }] })).toBe(false)
  })

  it('refuses to lock until every newsletter chapter has an active recording', () => {
    const withEmptyChapter = manifest()
    withEmptyChapter.sections.push({
      ...withEmptyChapter.sections[0],
      id: 'sec-empty-1',
      title: 'Empty chapter',
      introEventId: null,
      order: [],
    })
    expect(canLockEpisode(withEmptyChapter)).toBe(false)

    const withExcludedChapter = manifest()
    withExcludedChapter.sections.push({
      ...withExcludedChapter.sections[0],
      id: 'sec-excluded-1',
      title: 'Excluded chapter',
      sectionExcluded: true,
    })
    expect(canLockEpisode(withExcludedChapter)).toBe(false)
  })

  it('round-trips excluded segments and reviewed markers immutably', () => {
    const excluded = toggleSegmentExcluded(manifest(), 0, 'segment-a')
    expect(excluded.sections[0].order).toEqual(['intro-event', 'segment-b'])
    expect(excluded.sections[0].excluded).toEqual(['segment-a'])
    expect(toggleSegmentExcluded(excluded, 0, 'segment-a').sections[0].order)
      .toEqual(['intro-event', 'segment-b', 'segment-a'])

    const reviewed = toggleSegmentReviewed(manifest(), 0, 'segment-b')
    expect(reviewed.sections[0].reviewed).toEqual(['segment-b'])
    expect(manifest().sections[0].reviewed).toEqual([])
  })
})

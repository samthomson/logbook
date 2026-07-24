import { describe, expect, it } from 'vitest'
import type { CompassIssue, ManifestContent, NostrEvent, Segment } from '../types/nostr'
import {
  buildRecordingTargets,
  canonicalizeManifestContent,
  includeInventorySegment,
  isManifestDirty,
  projectAdminWorkspace,
  removeManifestReference,
  validateManifestReferences,
} from './admin-workspace'

const ID = {
  intro: '1'.repeat(64),
  included: '2'.repeat(64),
  excluded: '3'.repeat(64),
  discovered: '4'.repeat(64),
  targetTwo: '5'.repeat(64),
  legacy: '6'.repeat(64),
  unknown: '7'.repeat(64),
  missing: '8'.repeat(64),
}

function event(id: string, sectionId: string, createdAt = 1): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: 4200,
    tags: [['section', sectionId], ['issue', 'logbook-31'], ['t', 'logbook-31']],
    content: '',
    sig: 'b'.repeat(128),
  }
}

function segment(id: string, sectionId: string, createdAt = 1, isIntro = false): Segment {
  return {
    event: event(id, sectionId, createdAt),
    sectionId,
    issueId: 'logbook-31',
    isIntro,
    respondingTo: null,
    alt: null,
    audio: {
      url: `https://blossom.example/${'c'.repeat(64)}`,
      sha256: 'c'.repeat(64),
      mime: 'audio/webm',
      duration: 2,
      waveform: [],
    },
  }
}

function issue(): CompassIssue {
  return {
    event: { ...event('f'.repeat(64), 'issue'), kind: 30023 },
    issueNumber: 31,
    title: 'Compass #31',
    sections: [
      {
        id: 'sec-one-31',
        title: 'One',
        items: [
          { title: '', body: 'Lead prose' },
          { id: 'sec-one-project-31', title: 'Project', body: 'Body' },
        ],
      },
      {
        id: 'sec-two-31',
        title: 'Two',
        items: [{ id: 'sec-two-project-31', title: 'Second project', body: 'Body' }],
      },
      {
        id: 'sec-three-31',
        title: 'Three',
        items: [{ title: '', body: '' }],
      },
    ],
  }
}

function manifest(): ManifestContent {
  return {
    issueRef: 'naddr1fixture',
    episodeStatus: 'draft',
    publishedRss: null,
    sections: [
      {
        id: 'sec-one-31',
        title: 'One',
        introEventId: ID.intro,
        sectionExcluded: false,
        order: [ID.intro, ID.included],
        excluded: [ID.excluded],
        reviewed: [ID.included],
      },
      {
        id: 'sec-legacy-30',
        title: 'Old project',
        introEventId: null,
        sectionExcluded: false,
        order: [ID.legacy],
        excluded: [],
        reviewed: [],
      },
    ],
  }
}

function inventory(): Map<string, Segment> {
  return new Map([
    [ID.intro, segment(ID.intro, 'sec-one-31', 1, true)],
    [ID.included, segment(ID.included, 'sec-one-31', 2)],
    [ID.excluded, segment(ID.excluded, 'sec-one-31', 3)],
    [ID.discovered, segment(ID.discovered, 'sec-one-31', 4)],
    [ID.targetTwo, segment(ID.targetTwo, 'sec-two-project-31', 5)],
    [ID.legacy, segment(ID.legacy, 'sec-legacy-30', 6)],
    [ID.unknown, segment(ID.unknown, 'sec-unknown-31', 7)],
  ])
}

describe('admin workspace projection', () => {
  it('uses the exact H2/H3 recording target order', () => {
    expect(buildRecordingTargets(issue())).toEqual([
      { id: 'sec-one-31', title: 'One' },
      { id: 'sec-one-project-31', title: 'Project' },
      { id: 'sec-two-project-31', title: 'Second project' },
      { id: 'sec-three-31', title: 'Three' },
    ])
  })

  it('projects canonical, legacy, and unmatched chapters without mutating or dirtying the manifest', () => {
    const base = manifest()
    const before = structuredClone(base)
    const workspace = projectAdminWorkspace(issue(), base, inventory())

    expect(workspace.map((chapter) => chapter.title)).toEqual([
      'One', 'Project', 'Second project', 'Three', 'Unassigned · Old project', 'Unassigned recordings',
    ])
    expect(workspace[0].rows.map((row) => [row.segmentId, row.state, row.isNew])).toEqual([
      [ID.intro, 'included', false],
      [ID.included, 'included', false],
      [ID.excluded, 'excluded', false],
      [ID.discovered, 'inventory', true],
    ])
    expect(workspace[2].rows.map((row) => row.segmentId)).toEqual([ID.targetTwo])
    expect(workspace[4].rows.map((row) => row.segmentId)).toEqual([ID.legacy])
    expect(workspace[5].rows.map((row) => row.segmentId)).toEqual([ID.unknown])
    expect(new Set(workspace.flatMap((chapter) => chapter.rows.map((row) => row.segmentId))).size).toBe(7)
    expect(base).toEqual(before)
    expect(isManifestDirty(base, base)).toBe(false)
  })

  it('includes an inventory-only note only after an explicit transition', () => {
    const base = manifest()
    const next = includeInventorySegment(base, buildRecordingTargets(issue()), inventory().get(ID.discovered)!)
    expect(base.sections[0].order).not.toContain(ID.discovered)
    expect(next.sections[0].order.at(-1)).toBe(ID.discovered)
    expect(isManifestDirty(base, next)).toBe(true)
  })

  it('inserts a missing canonical section at target order and appends an unmatched source section', () => {
    const targets = buildRecordingTargets(issue())
    const canonical = includeInventorySegment(manifest(), targets, inventory().get(ID.targetTwo)!)
    expect(canonical.sections.map((section) => section.id)).toEqual([
      'sec-one-31', 'sec-two-project-31', 'sec-legacy-30',
    ])
    const unmatched = includeInventorySegment(canonical, targets, inventory().get(ID.unknown)!)
    expect(unmatched.sections.at(-1)).toMatchObject({ id: 'sec-unknown-31', order: [ID.unknown] })
  })

  it('retains unavailable and invalid references as visible issues and blocks Lock only for active inputs', () => {
    const content = manifest()
    content.sections[0].order.push(ID.missing, 'not-an-event-id')
    content.sections[0].excluded.push('invalid-excluded')
    const validation = validateManifestReferences(content, inventory())
    expect(validation.canLock).toBe(false)
    expect(validation.issues.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'Recording unavailable', 'Invalid recording reference',
    ]))
    const workspace = projectAdminWorkspace(issue(), content, inventory())
    expect(workspace[0].rows.some((row) => row.segmentId === ID.missing && row.unavailable)).toBe(true)
  })

  it('allows the intro pointer to alias one order entry but rejects any further active duplicate', () => {
    const valid = validateManifestReferences(manifest(), inventory())
    expect(valid.canLock).toBe(true)
    expect(valid.issues.some((item) => item.reason === 'Duplicate active recording')).toBe(false)

    const duplicated = manifest()
    duplicated.sections[0].order.push(ID.included)
    const invalid = validateManifestReferences(duplicated, inventory())
    expect(invalid.canLock).toBe(false)
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      segmentId: ID.included,
      reason: 'Duplicate active recording',
      active: true,
    }))
  })

  it('blocks Lock when an active intro pointer is detached from playback order', () => {
    const detached = manifest()
    detached.sections[0].order = [ID.discovered]
    const invalid = validateManifestReferences(detached, inventory())
    expect(invalid.canLock).toBe(false)
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      segmentId: ID.intro,
      reason: 'Intro missing from playback order',
      active: true,
    }))

    detached.sections[0].sectionExcluded = true
    expect(validateManifestReferences(detached, inventory()).issues)
      .toContainEqual(expect.objectContaining({ active: false }))
  })

  it('removes only the explicitly selected non-active malformed reference', () => {
    const content = manifest()
    content.sections[0].excluded.push('invalid-excluded')
    content.sections[0].reviewed.push('invalid-reviewed')
    const validation = validateManifestReferences(content, inventory())
    const excludedIssue = validation.issues.find((item) => item.segmentId === 'invalid-excluded')!
    const next = removeManifestReference(content, excludedIssue)
    expect(next.sections[0].excluded).not.toContain('invalid-excluded')
    expect(next.sections[0].reviewed).toContain('invalid-reviewed')
    expect(content.sections[0].excluded).toContain('invalid-excluded')
  })

  it('canonicalizes membership arrays but preserves playback order', () => {
    const left = manifest()
    const right = structuredClone(left)
    right.sections[0].excluded = [ID.excluded, ID.excluded]
    right.sections[0].reviewed = [ID.included, ID.included]
    expect(canonicalizeManifestContent(right)).toEqual(canonicalizeManifestContent(left))
    right.sections[0].order.push(ID.included)
    expect(isManifestDirty(left, right)).toBe(true)
    right.sections[0].order.pop()
    right.sections[0].order.reverse()
    expect(isManifestDirty(left, right)).toBe(true)
  })
})

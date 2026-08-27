import assert from 'node:assert/strict'
import test from 'node:test'
import { latestCuttingManifests, latestVerifiedManifest, missingManifestIssueIds, type ManifestEvent } from '../watch-state.ts'

test('missingManifestIssueIds selects only issues without a matching manifest d-tag', () => {
  const issues = [
    { id: 'issue-31', created_at: 31, tags: [['d', 'newsletter-31']] },
    { id: 'issue-32', created_at: 32, tags: [['d', 'newsletter-32']] },
  ]
  const manifests = [
    { tags: [['d', 'logbook-31']] },
    { tags: [['d', 'logbook-not-a-number']] },
  ]

  assert.deepEqual(missingManifestIssueIds(issues, manifests), ['issue-32'])
})

test('missingManifestIssueIds ignores malformed issues and returns newest missing issues first', () => {
  const issues = [
    { id: 'old', created_at: 1, tags: [['d', 'newsletter-30']] },
    { id: 'new', created_at: 2, tags: [['d', 'newsletter-31']] },
    { id: 'bad', created_at: 3, tags: [['d', 'newsletter-nope']] },
  ]

  assert.deepEqual(missingManifestIssueIds(issues, []), ['new', 'old'])
})

const COMPASS = 'compass'
function manifest(
  id: string,
  created_at: number,
  issueId: string,
  episodeStatus: string,
  pubkey = COMPASS,
  extra: { sections?: unknown; previous?: string } = {},
): ManifestEvent {
  const tags: string[][] = [['d', issueId]]
  if (extra.previous) tags.push(['previous', extra.previous])
  return {
    id,
    created_at,
    pubkey,
    tags,
    content: JSON.stringify({
      episodeStatus,
      issueRef: 'naddr1',
      sections: extra.sections ?? [],
    }),
  }
}

function cutting(events: ManifestEvent[]): string[] {
  return latestCuttingManifests(events, {
    expectedPubkey: COMPASS,
    verify: (event) => event.id !== 'forged',
  }).map((event) => event.id)
}

test('latestCuttingManifests respects terminal and replacement manifest states', () => {
  assert.deepEqual(cutting([
    manifest('old-cutting', 10, 'logbook-32', 'cutting'),
    manifest('new-published', 11, 'logbook-32', 'published'),
    manifest('active-cutting', 12, 'logbook-33', 'cutting'),
  ]), ['active-cutting'])

  assert.deepEqual(cutting([
    manifest('old-cutting', 10, 'logbook-32', 'cutting'),
    manifest('new-draft', 11, 'logbook-32', 'draft'),
  ]), [])
})

test('latestVerifiedManifest selects the newest verified addressable revision deterministically', () => {
  const selected = latestVerifiedManifest([
    manifest('old', 10, 'logbook-32', 'draft'),
    manifest('forged', 40, 'logbook-32', 'draft'),
    manifest('same-time-a', 30, 'logbook-32', 'draft'),
    manifest('same-time-b', 30, 'logbook-32', 'draft'),
  ], 'logbook-32', { expectedPubkey: COMPASS, verify: (event) => event.id !== 'forged' })
  assert.equal(selected?.id, 'same-time-b')
})

test('an older producer lock does not hide a Compass publish', () => {
  const producers = new Set([COMPASS, 'producer'])
  const events = [
    manifest('published', 50, 'logbook-34', 'published'),
    manifest('lock', 10, 'logbook-34', 'cutting', 'producer'),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'published',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    [],
  )
})

test('Compass progress of the same cut does not hide Compass publish even with a later created_at', () => {
  const producers = new Set([COMPASS, 'producer'])
  const sections = [{ id: 'news' }]
  const events = [
    manifest('published', 10, 'logbook-34', 'published', COMPASS, { sections }),
    manifest('progress', 80, 'logbook-34', 'cutting', COMPASS, { sections }),
    manifest('lock', 50, 'logbook-34', 'cutting', 'producer', { sections }),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'published',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    [],
  )
})

test('a producer lock of the same cut does not hide Compass publish even with a later created_at', () => {
  const producers = new Set([COMPASS, 'producer'])
  const sections = [{ id: 'news' }]
  const events = [
    manifest('published', 10, 'logbook-34', 'published', COMPASS, { sections }),
    manifest('lock', 50, 'logbook-34', 'cutting', 'producer', { sections }),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'published',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    [],
  )
})

test('a producer lock that names the published revision is live even with an older created_at', () => {
  const producers = new Set([COMPASS, 'producer'])
  const sections = [{ id: 'news' }]
  const published = manifest('published', 90, 'logbook-34', 'published', COMPASS, { sections })
  const next = manifest('next', 10, 'logbook-34', 'cutting', 'producer', { sections, previous: 'published' })
  const verify = () => true
  assert.equal(
    latestVerifiedManifest([published, next], 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'next',
  )
})

test('a producer lock of the same cut after Compass progress is the live revision', () => {
  const producers = new Set([COMPASS, 'producer'])
  const sections = [{ id: 'news' }]
  const events = [
    manifest('published', 10, 'logbook-34', 'published', COMPASS, { sections }),
    manifest('progress', 80, 'logbook-34', 'cutting', COMPASS, { sections }),
    manifest('lock', 50, 'logbook-34', 'cutting', 'producer', { sections }),
    manifest('next', 90, 'logbook-34', 'cutting', 'producer', { sections }),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'next',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    ['next'],
  )
})

test('a later producer lock of a different cut is the live revision', () => {
  const producers = new Set([COMPASS, 'producer'])
  const events = [
    manifest('published', 10, 'logbook-34', 'published', COMPASS, { sections: [{ id: 'old' }] }),
    manifest('lock', 50, 'logbook-34', 'cutting', 'producer', { sections: [{ id: 'new' }] }),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'lock',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    ['lock'],
  )
})

test('the lock named on published previous is superseded; a new lock of the same cut is live', () => {
  const producers = new Set([COMPASS, 'producer'])
  const sections = [{ id: 'news' }]
  const published = manifest('published', 10, 'logbook-34', 'published', COMPASS, {
    sections,
    previous: 'lock',
  })
  const named = manifest('lock', 50, 'logbook-34', 'cutting', 'producer', { sections })
  const next = manifest('next', 60, 'logbook-34', 'cutting', 'producer', { sections })
  const verify = () => true
  assert.equal(
    latestVerifiedManifest([published, named], 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'published',
  )
  assert.equal(
    latestVerifiedManifest([published, next], 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'next',
  )
})

test('a producer draft newer than publish reopens the cut', () => {
  const producers = new Set([COMPASS, 'producer'])
  const events = [
    manifest('published', 10, 'logbook-34', 'published'),
    manifest('reopen', 11, 'logbook-34', 'draft', 'producer'),
  ]
  const verify = () => true
  assert.equal(
    latestVerifiedManifest(events, 'logbook-34', { expectedPubkey: producers, verify })?.id,
    'reopen',
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    [],
  )
})

test('a manifest is trusted from a Compass-appointed producer and from nobody else', () => {
  const producers = new Set([COMPASS, 'producer'])
  const events = [
    manifest('compass-draft', 10, 'logbook-32', 'draft'),
    manifest('producer-lock', 20, 'logbook-32', 'cutting', 'producer'),
    manifest('stranger-lock', 30, 'logbook-32', 'cutting', 'stranger'),
  ]
  const verify = () => true

  const selected = latestVerifiedManifest(events, 'logbook-32', { expectedPubkey: producers, verify })
  assert.equal(selected?.id, 'producer-lock')

  // The producer lock must reach the stitcher; the stranger must never.
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: producers, verify }).map((event) => event.id),
    ['producer-lock'],
  )
  assert.deepEqual(
    latestCuttingManifests(events, { expectedPubkey: COMPASS, verify }).map((event) => event.id),
    [],
  )
})

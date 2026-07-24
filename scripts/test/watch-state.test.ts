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
function manifest(id: string, created_at: number, issueId: string, episodeStatus: string, pubkey = COMPASS): ManifestEvent {
  return { id, created_at, pubkey, tags: [['d', issueId]], content: JSON.stringify({ episodeStatus }) }
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
    manifest('old', 10, 'logbook-32', 'cutting'),
    manifest('forged', 20, 'logbook-32', 'draft'),
    manifest('newer', 11, 'logbook-32', 'published'),
    manifest('same-time-a', 30, 'logbook-32', 'draft'),
    manifest('same-time-b', 30, 'logbook-32', 'cutting'),
  ], 'logbook-32', { expectedPubkey: COMPASS, verify: (event) => event.id !== 'forged' })
  assert.equal(selected?.id, 'same-time-b')
})

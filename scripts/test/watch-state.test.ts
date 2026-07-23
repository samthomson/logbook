import assert from 'node:assert/strict'
import test from 'node:test'
import { missingManifestIssueIds } from '../watch-state.ts'

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

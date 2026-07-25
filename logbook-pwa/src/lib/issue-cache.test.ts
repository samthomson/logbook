import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { clearIssueCache, loadCachedIssue, saveCachedIssue } from './issue-cache'

const issue = {
  issueNumber: 42,
  title: 'Cached Compass issue',
  event: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 30023, tags: [['d', 'newsletter-42']], content: '## Topic', sig: 'c'.repeat(128) },
  sections: [],
}

const segments = [{ id: 'segment-1', sectionId: 'sec-topic-42', created_at: 2 }]

afterEach(async () => { await clearIssueCache() })

describe('verified issue cache', () => {
  it('round-trips a public issue and its parsed segments without auth data', async () => {
    await saveCachedIssue(issue, segments)

    await expect(loadCachedIssue()).resolves.toEqual({ issue, segments })
  })

  it('returns the newest cached issue deterministically', async () => {
    await saveCachedIssue({ ...issue, issueNumber: 41, event: { ...issue.event, id: 'd'.repeat(64) } }, [])
    await saveCachedIssue(issue, segments)

    await expect(loadCachedIssue()).resolves.toEqual({ issue, segments })
  })
})

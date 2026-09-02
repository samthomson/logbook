import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPASS_PUBKEY } from '../config'
import { clearIssueCache, loadCachedIssue, saveCachedIssue } from './issue-cache'
import { parseIssue } from './compass'

vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>()
  return {
    ...actual,
    BLOSSOM_SERVERS: ['https://blossom.example'],
  }
})

vi.mock('./relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relay')>()
  return {
    ...actual,
    filterVerified: (events: Array<{ sig: string }>) => events.filter((event) => event.sig !== '0'.repeat(128)),
  }
})

function issueEvent(issueNumber: number, id: string) {
  return {
    id,
    pubkey: COMPASS_PUBKEY,
    created_at: issueNumber,
    kind: 30023,
    tags: [['d', `newsletter-${issueNumber}`], ['title', `Nostr Compass #${issueNumber}`]],
    content: '## Topic\nCached copy',
    sig: 'c'.repeat(128),
  }
}

function segmentEvent(issueNumber: number) {
  const hash = 'a'.repeat(64)
  return {
    id: 'e'.repeat(64),
    pubkey: 'd'.repeat(64),
    created_at: 2,
    kind: 4200,
    tags: [
      ['x', hash],
      ['section', `sec-topic-${issueNumber}`],
      ['issue', `logbook-${issueNumber}`],
      ['t', `logbook-${issueNumber}`],
    ],
    content: JSON.stringify({
      audio: { url: `https://blossom.example/${hash}`, sha256: hash, mime: 'audio/webm', duration: 2, waveform: [] },
      isIntro: false,
    }),
    sig: 'f'.repeat(128),
  }
}

const issue = parseIssue(issueEvent(42, 'a'.repeat(64)))
const segments: [string, ReturnType<typeof segmentEvent>[]][] = [['sec-topic-42', [segmentEvent(42)]]]

afterEach(async () => { await clearIssueCache() })

describe('verified issue cache', () => {
  it('re-verifies and rebuilds a public issue and its relay segments', async () => {
    await saveCachedIssue(issue, segments)

    await expect(loadCachedIssue()).resolves.toEqual({ issue, segments })
  })

  it('returns the newest valid issue and can address a saved issue directly', async () => {
    const older = parseIssue(issueEvent(41, 'd'.repeat(64)))
    await saveCachedIssue(older, [])
    await saveCachedIssue(issue, segments)

    await expect(loadCachedIssue()).resolves.toEqual({ issue, segments })
    await expect(loadCachedIssue(41)).resolves.toEqual({ issue: older, segments: [] })
  })

  it('rejects a poisoned issue and drops forged or cross-issue segments', async () => {
    const forged = { ...segmentEvent(42), sig: '0'.repeat(128) }
    const wrongIssue = segmentEvent(41)
    const futureSegment = { ...segmentEvent(42), id: '7'.repeat(64), created_at: Math.floor(Date.now() / 1000) + 3600 }
    await saveCachedIssue(issue, [['sec-topic-42', [forged, wrongIssue, futureSegment]]])
    await expect(loadCachedIssue()).resolves.toEqual({ issue, segments: [] })

    await saveCachedIssue({ ...issue, event: { ...issue.event, pubkey: '9'.repeat(64) } }, [])
    await expect(loadCachedIssue(42)).resolves.toBeNull()

    const futureIssue = parseIssue({ ...issue.event, created_at: Math.floor(Date.now() / 1000) + 3600 })
    await saveCachedIssue(futureIssue, [])
    await expect(loadCachedIssue(42)).resolves.toBeNull()
  })
})

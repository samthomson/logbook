import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '../types/nostr'
import { loadInitialIssue } from './initial-issue'

function issue(number: number): NostrEvent {
  return {
    id: String(number).padStart(64, '0'),
    pubkey: 'a'.repeat(64),
    created_at: number,
    kind: 30_023,
    tags: [['d', `newsletter-${number}`]],
    content: '',
    sig: 'b'.repeat(128),
  }
}

const issueNumberOf = (event: NostrEvent) => Number(event.tags.find((tag) => tag[0] === 'd')?.[1]?.replace('newsletter-', ''))

describe('loadInitialIssue', () => {
  it('loads the preferred latest episode when there is no saved selection', async () => {
    const latest = issue(32)
    const loadSaved = vi.fn()

    await expect(loadInitialIssue(null, {
      loadSaved,
      loadPreferredLatest: vi.fn().mockResolvedValue(latest),
      issueNumberOf,
    })).resolves.toEqual({ selected: latest, newer: null })
    expect(loadSaved).not.toHaveBeenCalled()
  })

  it('preserves a saved episode and advertises a newer preferred episode', async () => {
    const saved = issue(31)
    const latest = issue(32)

    await expect(loadInitialIssue(31, {
      loadSaved: vi.fn().mockResolvedValue(saved),
      loadPreferredLatest: vi.fn().mockResolvedValue(latest),
      issueNumberOf,
    })).resolves.toEqual({ selected: saved, newer: latest })
  })

  it('falls back to the preferred latest episode when the saved lookup rejects', async () => {
    const latest = issue(32)

    await expect(loadInitialIssue(31, {
      loadSaved: vi.fn().mockRejectedValue(new Error('saved relay failed')),
      loadPreferredLatest: vi.fn().mockResolvedValue(latest),
      issueNumberOf,
    })).resolves.toEqual({ selected: latest, newer: null })
  })

  it('keeps a saved episode when the latest lookup rejects', async () => {
    const saved = issue(31)

    await expect(loadInitialIssue(31, {
      loadSaved: vi.fn().mockResolvedValue(saved),
      loadPreferredLatest: vi.fn().mockRejectedValue(new Error('latest relay failed')),
      issueNumberOf,
    })).resolves.toEqual({ selected: saved, newer: null })
  })

  it('surfaces the saved lookup failure when neither lookup can provide an episode', async () => {
    await expect(loadInitialIssue(31, {
      loadSaved: vi.fn().mockRejectedValue(new Error('saved relay failed')),
      loadPreferredLatest: vi.fn().mockRejectedValue(new Error('latest relay failed')),
      issueNumberOf,
    })).rejects.toThrow('saved relay failed')
  })
})

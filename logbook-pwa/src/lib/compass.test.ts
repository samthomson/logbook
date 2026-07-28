import { describe, expect, it } from 'vitest'
import { extractIssueNumber, selectCompassIssues } from './compass'
import type { NostrEvent } from '../types/nostr'

function event(id: string, d: string, title: string, createdAt: number): NostrEvent {
  return {
    id: id.repeat(64).slice(0, 64),
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    kind: 30023,
    tags: [['d', d], ['title', title]],
    content: title,
    sig: 'b'.repeat(128),
  }
}

describe('Compass issue inventory', () => {
  it('does not mistake random legacy d-tag suffixes for issue numbers', () => {
    expect(extractIssueNumber(event('1', 'b7e9a38c41055742', 'Nostr Compass #18', 1))).toBe(18)
    expect(extractIssueNumber(event('2', 'newsletter-32', 'Nostr Compass #32', 1))).toBe(32)
    expect(extractIssueNumber(event('3', 'nostr-compass-22', 'Nostr Compass #22', 1))).toBe(22)
  })

  it('drops podcast duplicates and keeps one newest newsletter revision per issue', () => {
    const selected = selectCompassIssues([
      event('1', 'random-a', 'Nostr Compass #5', 10),
      event('2', 'random-b', 'Nostr Compass Podcast #5', 20),
      event('3', 'newsletter-5', 'Nostr Compass #5', 30),
      event('4', 'newsletter-6', 'Nostr Compass #6', 25),
    ])
    expect(selected.map(extractIssueNumber)).toEqual([5, 6])
    expect(selected[0].created_at).toBe(30)
  })

  it('rejects a far-future revision before it can dominate issue selection', () => {
    const now = Math.floor(Date.now() / 1000)
    const selected = selectCompassIssues([
      event('5', 'newsletter-7', 'Nostr Compass #7', now),
      event('6', 'newsletter-7', 'Nostr Compass #7', now + 3600),
    ])
    expect(selected).toHaveLength(1)
    expect(selected[0].id).toBe('5'.repeat(64))
  })

  it('breaks equal-timestamp revision ties by event ID', () => {
    const selected = selectCompassIssues([
      event('7', 'newsletter-8', 'Nostr Compass #8', 50),
      event('8', 'newsletter-8', 'Nostr Compass #8', 50),
    ])
    expect(selected).toHaveLength(1)
    expect(selected[0].id).toBe('8'.repeat(64))
  })
})

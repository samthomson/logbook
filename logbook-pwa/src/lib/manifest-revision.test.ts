import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../types/nostr'
import {
  foldAuthoritativeManifestRevision,
  selectAuthoritativeManifestRevision,
  selectNewestAddressableRevision,
  selectNewestManifestRevision,
  selectNewestPerDTag,
} from './manifest-revision'

function manifest(id: string, created_at: number, status = '', sections: unknown = []): NostrEvent {
  return {
    id,
    created_at,
    kind: 34200,
    pubkey: 'a'.repeat(64),
    sig: 'b'.repeat(128),
    tags: [['d', 'logbook-31']],
    content: status
      ? JSON.stringify({ episodeStatus: status, issueRef: 'naddr1', sections })
      : '{}',
  }
}

describe('selectNewestManifestRevision', () => {
  it('chooses the newest addressable manifest independent of relay order', () => {
    expect(selectNewestManifestRevision([
      manifest('older', 100),
      manifest('newer', 101),
    ])?.id).toBe('newer')
  })

  it('uses the event id as a deterministic tie-breaker', () => {
    expect(selectNewestManifestRevision([
      manifest('aaa', 101),
      manifest('bbb', 101),
    ])?.id).toBe('bbb')
  })
})

describe('selectNewestAddressableRevision', () => {
  it('ignores verified relay results whose d tag does not match the requested address', () => {
    const expected = manifest('a'.repeat(64), 10)
    const newerWrongAddress = manifest('b'.repeat(64), 20)
    newerWrongAddress.tags = [['d', 'logbook-32']]

    expect(selectNewestAddressableRevision([newerWrongAddress, expected], 'logbook-31')).toEqual(expected)
    expect(selectNewestAddressableRevision([newerWrongAddress], 'logbook-31')).toBeNull()
  })
})

describe('selectNewestPerDTag', () => {
  it('keeps the published revision when older cutting events are still on the relay', () => {
    const cutting = manifest('cut', 100)
    const published = manifest('pub', 200)
    const otherIssue = manifest('other', 150)
    otherIssue.tags = [['d', 'logbook-32']]

    const picked = selectNewestPerDTag([cutting, published, otherIssue, cutting])
    expect(picked.map((event) => event.id).sort()).toEqual(['other', 'pub'])
  })
})

describe('selectAuthoritativeManifestRevision', () => {
  it('keeps a published revision when the leftover lock is older', () => {
    const published = manifest('pub', 200, 'published')
    published.pubkey = 'c'.repeat(64)
    const cutting = manifest('cut', 100, 'cutting')
    cutting.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([cutting, published])?.id).toBe('pub')
    expect(selectNewestAddressableRevision([cutting, published], 'logbook-31')?.id).toBe('pub')
  })

  it('keeps Compass published when the producer lock is the same cut with a later created_at', () => {
    const sections = [{ id: 'news', title: 'News', order: ['seg-1'], excluded: [], reviewed: [] }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    const cutting = manifest('cut', 500, 'cutting', sections)
    cutting.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([cutting, published])?.id).toBe('pub')
  })

  it('keeps Compass published when a later Compass progress cutting shares that cut', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    const progress = manifest('progress', 900, 'cutting', sections)
    progress.pubkey = 'c'.repeat(64)
    const lock = manifest('lock', 100, 'cutting', sections)
    lock.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([lock, progress, published])?.id).toBe('pub')
    expect(selectAuthoritativeManifestRevision([progress, published])?.id).toBe('pub')
  })

  it('keeps Compass published when later Compass progress omits the cut body', () => {
    const published = manifest('pub', 200, 'published', [{ id: 'news' }])
    published.pubkey = 'c'.repeat(64)
    const progress = manifest('progress', 900, 'cutting')
    progress.pubkey = 'c'.repeat(64)
    progress.content = JSON.stringify({ episodeStatus: 'cutting', release: { completed: ['audio'] } })
    expect(selectAuthoritativeManifestRevision([progress, published])?.id).toBe('pub')
  })

  it('does not let a named previous tag revive Compass progress of the same cut', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    published.tags = [['d', 'logbook-31'], ['previous', 'lock']]
    const progress = manifest('progress', 900, 'cutting', sections)
    progress.pubkey = 'c'.repeat(64)
    expect(selectAuthoritativeManifestRevision([progress, published])?.id).toBe('pub')
  })

  it('re-selects published after a live progress event arrives first', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    const progress = manifest('progress', 900, 'cutting', sections)
    progress.pubkey = 'c'.repeat(64)
    const seen = new Map<string, typeof progress>()
    expect(foldAuthoritativeManifestRevision(seen, progress)?.id).toBe('progress')
    expect(foldAuthoritativeManifestRevision(seen, published)?.id).toBe('pub')
  })

  it('keeps a producer lock that names the published revision even when created_at is older', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 900, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    const cutting = manifest('next', 100, 'cutting', sections)
    cutting.pubkey = 'p'.repeat(64)
    cutting.tags = [['d', 'logbook-31'], ['previous', 'pub']]
    expect(selectAuthoritativeManifestRevision([cutting, published])?.id).toBe('next')
  })

  it('keeps a producer lock of the same cut after Compass progress has already landed', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    const progress = manifest('progress', 900, 'cutting', sections)
    progress.pubkey = 'c'.repeat(64)
    const leftover = manifest('lock', 100, 'cutting', sections)
    leftover.pubkey = 'p'.repeat(64)
    const next = manifest('next', 1000, 'cutting', sections)
    next.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([leftover, progress, published, next])?.id).toBe('next')
  })

  it('keeps a later producer lock of a different cut', () => {
    const published = manifest('pub', 200, 'published', [{ id: 'old' }])
    published.pubkey = 'c'.repeat(64)
    const cutting = manifest('cut', 201, 'cutting', [{ id: 'new' }])
    cutting.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([cutting, published])?.id).toBe('cut')
  })

  it('supersedes the lock named on the published previous tag even when the cut matches a new lock', () => {
    const sections = [{ id: 'news' }]
    const published = manifest('pub', 200, 'published', sections)
    published.pubkey = 'c'.repeat(64)
    published.tags = [['d', 'logbook-31'], ['previous', 'cut']]
    const named = manifest('cut', 500, 'cutting', sections)
    named.pubkey = 'p'.repeat(64)
    const next = manifest('next', 600, 'cutting', sections)
    next.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([named, published])?.id).toBe('pub')
    expect(selectAuthoritativeManifestRevision([next, published])?.id).toBe('next')
  })

  it('keeps a producer draft that is newer than the published revision', () => {
    const published = manifest('pub', 200, 'published')
    published.pubkey = 'c'.repeat(64)
    const draft = manifest('draft', 201, 'draft')
    draft.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([published, draft])?.id).toBe('draft')
  })

  it('uses each author\'s latest event so a leftover lock cannot hide a newer draft', () => {
    const published = manifest('pub', 200, 'published')
    published.pubkey = 'c'.repeat(64)
    const leftover = manifest('old-lock', 500, 'cutting')
    leftover.pubkey = 'p'.repeat(64)
    const draft = manifest('draft', 600, 'draft')
    draft.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([published, leftover, draft])?.id).toBe('draft')
  })
})

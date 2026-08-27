import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../types/nostr'
import {
  selectAuthoritativeManifestRevision,
  selectNewestAddressableRevision,
  selectNewestManifestRevision,
  selectNewestPerDTag,
} from './manifest-revision'

function manifest(id: string, created_at: number, status = ''): NostrEvent {
  return {
    id,
    created_at,
    kind: 34200,
    pubkey: 'a'.repeat(64),
    sig: 'b'.repeat(128),
    tags: [['d', 'logbook-31']],
    content: status ? JSON.stringify({ episodeStatus: status, issueRef: 'naddr1', sections: [] }) : '{}',
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

  it('keeps a producer lock that is newer than the published revision', () => {
    const published = manifest('pub', 200, 'published')
    published.pubkey = 'c'.repeat(64)
    const cutting = manifest('cut', 201, 'cutting')
    cutting.pubkey = 'p'.repeat(64)
    expect(selectAuthoritativeManifestRevision([cutting, published])?.id).toBe('cut')
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

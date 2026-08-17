import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../types/nostr'
import {
  selectNewestAddressableRevision,
  selectNewestManifestRevision,
  selectNewestPerDTag,
} from './manifest-revision'

function manifest(id: string, created_at: number): NostrEvent {
  return {
    id,
    created_at,
    kind: 34200,
    pubkey: 'a'.repeat(64),
    sig: 'b'.repeat(128),
    tags: [['d', 'logbook-31']],
    content: '{}',
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

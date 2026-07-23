import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { filterVerified } from './relay'

describe('filterVerified', () => {
  it('accepts a freshly signed event', () => {
    const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'valid' }, generateSecretKey())
    expect(filterVerified([event])).toEqual([event])
  })

  it('rejects a modified signature even if the original event was already verified', () => {
    const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'valid' }, generateSecretKey())
    expect(filterVerified([event])).toEqual([event])

    const forged = { ...event, sig: '0'.repeat(128) }
    expect(filterVerified([forged])).toEqual([])
  })

  it('rejects malformed event encoding', () => {
    expect(filterVerified([{ id: 'z', pubkey: 'not-a-key', sig: 'not-a-signature' }])).toEqual([])
  })
})

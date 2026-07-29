import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
const publish = vi.hoisted(() => vi.fn())

vi.mock('./pool', () => ({
  getPool: () => ({ publish }),
}))

import { filterVerified, publishToRelays } from './relay'
import { rememberRelayVerifiedEvent, wasRelayVerifiedEvent } from './verified-event-cache'
import relaySource from './relay.ts?raw'

describe('filterVerified', () => {
  it('accepts a freshly signed event', () => {
    const event = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'valid' }, generateSecretKey())
    expect(filterVerified([event])).toEqual([event])
  })

  it('reuses the relay verification result instead of repeating Schnorr math', () => {
    expect(relaySource).toContain('wasRelayVerifiedEvent')
    expect(relaySource.indexOf('wasRelayVerifiedEvent')).toBeLessThan(relaySource.indexOf('schnorr.verify'))
  })

  it('binds the relay-verification cache to the exact event identity', () => {
    const event = finalizeEvent({ kind: 1, created_at: 2, tags: [['t', 'cache']], content: 'cached' }, generateSecretKey())
    rememberRelayVerifiedEvent(event)

    expect(wasRelayVerifiedEvent(event)).toBe(true)
    expect(filterVerified([event])).toEqual([event])
    expect(wasRelayVerifiedEvent({ ...event, id: '0'.repeat(64) })).toBe(false)
    expect(wasRelayVerifiedEvent({ ...event, pubkey: '0'.repeat(64) })).toBe(false)
    expect(wasRelayVerifiedEvent({ ...event, sig: '0'.repeat(128) })).toBe(false)

    event.tags.push(['mutated', 'after-verification'])
    expect(filterVerified([event])).toEqual([])
  })

  it('still rejects mutated content after a cached verification', () => {
    const event = finalizeEvent({ kind: 1, created_at: 3, tags: [], content: 'original' }, generateSecretKey())
    expect(filterVerified([event])).toEqual([event])

    const forged = { ...event, content: 'mutated' }
    expect(filterVerified([forged])).toEqual([])
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

describe('publishToRelays durability', () => {
  it('waits for two acknowledgements when multiple relays are configured', async () => {
    let acceptFirst!: () => void
    let acceptSecond!: () => void
    publish.mockReturnValueOnce([
      new Promise<void>((resolve) => { acceptFirst = resolve }),
      new Promise<void>((resolve) => { acceptSecond = resolve }),
      new Promise<void>(() => {}),
    ])
    const event = finalizeEvent({ kind: 1, created_at: 4, tags: [], content: 'durable' }, generateSecretKey())
    let settled = false
    const result = publishToRelays(event, ['wss://one.test', 'wss://two.test', 'wss://three.test'])
      .then(() => { settled = true })

    acceptFirst()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    acceptSecond()
    await result
    expect(settled).toBe(true)
  })

  it('rejects when a two-relay acknowledgement can no longer be reached', async () => {
    publish.mockReturnValueOnce([
      Promise.resolve(),
      Promise.reject(new Error('offline')),
      Promise.reject(new Error('blocked')),
    ])
    const event = finalizeEvent({ kind: 1, created_at: 5, tags: [], content: 'partial' }, generateSecretKey())

    await expect(publishToRelays(event, ['wss://one.test', 'wss://two.test', 'wss://three.test']))
      .rejects.toThrow(/only 1 of 2 required relays accepted/i)
  })
})

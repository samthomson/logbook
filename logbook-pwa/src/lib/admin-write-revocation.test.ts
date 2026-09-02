import { describe, expect, it, vi } from 'vitest'
import { COMPASS_PUBKEY, D_ISSUE_WL } from '../config'
import type { ManifestContent, NostrEvent, NostrSigner } from '../types/nostr'
import { updateManifest } from './manifest'
import { publishWhitelist } from './whitelist'
import { publishToRelays } from './relay'

vi.mock('./relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relay')>()
  return { ...actual, publishToRelays: vi.fn() }
})

function revokingSigner() {
  let active = true
  const signEvent = vi.fn(async (event) => ({
    ...event,
    id: 'a'.repeat(64),
    sig: 'b'.repeat(128),
  }) as NostrEvent)
  const signer: NostrSigner = {
    getPublicKey: async () => {
      active = false
      return COMPASS_PUBKEY
    },
    signEvent,
  }
  return {
    signer,
    signEvent,
    assertActive: () => {
      if (!active) throw new Error('Admin capability was revoked')
    },
  }
}

const manifestContent: ManifestContent = {
  issueRef: 'naddr1fixture',
  episodeStatus: 'draft',
  sections: [],
  publishedRss: null,
}

describe('admin write authorization revocation', () => {
  it('rejects a producer-authored validation roster before signing or publishing', async () => {
    const signEvent = vi.fn()
    const signer: NostrSigner = {
      getPublicKey: async () => 'd'.repeat(64),
      signEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishWhitelist(
      D_ISSUE_WL(31),
      [{ pubkey: 'c'.repeat(64) }],
      signer,
      ['wss://relay.example'],
    )).rejects.toThrow(/Only the Compass key/i)
    expect(signEvent).not.toHaveBeenCalled()
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not publish a manifest if the signer switches identity while signing', async () => {
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()
    const signer: NostrSigner = {
      getPublicKey: async () => COMPASS_PUBKEY,
      signEvent: async (event) => ({
        ...event,
        pubkey: 'd'.repeat(64),
        id: 'a'.repeat(64),
        sig: 'b'.repeat(128),
      }) as NostrEvent,
    }

    await expect(updateManifest(31, manifestContent, signer, ['wss://relay.example']))
      .rejects.toThrow(/signer identity changed/i)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not publish a whitelist if the signer switches identity while signing', async () => {
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()
    const signer: NostrSigner = {
      getPublicKey: async () => COMPASS_PUBKEY,
      signEvent: async (event) => ({
        ...event,
        pubkey: 'd'.repeat(64),
        id: 'a'.repeat(64),
        sig: 'b'.repeat(128),
      }) as NostrEvent,
    }

    await expect(publishWhitelist(
      D_ISSUE_WL(31),
      [{ pubkey: 'c'.repeat(64) }],
      signer,
      ['wss://relay.example'],
    )).rejects.toThrow(/signer identity changed/i)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('revalidates the manifest signer immediately before relay publication', async () => {
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls === 1 ? COMPASS_PUBKEY : 'd'.repeat(64)),
      signEvent: async (event) => ({
        ...event,
        id: 'a'.repeat(64),
        sig: 'b'.repeat(128),
      }) as NostrEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(updateManifest(31, manifestContent, signer, ['wss://relay.example']))
      .rejects.toThrow(/signer identity changed/i)
    expect(identityCalls).toBeGreaterThanOrEqual(2)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('revalidates the whitelist signer immediately before relay publication', async () => {
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls === 1 ? COMPASS_PUBKEY : 'd'.repeat(64)),
      signEvent: async (event) => ({
        ...event,
        id: 'a'.repeat(64),
        sig: 'b'.repeat(128),
      }) as NostrEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishWhitelist(
      D_ISSUE_WL(31),
      [{ pubkey: 'c'.repeat(64) }],
      signer,
      ['wss://relay.example'],
    )).rejects.toThrow(/signer identity changed/i)
    expect(identityCalls).toBeGreaterThanOrEqual(2)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not sign a manifest after revocation during identity lookup', async () => {
    const { signer, signEvent, assertActive } = revokingSigner()

    await expect(updateManifest(
      31,
      manifestContent,
      signer,
      ['wss://relay.example'],
      null,
      null,
      assertActive,
    )).rejects.toThrow('Admin capability was revoked')
    expect(signEvent).not.toHaveBeenCalled()
  })

  it('does not sign a whitelist after revocation during identity lookup', async () => {
    const { signer, signEvent, assertActive } = revokingSigner()

    await expect(publishWhitelist(
      D_ISSUE_WL(31),
      [{ pubkey: 'c'.repeat(64) }],
      signer,
      ['wss://relay.example'],
      assertActive,
    )).rejects.toThrow('Admin capability was revoked')
    expect(signEvent).not.toHaveBeenCalled()
  })
})

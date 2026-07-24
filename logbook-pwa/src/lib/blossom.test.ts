import { describe, expect, it, vi } from 'vitest'
import { validateUploadDescriptor, uploadBlob } from './blossom'
import type { NostrEvent, NostrSigner } from '../types/nostr'

const HASH = 'a'.repeat(64)
const SERVERS = ['https://blossom.example']
const blob = new Blob([new Uint8Array(128)], { type: 'audio/webm' })

describe('validateUploadDescriptor', () => {
  it('accepts a canonical content-addressed URL from the configured upload origin', () => {
    expect(validateUploadDescriptor({
      url: `https://blossom.example/${HASH}.webm`,
      sha256: HASH,
      size: 128,
      type: 'audio/webm',
    }, blob, HASH, SERVERS).url).toBe(`https://blossom.example/${HASH}.webm`)
  })

  it('rejects untrusted origins, insecure URLs, non-canonical paths, and hash mismatches', () => {
    for (const url of [
      `https://evil.example/${HASH}`,
      `http://blossom.example/${HASH}`,
      'https://blossom.example/not-the-hash',
    ]) {
      expect(() => validateUploadDescriptor({ url, sha256: HASH }, blob, HASH, SERVERS)).toThrow()
    }
    expect(() => validateUploadDescriptor({
      url: `https://blossom.example/${HASH}`,
      sha256: 'b'.repeat(64),
    }, blob, HASH, SERVERS)).toThrow(/integrity/i)
  })
})

describe('uploadBlob authorization', () => {
  it('does not sign or upload when the live signer identity differs from the authenticated principal', async () => {
    const signEvent = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const signer: NostrSigner = {
      getPublicKey: async () => 'b'.repeat(64),
      signEvent,
    }

    await expect(uploadBlob(
      blob,
      signer,
      'a'.repeat(64),
      SERVERS,
      undefined,
      undefined,
    )).rejects.toThrow(/signer identity changed/i)
    expect(signEvent).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('does not upload when the signer changes identity while signing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const signer: NostrSigner = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async (event) => ({
        ...event,
        pubkey: 'b'.repeat(64),
        id: 'c'.repeat(64),
        sig: 'd'.repeat(128),
      }) as NostrEvent,
    }

    await expect(uploadBlob(
      blob,
      signer,
      'a'.repeat(64),
      SERVERS,
    )).rejects.toThrow(/signer identity changed/i)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('revalidates signer identity immediately before upload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls === 1 ? 'a' : 'b').repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'c'.repeat(64),
        sig: 'd'.repeat(128),
      }) as NostrEvent,
    }

    await expect(uploadBlob(blob, signer, 'a'.repeat(64), SERVERS))
      .rejects.toThrow(/signer identity changed/i)
    expect(identityCalls).toBeGreaterThanOrEqual(2)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('retains a successful primary descriptor when identity changes before mirroring', async () => {
    const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
    const hash = Array.from(hashBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      url: `https://primary.example/${hash}`,
      sha256: hash,
      size: blob.size,
      type: blob.type,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls <= 3 ? 'a' : 'b').repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'c'.repeat(64),
        sig: 'd'.repeat(128),
      }) as NostrEvent,
    }

    const result = await uploadBlob(
      blob,
      signer,
      'a'.repeat(64),
      ['https://primary.example', 'https://mirror.example'],
    )

    expect(result.descriptor.sha256).toBe(hash)
    expect(result.mirrorFailures).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('does not request a signature after authorization is revoked while hashing', async () => {
    let signerCalls = 0
    let checks = 0
    const signer: NostrSigner = {
      getPublicKey: async () => {
        signerCalls += 1
        return 'a'.repeat(64)
      },
      signEvent: async (event) => {
        signerCalls += 1
        return { ...event, id: 'b'.repeat(64), sig: 'c'.repeat(128) } as NostrEvent
      },
    }

    await expect(uploadBlob(blob, signer, 'a'.repeat(64), SERVERS, undefined, () => {
      checks += 1
      if (checks > 1) throw new Error('Publishing authorization was revoked.')
    })).rejects.toThrow('Publishing authorization was revoked.')
    expect(signerCalls).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer'
import { restoreSession } from './auth'

describe('restoreSession', () => {
  it('restores the authenticated read state from a valid nbunksec without waiting for Amber', async () => {
    const remote = '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'
    const session = NostrConnectSigner.createNbunksec({
      remote,
      clientKey: '22'.repeat(32),
      relays: ['wss://127.0.0.1:1'],
      bunkerSecret: 'test-secret',
    })

    const result = await Promise.race([
      restoreSession(session, 'amber'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('restore waited for Amber')), 50)),
    ])

    expect(result.pubkey).toBe(remote)
    expect(result.method).toBe('amber')
    expect(result.session).toBe(session)
  })

  it('restores the account identity separately from the NIP-46 routing identity', async () => {
    const routingIdentity = '11'.repeat(32)
    const accountIdentity = '77'.repeat(32)
    const session = NostrConnectSigner.createNbunksec({
      remote: routingIdentity,
      clientKey: '22'.repeat(32),
      relays: ['wss://127.0.0.1:1'],
    })

    const result = await restoreSession(session, 'amber', accountIdentity)

    expect(result.pubkey).toBe(accountIdentity)
  })
})

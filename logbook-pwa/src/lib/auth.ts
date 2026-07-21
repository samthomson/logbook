/**
 * Authentication module — uses applesauce-signers.
 *
 * Login methods:
 *   1. NIP-46 bunker URI → NostrConnectSigner
 *   2. window.nostr (Amber / browser extension) → ExtensionSigner
 *   3. nsec / ncryptsec paste → PrivateKeySigner / PasswordSigner (in-memory only)
 */

import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer'
import { ExtensionSigner } from 'applesauce-signers/signers/extension-signer'
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer'
import { PasswordSigner } from 'applesauce-signers/signers/password-signer'
import { nip19 } from 'nostr-tools'
import type { NostrSigner } from '../types/nostr'
import { DEFAULT_RELAYS } from '../config'

export type AuthMethod = 'bunker' | 'extension' | 'nsec' | 'none'

export interface AuthState {
  pubkey: string
  method: AuthMethod
  signer: NostrSigner
}

// ─── NIP-46 Bunker ────────────────────────────────────────────────────────────

export async function connectBunker(bunkerUri: string): Promise<AuthState> {
  if (!bunkerUri.startsWith('bunker://')) {
    throw new Error('Invalid bunker URI — must start with bunker://')
  }

  const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri, {
    relays: DEFAULT_RELAYS,
  } as Parameters<typeof NostrConnectSigner.fromBunkerURI>[1])

  const pubkey = await signer.getPublicKey()

  return { pubkey, method: 'bunker', signer: signer as unknown as NostrSigner }
}

// ─── NIP-55 / window.nostr (Amber / extensions) ───────────────────────────────

export function hasWindowNostr(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window
}

export async function connectWindowNostr(): Promise<AuthState> {
  if (!hasWindowNostr()) {
    throw new Error('window.nostr not available — install Amber or a browser extension')
  }

  const signer = new ExtensionSigner()
  const pubkey = await signer.getPublicKey()

  return { pubkey, method: 'extension', signer: signer as unknown as NostrSigner }
}

// ─── nsec / ncryptsec paste ───────────────────────────────────────────────────

export async function connectNsec(input: string, passphrase?: string): Promise<AuthState> {
  let signer: NostrSigner

  if (input.startsWith('ncryptsec')) {
    if (!passphrase) throw new Error('Passphrase required for ncryptsec')
    const ps = await PasswordSigner.fromNcryptsec(input, passphrase)
    signer = ps as unknown as NostrSigner
  } else if (input.startsWith('nsec1')) {
    const decoded = nip19.decode(input)
    if (decoded.type !== 'nsec') throw new Error('Expected nsec bech32')
    const ps = PrivateKeySigner.fromKey(decoded.data as Uint8Array)
    signer = ps as unknown as NostrSigner
  } else {
    throw new Error('Input must be nsec1... or ncryptsec...')
  }

  const pubkey = await signer.getPublicKey()
  return { pubkey, method: 'nsec', signer }
}

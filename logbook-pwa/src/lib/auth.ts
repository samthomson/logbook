/**
 * Authentication module — uses applesauce-signers.
 *
 * Login methods:
 *   1. Amber one-tap (Android) → nostrconnect:// deep link → NostrConnectSigner (NIP-46)
 *   2. NIP-46 bunker URI → NostrConnectSigner
 *   3. window.nostr (browser extension / WebView shim) → ExtensionSigner
 *   4. nsec / ncryptsec paste → PrivateKeySigner / PasswordSigner (in-memory only)
 *
 * The Amber flow pre-authorizes all Logbook event kinds via NIP-46 `permissions`,
 * so publish + Blossom-auth signatures happen over relays with no app switching
 * and no per-event prompts (web NIP-55 has no batch API — NIP-46 is the batch path).
 */

import { hexToBytes } from 'applesauce-core/helpers/event'
import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer'
import { ExtensionSigner } from 'applesauce-signers/signers/extension-signer'
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer'
import { PasswordSigner } from 'applesauce-signers/signers/password-signer'
import { Observable } from 'rxjs'
import { nip19 } from 'nostr-tools'
import type { NostrSigner, NostrEvent } from '../types/nostr'
import { RELAYS, KINDS } from '../config'
import { getPool } from './pool'

export type AuthMethod = 'amber' | 'bunker' | 'extension' | 'nsec' | 'none'

export interface AuthState {
  pubkey: string
  method: AuthMethod
  signer: NostrSigner
  /** nbunksec-encoded NIP-46 session (amber/bunker) — lets us restore without re-approval */
  session?: string
}

// Kinds Logbook signs: segments, Blossom auth, transcripts, manifests, reactions.
const SIGNING_KINDS = [
  KINDS.SEGMENT,
  KINDS.BLOSSOM_AUTH,
  KINDS.TRANSCRIPT,
  KINDS.MANIFEST,
  KINDS.REACTION,
]

// ─── NIP-46 transport wiring ──────────────────────────────────────────────────
// applesauce 6.x requires explicit relay transport for NostrConnectSigner.
// Wire the class-level fallback once to the app's shared SimplePool.

let transportWired = false

function wireNip46Transport(): void {
  if (transportWired) return
  transportWired = true
  const pool = getPool()

  NostrConnectSigner.subscriptionMethod = (relays, filters) =>
    new Observable<NostrEvent | string>((observer) => {
      // applesauce only ever subscribes with a single filter (kind 24133 #p)
      const sub = pool.subscribeMany(relays, filters[0] as Parameters<typeof pool.subscribeMany>[1], {
        onevent: (event) => observer.next(event as NostrEvent),
        oneose: () => observer.next('EOSE'),
      })
      return () => sub.close()
    }) as ReturnType<NonNullable<typeof NostrConnectSigner.subscriptionMethod>>

  NostrConnectSigner.publishMethod = async (relays, event) => {
    await Promise.any(pool.publish(relays, event as Parameters<typeof pool.publish>[1]))
  }
}

function toAuthState(
  signer: NostrConnectSigner,
  pubkey: string,
  method: 'amber' | 'bunker',
): AuthState {
  // A completed NIP-46 connection always has a remote signer. Persisting its
  // nbunksec is mandatory: silently returning an in-memory-only Amber login
  // creates a misleading successful login that is guaranteed to vanish on refresh.
  const session = signer.getNbunksec()
  return { pubkey, method, signer: signer as unknown as NostrSigner, session }
}

// ─── Amber one-tap (nostrconnect:// deep link) ───────────────────────────────

export interface AmberConnectHandle {
  /** nostrconnect:// URI — navigate to it synchronously inside the click handler */
  uri: string
  /** Resolves once the user approves in Amber and the NIP-46 session is live */
  wait: (abort?: AbortSignal) => Promise<AuthState>
  /** Abort the pending connection and close the relay subscription */
  cancel: () => void
}

export function startAmberConnect(): AmberConnectHandle {
  wireNip46Transport()
  const signer = new NostrConnectSigner({ relays: RELAYS })

  const uri = signer.getNostrConnectURI({
    name: 'Logbook',
    url: typeof window !== 'undefined' ? window.location.origin : undefined,
    permissions: NostrConnectSigner.buildSigningPermissions(SIGNING_KINDS),
  })

  return {
    uri,
    wait: async (abort?: AbortSignal) => {
      await signer.waitForSigner(abort)
      const pubkey = await signer.getPublicKey()
      return toAuthState(signer, pubkey, 'amber')
    },
    cancel: () => {
      void signer.close().catch(() => {})
    },
  }
}

/**
 * Rehydrate the local NIP-46 client session without issuing a new `connect`
 * request.  Amber can be asleep after a browser/PWA reload; read-only access
 * must not be treated as a logout just because the remote signer has not yet
 * answered.  The signer reconnects lazily on the first operation that needs a
 * signature.
 */
export async function restoreSession(
  nbunksec: string,
  method: 'amber' | 'bunker',
  accountPubkey?: string,
): Promise<AuthState> {
  wireNip46Transport()
  const { remote, clientKey, relays, bunkerSecret } = NostrConnectSigner.parseNbunksec(nbunksec)
  const signer = new NostrConnectSigner({
    relays,
    remote,
    pubkey: remote,
    signer: new PrivateKeySigner(hexToBytes(clientKey)),
    bunkerSecret,
  })
  const pubkey = accountPubkey && /^[0-9a-f]{64}$/i.test(accountPubkey)
    ? accountPubkey.toLowerCase()
    : remote
  return { pubkey, method, signer: signer as unknown as NostrSigner, session: nbunksec }
}

// ─── NIP-46 Bunker ────────────────────────────────────────────────────────────

export async function connectBunker(bunkerUri: string): Promise<AuthState> {
  if (!bunkerUri.startsWith('bunker://')) {
    throw new Error('Invalid bunker URI — must start with bunker://')
  }

  wireNip46Transport()
  const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri, {
    permissions: NostrConnectSigner.buildSigningPermissions(SIGNING_KINDS),
  })

  const pubkey = await signer.getPublicKey()
  return toAuthState(signer, pubkey, 'bunker')
}

// ─── window.nostr (browser extension / WebView shim) ─────────────────────────

export function hasWindowNostr(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window
}

export async function connectWindowNostr(): Promise<AuthState> {
  if (!hasWindowNostr()) {
    throw new Error('window.nostr not available — install a NIP-07 extension')
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

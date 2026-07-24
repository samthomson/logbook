import type { NostrEvent, NostrSigner } from '../types/nostr'
import { withSignerTimeout } from './signer-timeout'

const HEX_PUBKEY = /^[0-9a-f]{64}$/i

export class SignerIdentityError extends Error {
  constructor() {
    super('Signer identity changed. Sign in again before publishing.')
    this.name = 'SignerIdentityError'
  }
}

/** Fail closed when a mutable signer no longer represents the authenticated principal. */
export function assertExpectedSignerPubkey(actual: string, expected: string): void {
  if (!HEX_PUBKEY.test(actual) || !HEX_PUBKEY.test(expected) || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new SignerIdentityError()
  }
}

/** A signer may switch accounts between identity lookup and signing; verify its output too. */
export function assertEventSignedByExpected(event: NostrEvent, expected: string): void {
  assertExpectedSignerPubkey(event.pubkey, expected)
}

/** Re-check a mutable remote/browser signer immediately around network side effects. */
export async function assertSignerStillExpected(
  signer: NostrSigner,
  expected: string,
  assertActive?: () => void,
): Promise<void> {
  assertActive?.()
  const actual = await withSignerTimeout(signer.getPublicKey(), 'Amber identity revalidation')
  assertActive?.()
  assertExpectedSignerPubkey(actual, expected)
}

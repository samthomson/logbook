type SignedEventIdentity = { id: string; pubkey: string; sig: string }

const relayVerified = new WeakMap<object, string>()

function fingerprint(event: SignedEventIdentity): string {
  return `${event.id}:${event.pubkey}:${event.sig}`
}

/** Record only events accepted by SimplePool's cryptographic verifier. */
export function rememberRelayVerifiedEvent(event: SignedEventIdentity): void {
  relayVerified.set(event, fingerprint(event))
}

/** Reuse verification only for the exact object and signed identity the pool saw. */
export function wasRelayVerifiedEvent(event: SignedEventIdentity): boolean {
  return relayVerified.get(event) === fingerprint(event)
}

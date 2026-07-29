/**
 * Relay transport helpers — publish with per-relay error surfacing.
 *
 * `Promise.any(pool.publish(...))` resolves on the first relay that accepts,
 * but if ALL relays reject it throws an AggregateError with no useful message
 * and no record of which relays failed. `publishToRelays` requires two relay
 * acknowledgements when redundancy is configured, so a single transient relay
 * cannot make the client discard its recoverable draft prematurely.
 */
import type { NostrEvent } from '../types/nostr'
import { getPool } from './pool'
import { getEventHash } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { wasRelayVerifiedEvent } from './verified-event-cache'

/** Publish an event; require redundant acknowledgement when possible. */
export async function publishToRelays(event: NostrEvent, relays: string[]): Promise<void> {
  if (relays.length === 0) throw new Error('No relays configured')
  const pool = getPool()
  const promises = pool.publish(relays, event)

  const requiredAcks = Math.min(2, promises.length)
  if (requiredAcks === 0) throw new Error('No relay publish requests were created')

  return new Promise<void>((resolve, reject) => {
    const failures: string[] = []
    let accepted = 0
    let completed = 0
    let settled = false
    promises.forEach((p, i) => {
      Promise.resolve(p)
        .then(() => {
          if (settled) return
          accepted += 1
          completed += 1
          if (accepted >= requiredAcks) {
            settled = true
            resolve()
          }
        })
        .catch((reason: unknown) => {
          if (settled) return
          completed += 1
          failures.push(`${relays[i]}: ${reason instanceof Error ? reason.message : String(reason)}`)
          const maximumPossibleAcks = accepted + promises.length - completed
          if (maximumPossibleAcks < requiredAcks) {
            settled = true
            reject(new Error(
              `Only ${accepted} of ${requiredAcks} required relays accepted the event:\n${failures.join('\n')}`,
            ))
          }
        })
    })
  })
}

/**
 * Return only events with a valid schnorr signature + matching id.
 *
 * The relay `authors:` filter and a client-side `pubkey` re-check stop honest
 * relays from returning the wrong author — but a malicious relay can return an
 * event carrying Compass's pubkey with a garbage signature, and the client
 * would trust it. For any event we treat as authoritative (Compass issues,
 * manifests), verify the cryptographic signature before trusting content.
 */
export function filterVerified<T extends { id: string; pubkey: string; sig: string }>(events: T[]): T[] {
  return events.filter((e) => {
    try {
      if (getEventHash(e as unknown as Parameters<typeof getEventHash>[0]) !== e.id) return false
      // SimplePool already did the expensive curve math. Its private WeakMap
      // entry is bound to this exact object/id/pubkey/signature, so copied or
      // mutated events cannot inherit the fast path.
      if (wasRelayVerifiedEvent(e)) return true
      return schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey))
    } catch {
      return false
    }
  })
}

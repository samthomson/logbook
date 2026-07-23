/**
 * Relay transport helpers — publish with per-relay error surfacing.
 *
 * `Promise.any(pool.publish(...))` resolves on the first relay that accepts,
 * but if ALL relays reject it throws an AggregateError with no useful message
 * and no record of which relays failed. `publishToRelays` resolves as soon as
 * the first relay accepts (fast path preserved) and, only if every relay
 * rejects, throws a descriptive error listing each relay's rejection reason —
 * so publish failures are diagnosable instead of opaque.
 */
import type { NostrEvent } from '../types/nostr'
import { getPool } from './pool'
import { getEventHash } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

/** Publish an event; resolve on first relay ack, throw a rich error if all fail. */
export async function publishToRelays(event: NostrEvent, relays: string[]): Promise<void> {
  if (relays.length === 0) throw new Error('No relays configured')
  const pool = getPool()
  const promises = pool.publish(relays, event)

  return new Promise<void>((resolve, reject) => {
    const failures: string[] = []
    let settled = false
    promises.forEach((p, i) => {
      Promise.resolve(p)
        .then(() => {
          if (!settled) {
            settled = true
            resolve()
          }
        })
        .catch((reason: unknown) => {
          failures.push(`${relays[i]}: ${reason instanceof Error ? reason.message : String(reason)}`)
          if (!settled && failures.length === promises.length) {
            settled = true
            reject(new Error(`All relays rejected the event:\n${failures.join('\n')}`))
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
      return (
        getEventHash(e as unknown as Parameters<typeof getEventHash>[0]) === e.id &&
        schnorr.verify(hexToBytes(e.sig), hexToBytes(e.id), hexToBytes(e.pubkey))
      )
    } catch {
      return false
    }
  })
}

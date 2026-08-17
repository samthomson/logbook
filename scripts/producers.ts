/**
 * Who may author an episode manifest: Compass plus every producer named on the
 * Compass-signed producer list (kind 34201, d=logbook-wl-admins).
 *
 * Authority has one root. Only Compass can sign that list, so a key cannot
 * appoint itself; the worker resolves the list from the relay rather than
 * trusting its own environment.
 */

import { SimplePool } from 'nostr-tools/pool'
import { verifyNostrEvent } from './segment-security.ts'
import { COMPASS_PUBKEY, RELAYS, D_ADMINS, KINDS } from './config.ts'

const HEX_64 = /^[0-9a-f]{64}$/

export async function fetchProducerPubkeys(pool: SimplePool, relays: string[] = RELAYS): Promise<Set<string>> {
  const events = await pool.querySync(relays, {
    kinds: [KINDS.WHITELIST],
    authors: [COMPASS_PUBKEY], // the producer list is Compass-signed only
    '#d': [D_ADMINS],
    limit: 20,
  })
  const newest = events
    .filter((event) => event.pubkey === COMPASS_PUBKEY && verifyNostrEvent(event as never))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]

  const producers = new Set<string>([COMPASS_PUBKEY])
  if (!newest) return producers

  try {
    const content = JSON.parse(newest.content) as { admins?: unknown }
    if (Array.isArray(content.admins)) {
      for (const entry of content.admins) {
        if (typeof entry !== 'string') continue
        const hex = entry.trim().toLowerCase()
        if (HEX_64.test(hex)) producers.add(hex)
      }
    }
  } catch {
    // A malformed list must not widen trust; Compass alone remains.
  }
  return producers
}

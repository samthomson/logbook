import { getPool } from './pool'
/**
 * Profile fetching (kind 0) with in-memory cache.
 * Queries DISCOVERY_RELAYS only — never publishes there.
 */

import { nip19 } from 'nostr-tools'
import { DISCOVERY_RELAYS } from '../config'
import type { NostrEvent } from '../types/nostr'

export interface Profile {
  pubkey: string
  name: string | null       // display_name || name
  picture: string | null
}

const cache = new Map<string, Profile | null>()
const pending = new Map<string, Promise<Profile | null>>()


function parseProfileEvent(pubkey: string, event: NostrEvent | null): Profile | null {
  if (!event) return null
  try {
    const c = JSON.parse(event.content) as Record<string, unknown>
    const name =
      (typeof c.display_name === 'string' && c.display_name.trim()) ||
      (typeof c.name === 'string' && c.name.trim()) ||
      null
    const picture = typeof c.picture === 'string' && c.picture.startsWith('http') ? c.picture : null
    return { pubkey, name, picture }
  } catch {
    return null
  }
}

/** Fetch a profile; null if not found. Cached (including negative results for the session). */
export async function fetchProfile(pubkey: string): Promise<Profile | null> {
  if (cache.has(pubkey)) return cache.get(pubkey) ?? null
  if (pending.has(pubkey)) return pending.get(pubkey)!

  const p = (async () => {
    try {
      const events = await getPool().querySync(DISCOVERY_RELAYS, {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      })
      const profile = parseProfileEvent(pubkey, events[0] ?? null)
      cache.set(pubkey, profile)
      return profile
    } catch {
      // A failed query is not evidence of a missing profile. Caching null here
      // would pin every later render to the anonymous fallback for the session.
      return null
    } finally {
      pending.delete(pubkey)
    }
  })()
  pending.set(pubkey, p)
  return p
}

/** Batch-fetch profiles for many pubkeys at once (one relay query). */
export async function fetchProfiles(pubkeys: string[]): Promise<Map<string, Profile>> {
  const requested = [...new Set(pubkeys)]
  const missing = requested.filter((pk) => !cache.has(pk) && !pending.has(pk))
  if (missing.length) {
    const batch = getPool().querySync(DISCOVERY_RELAYS, {
      kinds: [0],
      authors: missing,
    }).then((events) => {
      const byAuthor = new Map<string, NostrEvent>()
      for (const e of events) {
        const prev = byAuthor.get(e.pubkey)
        if (!prev || e.created_at > prev.created_at) byAuthor.set(e.pubkey, e)
      }
      for (const pk of missing) cache.set(pk, parseProfileEvent(pk, byAuthor.get(pk) ?? null))
    }).catch(() => {
      // Leave the cache untouched so the next mount retries instead of showing
      // an anonymous author for the rest of the session.
    })

    // Claim every pubkey synchronously, before another mounted excerpt can
    // launch an overlapping relay query during the same React effect flush.
    for (const pk of missing) {
      const request = batch
        .then(() => cache.get(pk) ?? null)
        .finally(() => pending.delete(pk))
      pending.set(pk, request)
    }
  }

  await Promise.all(requested.flatMap((pk) => {
    const request = pending.get(pk)
    return request ? [request] : []
  }))
  const out = new Map<string, Profile>()
  for (const pk of requested) {
    const p = cache.get(pk)
    if (p) out.set(pk, p)
  }
  return out
}

/** Short fallback label for a pubkey with no known profile. */
export function shortKey(pubkey: string): string {
  return pubkey.slice(0, 8)
}

/**
 * Display name for a recording's author. Falls back to the full npub rather
 * than a generic word, so two unknown authors never look like the same person.
 */
export function authorLabel(profile: Profile | null | undefined, pubkey: string): string {
  const name = profile?.name?.trim()
  if (name) return name
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return shortKey(pubkey)
  }
}

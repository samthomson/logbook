/**
 * Validation-roster module — kind 34201 events authored by COMPASS_PUBKEY.
 *
 * Authentication permits recording; validation determines cut eligibility.
 *
 * Sources (merged as a UNION — revocation requires removal from every list
 * that grants a pubkey; the admin UI shows provenance per entry):
 *   1. Per-issue event:    kind 34201, d-tag `logbook-wl-<issueNumber>`
 *   2. Standing roster:    kind 34201, d-tag `logbook-wl-standing`
 *   3. Every npub mention in the current canonical revision of each
 *      signature-verified Compass newsletter.
 *
 * Admins come from a THIRD event (d-tag `logbook-wl-admins`), fetched
 * separately — admin status is never derived from contributor lists.
 *
 * Failure semantics (explicit, do not "simplify"):
 *   - Event ABSENT (relays return nothing for a d-tag) = empty list. This is
 *     normal for a fresh issue — NOT an error.
 *   - Event present but unverifiable (bad sig / wrong author) = ignored,
 *     treated as absent, logged.
 *   - RELAY ERROR (query throws) for a d-tag = that source contributes
 *     nothing; if ALL signed event sources error, the caller
 *     gets `degraded: true` so the UI can show that validation status is
 *     temporarily unavailable without disabling authenticated recording.
 *   - Producer authority fails closed to Compass alone when the admins event
 *     is absent or unreachable. Initial seeding uses the trusted worker tool;
 *     build-time configuration cannot restore a relay-revoked producer.
 *
 * Trust: all fetches pin authors:[COMPASS_PUBKEY] and run filterVerified —
 * anyone can publish a kind 34201 with our d-tags, but clients only trust
 * Compass-signed ones; producer manifests remain separately constrained by the
 * Compass-signed producer roster.
 */

import { nip19 } from 'nostr-tools'
import { COMPASS_PUBKEY, RELAYS, DISCOVERY_RELAYS, KINDS, D_STANDING, D_ADMINS, D_ISSUE_WL } from '../config'
import type { NostrEvent, NostrSigner } from '../types/nostr'
import { getPool } from './pool'
import { filterVerified, publishToRelays } from './relay'
import { now } from './utils'
import { assertEventSignedByExpected, assertSignerStillExpected } from './signer-identity'
import { withSignerTimeout } from './signer-timeout'
import { hasReasonableEventTimestamp, latestReasonableEventTimestamp } from './event-time'

export interface WhitelistEntry {
  pubkey: string          // hex-64, normalized
  name?: string           // display label (advisory)
}

export interface AccessLists {
  /** Union of per-issue, standing, and verified-newsletter contributors. */
  contributors: Set<string>
  /** Admin pubkeys from the Compass-signed event, plus Compass itself. */
  admins: Set<string>
  /** Provenance: which lists grant each contributor (for admin UI display). */
  sources: Map<string, ('per-issue' | 'standing' | 'newsletter')[]>
  /** True when every source failed — UI should show a retry banner. */
  degraded: boolean
  /** Retained for compatibility; false because config never grants authority. */
  adminsFromBootstrap: boolean
}

// In-memory cache, keyed per d-tag. Cleared on own publish; refetched on
// session start / episode page mount. Cross-device staleness is bounded by
// session lifetime; a foreground refresh bypasses it before privileged writes.
const eventCache = new Map<string, NostrEvent | null>()

/**
 * Fetch one whitelist event by d-tag. Returns null when absent/invalid.
 *
 * `authors` must always be pinned — anyone can squat a d-tag. Every trusted
 * roster is Compass-only; producers curate episodes but cannot delegate roster
 * authority.
 */
async function fetchWhitelistEvent(
  dTag: string,
  relays: string[] = RELAYS,
  forceRefresh = false,
  authors: string[] = [COMPASS_PUBKEY],
): Promise<NostrEvent | null> {
  if (!forceRefresh && eventCache.has(dTag)) return eventCache.get(dTag) ?? null
  const pool = getPool()
  const trusted = new Set(authors.map((author) => author.toLowerCase()))
  const events = await pool.querySync(relays, {
    kinds: [KINDS.WHITELIST],
    authors: [...trusted], // REQUIRED — anyone can squat the d-tag
    '#d': [dTag],
    until: latestReasonableEventTimestamp(),
    limit: 50,
  })
  // NIP-01: latest created_at wins; the lexicographically lowest ID breaks ties.
  const verified = filterVerified(events)
    .filter((e) => trusted.has(e.pubkey.toLowerCase()))
    .filter((e) => hasReasonableEventTimestamp(e))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
  const winner = verified[0] ?? null
  // Cache only verified revisions. A timed-out/temporarily empty relay query
  // must remain retryable when the PWA returns to the foreground.
  if (winner) eventCache.set(dTag, winner)
  return winner
}

/** Parse a whitelist event's content into entries. Content schema:
 *  contributors/standing: { contributors: [{pubkey: hex|npub, name?}] }
 *  admins:                { admins: [hex|npub] }
 * Invalid tokens are dropped silently (deliberate — one bad npub must not
 * poison the whole list). */
function parseEntries(event: NostrEvent, field: 'contributors' | 'admins'): WhitelistEntry[] {
  try {
    const data = JSON.parse(event.content) as Record<string, unknown>
    const raw = data[field]
    if (!Array.isArray(raw)) return []
    const out: WhitelistEntry[] = []
    for (const item of raw) {
      if (field === 'admins') {
        const hex = typeof item === 'string' ? normalizeToHex(item) : null
        if (hex) out.push({ pubkey: hex })
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        const hex = typeof rec.pubkey === 'string' ? normalizeToHex(rec.pubkey) : null
        if (hex) out.push({ pubkey: hex, name: typeof rec.name === 'string' ? rec.name : undefined })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Fetch the full access-control picture for an issue.
 * Single entry point — App must derive both canRecord and isAdmin from this
 * one call (no parallel fetch → no gating race).
 */
export async function fetchAccessLists(
  issueNumber: number,
  relays: string[] = RELAYS,
  options: { forceRefresh?: boolean } = {},
): Promise<AccessLists> {
  const issueDTag = D_ISSUE_WL(issueNumber)

  // The producer list resolves first for admin capability. It does not widen
  // roster authorship: every trusted 34201 event is Compass-authored.
  const adminsResult = await Promise.allSettled([
    fetchWhitelistEvent(D_ADMINS, relays, options.forceRefresh),
  ])
  const adminsEv = adminsResult[0].status === 'fulfilled' ? adminsResult[0].value : null
  const producers = new Set<string>([COMPASS_PUBKEY.toLowerCase()])
  if (adminsEv) {
    for (const entry of parseEntries(adminsEv, 'admins')) producers.add(entry.pubkey.toLowerCase())
  }

  const contributorResults = await Promise.allSettled([
    fetchWhitelistEvent(issueDTag, relays, options.forceRefresh),
    fetchWhitelistEvent(D_STANDING, relays, options.forceRefresh),
    fetchVerifiedNewsletterMentions(),
  ])
  const [issueEv, standingEv] = contributorResults.map((r) =>
    r.status === 'fulfilled' ? r.value : null,
  ) as [NostrEvent | null, NostrEvent | null, Set<string> | null]

  const contributors = new Set<string>()
  const sources = new Map<string, ('per-issue' | 'standing' | 'newsletter')[]>()
  const grant = (pk: string, src: 'per-issue' | 'standing' | 'newsletter') => {
    contributors.add(pk)
    sources.set(pk, [...(sources.get(pk) ?? []), src])
  }

  if (issueEv) for (const e of parseEntries(issueEv, 'contributors')) grant(e.pubkey, 'per-issue')
  if (standingEv) for (const e of parseEntries(standingEv, 'contributors')) grant(e.pubkey, 'standing')
  const newsletter = contributorResults[2].status === 'fulfilled' ? contributorResults[2].value : null
  if (newsletter) for (const pk of newsletter) grant(pk, 'newsletter')

  // Admins are relay-authoritative. COMPASS_PUBKEY is always the root admin;
  // no build-time list can restore a producer removed from the signed event.
  const adminsFromBootstrap = false
  const admins = producers

  // Degraded = every source failed (all promises rejected). Absent events are
  // fulfilled-null and do NOT count as failure.
  const degraded = contributorResults.every((r) => r.status === 'rejected')

  return { contributors, admins, sources, degraded, adminsFromBootstrap }
}

/** Broad validation roster from each canonical signature-verified Compass newsletter revision. */
export async function fetchVerifiedNewsletterMentions(
  relays: string[] = DISCOVERY_RELAYS,
): Promise<Set<string>> {
  const pool = getPool()
  const byDTag = new Map<string, NostrEvent>()
  let until = latestReasonableEventTimestamp()
  for (;;) {
    const page = await pool.querySync(relays, {
      kinds: [30023],
      authors: [COMPASS_PUBKEY],
      until,
      limit: 500,
    })
    if (page.length === 0) break
    const reasonablePage = page.filter((event) => hasReasonableEventTimestamp(event))
    const trustedPage = filterVerified(reasonablePage).filter(
      (event) => event.pubkey.toLowerCase() === COMPASS_PUBKEY.toLowerCase() && hasReasonableEventTimestamp(event),
    )
    let oldest = until
    for (const event of reasonablePage) oldest = Math.min(oldest, event.created_at)
    for (const event of trustedPage) {
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
      if (!dTag || !/^newsletter-\d+$/.test(dTag)) continue
      const current = byDTag.get(dTag)
      if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id < current.id)) {
        byDTag.set(dTag, event)
      }
    }
    if (oldest >= until || oldest <= 0) break
    until = oldest - 1
  }
  const out = new Set<string>()
  for (const event of byDTag.values()) {
    for (const pubkey of extractMentionedPubkeys(event.content)) out.add(pubkey)
  }
  return out
}

/** Extract npub1… tokens mentioned in newsletter markdown (auto-suggest).
 *  Validated via nip19.decode, deduped, hex-normalized. */
export function extractMentionedPubkeys(markdown: string): string[] {
  const tokens = markdown.match(/npub1[02-9ac-hj-np-z]+/g) ?? []
  const out = new Set<string>()
  for (const t of tokens) {
    const hex = normalizeToHex(t)
    if (hex) out.add(hex)
  }
  return [...out]
}

/**
 * Publish a roster event. All trusted 34201 state is Compass-only, so reject a
 * non-Compass signer before any signing or relay side effect.
 */
export async function publishWhitelist(
  dTag: string,
  entries: WhitelistEntry[],
  signer: NostrSigner,
  relays: string[] = RELAYS,
  assertActive?: () => void,
): Promise<NostrEvent> {
  if (relays.length === 0) throw new Error('No relays configured')
  assertActive?.()
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertActive?.()
  const isAdmins = dTag === D_ADMINS
  if (pubkey.toLowerCase() !== COMPASS_PUBKEY.toLowerCase()) {
    throw new Error(
      'Only the Compass key can change producer or contributor validation rosters. ' +
      'This change would be ignored by all clients.',
    )
  }
  const content = JSON.stringify(
    isAdmins
      ? { admins: entries.map((e) => e.pubkey) }
      : { contributors: entries.map((e) => (e.name ? { pubkey: e.pubkey, name: e.name } : { pubkey: e.pubkey })) },
  )
  const unsigned = {
    kind: KINDS.WHITELIST,
    created_at: now(),
    tags: [
      ['d', dTag],
      ['alt', `Logbook whitelist: ${dTag}`],
    ],
    content,
    pubkey,
  }
  assertActive?.()
  const event = await withSignerTimeout(signer.signEvent(unsigned), 'Signer whitelist signing')
  assertActive?.()
  assertEventSignedByExpected(event, pubkey)
  await assertSignerStillExpected(signer, pubkey, assertActive)
  await publishToRelays(event, relays)
  assertActive?.()
  // Own publish invalidates the cache for ALL d-tags this session holds.
  eventCache.clear()
  return event
}

/** Fetch current entries for one d-tag (for the editor). All are Compass-only. */
export async function fetchWhitelistEntries(
  dTag: string,
  relays: string[] = RELAYS,
): Promise<WhitelistEntry[]> {
  const ev = await fetchWhitelistEvent(dTag, relays, false, [COMPASS_PUBKEY])
  if (!ev) return []
  return parseEntries(ev, dTag === D_ADMINS ? 'admins' : 'contributors')
}

/**
 * Pubkeys allowed to author an episode manifest: Compass plus every producer on
 * the Compass-signed admin list. Authority still originates from Compass alone —
 * only Compass can sign that list — so no key can promote itself.
 *
 * When the list is absent or unreachable this fails closed to Compass alone.
 */
export async function fetchProducerPubkeys(
  relays: string[] = RELAYS,
  forceRefresh = false,
): Promise<Set<string>> {
  const event = await fetchWhitelistEvent(D_ADMINS, relays, forceRefresh)
  const producers = new Set<string>([COMPASS_PUBKEY.toLowerCase()])
  if (event) {
    for (const entry of parseEntries(event, 'admins')) producers.add(entry.pubkey.toLowerCase())
  }
  return producers
}


/** Convert npub1… to hex, or pass through if already hex-64. */
export function normalizeToHex(pubkey: string): string | null {
  if (!pubkey) return null
  if (pubkey.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(pubkey)
      if (decoded.type === 'npub') return decoded.data as string
    } catch {
      return null
    }
  }
  if (/^[0-9a-f]{64}$/i.test(pubkey)) return pubkey.toLowerCase()
  return null
}

/** Invalidate cached events (called after publish; safe to call liberally). */
export function invalidateWhitelistCache(): void {
  eventCache.clear()
}

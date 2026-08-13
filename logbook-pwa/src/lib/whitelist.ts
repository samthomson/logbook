/**
 * Whitelist module — kind 34201 events authored by COMPASS_PUBKEY.
 *
 * The whitelist is UI-only — relay and Blossom access remain public.
 * The record button is hidden for pubkeys not on the merged list.
 *
 * Sources (merged as a UNION — revocation requires removal from every list
 * that grants a pubkey; the admin UI shows provenance per entry):
 *   1. Per-issue event:    kind 34201, d-tag `logbook-wl-<issueNumber>`
 *   2. Standing roster:    kind 34201, d-tag `logbook-wl-standing`
 *   3. Legacy static JSON: /data/whitelist-<issueId>.json + /data/npubs.yml
 *      (one-release fallback; removal criterion: zero fallback hits logged
 *      for 30 days, then delete this branch)
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
 *     nothing; if ALL event sources error AND static JSON errors, the caller
 *     gets `degraded: true` so the UI can show "couldn't load contributor
 *     list — retry" instead of silently hiding the record button.
 *   - Bootstrap ADMIN_PUBKEYS are used only when the admins event is absent
 *     or unfetchable — admins must never be locked out of the UI that fixes
 *     the list.
 *
 * Trust: all fetches pin authors:[COMPASS_PUBKEY] and run filterVerified —
 * anyone can publish a kind 34201 with our d-tags, but clients only trust
 * Compass-signed ones (same model as kind 34200 manifests).
 */

import { nip19 } from 'nostr-tools'
import { COMPASS_PUBKEY, RELAYS, KINDS, D_STANDING, D_ADMINS, D_ISSUE_WL, ADMIN_PUBKEYS, ISSUE_PREFIX } from '../config'
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
  /** Union of per-issue + standing + legacy JSON contributors. */
  contributors: Set<string>
  /** Admin pubkeys — on-chain event if fetchable, else config bootstrap. */
  admins: Set<string>
  /** Provenance: which lists grant each contributor (for admin UI display). */
  sources: Map<string, ('per-issue' | 'standing' | 'legacy')[]>
  /** True when every source failed — UI should show a retry banner. */
  degraded: boolean
  /** True when admins came from the config bootstrap (no on-chain event). */
  adminsFromBootstrap: boolean
}

// In-memory cache, keyed per d-tag. Cleared on own publish; refetched on
// session start / AdminPanel mount. Cross-device staleness is bounded by
// session lifetime — acceptable for a UI-only gate.
const eventCache = new Map<string, NostrEvent | null>()

/** Fetch one whitelist event by d-tag. Returns null when absent/invalid. */
async function fetchWhitelistEvent(
  dTag: string,
  relays: string[] = RELAYS,
  forceRefresh = false,
): Promise<NostrEvent | null> {
  if (!forceRefresh && eventCache.has(dTag)) return eventCache.get(dTag) ?? null
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.WHITELIST],
    authors: [COMPASS_PUBKEY], // REQUIRED — anyone can squat the d-tag
    '#d': [dTag],
    until: latestReasonableEventTimestamp(),
    limit: 50,
  })
  // Latest-by-created_at wins after signature verification (manifest rule).
  const verified = filterVerified(events)
    .filter((e) => e.pubkey === COMPASS_PUBKEY)
    .filter((e) => hasReasonableEventTimestamp(e))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
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
  const legacyIssueId = `${ISSUE_PREFIX}-${issueNumber}` // logbook-<N> static JSON

  const results = await Promise.allSettled([
    fetchWhitelistEvent(issueDTag, relays, options.forceRefresh),
    fetchWhitelistEvent(D_STANDING, relays, options.forceRefresh),
    fetchWhitelistEvent(D_ADMINS, relays, options.forceRefresh),
    fetchLegacyJson(legacyIssueId),
  ])
  const [issueEv, standingEv, adminsEv, legacy] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : null,
  ) as [NostrEvent | null, NostrEvent | null, NostrEvent | null, Set<string> | null]

  const contributors = new Set<string>()
  const sources = new Map<string, ('per-issue' | 'standing' | 'legacy')[]>()
  const grant = (pk: string, src: 'per-issue' | 'standing' | 'legacy') => {
    contributors.add(pk)
    sources.set(pk, [...(sources.get(pk) ?? []), src])
  }

  if (issueEv) for (const e of parseEntries(issueEv, 'contributors')) grant(e.pubkey, 'per-issue')
  if (standingEv) for (const e of parseEntries(standingEv, 'contributors')) grant(e.pubkey, 'standing')
  if (legacy) for (const pk of legacy) grant(pk, 'legacy')

  // Admins: verified on-chain event replaces config entirely; config is the
  // bootstrap when no verified event is fetchable. COMPASS_PUBKEY always admin.
  const adminsFromBootstrap = adminsEv === null
  const admins = new Set<string>([COMPASS_PUBKEY])
  if (adminsEv) {
    for (const e of parseEntries(adminsEv, 'admins')) admins.add(e.pubkey)
  } else {
    for (const pk of ADMIN_PUBKEYS) admins.add(pk.toLowerCase())
  }

  // Degraded = every source failed (all promises rejected). Absent events are
  // fulfilled-null and do NOT count as failure.
  const degraded = results.every((r) => r.status === 'rejected')

  return { contributors, admins, sources, degraded, adminsFromBootstrap }
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
 * Publish a whitelist event. Signed by the caller's signer — but readers
 * only trust COMPASS_PUBKEY-authored events, so a non-Compass publish is
 * pointless: throw pre-signing (same guard class as updateManifest).
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
  if (pubkey !== COMPASS_PUBKEY) {
    throw new Error(
      'Whitelist events are only trusted when signed by the Compass key. ' +
      'You are logged in as an admin, but not the Compass key — this change ' +
      'would be ignored by all clients.',
    )
  }
  const isAdmins = dTag === D_ADMINS
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
  assertEventSignedByExpected(event, COMPASS_PUBKEY)
  await assertSignerStillExpected(signer, COMPASS_PUBKEY, assertActive)
  await publishToRelays(event, relays)
  assertActive?.()
  // Own publish invalidates the cache for ALL d-tags this session holds.
  eventCache.clear()
  return event
}

/** Fetch current entries for one d-tag (for the admin editor). */
export async function fetchWhitelistEntries(
  dTag: string,
  relays: string[] = RELAYS,
): Promise<WhitelistEntry[]> {
  const ev = await fetchWhitelistEvent(dTag, relays)
  if (!ev) return []
  return parseEntries(ev, dTag === D_ADMINS ? 'admins' : 'contributors')
}

/** Legacy static-JSON sources (one-release fallback). */
async function fetchLegacyJson(issueId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const [issueList, roster] = await Promise.allSettled([
    fetch(`/data/whitelist-${issueId}.json`).then((r) => (r.ok ? r.json() : [])),
    fetch('/data/npubs.yml').then((r) => (r.ok ? r.text() : '')),
  ])
  if (issueList.status === 'fulfilled' && Array.isArray(issueList.value)) {
    for (const p of issueList.value as string[]) {
      const hex = normalizeToHex(p)
      if (hex) {
        out.add(hex)
        console.warn('Legacy whitelist JSON in use — migrate to kind 34201')
      }
    }
  }
  if (roster.status === 'fulfilled' && typeof roster.value === 'string') {
    for (const hex of parseNpubsYml(roster.value)) out.add(hex)
  }
  return out
}

/** Parse npubs.yml — flat "name: npub1…" or "- pubkey: <hex>" entries. */
function parseNpubsYml(yaml: string): string[] {
  const pubkeys: string[] = []
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim().replace(/^-\s*/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const value = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    const hex = normalizeToHex(value)
    if (hex) pubkeys.push(hex)
  }
  return pubkeys
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

import { getPool } from './pool'
/**
 * Manifest module — fetch and update kind 34200 issue manifests.
 *
 * Security: ALL queries MUST pin authors to the trusted producer set — Compass
 * plus the producers named on the Compass-signed admin list. The client
 * re-verifies event.pubkey against that same set on receipt. Only Compass can
 * sign the admin list, so authority always originates from Compass.
 */

import { RELAYS, KINDS, ISSUE_PREFIX, COMPASS_PUBKEY } from '../config'
import type { Filter } from 'nostr-tools'
import { fetchProducerPubkeys } from './whitelist'
import type {
  NostrEvent,
  IssueManifest,
  ManifestContent,
  ManifestSection,
  NostrSigner,
} from '../types/nostr'
import { parseManifestContent } from '../types/nostr'
import { now } from './utils'
import { publishToRelays, filterVerified } from './relay'
import {
  foldAuthoritativeManifestRevision,
  selectNewestAddressableRevision,
  selectNewestPerDTag,
} from './manifest-revision'
import { releaseOverlayKey, withReleaseOverlay } from './release-overlay'
import { withSignerTimeout } from './signer-timeout'
import { assertEventSignedByExpected, assertSignerStillExpected } from './signer-identity'
function manifestFilters(
  producers: ReadonlySet<string>,
  extra: { '#d'?: string[] } = {},
): Filter[] {
  const compass = COMPASS_PUBKEY.toLowerCase()
  const others = [...producers].filter((pubkey) => pubkey !== compass)
  const scoped = Boolean(extra['#d']?.length)
  const base = { kinds: [KINDS.MANIFEST], limit: scoped ? 500 : 50, ...extra }
  return [
    { ...base, authors: [compass] },
    ...(others.length > 0 ? [{ ...base, authors: others }] : []),
  ]
}

/** A live subscription has no per-author limit to preserve, so the producer
 * batches merge into the single filter nostr-tools subscribes with. */
function manifestSubscriptionFilter(
  producers: ReadonlySet<string>,
  extra: { '#d'?: string[] } = {},
): Filter {
  return { kinds: [KINDS.MANIFEST], authors: [...producers], limit: 50, ...extra }
}


export async function fetchVerifiedManifestEvents(
  issueNumber: number,
  relays: string[] = RELAYS,
): Promise<NostrEvent[]> {
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const producers = await fetchProducerPubkeys(relays)
  const pool = getPool()
  const events = (
    await Promise.all(manifestFilters(producers, { '#d': [issueId] }).map((filter) => pool.querySync(relays, filter)))
  ).flat()
  return filterVerified(events).filter((candidate) => (
    producers.has(candidate.pubkey.toLowerCase())
    && candidate.tags.some((tag) => tag[0] === 'd' && tag[1] === issueId)
  ))
}

function presentManifest(event: NostrEvent, all: readonly NostrEvent[]): IssueManifest | null {
  const parsed = parseManifestEvent(event)
  if (!parsed) return null
  return withReleaseOverlay(parsed, all)
}

/** Fetch the manifest for a given issue number. Returns null if not found. */
export async function fetchManifest(
  issueNumber: number,
  relays: string[] = RELAYS,
  preferEventId?: string | null,
): Promise<IssueManifest | null> {
  const events = await fetchVerifiedManifestEvents(issueNumber, relays)
  if (preferEventId) {
    const preferred = events.find((event) => event.id === preferEventId)
    if (preferred) return presentManifest(preferred, events)
  }
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const event = selectNewestAddressableRevision(events, issueId)
  if (!event) return null
  return presentManifest(event, events)
}

/**
 * Live revisions of one episode's manifest. The worker can hand an episode back
 * at any moment, so the page must not need a reload to show it. Same pinning as
 * every other manifest read: producer authors, signature re-verified on receipt.
 */
export function subscribeManifest(
  issueNumber: number,
  onRevision: (manifest: IssueManifest) => void,
  relays: string[] = RELAYS,
): () => void {
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  let cancelled = false
  let close: (() => void) | null = null

  void fetchProducerPubkeys(relays).then((producers) => {
    if (cancelled) return
    const seen = new Map<string, NostrEvent>()
    let emittedKey: string | null = null
    const sub = getPool().subscribeMany(
      relays,
      manifestSubscriptionFilter(producers, { '#d': [issueId] }),
      {
        onevent: (event) => {
          if (!producers.has(event.pubkey.toLowerCase())) return
          const [verified] = filterVerified([event as NostrEvent])
          if (!verified) return
          const picked = foldAuthoritativeManifestRevision(seen, verified)
          if (!picked) return
          const parsed = presentManifest(picked, [...seen.values()])
          if (!parsed || parsed.issueId !== issueId) return
          const key = releaseOverlayKey(parsed)
          if (key === emittedKey) return
          emittedKey = key
          onRevision(parsed)
        },
        oneose: () => {
          void fetchManifest(issueNumber, relays).then((parsed) => {
            if (cancelled || !parsed) return
            const key = releaseOverlayKey(parsed)
            if (key === emittedKey) return
            emittedKey = key
            onRevision(parsed)
          })
        },
      },
    )
    close = () => sub.close()
  })

  return () => {
    cancelled = true
    close?.()
  }
}

/** Live revisions of every episode, for the index. Same pinning as fetchAllManifests. */
export function subscribeManifests(
  onRevision: (manifest: IssueManifest) => void,
  relays: string[] = RELAYS,
): () => void {
  let cancelled = false
  let close: (() => void) | null = null

  void fetchProducerPubkeys(relays).then((producers) => {
    if (cancelled) return
    const seenByIssue = new Map<string, Map<string, NostrEvent>>()
    const emittedByIssue = new Map<string, string>()
    const sub = getPool().subscribeMany(
      relays,
      manifestSubscriptionFilter(producers),
      {
        onevent: (event) => {
          if (!producers.has(event.pubkey.toLowerCase())) return
          const [verified] = filterVerified([event as NostrEvent])
          if (!verified) return
          const dTag = verified.tags.find((tag) => tag[0] === 'd')?.[1]
          if (!dTag) return
          let seen = seenByIssue.get(dTag)
          if (!seen) {
            seen = new Map()
            seenByIssue.set(dTag, seen)
          }
          const picked = foldAuthoritativeManifestRevision(seen, verified)
          if (!picked) return
          const parsed = presentManifest(picked, [...seen.values()])
          if (!parsed) return
          const key = releaseOverlayKey(parsed)
          if (key === emittedByIssue.get(dTag)) return
          emittedByIssue.set(dTag, key)
          onRevision(parsed)
        },
      },
    )
    close = () => sub.close()
  })

  return () => {
    cancelled = true
    close?.()
  }
}

/** Fetch all available manifests for the issue picker. */
export async function fetchAllManifests(
  relays: string[] = RELAYS,
): Promise<IssueManifest[]> {
  const pool = getPool()
  const producers = await fetchProducerPubkeys(relays)

  const events = (
    await Promise.all(manifestFilters(producers).map((filter) => pool.querySync(relays, filter)))
  ).flat()

  const verified = filterVerified(events).filter((e) => producers.has(e.pubkey.toLowerCase()))
  const byIssue = new Map<string, NostrEvent[]>()
  for (const event of verified) {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (!dTag) continue
    const group = byIssue.get(dTag)
    if (group) group.push(event)
    else byIssue.set(dTag, [event])
  }
  return selectNewestPerDTag(verified)
    .map((event) => {
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
      return presentManifest(event, dTag ? byIssue.get(dTag) ?? [event] : [event])
    })
    .filter((m): m is IssueManifest => m !== null)
    .sort((a, b) => b.event.created_at - a.event.created_at)
}

/**
 * Publish an updated manifest (producers only).
 * Replaces the previous version via the addressable event mechanism.
 */
export async function updateManifest(
  issueNumber: number,
  content: ManifestContent,
  signer: NostrSigner,
  relays: string[] = RELAYS,
  previousEventId: string | null = null,
  previousCreatedAt: number | null = null,
  assertActive?: () => void,
): Promise<NostrEvent> {
  if (relays.length === 0) throw new Error('No relays configured')
  assertActive?.()
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertActive?.()

  // Re-resolve authority at publish time: a stale UI must not emit an event
  // every reader would discard.
  const producers = await fetchProducerPubkeys(relays, true)
  assertActive?.()
  if (!producers.has(pubkey.toLowerCase())) {
    throw new Error(
      'Only Compass or a producer on the Compass-signed producer list can publish an episode. ' +
      'Ask Compass to add this key before releasing.',
    )
  }

  const unsigned = {
    kind: KINDS.MANIFEST,
    created_at: manifestCreatedAt(now(), previousCreatedAt),
    tags: buildManifestTags(issueNumber, previousEventId),
    content: JSON.stringify(content),
    pubkey,
  }

  assertActive?.()
  const event = await withSignerTimeout(signer.signEvent(unsigned), 'Signer manifest signing')
  assertActive?.()
  assertEventSignedByExpected(event, pubkey)
  await assertSignerStillExpected(signer, pubkey, assertActive)
  await publishToRelays(event, relays)
  assertActive?.()
  return event
}

export function manifestCreatedAt(currentTime: number, previousCreatedAt: number | null): number {
  return previousCreatedAt === null ? currentTime : Math.max(currentTime, previousCreatedAt + 1)
}

export function buildManifestTags(issueNumber: number, previousEventId: string | null): string[][] {
  const tags = [
    ['d', `${ISSUE_PREFIX}-${issueNumber}`],
    ['title', `Logbook Episode ${issueNumber}`],
  ]
  if (previousEventId) tags.push(['previous', previousEventId])
  return tags
}

/** Parse a raw kind 34200 event into a typed IssueManifest. */
function parseManifestEvent(event: NostrEvent): IssueManifest | null {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  if (!dTag) return null

  const content = parseManifestContent(event.content)
  if (!content) return null

  return {
    event,
    issueId: dTag,
    content,
  }
}

/**
 * Build an initial empty manifest for a new issue.
 * Called by the VPS cron when a new Compass issue is detected.
 */
export function buildInitialManifest(
  _issueNumber: number,
  issueRef: string,
  sections: { id: string; title: string }[],
): ManifestContent {
  return {
    issueRef,
    episodeStatus: 'draft',
    sections: sections.map(
      (s): ManifestSection => ({
        id: s.id,
        title: s.title,
        introEventId: null,
        sectionExcluded: false,
        order: [],
        excluded: [],
        reviewed: [],
      }),
    ),
    publishedRss: null,
  }
}

import { getPool } from './pool'
/**
 * Manifest module — fetch and update kind 34200 issue manifests.
 *
 * Security: ALL queries MUST pin authors:[COMPASS_PUBKEY].
 * The client re-verifies event.pubkey === COMPASS_PUBKEY on receipt.
 */

import { COMPASS_PUBKEY, DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'
import type {
  NostrEvent,
  IssueManifest,
  ManifestContent,
  ManifestSection,
  NostrSigner,
} from '../types/nostr'
import { parseManifestContent } from '../types/nostr'
import { now } from './utils'


/** Fetch the manifest for a given issue number. Returns null if not found. */
export async function fetchManifest(
  issueNumber: number,
  relays: string[] = DEFAULT_RELAYS,
): Promise<IssueManifest | null> {
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const pool = getPool()

  const events = await pool.querySync(relays, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],  // REQUIRED — never omit
    '#d': [issueId],
    limit: 1,
  })

  if (!events.length) return null

  const event = events[0]

  // Re-verify pubkey — the relay filter protects us, but client must check too
  if (event.pubkey !== COMPASS_PUBKEY) {
    console.error('Manifest pubkey mismatch — discarding spoofed manifest', event)
    return null
  }

  return parseManifestEvent(event)
}

/** Fetch all available manifests for the issue picker. */
export async function fetchAllManifests(
  relays: string[] = DEFAULT_RELAYS,
): Promise<IssueManifest[]> {
  const pool = getPool()

  const events = await pool.querySync(relays, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],  // REQUIRED
    limit: 50,
  })

  return events
    .filter((e) => e.pubkey === COMPASS_PUBKEY)  // re-verify
    .map(parseManifestEvent)
    .filter((m): m is IssueManifest => m !== null)
    .sort((a, b) => b.event.created_at - a.event.created_at)
}

/**
 * Publish an updated manifest (admin only).
 * Replaces the previous version via the addressable event mechanism.
 */
export async function updateManifest(
  issueNumber: number,
  content: ManifestContent,
  signer: NostrSigner,
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent> {
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const pubkey = await signer.getPublicKey()

  // Only Compass pubkey should publish manifests
  if (pubkey !== COMPASS_PUBKEY) {
    throw new Error('Only the Compass pubkey can publish manifests')
  }

  const unsigned = {
    kind: KINDS.MANIFEST,
    created_at: now(),
    tags: [
      ['d', issueId],
      ['title', `Logbook Episode ${issueNumber}`],
    ],
    content: JSON.stringify(content),
    pubkey,
  }

  if (relays.length === 0) throw new Error('No relays configured')
  const event = await signer.signEvent(unsigned)
  const pool = getPool()
  await Promise.any(pool.publish(relays, event))
  return event
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
        order: [],
        excluded: [],
        reviewed: [],
      }),
    ),
    publishedRss: null,
  }
}

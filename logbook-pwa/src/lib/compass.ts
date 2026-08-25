import { nip19 } from 'nostr-tools'
import { RELAYS, DISCOVERY_RELAYS, ISSUE_PREFIX, KINDS } from '../config'
import { REAL_COMPASS_PUBKEY } from './config-env'
import type { NostrEvent, CompassIssue, IssueSection, IssueSectionItem } from '../types/nostr'
import { slugify } from './utils'
import { filterVerified } from './relay'
import { hasReasonableEventTimestamp, latestReasonableEventTimestamp } from './event-time'
import { getPool } from './pool'
const ISSUE_CACHE_TTL_MS = 5 * 60 * 1000
const ISSUE_QUERY_MAX_WAIT_MS = 1_800
const INITIAL_ISSUE_SCAN_LIMIT = 12
const issueLists = new Map<string, { expiresAt: number; events: NostrEvent[] }>()
const issueRequests = new Map<string, Promise<NostrEvent[]>>()

/** The newsletter's own Nostr address — the episode is built from this event. */
export function issueAddress(issue: CompassIssue): string {
  const identifier = issue.event.tags.find((tag) => tag[0] === 'd')?.[1]
  if (!identifier) throw new Error('The Compass issue has no addressable identifier.')
  return nip19.naddrEncode({
    kind: issue.event.kind,
    pubkey: issue.event.pubkey,
    identifier,
  })
}

/** Fetch the most recent Compass kind 30023 long-form issue. */
export async function fetchLatestIssue(
  relays: string[] = DISCOVERY_RELAYS,
): Promise<NostrEvent | null> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [REAL_COMPASS_PUBKEY],
    until: latestReasonableEventTimestamp(),
    limit: 20,
  }, { maxWait: ISSUE_QUERY_MAX_WAIT_MS })
  if (!events.length) return null
  // Only trust cryptographically valid issues (a malicious relay can spoof pubkey)
  const verified = filterVerified(events).filter((event) => hasReasonableEventTimestamp(event))
  if (!verified.length) return null
  // Return most recent deterministically when relays disagree on same-second revisions.
  return verified.reduce((a, b) => (
    a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id) ? a : b
  ))
}

/** Fetch a specific Compass issue by its d-tag (issue number slug). */
export async function fetchIssueByDTag(
  dTag: string,
  relays: string[] = DISCOVERY_RELAYS,
): Promise<NostrEvent | null> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [REAL_COMPASS_PUBKEY],
    '#d': [dTag],
    until: latestReasonableEventTimestamp(),
    limit: 20,
  }, { maxWait: ISSUE_QUERY_MAX_WAIT_MS })
  const verified = filterVerified(events).filter((event) => hasReasonableEventTimestamp(event))
  return verified.reduce<NostrEvent | null>((latest, event) => (
    !latest || event.created_at > latest.created_at || (event.created_at === latest.created_at && event.id > latest.id)
      ? event
      : latest
  ), null)
}

/** Fetch all available Compass issues (for the issue picker). */
export async function fetchAllIssues(
  relays: string[] = DISCOVERY_RELAYS,
): Promise<NostrEvent[]> {
  const key = relays.join('\n')
  const cached = issueLists.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.events
  const inFlight = issueRequests.get(key)
  if (inFlight) return inFlight

  const request = getPool().querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [REAL_COMPASS_PUBKEY],
    until: latestReasonableEventTimestamp(),
    limit: 100,
  }, { maxWait: ISSUE_QUERY_MAX_WAIT_MS }).then((events) => {
    const selected = selectCompassIssues(filterVerified(events))
    issueLists.set(key, { expiresAt: Date.now() + ISSUE_CACHE_TTL_MS, events: selected })
    return selected
  }).finally(() => issueRequests.delete(key))
  issueRequests.set(key, request)
  return request
}

/** Keep newsletter issues only and collapse old replaceable-event revisions by issue number. */
export function selectCompassIssues(events: readonly NostrEvent[]): NostrEvent[] {
  const selected = new Map<number, NostrEvent>()
  for (const event of events) {
    if (!hasReasonableEventTimestamp(event)) continue
    const title = event.tags.find((tag) => tag[0] === 'title')?.[1] ?? ''
    if (/\bpodcast\b/i.test(title)) continue
    const issueNumber = extractIssueNumber(event)
    if (issueNumber <= 0) continue
    const current = selected.get(issueNumber)
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id > current.id)) {
      selected.set(issueNumber, event)
    }
  }
  return [...selected.values()].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
}

/**
 * Choose the newest verified Compass issue that actually has voice notes.
 * A freshly published newsletter can legitimately be empty; defaulting to it
 * made existing cross-identity notes look as if authentication hid them.
 */
export async function fetchLatestIssueWithSegments(
  relays: string[] = RELAYS,
): Promise<NostrEvent | null> {
  // Startup only needs a recent window. Loading the complete episode picker
  // here made SimplePool verify every historical issue before first content.
  const recent = await getPool().querySync(DISCOVERY_RELAYS, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [REAL_COMPASS_PUBKEY],
    until: latestReasonableEventTimestamp(),
    limit: INITIAL_ISSUE_SCAN_LIMIT,
  }, { maxWait: ISSUE_QUERY_MAX_WAIT_MS })
  const issues = selectCompassIssues(filterVerified(recent))
  const populated = await findLatestPopulatedIssue(issues, relays)
  if (populated) return populated

  // Preserve historical-note discovery if an unusually long run of new
  // newsletters has no audio. The expensive inventory scan is a fallback,
  // never part of the normal startup path.
  const recentIds = new Set(issues.map((event) => event.id))
  const olderIssues = (await fetchAllIssues()).filter((event) => !recentIds.has(event.id))
  return findLatestPopulatedIssue(olderIssues, relays)
}

async function findLatestPopulatedIssue(
  issues: NostrEvent[],
  relays: string[],
): Promise<NostrEvent | null> {
  if (!issues.length) return null
  const issueIds = issues
    .map((event) => extractIssueNumber(event))
    .filter((number) => number > 0)
    .map((number) => `${ISSUE_PREFIX}-${number}`)
  if (!issueIds.length) return null

  const pool = getPool()
  const segments = await pool.querySync(relays, {
    kinds: [KINDS.SEGMENT],
    '#t': issueIds,
    until: latestReasonableEventTimestamp(),
    limit: 500,
  }, { maxWait: ISSUE_QUERY_MAX_WAIT_MS })
  const populated = new Set(filterVerified(segments)
    .filter((event) => hasReasonableEventTimestamp(event))
    .map((event) => event.tags.find((tag) => tag[0] === 't')?.[1]))
  return issues.find((event) => populated.has(`${ISSUE_PREFIX}-${extractIssueNumber(event)}`)) ?? null
}

/**
 * Extract the issue number from a kind 30023 event.
 * Looks for the "d" tag first (e.g. "31"), then falls back to parsing the title.
 */
export function extractIssueNumber(event: NostrEvent): number {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  if (dTag) {
    // Random legacy long-form d-tags often end in digits. Only parse d-tags
    // whose entire value is an issue number or uses one of our known prefixes.
    const match = dTag.match(/^(?:newsletter-|nostr-compass-|logbook-)?(\d+)$/i)
    if (match) return parseInt(match[1], 10)
  }
  // Fallback: parse from title tag
  const titleTag = event.tags.find((t) => t[0] === 'title')?.[1] ?? ''
  const match = titleTag.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Parse a Compass kind 30023 event into structured sections.
 *
 * The newsletter uses:
 *   ## Section Title        ← H2 = top-level section
 *   ### Project Name        ← H3 = sub-item within section
 *   prose...
 *
 * H2 group IDs use sec-<h2-slug>-<issueNumber>; named H3 item IDs use
 * sec-<h2-slug>-<h3-slug>-<issueNumber>. See SPEC.md §4.
 */
export function parseIssue(event: NostrEvent): CompassIssue {
  const issueNumber = extractIssueNumber(event)
  const titleTag = event.tags.find((t) => t[0] === 'title')?.[1] ?? `Issue ${issueNumber}`
  const sections = parseMarkdownSections(event.content, issueNumber)

  return {
    event,
    issueNumber,
    title: titleTag,
    sections,
  }
}

function parseMarkdownSections(markdown: string, issueNumber: number): IssueSection[] {
  const lines = markdown.split('\n')
  const sections: IssueSection[] = []
  let currentSection: IssueSection | null = null
  let currentItem: IssueSectionItem | null = null
  let currentBody: string[] = []

  const flushItem = () => {
    if (currentItem && currentSection) {
      currentItem.body = currentBody.join('\n').trim()
      currentSection.items.push(currentItem)
      currentItem = null
      currentBody = []
    }
  }

  const flushSection = () => {
    flushItem()
    if (currentSection) {
      sections.push(currentSection)
      currentSection = null
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushSection()
      const title = line.slice(3).trim()
      const id = `sec-${slugify(title)}-${issueNumber}`
      currentSection = { id, title, items: [] }
    } else if (line.startsWith('### ')) {
      flushItem()
      if (currentSection) {
        const title = line.slice(4).trim()
        // Item id: stable per project within the issue — used as the
        // recording-section id for per-item voice notes.
        const parentSlug = currentSection.id.replace(/^sec-/, '').replace(/-\d+$/, '')
        currentItem = {
          title,
          body: '',
          id: `sec-${parentSlug}-${slugify(title)}-${issueNumber}`,
        }
        currentBody = []
      }
    } else {
      if (currentItem) {
        currentBody.push(line)
      } else if (currentSection) {
        // Lead prose directly under the H2, before any H3 — keep it as
        // title-less items, preserving blank lines (paragraph breaks).
        const last = currentSection.items[currentSection.items.length - 1]
        if (last && !last.title) {
          last.body = `${last.body}\n${line}`
        } else {
          currentSection.items.push({ title: '', body: line })
        }
      }
    }
  }

  flushSection()
  return sections
}

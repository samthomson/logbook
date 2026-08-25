/** Public offline snapshot only: verified issue data and parsed relay segments.
 * Never store signer/session/draft data in this database. */
import { BLOSSOM_SERVERS, ISSUE_PREFIX, KINDS } from '../config'
import { REAL_COMPASS_PUBKEY } from './config-env'
import type { CompassIssue, NostrEvent } from '../types/nostr'
import { getTag } from '../types/nostr'
import { extractIssueNumber, parseIssue } from './compass'
import { filterVerified } from './relay'
import { selectTrustedSegmentEvents } from './segment'
import { hasReasonableEventTimestamp } from './event-time'

const DB_NAME = 'logbook-public-timeline'
const STORE = 'issues'
const VERSION = 1

interface CachedIssue {
  key: string
  issue: unknown
  segments: unknown
  cachedAt: number
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<NostrEvent>
  return typeof event.id === 'string'
    && typeof event.pubkey === 'string'
    && typeof event.created_at === 'number'
    && typeof event.kind === 'number'
    && Array.isArray(event.tags)
    && event.tags.every((tag) => Array.isArray(tag) && tag.every((entry) => typeof entry === 'string'))
    && typeof event.content === 'string'
    && typeof event.sig === 'string'
}

/** Rebuild, rather than trust, all derived cache fields at the local-storage boundary. */
function validateCachedIssue(row: CachedIssue): { issue: CompassIssue; segments: [string, NostrEvent[]][] } | null {
  if (!Number.isFinite(row.cachedAt) || row.cachedAt > Date.now()) return null
  if (!row.issue || typeof row.issue !== 'object') return null
  const event = (row.issue as { event?: unknown }).event
  if (!isNostrEvent(event) || event.kind !== KINDS.COMPASS_ISSUE || event.pubkey !== REAL_COMPASS_PUBKEY) return null
  if (!hasReasonableEventTimestamp(event)) return null
  if (filterVerified([event]).length !== 1) return null

  let issue: CompassIssue
  try { issue = parseIssue(event) } catch { return null }
  if (!Number.isSafeInteger(issue.issueNumber) || row.key !== `issue-${issue.issueNumber}` || extractIssueNumber(event) !== issue.issueNumber) return null

  const cachedGroups = Array.isArray(row.segments) ? row.segments : []
  const candidates = cachedGroups.flatMap((group) => {
    if (!Array.isArray(group) || !Array.isArray(group[1])) return []
    return group[1].filter(isNostrEvent)
  })
  const trusted = selectTrustedSegmentEvents(candidates, `${ISSUE_PREFIX}-${issue.issueNumber}`, BLOSSOM_SERVERS)
  const grouped = new Map<string, NostrEvent[]>()
  for (const segment of trusted) {
    const sectionId = getTag(segment, 'section')
    if (!sectionId) continue
    const events = grouped.get(sectionId) ?? []
    if (!events.some((event) => event.id === segment.id)) events.push(segment)
    grouped.set(sectionId, events)
  }
  return {
    issue,
    segments: [...grouped.entries()].map(([sectionId, events]) => [
      sectionId,
      events.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)),
    ]),
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : request.result.createObjectStore(STORE, { keyPath: 'key' })
      if (!store.indexNames.contains('cachedAt')) store.createIndex('cachedAt', 'cachedAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open public timeline cache'))
  })
}

export async function saveCachedIssue<TIssue extends { issueNumber: number }>(issue: TIssue, segments: unknown): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put({
        key: `issue-${issue.issueNumber}`,
        issue,
        segments,
        cachedAt: Date.now(),
      } satisfies CachedIssue)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Unable to save public timeline cache'))
    })
  } finally { db.close() }
}

export async function loadCachedIssue(
  issueNumber?: number,
): Promise<{ issue: CompassIssue; segments: [string, NostrEvent[]][] } | null> {
  const db = await openDb()
  try {
    if (issueNumber !== undefined) {
      const row = await new Promise<CachedIssue | undefined>((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(`issue-${issueNumber}`)
        request.onsuccess = () => resolve(request.result as CachedIssue | undefined)
        request.onerror = () => reject(request.error ?? new Error('Unable to read public timeline cache'))
      })
      return row ? validateCachedIssue(row) : null
    }
    const rows = await new Promise<CachedIssue[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as CachedIssue[])
      request.onerror = () => reject(request.error ?? new Error('Unable to read public timeline cache'))
    })
    const ordered = rows.sort((a, b) => b.cachedAt - a.cachedAt || b.key.localeCompare(a.key))
    for (const row of ordered) {
      const validated = validateCachedIssue(row)
      if (validated) return validated
    }
    return null
  } finally { db.close() }
}

export async function clearIssueCache(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Unable to clear public timeline cache'))
    })
  } finally { db.close() }
}

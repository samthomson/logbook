/** Public offline snapshot only: verified issue data and parsed relay segments.
 * Never store signer/session/draft data in this database. */
const DB_NAME = 'logbook-public-timeline'
const STORE = 'issues'
const VERSION = 1

interface CachedIssue {
  key: string
  issue: unknown
  segments: unknown
  cachedAt: number
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

export async function loadCachedIssue<TIssue = unknown, TSegments = unknown>(): Promise<{ issue: TIssue; segments: TSegments } | null> {
  const db = await openDb()
  try {
    const rows = await new Promise<CachedIssue[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as CachedIssue[])
      request.onerror = () => reject(request.error ?? new Error('Unable to read public timeline cache'))
    })
    const newest = rows.sort((a, b) => b.cachedAt - a.cachedAt || b.key.localeCompare(a.key))[0]
    return newest ? { issue: newest.issue as TIssue, segments: newest.segments as TSegments } : null
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

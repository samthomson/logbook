export const AUTH_SESSION_KEY = 'logbook_auth'
export const SELECTED_ISSUE_KEY = 'logbook_selected_issue'

export type RestorableAuthMethod = 'extension' | 'amber' | 'bunker'

export interface RestorableAuthSession {
  method: RestorableAuthMethod
  session?: string
  /** Public account identity; distinct from a NIP-46 routing identity. */
  pubkey?: string
}

interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
}

interface WritableStorageLike extends StorageLike {
  setItem(key: string, value: string): void
}

/**
 * Read only credentials that are safe to restore. Older records held raw nsec,
 * bunker URI, or ncryptsec passphrase fields; erase those records on sight.
 */
export function readRestorableAuthSession(storage: StorageLike): RestorableAuthSession | null {
  const saved = storage.getItem(AUTH_SESSION_KEY)
  if (!saved) return null

  try {
    const value: unknown = JSON.parse(saved)
    if (!value || typeof value !== 'object') {
      storage.removeItem(AUTH_SESSION_KEY)
      return null
    }

    const { method, input, passphrase, session, pubkey } = value as Record<string, unknown>
    if (typeof input === 'string' || typeof passphrase === 'string') {
      storage.removeItem(AUTH_SESSION_KEY)
      return null
    }

    if (method === 'extension') return { method }
    if ((method === 'amber' || method === 'bunker') && typeof session === 'string' && session.length > 0) {
      return {
        method,
        session,
        ...(typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey) ? { pubkey: pubkey.toLowerCase() } : {}),
      }
    }
  } catch {
    storage.removeItem(AUTH_SESSION_KEY)
  }

  return null
}

export function saveRestorableAuthSession(
  storage: WritableStorageLike,
  session: RestorableAuthSession | null,
): void {
  if (!session || (session.method !== 'extension' && !(typeof session.session === 'string' && session.session.length > 0))) {
    storage.removeItem(AUTH_SESSION_KEY)
    return
  }
  storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session))
}

export function readSelectedIssueNumber(storage: StorageLike): number | null {
  const raw = storage.getItem(SELECTED_ISSUE_KEY)
  if (!raw) return null
  const issueNumber = Number(raw)
  if (Number.isSafeInteger(issueNumber) && issueNumber > 0) return issueNumber
  storage.removeItem(SELECTED_ISSUE_KEY)
  return null
}

export function saveSelectedIssueNumber(storage: WritableStorageLike, issueNumber: number): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    storage.removeItem(SELECTED_ISSUE_KEY)
    return
  }
  storage.setItem(SELECTED_ISSUE_KEY, String(issueNumber))
}

export function restorePersistedAuthSession(
  durableStorage: WritableStorageLike,
  legacyTabStorage: StorageLike,
): RestorableAuthSession | null {
  const durable = readRestorableAuthSession(durableStorage)
  if (durable?.method === 'extension') return durable

  // NIP-46 nbunksec values are bearer capabilities. Never retain one in
  // localStorage, where it would survive the tab and remain available to any
  // future same-origin script. Erase older durable records on sight.
  if (durable) durableStorage.removeItem(AUTH_SESSION_KEY)

  return readRestorableAuthSession(legacyTabStorage)
}

export const AUTH_SESSION_KEY = 'logbook_auth'

export type RestorableAuthMethod = 'extension' | 'amber' | 'bunker'

export interface RestorableAuthSession {
  method: RestorableAuthMethod
  session?: string
}

interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
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

    const { method, input, passphrase, session } = value as Record<string, unknown>
    if (typeof input === 'string' || typeof passphrase === 'string') {
      storage.removeItem(AUTH_SESSION_KEY)
      return null
    }

    if (method === 'extension') return { method }
    if ((method === 'amber' || method === 'bunker') && typeof session === 'string' && session.length > 0) {
      return { method, session }
    }
  } catch {
    storage.removeItem(AUTH_SESSION_KEY)
  }

  return null
}

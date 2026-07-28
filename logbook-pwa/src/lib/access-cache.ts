export const ACCESS_CACHE_KEY = 'logbook_access_snapshot'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface AccessSnapshot {
  issueNumber: number
  pubkey: string
  allowed: Set<string>
  admins: Set<string>
  cachedAt: number
}

const isPubkey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)

export function saveAccessSnapshot(
  storage: StorageLike,
  snapshot: Omit<AccessSnapshot, 'cachedAt'> & { cachedAt?: number },
): void {
  if (!Number.isSafeInteger(snapshot.issueNumber) || snapshot.issueNumber <= 0 || !isPubkey(snapshot.pubkey)) return
  storage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
    issueNumber: snapshot.issueNumber,
    pubkey: snapshot.pubkey.toLowerCase(),
    allowed: [...snapshot.allowed].filter(isPubkey).map((value) => value.toLowerCase()),
    admins: [...snapshot.admins].filter(isPubkey).map((value) => value.toLowerCase()),
    cachedAt: snapshot.cachedAt ?? Date.now(),
  }))
}

export function loadAccessSnapshot(
  storage: StorageLike,
  issueNumber: number,
  pubkey: string,
  now = Date.now(),
): AccessSnapshot | null {
  const raw = storage.getItem(ACCESS_CACHE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      value.issueNumber !== issueNumber
      || !isPubkey(value.pubkey)
      || value.pubkey.toLowerCase() !== pubkey.toLowerCase()
      || typeof value.cachedAt !== 'number'
      || !Number.isFinite(value.cachedAt)
      || value.cachedAt > now
      || now - value.cachedAt > MAX_AGE_MS
      || !Array.isArray(value.allowed)
      || !Array.isArray(value.admins)
      || !value.allowed.every(isPubkey)
      || !value.admins.every(isPubkey)
    ) {
      storage.removeItem(ACCESS_CACHE_KEY)
      return null
    }
    return {
      issueNumber,
      pubkey: value.pubkey.toLowerCase(),
      allowed: new Set(value.allowed.map((entry) => entry.toLowerCase())),
      admins: new Set(value.admins.map((entry) => entry.toLowerCase())),
      cachedAt: value.cachedAt,
    }
  } catch {
    storage.removeItem(ACCESS_CACHE_KEY)
    return null
  }
}

export function clearAccessSnapshot(storage: StorageLike): void {
  storage.removeItem(ACCESS_CACHE_KEY)
}

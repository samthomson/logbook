import { describe, expect, it } from 'vitest'
import { AUTH_SESSION_KEY, readRestorableAuthSession, restorePersistedAuthSession, readSelectedIssueNumber, saveRestorableAuthSession, saveSelectedIssueNumber } from './session'

function storageWith(value: string | null) {
  let current = value
  let removals = 0
  return {
    getItem: () => current,
    setItem: (_key: string, value: string) => { current = value },
    removeItem: () => { current = null; removals += 1 },
    get removals() { return removals },
  }
}

describe('readRestorableAuthSession', () => {
  it('erases legacy raw-secret and passphrase records', () => {
    const legacyNsec = storageWith(JSON.stringify({ method: 'nsec', input: 'nsec1secret' }))
    expect(readRestorableAuthSession(legacyNsec)).toBeNull()
    expect(legacyNsec.removals).toBe(1)

    const legacyNcryptsec = storageWith(JSON.stringify({ method: 'bunker', input: 'ncryptsec...', passphrase: 'secret' }))
    expect(readRestorableAuthSession(legacyNcryptsec)).toBeNull()
    expect(legacyNcryptsec.removals).toBe(1)
  })

  it('restores only extension or revocable NIP-46 session state', () => {
    expect(readRestorableAuthSession(storageWith(JSON.stringify({ method: 'extension' })))).toEqual({ method: 'extension' })
    expect(readRestorableAuthSession(storageWith(JSON.stringify({ method: 'amber', session: 'nbunksec1safe-session' })))).toEqual({ method: 'amber', session: 'nbunksec1safe-session' })
    expect(readRestorableAuthSession(storageWith(JSON.stringify({ method: 'bunker', session: '' })))).toBeNull()
  })

  it('keeps NIP-46 capabilities tab-scoped and restores a durable extension marker', () => {
    const durable = storageWith(null)
    const tab = storageWith(JSON.stringify({ method: 'amber', session: 'nbunksec1safe-session' }))
    expect(restorePersistedAuthSession(durable, tab)).toEqual({ method: 'amber', session: 'nbunksec1safe-session' })
    expect(durable.getItem()).toBeNull()
    expect(readRestorableAuthSession(tab)).toEqual({ method: 'amber', session: 'nbunksec1safe-session' })

    const extension = storageWith(JSON.stringify({ method: 'extension' }))
    expect(restorePersistedAuthSession(extension, storageWith(null))).toEqual({ method: 'extension' })

    const unsafeDurable = storageWith(null)
    const unsafeLegacy = storageWith(JSON.stringify({ method: 'nsec', input: 'nsec1secret' }))
    expect(restorePersistedAuthSession(unsafeDurable, unsafeLegacy)).toBeNull()
    expect(unsafeLegacy.getItem()).toBeNull()
  })

  it('writes a completed Amber session only to the provided tab storage', () => {
    const storage = storageWith(null)
    saveRestorableAuthSession(storage, { method: 'amber', session: 'nbunksec1safe-session' })
    expect(readRestorableAuthSession(storage)).toEqual({ method: 'amber', session: 'nbunksec1safe-session' })

    saveRestorableAuthSession(storage, null)
    expect(storage.getItem()).toBeNull()
  })

  it('writes the public account identity with a tab-scoped Amber session', () => {
    const storage = storageWith(null)
    const saved = { method: 'amber' as const, session: 'nbunksec1safe-session', pubkey: '77'.repeat(32) }

    saveRestorableAuthSession(storage, saved)

    expect(readRestorableAuthSession(storage)).toEqual(saved)
  })

  it('persists only a valid selected issue number independently of identity', () => {
    const storage = storageWith(null)
    saveSelectedIssueNumber(storage, 31)
    expect(readSelectedIssueNumber(storage)).toBe(31)
    saveSelectedIssueNumber(storage, 0)
    expect(readSelectedIssueNumber(storage)).toBeNull()
  })

  it('clears corrupt values', () => {
    const storage = storageWith('{not json')
    expect(readRestorableAuthSession(storage)).toBeNull()
    expect(storage.removals).toBe(1)
    expect(AUTH_SESSION_KEY).toBe('logbook_auth')
  })
})

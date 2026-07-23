import { describe, expect, it } from 'vitest'
import { AUTH_SESSION_KEY, readRestorableAuthSession } from './session'

function storageWith(value: string | null) {
  let current = value
  let removals = 0
  return {
    getItem: () => current,
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

  it('clears corrupt values', () => {
    const storage = storageWith('{not json')
    expect(readRestorableAuthSession(storage)).toBeNull()
    expect(storage.removals).toBe(1)
    expect(AUTH_SESSION_KEY).toBe('logbook_auth')
  })
})

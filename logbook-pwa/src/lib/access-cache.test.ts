import { describe, expect, it } from 'vitest'
import { ACCESS_CACHE_KEY, loadAccessSnapshot, saveAccessSnapshot } from './access-cache'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    values,
  }
}

const pubkey = 'a'.repeat(64)
const other = 'b'.repeat(64)

describe('access snapshot', () => {
  it('restores only the same principal and issue within the tab-session cache window', () => {
    const store = storage()
    saveAccessSnapshot(store, {
      issueNumber: 32,
      pubkey,
      allowed: new Set([pubkey]),
      admins: new Set([other]),
      cachedAt: 1_000,
    })

    const restored = loadAccessSnapshot(store, 32, pubkey, 2_000)
    expect(restored?.allowed).toEqual(new Set([pubkey]))
    expect(restored?.admins).toEqual(new Set([other]))
    expect(loadAccessSnapshot(store, 31, pubkey, 2_000)).toBeNull()
  })

  it('fails closed and deletes stale or malformed records', () => {
    const store = storage()
    saveAccessSnapshot(store, {
      issueNumber: 32,
      pubkey,
      allowed: new Set([pubkey]),
      admins: new Set(),
      cachedAt: 1,
    })
    expect(loadAccessSnapshot(store, 32, pubkey, 24 * 60 * 60 * 1000 + 2)).toBeNull()

    saveAccessSnapshot(store, {
      issueNumber: 32,
      pubkey,
      allowed: new Set([pubkey]),
      admins: new Set(),
      cachedAt: 3_000,
    })
    expect(loadAccessSnapshot(store, 32, pubkey, 2_000)).toBeNull()

    store.setItem(ACCESS_CACHE_KEY, JSON.stringify({ issueNumber: 32, pubkey, allowed: ['not-a-key'], admins: [], cachedAt: Date.now() }))
    expect(loadAccessSnapshot(store, 32, pubkey)).toBeNull()
    expect(store.getItem(ACCESS_CACHE_KEY)).toBeNull()
  })
})

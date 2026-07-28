import { beforeAll, describe, expect, it, vi } from 'vitest'
import { COMPASS_PUBKEY } from '../config'

const state = vi.hoisted(() => ({ revision: 1 }))

vi.mock('./relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relay')>()
  return { ...actual, filterVerified: (events: unknown[]) => events }
})

vi.mock('./pool', () => ({
  getPool: () => ({
    querySync: async (_relays: string[], filter: Record<string, string[][]>) => {
      const dTag = filter['#d']?.[0] ?? 'unknown'
      const event = (id: string, contributors: string[]) => ({
        id: id.repeat(64),
        pubkey: COMPASS_PUBKEY,
        created_at: Math.floor(Date.now() / 1000),
        kind: 34201,
        tags: [['d', dTag]],
        content: JSON.stringify({
          contributors: contributors.map((pubkey) => ({ pubkey })),
          admins: [],
        }),
        sig: 'b'.repeat(128),
      })
      if (state.revision === 3) {
        return [event('1', ['b'.repeat(64)]), event('2', ['c'.repeat(64)])]
      }
      return [event(String(state.revision), state.revision === 1 ? ['a'.repeat(64)] : [])]
    },
  }),
}))

beforeAll(() => {
  vi.stubGlobal('fetch', async () => ({ ok: false }))
})

describe('access-list revalidation', () => {
  it('bypasses the module cache when a foreground refresh is forced', async () => {
    const { fetchAccessLists } = await import('./whitelist')
    const initial = await fetchAccessLists(32)
    expect(initial.contributors.has('a'.repeat(64))).toBe(true)

    state.revision = 2
    const refreshed = await fetchAccessLists(32, undefined, { forceRefresh: true })
    expect(refreshed.contributors.has('a'.repeat(64))).toBe(false)

    state.revision = 3
    const tied = await fetchAccessLists(32, undefined, { forceRefresh: true })
    expect(tied.contributors.has('b'.repeat(64))).toBe(false)
    expect(tied.contributors.has('c'.repeat(64))).toBe(true)
  })
})

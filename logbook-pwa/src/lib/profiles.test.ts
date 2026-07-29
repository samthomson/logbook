import { describe, expect, it, vi } from 'vitest'

const querySync = vi.hoisted(() => vi.fn())

vi.mock('./pool', () => ({
  getPool: () => ({ querySync }),
}))

import { fetchProfiles } from './profiles'

describe('fetchProfiles', () => {
  it('coalesces overlapping in-flight batch requests', async () => {
    const alice = '1'.repeat(64)
    const bob = '2'.repeat(64)
    let resolveQuery!: (events: never[]) => void
    querySync.mockReturnValue(new Promise<never[]>((resolve) => { resolveQuery = resolve }))

    const first = fetchProfiles([alice, bob])
    const second = fetchProfiles([bob])

    expect(querySync).toHaveBeenCalledTimes(1)
    resolveQuery([])
    await expect(Promise.all([first, second])).resolves.toEqual([new Map(), new Map()])
  })
})

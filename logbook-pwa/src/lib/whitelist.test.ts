import { beforeAll, describe, expect, it, vi } from 'vitest'
import { COMPASS_PUBKEY } from '../config'
import { nip19 } from 'nostr-tools'

const state = vi.hoisted(() => ({ revision: 1, newsletterPageCalls: 0 }))

vi.mock('./relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relay')>()
  return { ...actual, filterVerified: (events: unknown[]) => events }
})

vi.mock('./pool', () => ({
  getPool: () => ({
    querySync: async (_relays: string[], filter: Record<string, unknown>) => {
      if ((filter.kinds as number[])?.[0] === 30023) {
        if (state.revision === 5) return [{
          id: '9'.repeat(64), pubkey: COMPASS_PUBKEY, created_at: Math.floor(Date.now() / 1000), kind: 30023,
          tags: [['d', 'newsletter-1']], content: `Prior guest nostr:${nip19.npubEncode('d'.repeat(64))}`, sig: 'b'.repeat(128),
        }]
        if (state.revision === 6) {
          state.newsletterPageCalls += 1
          const until = Number(filter.until)
          const recent = Math.floor(Date.now() / 1000) - 100
          const old = recent - 100
          if (until > recent) return [{
            id: '8'.repeat(64), pubkey: COMPASS_PUBKEY, created_at: recent, kind: 30023,
            tags: [['d', 'newsletter-2']], content: `Recent guest nostr:${nip19.npubEncode('e'.repeat(64))}`, sig: 'b'.repeat(128),
          }]
          if (until > old) return [{
            id: '7'.repeat(64), pubkey: COMPASS_PUBKEY, created_at: old, kind: 30023,
            tags: [['d', 'newsletter-3']], content: `Old guest nostr:${nip19.npubEncode('f'.repeat(64))}`, sig: 'b'.repeat(128),
          }]
        }
        return []
      }
      const dTag = (filter['#d'] as string[] | undefined)?.[0] ?? 'unknown'
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
      if (state.revision === 4) return []
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

  it('fails closed to Compass when no signed producer list is available', async () => {
    const { fetchAccessLists, fetchProducerPubkeys } = await import('./whitelist')
    state.revision = 4

    const producers = await fetchProducerPubkeys(undefined, true)
    expect(producers).toEqual(new Set([COMPASS_PUBKEY]))

    const access = await fetchAccessLists(32, undefined, { forceRefresh: true })
    expect(access.admins).toEqual(new Set([COMPASS_PUBKEY]))
    expect(access.adminsFromBootstrap).toBe(false)
  })

  it('derives validation from mentions across verified Compass newsletters', async () => {
    const { fetchAccessLists } = await import('./whitelist')
    state.revision = 5
    const access = await fetchAccessLists(32, undefined, { forceRefresh: true })
    expect(access.contributors.has('d'.repeat(64))).toBe(true)
    expect(access.sources.get('d'.repeat(64))).toContain('newsletter')
  })

  it('paginates through the complete verified Compass newsletter history', async () => {
    const { fetchVerifiedNewsletterMentions } = await import('./whitelist')
    state.revision = 6
    state.newsletterPageCalls = 0
    const contributors = await fetchVerifiedNewsletterMentions()
    expect(contributors).toEqual(new Set(['e'.repeat(64), 'f'.repeat(64)]))
    expect(state.newsletterPageCalls).toBe(3)
  })
})

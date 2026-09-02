import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { COMPASS_PUBKEY, KINDS } from '../config'
import { episodeAddress, parseRoute, routeHash, routeIssueNumber } from './route'

describe('hash routes', () => {
  it('treats an empty or unknown hash as home', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' })
    expect(parseRoute('#/')).toEqual({ kind: 'home' })
    expect(parseRoute('#/nope/deeper')).toEqual({ kind: 'home' })
    expect(parseRoute('#/episode/7')).toEqual({ kind: 'home' })
    expect(parseRoute('#/episode/naddr1notreal')).toEqual({ kind: 'home' })
    expect(parseRoute(`#/episode/${episodeAddress(12)}/unknown`)).toEqual({ kind: 'home' })
  })

  it('parses an episode route from a newsletter address', () => {
    const address = episodeAddress(7)
    expect(parseRoute(`#/episode/${address}`)).toEqual({ kind: 'episode', issueNumber: 7 })
    expect(parseRoute(`#/episode/${address}/`)).toEqual({ kind: 'episode', issueNumber: 7 })
    expect(parseRoute(`#/episode/${address}/produce`)).toEqual({ kind: 'home' })
    expect(parseRoute('#/login')).toEqual({ kind: 'login' })
  })

  it('refuses an address from another author or another kind', () => {
    const otherAuthor = nip19.naddrEncode({
      kind: KINDS.COMPASS_ISSUE,
      pubkey: 'f'.repeat(64),
      identifier: 'newsletter-7',
    })
    const otherKind = nip19.naddrEncode({
      kind: 30_024,
      pubkey: COMPASS_PUBKEY,
      identifier: 'newsletter-7',
    })
    const otherIdentifier = nip19.naddrEncode({
      kind: KINDS.COMPASS_ISSUE,
      pubkey: COMPASS_PUBKEY,
      identifier: 'logbook-7',
    })

    expect(parseRoute(`#/episode/${otherAuthor}`)).toEqual({ kind: 'home' })
    expect(parseRoute(`#/episode/${otherKind}`)).toEqual({ kind: 'home' })
    expect(parseRoute(`#/episode/${otherIdentifier}`)).toEqual({ kind: 'home' })
  })

  it('round-trips every route through its hash', () => {
    for (const route of [
      { kind: 'home' } as const,
      { kind: 'login' } as const,
      { kind: 'episode', issueNumber: 3 } as const,
    ]) {
      expect(parseRoute(routeHash(route))).toEqual(route)
    }
  })

  it('exposes the episode number only for episode routes', () => {
    expect(routeIssueNumber({ kind: 'episode', issueNumber: 4 })).toBe(4)
    expect(routeIssueNumber({ kind: 'home' })).toBeNull()
    expect(routeIssueNumber({ kind: 'login' })).toBeNull()
  })
})

/**
 * Hash routing. The PWA is served as static files from nsite gateways and
 * nginx, neither of which rewrites unknown paths to index.html, so every route
 * lives after the '#'. Unrecognised hashes resolve to home rather than a blank
 * screen.
 *
 * An episode is addressed by its Nostr address (naddr), which names the kind,
 * the author, and the newsletter identifier. A link that points at another
 * author or another kind is not a Logbook episode and resolves to home, so the
 * URL cannot widen what the app will load.
 */

import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { COMPASS_PUBKEY, KINDS } from '../config'

export type Route =
  | { kind: 'home' }
  | { kind: 'login' }
  | { kind: 'episode'; issueNumber: number }

const NEWSLETTER_IDENTIFIER = /^newsletter-(\d{1,9})$/

/** The naddr for a Compass newsletter, which is what an episode is cut from. */
export function episodeAddress(issueNumber: number): string {
  return nip19.naddrEncode({
    kind: KINDS.COMPASS_ISSUE,
    pubkey: COMPASS_PUBKEY,
    identifier: `newsletter-${issueNumber}`,
  })
}

function issueNumberFromAddress(address: string): number | null {
  try {
    const decoded = nip19.decode(address)
    if (decoded.type !== 'naddr') return null
    const pointer = decoded.data
    if (pointer.kind !== KINDS.COMPASS_ISSUE) return null
    if (pointer.pubkey.toLowerCase() !== COMPASS_PUBKEY) return null
    const match = NEWSLETTER_IDENTIFIER.exec(pointer.identifier)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (path === '') return { kind: 'home' }
  const parts = path.split('/')
  if (parts[0] === 'login' && parts.length === 1) return { kind: 'login' }
  if (parts[0] === 'episode' && parts.length === 2) {
    const issueNumber = issueNumberFromAddress(parts[1] ?? '')
    if (issueNumber !== null) return { kind: 'episode', issueNumber }
  }
  return { kind: 'home' }
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'home': return '#/'
    case 'login': return '#/login'
    case 'episode': return `#/episode/${episodeAddress(route.issueNumber)}`
  }
}

export function routeIssueNumber(route: Route): number | null {
  return route.kind === 'episode' ? route.issueNumber : null
}

/** '' outside a browser, so the shell can also render without a DOM. */
function currentHash(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.hash
}

export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(currentHash()))

  useEffect(() => {
    const sync = () => setRoute(parseRoute(currentHash()))
    window.addEventListener('hashchange', sync)
    sync()
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash = routeHash(next)
    if (typeof globalThis.location === 'undefined' || globalThis.location.hash === hash) setRoute(next)
    else globalThis.location.hash = hash
  }, [])

  return [route, navigate]
}

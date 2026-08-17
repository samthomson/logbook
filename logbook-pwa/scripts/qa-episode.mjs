import { nip19 } from 'nostr-tools'

const COMPASS_ISSUE_KIND = 30_023

/** Hash route for a Compass newsletter episode. */
export function episodeHref(origin, issueNumber, pubkey = process.env.COMPASS_PUBKEY) {
  if (!pubkey) throw new Error('COMPASS_PUBKEY is required to build an episode URL')
  const naddr = nip19.naddrEncode({
    kind: COMPASS_ISSUE_KIND,
    pubkey,
    identifier: `newsletter-${issueNumber}`,
  })
  return `${String(origin).replace(/\/$/, '')}/#/episode/${naddr}`
}

/** Vite fixture: anonymous readers can open a finished episode. */
export const publishedManifestSource = `
  export async function fetchManifest() {
    return { content: { episodeStatus: 'published', publishedRss: null, issueRef: 'naddr1qa', sections: [] } }
  }
  export function subscribeManifest() { return () => {} }
  export function subscribeManifests() { return () => {} }
  export async function fetchAllManifests() { return [] }
  export async function updateManifest() { throw new Error('no writes') }
  export function buildInitialManifest() {
    return { episodeStatus: 'draft', publishedRss: null, issueRef: 'naddr1qa', sections: [] }
  }
`

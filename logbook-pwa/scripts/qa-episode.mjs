import { nip19 } from 'nostr-tools'

const COMPASS_ISSUE_KIND = 30_023

/** The production Compass author the route validator accepts
 * (src/lib/config-env.ts REAL_COMPASS_PUBKEY) — not the test COMPASS_PUBKEY. */
const REAL_COMPASS_PUBKEY = '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'

/** Hash route for a Compass newsletter episode. */
export function episodeHref(origin, issueNumber) {
  const naddr = nip19.naddrEncode({
    kind: COMPASS_ISSUE_KIND,
    pubkey: REAL_COMPASS_PUBKEY,
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

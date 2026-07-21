/**
 * VPS script configuration.
 * Secrets come from environment variables — never hardcoded.
 */

export const COMPASS_PUBKEY =
  // Test key — used for logbook-1 smoke testing. Switch to the production
  // Compass key '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'
  // when going live (it authors the weekly kind 30023 newsletters #26+).
  'baa11ea074871c850de58b626288da51a9e8bb5df7cdb63859dfa19898659b7e'

export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
]

export const BLOSSOM_SERVERS = [
  'https://blossom.band',       // primary: byte-range + CORS confirmed
  'https://blossom.ditto.pub',  // mirror 1: Cloudflare-backed, Content-Range exposed
  'https://blossom.oxtr.dev',   // mirror 2: BUD-01+BUD-04 confirmed
]

export const KINDS = {
  COMPASS_ISSUE: 30023,
  SEGMENT: 4200,
  MANIFEST: 34200,
  BLOSSOM_AUTH: 24242,
  TRANSCRIPT: 1111,
  REACTION: 7,
} as const

export const ISSUE_PREFIX = 'logbook'

export async function loadPrivateKey(): Promise<Uint8Array> {
  const nsec = process.env.COMPASS_NSEC
  if (!nsec) throw new Error('COMPASS_NSEC environment variable is not set')
  const { nip19 } = await import('nostr-tools')
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('COMPASS_NSEC must be an nsec bech32 string')
  return decoded.data as Uint8Array
}

// Paths for VPS static files
export const STATIC_DIR = process.env.LOGBOOK_STATIC_DIR ?? '/var/www/logbook'
export const RSS_PATH = `${STATIC_DIR}/feed.xml`
export const AUDIO_DIR = `${STATIC_DIR}/audio`

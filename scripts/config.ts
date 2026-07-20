/**
 * VPS script configuration.
 * Secrets come from environment variables — never hardcoded.
 */

export const COMPASS_PUBKEY =
  '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751aca95'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
]

export const BLOSSOM_SERVERS = [
  'https://blossom.band',
  'https://blossom.primal.net',
  'https://files.v0l.io',
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

// Compass Nostr pubkey (hex) — the authoritative source for issue manifests.
// All kind 34200 queries MUST pin authors:[COMPASS_PUBKEY] and re-verify on receipt.
export const COMPASS_PUBKEY =
  '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'

// Admin pubkeys (hex) — can access drag-to-reorder and lock episode.
// COMPASS_PUBKEY is always implicitly an admin.
export const ADMIN_PUBKEYS: string[] = [COMPASS_PUBKEY]

// Default Nostr relays
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
]

// Blossom servers — public servers only, no self-hosted origin.
// Upload goes to all listed servers; each gets its own kind 24242 auth event.
// BUD-04: client uploads to first, then mirrors to the rest.
export const BLOSSOM_SERVERS = [
  'https://blossom.band',       // primary: byte-range + CORS confirmed
  'https://blossom.ditto.pub',  // mirror 1: Cloudflare-backed, Content-Range exposed
  'https://blossom.oxtr.dev',   // mirror 2: BUD-01+BUD-04 confirmed
]

// Primary Blossom server for the initial upload (BUD-01 PUT)
export const BLOSSOM_PRIMARY = BLOSSOM_SERVERS[0]

// Nostr event kinds used by Logbook
export const KINDS = {
  COMPASS_ISSUE: 30023,    // Compass newsletter (kind 30023 long-form)
  SEGMENT: 4200,           // Voice segment (regular/immutable)
  MANIFEST: 34200,         // Issue manifest (addressable)
  BLOSSOM_AUTH: 24242,     // Blossom upload auth
  TRANSCRIPT: 1111,        // Companion transcript (scoped to segment)
  REACTION: 7,             // "Made the cut" marker
} as const

// Issue ID prefix
export const ISSUE_PREFIX = 'logbook'

// Supported recording MIME type — iOS 18.4+ and Chrome/Android
export const RECORDING_MIME = 'audio/webm;codecs=opus'
export const RECORDING_MIME_FALLBACK = 'audio/webm'

// iOS minimum version for recording support
export const IOS_RECORDING_MIN_VERSION = 18.4

// Maximum waveform samples stored per segment
export const WAVEFORM_SAMPLES = 100

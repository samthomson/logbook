// Compass Nostr pubkey (hex) — the authoritative source for issue manifests.
// All kind 34200 queries MUST pin authors:[COMPASS_PUBKEY] and re-verify on receipt.
export const COMPASS_PUBKEY =
  '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751aca95'

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

// Blossom servers — VPS origin first, public mirrors after.
// VPS origin must serve HTTPS with CORS and byte-range (Range) support.
export const BLOSSOM_SERVERS = [
  'https://blossom.nostrcompass.com', // VPS origin — primary
  'https://blossom.band',             // public mirror
]

// Primary Blossom server for uploads (must be first in BLOSSOM_SERVERS)
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

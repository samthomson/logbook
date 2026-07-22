// Compass Nostr pubkey (hex) — the authoritative source for issue manifests.
// All kind 34200 queries MUST pin authors:[COMPASS_PUBKEY] and re-verify on receipt.
// Real Compass key — authors the weekly kind 30023 newsletters (d-tag newsletter-N).
export const COMPASS_PUBKEY =
  '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'

// Test key (logbook-1 smoke tests only):
// 'baa11ea074871c850de58b626288da51a9e8bb5df7cdb63859dfa19898659b7e'

// Admin pubkeys (hex) — BOOTSTRAP FALLBACK only.
// The authoritative admin list is the kind 34201 event d-tagged D_ADMINS,
// authored by COMPASS_PUBKEY. These keys are used only when no verified
// admins event is fetchable, and are NEVER locked out by whitelist fetch
// failures (they must always be able to reach the UI that fixes the list).
// COMPASS_PUBKEY is always implicitly an admin.
export const ADMIN_PUBKEYS: string[] = [
  COMPASS_PUBKEY,
  '24b859838aca43694d0285f9c0130e2ca24fdb72e5f48a90dfb747279fc6f7fe', // test user
  '3c457108865e05d95ce3848aa0bc51cd64f984c5c61689a3d49809ab71fa1d64', // e2e-tester (dev verification)
]

// Default Nostr relays
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
]

// Blossom servers — public servers only, no self-hosted origin.
// Upload goes to all listed servers; each gets its own kind 24242 auth event.
// BUD-04: client uploads to first, then mirrors to the rest.
export const BLOSSOM_SERVERS = [
  'https://blossom.ditto.pub',  // primary: reliable BUD-01 (blossom.band sniff-rejects some recordings)
  'https://blossom.band',       // mirror 1: byte-range + CORS confirmed
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
  WHITELIST: 34201,        // Whitelist event (addressable) — contributors/standing/admins
} as const

// Issue ID prefix
export const ISSUE_PREFIX = 'logbook'

// Whitelist d-tags (kind 34201, authored by COMPASS_PUBKEY).
// Per-issue reuses the manifest issue-id scheme so correlation can't drift.
export const D_STANDING = `${ISSUE_PREFIX}-wl-standing`
export const D_ADMINS = `${ISSUE_PREFIX}-wl-admins`
export const D_ISSUE_WL = (issueNumber: number): string =>
  `${ISSUE_PREFIX}-wl-${issueNumber}`

// Supported recording MIME type — iOS 18.4+ and Chrome/Android
export const RECORDING_MIME = 'audio/webm;codecs=opus'
export const RECORDING_MIME_FALLBACK = 'audio/webm'

// iOS minimum version for recording support
export const IOS_RECORDING_MIN_VERSION = 18.4

// Maximum waveform samples stored per segment
export const WAVEFORM_SAMPLES = 100

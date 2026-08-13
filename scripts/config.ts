/**
 * VPS script configuration. Required env vars — same names as root `.env` / PWA.
 */

import { requirePubkey, requireUrlList } from './config-env.ts'

export const COMPASS_PUBKEY = requirePubkey(
  process.env.COMPASS_PUBKEY,
  'COMPASS_PUBKEY',
)

/** Single relay list for all worker Nostr I/O. */
export const RELAYS = requireUrlList(
  process.env.RELAYS,
  'RELAYS',
  'ws',
)

export const BLOSSOM_SERVERS = requireUrlList(
  process.env.BLOSSOM_SERVERS,
  'BLOSSOM_SERVERS',
  'http',
)

export const KINDS = {
  COMPASS_ISSUE: 30023,
  SEGMENT: 4200,
  MANIFEST: 34200,
  WHITELIST: 34201,
  BLOSSOM_AUTH: 24242,
  TRANSCRIPT: 1111,
  REACTION: 7,
} as const

export const ISSUE_PREFIX = 'logbook'
export const D_STANDING = `${ISSUE_PREFIX}-wl-standing`
export const D_ADMINS = `${ISSUE_PREFIX}-wl-admins`

export const STATIC_DIR = process.env.LOGBOOK_STATIC_DIR ?? '/var/www/logbook'
export const RSS_PATH = `${STATIC_DIR}/feed.xml`
export const AUDIO_DIR = process.env.LOGBOOK_AUDIO_DIR ?? `${STATIC_DIR}/audio`

export const BASE_URL = (() => {
  const raw = process.env.LOGBOOK_BASE_URL?.trim()
  if (!raw) throw new Error('LOGBOOK_BASE_URL is required')
  return raw.replace(/\/$/, '')
})()

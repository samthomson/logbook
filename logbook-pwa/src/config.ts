// Deployment identity and endpoints are build-time inputs. Vite inlines
// import.meta.env — retargeting requires a rebuild. Same names as root `.env`
// and the worker (no VITE_/LOGBOOK_ rename).
import {
  parsePubkeyList,
  requirePubkey,
  requireUrlList,
} from './lib/config-env'

export const COMPASS_PUBKEY = requirePubkey(
  import.meta.env.COMPASS_PUBKEY,
  'COMPASS_PUBKEY',
)

export const ADMIN_PUBKEYS: string[] = [
  COMPASS_PUBKEY,
  ...parsePubkeyList(import.meta.env.ADMIN_PUBKEYS, 'ADMIN_PUBKEYS')
    .filter((pubkey) => pubkey !== COMPASS_PUBKEY),
]

/** Relays for Logbook events (segments, manifests, whitelists, publish). */
export const RELAYS = requireUrlList(
  import.meta.env.RELAYS,
  'RELAYS',
  'ws',
)

/** Read-only: kind 0 / NIP-05 / Compass kind 30023 newsletters. Never used for publishing. */
export const DISCOVERY_RELAYS = requireUrlList(
  import.meta.env.DISCOVERY_RELAYS,
  'DISCOVERY_RELAYS',
  'ws',
)

export const BLOSSOM_SERVERS = requireUrlList(
  import.meta.env.BLOSSOM_SERVERS,
  'BLOSSOM_SERVERS',
  'http',
)

export const BLOSSOM_PRIMARY = BLOSSOM_SERVERS[0]

export const KINDS = {
  COMPASS_ISSUE: 30023,
  SEGMENT: 4200,
  MANIFEST: 34200,
  BLOSSOM_AUTH: 24242,
  TRANSCRIPT: 1111,
  REACTION: 7,
  WHITELIST: 34201,
  PODSTR_EPISODE: 30054,
} as const

export const ISSUE_PREFIX = 'logbook'
export const D_ISSUE = (issueNumber: number): string => `${ISSUE_PREFIX}-${issueNumber}`
export const D_PODSTR = (issueNumber: number): string => `${ISSUE_PREFIX}-${D_ISSUE(issueNumber)}`

export const D_STANDING = `${ISSUE_PREFIX}-wl-standing`
export const D_ADMINS = `${ISSUE_PREFIX}-wl-admins`
export const D_ISSUE_WL = (issueNumber: number): string =>
  `${ISSUE_PREFIX}-wl-${issueNumber}`

export const RECORDING_MIME = 'audio/webm;codecs=opus'
export const RECORDING_MIME_FALLBACK = 'audio/webm'

export const IOS_RECORDING_MIN_VERSION = 18.4

export const WAVEFORM_SAMPLES = 100

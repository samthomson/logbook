import { getEventHash } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

const SHA256_HEX = /^[a-f0-9]{64}$/
const MAX_SEGMENT_SECONDS = 60 * 60 * 2

export interface VerifiedSegment {
  event: NostrEvent
  issueId: string
  sectionId: string
  audio: {
    url: string
    sha256: string
    mime: string
    duration: number
  }
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1]
}

function requireSha256(value: string): void {
  if (!SHA256_HEX.test(value)) throw new Error('Expected a lowercase 64-character SHA-256 hash')
}

/**
 * Restrict blob downloads to configured HTTPS Blossom origins. The source host
 * is never trusted: its canonical hash path is rebuilt under each configured
 * origin, preventing relay data from turning the VPS into an SSRF client.
 */
export function getTrustedBlobCandidates(
  rawUrl: string,
  sha256: string,
  servers: readonly string[],
): string[] {
  requireSha256(sha256)
  let source: URL
  try {
    source = new URL(rawUrl)
  } catch {
    throw new Error('Blob URL is invalid')
  }
  if (source.protocol !== 'https:') throw new Error('Blob URL must use HTTPS')
  // Blossom servers commonly retain a media extension (for example `.webm`)
  // after the content-addressed hash. Preserve only a narrow safe suffix when
  // rebuilding the URL; never retain an arbitrary relay-provided path.
  const pathMatch = source.pathname.match(new RegExp(`^/${sha256}(\\.[a-z0-9]{1,10})?$`))
  if (!pathMatch) {
    throw new Error('Blob URL path must be the declared SHA-256 hash with an optional safe extension')
  }
  const extension = pathMatch[1] ?? ''

  const candidates = new Set<string>()
  for (const server of servers) {
    const base = new URL(server)
    if (base.protocol !== 'https:') throw new Error(`Configured Blossom server must use HTTPS: ${server}`)
    candidates.add(new URL(`/${sha256}${extension}`, base).toString())
  }
  if (!candidates.size) throw new Error('No configured Blossom servers')
  return [...candidates]
}

export function verifyNostrEvent(event: NostrEvent): boolean {
  try {
    return (
      getEventHash(event) === event.id &&
      schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
    )
  } catch {
    return false
  }
}

/** Parse only a cryptographically valid, structurally valid segment event. */
export function parseVerifiedSegment(
  event: NostrEvent,
  servers: readonly string[],
): VerifiedSegment {
  if (event.kind !== 4200) throw new Error('Unexpected event kind')
  if (!verifyNostrEvent(event)) {
    throw new Error('Segment signature or ID is invalid')
  }

  let content: unknown
  try {
    content = JSON.parse(event.content)
  } catch {
    throw new Error('Segment content is not JSON')
  }
  if (!content || typeof content !== 'object' || !('audio' in content)) {
    throw new Error('Segment content is missing audio metadata')
  }

  const audio = (content as { audio: unknown }).audio
  if (!audio || typeof audio !== 'object') throw new Error('Segment audio metadata is invalid')
  const candidate = audio as Record<string, unknown>
  if (
    typeof candidate.url !== 'string' ||
    typeof candidate.sha256 !== 'string' ||
    typeof candidate.mime !== 'string' ||
    typeof candidate.duration !== 'number' ||
    !Number.isFinite(candidate.duration) ||
    candidate.duration <= 0 ||
    candidate.duration > MAX_SEGMENT_SECONDS ||
    !(candidate.mime.startsWith('audio/') || candidate.mime === 'video/webm')
  ) {
    throw new Error('Segment audio metadata is invalid')
  }

  const tagHash = tagValue(event, 'x')
  if (!tagHash) throw new Error('Segment is missing required x tag')
  if (tagHash !== candidate.sha256) throw new Error('Segment x tag does not match audio hash')
  const issueId = tagValue(event, 'issue')
  const sectionId = tagValue(event, 'section')
  if (!issueId || !sectionId) throw new Error('Segment is missing issue or section tag')

  getTrustedBlobCandidates(candidate.url, candidate.sha256, servers)
  return {
    event,
    issueId,
    sectionId,
    audio: {
      url: candidate.url,
      sha256: candidate.sha256,
      mime: candidate.mime,
      duration: candidate.duration,
    },
  }
}

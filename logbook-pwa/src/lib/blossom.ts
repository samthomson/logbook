/**
 * Blossom upload module (BUD-01 + BUD-04) — hardened.
 *
 * Reliability model (learned the hard way):
 *  - Every fetch has a timeout + bounded retry with backoff — a hung server
 *    never leaves the UI stuck in "Uploading…".
 *  - Auth events (kind 24242) are signed FRESH per attempt, so a retry minutes
 *    later never reuses an expired signature (→ silent 401).
 *  - The blob's sha256 is recomputed and verified against the server's reported
 *    sha256 — a server returning a descriptor for different bytes is rejected.
 *  - Empty / undersized blobs are refused up front (servers MIME-sniff and
 *    reject them anyway — fail fast with a clear error instead of a 400).
 *  - If the primary succeeds but publish later fails, the descriptor is kept so
 *    a retry REUSES it instead of re-uploading (no orphaned duplicates).
 *  - Mirror failures are collected and reported, not silently dropped.
 *
 * Per-server quirks (from references/blossom-quirks.md):
 *  - blossom.band MIME-sniffs and 400s some real recordings → always try the
 *    next server rather than dying on one picky server.
 *  - blossom.oxtr.dev 401s direct PUT /upload but accepts BUD-04 /mirror → it's
 *    a mirror target only, never the primary.
 *  - blossom.ditto.pub is the reliable primary.
 */

import { BLOSSOM_SERVERS, KINDS } from '../config'
import type { BlobDescriptor, NostrSigner, NostrEvent } from '../types/nostr'
import { sha256Blob, now } from './utils'
import { fetchRaw, HttpError } from './http'
import { SignerTimeoutError, withSignerTimeout } from './signer-timeout'
import { validateTrustedBlobUrl } from './blob-trust'

const AUTH_EXPIRY_SECONDS = 60 * 5 // 5 minutes
const MIN_BLOB_BYTES = 100 // servers content-sniff; sub-100B blobs always reject

/** Servers that must never be used as the direct-upload primary (mirror only). */
const MIRROR_ONLY = new Set(['https://blossom.oxtr.dev'])

export interface UploadResult {
  descriptor: BlobDescriptor
  /** Servers the blob was successfully mirrored to (excludes primary). */
  mirrored: string[]
  /** Servers that failed to mirror, with their error messages. */
  mirrorFailures: { server: string; error: string }[]
}

/**
 * Upload a blob to Blossom, mirror to all configured servers.
 * Retries each primary candidate with fresh auth; returns the winning
 * descriptor plus per-mirror outcomes.
 */
export async function uploadBlob(
  blob: Blob,
  signer: NostrSigner,
  servers: string[] = BLOSSOM_SERVERS,
  onProgress?: (stage: string) => void,
): Promise<UploadResult> {
  if (servers.length === 0) throw new Error('No Blossom servers configured')

  // Fail fast on a blob that servers would reject anyway. An empty recording
  // (e.g. MediaRecorder stop with no dataavailable) produces a header-only or
  // 0-byte webm that gets MIME-sniff-rejected — catch it here with a real error.
  if (!blob || blob.size < MIN_BLOB_BYTES) {
    throw new Error(
      `Recording is empty (${blob?.size ?? 0} bytes) — microphone captured nothing. ` +
      `Check mic permission and try again.`,
    )
  }

  onProgress?.('hashing')
  const sha256 = await sha256Blob(blob)

  // Try each eligible primary in order until one accepts the blob.
  const primaries = servers.filter((s) => !MIRROR_ONLY.has(s))
  const errors: string[] = []
  let descriptor: BlobDescriptor | null = null
  let primaryUsed = ''

  for (const server of primaries) {
    onProgress?.(`uploading to ${new URL(server).host}`)
    try {
      descriptor = await uploadToPrimary(blob, sha256, server, signer, onProgress)
      primaryUsed = server
      break
    } catch (err) {
      if (err instanceof SignerTimeoutError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${new URL(server).host}: ${msg}`)
      console.warn(`Blossom upload to ${server} failed, trying next:`, msg)
    }
  }
  if (!descriptor) {
    throw new Error(`All Blossom servers rejected the upload:\n${errors.join('\n')}`)
  }

  // Mirror to every other configured server (including mirror-only ones).
  // Failures are collected, not thrown — the primary already has the bytes.
  const mirrored: string[] = []
  const mirrorFailures: { server: string; error: string }[] = []
  await Promise.all(
    servers
      .filter((m) => m !== primaryUsed)
      .map(async (mirror) => {
        try {
          await mirrorBlob(descriptor!.url, sha256, blob.type, mirror, signer)
          mirrored.push(mirror)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          mirrorFailures.push({ server: mirror, error: msg })
          console.warn(`Blossom mirror to ${mirror} failed:`, msg)
        }
      }),
  )

  return { descriptor, mirrored, mirrorFailures }
}

/**
 * BUD-01 PUT upload to a single server, with retry + fresh auth per attempt
 * + sha256 integrity verification of the returned descriptor.
 */
async function uploadToPrimary(
  blob: Blob,
  sha256: string,
  serverUrl: string,
  signer: NostrSigner,
  onProgress?: (stage: string) => void,
): Promise<BlobDescriptor> {
  const base = serverUrl.replace(/\/$/, '')

  // Retry up to 3 attempts. Auth is signed inside the loop so a retry after a
  // timeout/backoff never presents an expired kind-24242 event.
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onProgress?.(`Awaiting Amber signature for ${new URL(serverUrl).host}`)
      const authEvent = await makeBlossomAuth(sha256, 'upload', signer)
      const res = await fetchRaw(`${base}/upload`, {
        method: 'PUT',
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
        },
        body: blob,
        timeoutMs: 30_000,
        attempts: 1, // we handle retry ourselves so auth is re-signed each time
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        // 4xx (auth / sniff reject) is not retryable on this server — bail to next.
        throw new HttpError(`upload failed (${res.status}): ${body.slice(0, 160)}`, res.status)
      }

      const data = (await res.json()) as Record<string, unknown>
      const descriptor = validateUploadDescriptor(data, blob, sha256, [serverUrl])
      return descriptor
    } catch (err) {
      lastErr = err
      // A disconnected NIP-46 signer cannot be repaired by retrying the same
      // server. Return the saved draft promptly so the user can reopen Amber.
      if (err instanceof SignerTimeoutError) break
      // Don't retry client errors (4xx) — they won't succeed on a retry.
      if (err instanceof HttpError && err.status !== undefined && err.status < 500) break
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr))
}

/** Validate an untrusted Blossom upload response against local bytes/config. */
export function validateUploadDescriptor(
  data: Record<string, unknown>,
  blob: Blob,
  expectedSha256: string,
  trustedServers: readonly string[],
): BlobDescriptor {
  const url = data.url as string | undefined
  if (!url || typeof url !== 'string') {
    throw new HttpError('malformed descriptor: missing url')
  }
  const reportedHash = typeof data.sha256 === 'string' ? data.sha256 : ''
  if (reportedHash && reportedHash !== expectedSha256) {
    throw new HttpError(
      `integrity mismatch: server reported sha256 ${reportedHash.slice(0, 12)}… ` +
      `expected ${expectedSha256.slice(0, 12)}…`,
    )
  }
  validateTrustedBlobUrl(url, expectedSha256, trustedServers)
  return {
    url,
    sha256: expectedSha256,
    size: (data.size as number) ?? blob.size,
    mime: (data.type ?? data.mime ?? blob.type) as string,
    uploaded: (data.uploaded as number | undefined) ?? now(),
  }
}

/**
 * BUD-04 mirror: ask a server to fetch the blob from a URL.
 * Fresh auth per mirror. Retried once on transient failure.
 */
async function mirrorBlob(
  sourceUrl: string,
  sha256: string,
  mime: string,
  serverUrl: string,
  signer: NostrSigner,
): Promise<void> {
  const base = serverUrl.replace(/\/$/, '')
  let lastErr: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const authEvent = await makeBlossomAuth(sha256, 'upload', signer)
      const res = await fetchRaw(`${base}/mirror`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`,
        },
        body: JSON.stringify({ url: sourceUrl, sha256, type: mime }),
        timeoutMs: 20_000,
        attempts: 1,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new HttpError(`mirror failed (${res.status}): ${body.slice(0, 160)}`, res.status)
      }
      return
    } catch (err) {
      lastErr = err
      if (err instanceof HttpError && err.status !== undefined && err.status < 500) break
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr))
}

/**
 * Build and sign a kind 24242 Blossom auth event.
 * Signed fresh on every call — callers must not cache across retries.
 * t = "upload" | "get" | "delete" | "list"
 */
async function makeBlossomAuth(
  sha256: string,
  t: 'upload' | 'get' | 'delete' | 'list',
  signer: NostrSigner,
): Promise<NostrEvent> {
  const expiration = now() + AUTH_EXPIRY_SECONDS
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Amber identity request')
  const unsigned = {
    kind: KINDS.BLOSSOM_AUTH,
    created_at: now(),
    tags: [
      ['t', t],
      ['x', sha256],
      ['expiration', String(expiration)],
    ],
    content: `${t} ${sha256}`,
    pubkey,
  }
  return withSignerTimeout(signer.signEvent(unsigned), 'Amber Blossom authorization')
}

/** Delete a blob from a server (best-effort). */
export async function deleteBlob(
  sha256: string,
  serverUrl: string,
  signer: NostrSigner,
): Promise<void> {
  const authEvent = await makeBlossomAuth(sha256, 'delete', signer)
  await fetchRaw(`${serverUrl.replace(/\/$/, '')}/${sha256}`, {
    method: 'DELETE',
    headers: { Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}` },
    timeoutMs: 15_000,
  }).catch(() => {})
}

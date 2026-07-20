/**
 * Blossom upload module (BUD-01 + BUD-04).
 *
 * Flow:
 *   1. Sign a kind 24242 auth event scoped to the blob sha256 + expiry
 *   2. PUT the blob to the primary server
 *   3. Mirror to secondary servers using BUD-04 (server fetches from URL)
 *
 * All servers are public — no VPS origin.
 */

import { BLOSSOM_SERVERS, KINDS } from '../config'
import type { BlobDescriptor, NostrSigner, NostrEvent } from '../types/nostr'
import { sha256Blob, now } from './utils'

const AUTH_EXPIRY_SECONDS = 60 * 5 // 5 minutes

/**
 * Upload a blob to Blossom, mirror to all configured servers.
 * Returns the primary server's BlobDescriptor.
 */
export async function uploadBlob(
  blob: Blob,
  signer: NostrSigner,
  servers: string[] = BLOSSOM_SERVERS,
): Promise<BlobDescriptor> {
  if (servers.length === 0) throw new Error('No Blossom servers configured')

  const sha256 = await sha256Blob(blob)
  const [primary, ...mirrors] = servers

  // Upload to primary
  const descriptor = await uploadToPrimary(blob, sha256, primary, signer)

  // Mirror to remaining servers (fire and forget — don't block on mirror failures)
  for (const mirror of mirrors) {
    mirrorBlob(descriptor.url, sha256, blob.type, mirror, signer).catch((err) => {
      console.warn(`Blossom mirror to ${mirror} failed:`, err)
    })
  }

  return descriptor
}

/** BUD-01 PUT upload to a single server. */
async function uploadToPrimary(
  blob: Blob,
  sha256: string,
  serverUrl: string,
  signer: NostrSigner,
): Promise<BlobDescriptor> {
  const authEvent = await makeBlossomAuth(sha256, 'upload', signer)
  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`

  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/${sha256}`, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type,
      'Content-Length': String(blob.size),
      Authorization: authHeader,
    },
    body: blob,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Blossom upload failed (${res.status}): ${body}`)
  }

  const data = await res.json() as Record<string, unknown>
  return {
    url: data.url as string,
    sha256: data.sha256 as string,
    size: data.size as number,
    mime: (data.type ?? data.mime) as string,
    uploaded: (data.uploaded as number | undefined) ?? now(),
  }
}

/**
 * BUD-04 mirror: ask a server to fetch the blob from a URL.
 * Each mirror needs its own fresh auth event.
 */
async function mirrorBlob(
  sourceUrl: string,
  sha256: string,
  mime: string,
  serverUrl: string,
  signer: NostrSigner,
): Promise<void> {
  const authEvent = await makeBlossomAuth(sha256, 'upload', signer)
  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`

  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/mirror`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({ url: sourceUrl, sha256, type: mime }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Blossom mirror failed (${res.status}): ${body}`)
  }
}

/**
 * Build and sign a kind 24242 Blossom auth event.
 * t = "upload" | "get" | "delete" | "list"
 */
async function makeBlossomAuth(
  sha256: string,
  t: 'upload' | 'get' | 'delete' | 'list',
  signer: NostrSigner,
): Promise<NostrEvent> {
  const expiration = now() + AUTH_EXPIRY_SECONDS
  const pubkey = await signer.getPublicKey()
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
  return signer.signEvent(unsigned)
}

/** Delete a blob from a server (best-effort). */
export async function deleteBlob(
  sha256: string,
  serverUrl: string,
  signer: NostrSigner,
): Promise<void> {
  const authEvent = await makeBlossomAuth(sha256, 'delete', signer)
  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`

  await fetch(`${serverUrl.replace(/\/$/, '')}/${sha256}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader },
  })
}

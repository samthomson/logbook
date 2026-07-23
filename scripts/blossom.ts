/**
 * Shared Blossom upload (BUD-01) for VPS scripts.
 * Uploads to the primary server, mirrors to the rest, returns the descriptor.
 * Auth: kind 24242 event per BUD-01 spec, signed by COMPASS_NSEC.
 */

import { finalizeEvent } from 'nostr-tools'
import { createHash } from 'node:crypto'
import { KINDS, BLOSSOM_SERVERS } from './config.ts'

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  mime: string
  /** All mirror URLs, primary first */
  urls: string[]
}

export async function uploadToBlossom(
  data: Buffer,
  mime: string,
  privkey: Uint8Array,
  servers: string[] = BLOSSOM_SERVERS,
): Promise<BlobDescriptor> {
  const sha256 = createHash('sha256').update(data).digest('hex')
  const urls: string[] = []
  const errors: string[] = []

  for (const server of servers) {
    const auth = finalizeEvent(
      {
        kind: KINDS.BLOSSOM_AUTH,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['t', 'upload'],
          ['x', sha256],
          ['expiration', String(Math.floor(Date.now() / 1000) + 3600)],
        ],
        content: `Upload ${sha256}`,
      },
      privkey,
    )
    const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64')

    try {
      const res = await fetch(`${server}/upload`, {
        method: 'PUT',
        headers: { Authorization: authHeader, 'Content-Type': mime },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        errors.push(`${server}: HTTP ${res.status}`)
        continue
      }
      const descriptor = (await res.json()) as { url: string; sha256: string }
      urls.push(descriptor.url)
    } catch (err) {
      errors.push(`${server}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!urls.length) {
    throw new Error(`Blossom upload failed on all servers:\n  ${errors.join('\n  ')}`)
  }
  if (errors.length) {
    console.warn(`[blossom] Partial mirror failures: ${errors.join('; ')}`)
  }

  return { url: urls[0], urls, sha256, size: data.length, mime }
}

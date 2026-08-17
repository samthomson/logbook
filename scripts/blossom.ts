/**
 * Shared Blossom upload (BUD-01) for VPS scripts.
 * Uploads to the primary server, mirrors to the rest, returns the descriptor.
 * Auth: kind 24242 event per BUD-01 spec, signed via the Compass NIP-46 bunker.
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

export type BlossomSigner = {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<unknown>
}

/** Bind an untrusted BUD-01 descriptor to the bytes and configured origin that
 * produced it before its URL is allowed into a Compass-authored release. */
export function validateUploadDescriptor(
  descriptor: { url?: unknown; sha256?: unknown },
  expectedSha256: string,
  servers: readonly string[],
): string {
  if (descriptor.sha256 !== expectedSha256) {
    throw new Error('Blossom upload descriptor SHA-256 does not match uploaded bytes')
  }
  if (typeof descriptor.url !== 'string') throw new Error('Blossom upload descriptor is missing URL')
  let url: URL
  try {
    url = new URL(descriptor.url)
  } catch {
    throw new Error('Blossom upload descriptor URL is invalid')
  }
  if (url.protocol !== 'https:') throw new Error('Blossom upload descriptor URL must use HTTPS')
  const configuredOrigins = new Set(servers.map((server) => new URL(server).origin))
  if (!configuredOrigins.has(url.origin)) {
    throw new Error('Blossom upload descriptor URL is not on a configured Blossom origin')
  }
  if (!new RegExp(`^/${expectedSha256}(\\.[a-z0-9]{1,10})?$`).test(url.pathname)) {
    throw new Error('Blossom upload descriptor URL must use the canonical hash path')
  }
  return url.toString()
}

export async function uploadToBlossom(
  data: Buffer,
  mime: string,
  signer: Uint8Array | BlossomSigner,
  servers: string[] = BLOSSOM_SERVERS,
): Promise<BlobDescriptor> {
  const sha256 = createHash('sha256').update(data).digest('hex')
  const urls: string[] = []
  const errors: string[] = []

  for (const server of servers) {
    const authTemplate = {
      kind: KINDS.BLOSSOM_AUTH,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'upload'],
        ['x', sha256],
        ['expiration', String(Math.floor(Date.now() / 1000) + 3600)],
      ],
      content: `Upload ${sha256}`,
    }
    const auth = signer instanceof Uint8Array
      ? finalizeEvent(authTemplate, signer)
      : await signer.signEvent(authTemplate)
    const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64')

    try {
      const res = await fetch(`${server}/upload`, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': mime,
          'Content-Length': String(data.length),
          'X-SHA-256': sha256,
          'X-Content-Type': mime,
          'X-Content-Length': String(data.length),
        },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const detail = body.trim().slice(0, 160)
        errors.push(`${server}: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
        continue
      }
      const descriptor = (await res.json()) as { url?: unknown; sha256?: unknown }
      urls.push(validateUploadDescriptor(descriptor, sha256, servers))
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

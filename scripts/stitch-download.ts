import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { getTrustedBlobCandidates } from './segment-security.ts'

export interface BlobFetchResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

export type BlobFetch = (url: string, init: { signal: AbortSignal }) => Promise<BlobFetchResponse>

export interface DownloadVerifiedBlobOptions {
  url: string
  destPath: string
  expectedSha256: string
  servers: readonly string[]
  fetchImpl: BlobFetch
  maxBytes?: number
  writeFile?: (path: string, bytes: Buffer) => void
}

/**
 * Download only canonical paths from configured Blossom origins, then verify
 * both maximum size and content hash before the destination is ever written.
 */
export async function downloadVerifiedBlob({
  url,
  destPath,
  expectedSha256,
  servers,
  fetchImpl,
  maxBytes = 256 * 1024 * 1024,
  writeFile = writeFileSync,
}: DownloadVerifiedBlobOptions): Promise<void> {
  const candidates = getTrustedBlobCandidates(url, expectedSha256, servers)
  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(candidate, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) {
        errors.push(`${candidate}: HTTP ${response.status}`)
        continue
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (contentLength > maxBytes) {
        errors.push(`${candidate}: blob exceeds ${maxBytes} byte limit`)
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > maxBytes) {
        errors.push(`${candidate}: blob exceeds ${maxBytes} byte limit`)
        continue
      }
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== expectedSha256) {
        errors.push(`${candidate}: sha256 mismatch (got ${actual.slice(0, 12)}…)`)
        continue
      }
      writeFile(destPath, bytes)
      return
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Failed to download blob from all mirrors:\n  ${errors.join('\n  ')}`)
}

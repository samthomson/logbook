import { createHash } from 'node:crypto'

export interface StaticSyncAcknowledgement {
  /** True only when the remote static host accepted the uploaded release. */
  hosted: boolean
  /** SHA-256 of the feed the host acknowledged. */
  feedDigest: string
}

export type StaticSync = () => Promise<StaticSyncAcknowledgement>

/**
 * Explicit acknowledgement boundary between local static-file generation and a
 * hosted feed. A successful write to STATIC_DIR is deliberately insufficient.
 */
export async function acknowledgeStaticSync(expectedFeedDigest: string, sync: StaticSync): Promise<void> {
  const acknowledgement = await sync()
  if (!acknowledgement.hosted) {
    throw new Error('Static sync did not return a hosted acknowledgement')
  }
  if (acknowledgement.feedDigest !== expectedFeedDigest) {
    throw new Error('Hosted static sync acknowledged a different feed digest')
  }
}

/** GET the hosted feed and hash the bytes. That is the acknowledgement. */
export async function readBackHostedFeed(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StaticSyncAcknowledgement> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`Hosted feed read-back failed: ${url} HTTP ${response.status}`)
  }
  const digest = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
  return { hosted: true, feedDigest: digest }
}

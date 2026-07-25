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

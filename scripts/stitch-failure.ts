/**
 * A stitch run that dies must not leave the episode locked. Only a producer can
 * fix the cut, so the manifest goes back to draft carrying the reason it came
 * back — otherwise the worker retries the same broken cut every cycle while the
 * app shows an episode that reads as finished.
 */

export interface ManifestFailure {
  /** Unix seconds the run failed. */
  at: number
  /** One line a producer can act on, with no event ids in it. */
  reason: string
  /** Set when one recording is at fault, so the page can point at it. */
  segmentId?: string
  sectionId?: string
  /** Set when an RSS/publish step failed while the cut stayed locked. */
  stage?: 'audio' | 'chapters' | 'feed' | 'podstr' | 'announcement'
}

/** A failure the producer fixes by changing one recording's place in the cut. */
export class SegmentFailure extends Error {
  constructor(message: string, readonly segmentId: string, readonly sectionId: string) {
    super(message)
    this.name = 'SegmentFailure'
  }
}

/** Relay events are not log files: keep the reason to a single readable line. */
const MAX_REASON_CHARS = 400

export function failureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const line = raw.replace(/\s+/g, ' ').trim()
  return line.length > MAX_REASON_CHARS ? `${line.slice(0, MAX_REASON_CHARS - 1)}…` : line
}

export function draftAfterFailure<T extends { episodeStatus: string }>(
  manifest: T,
  error: unknown,
  at: number,
): T & { episodeStatus: 'draft'; lastFailure: ManifestFailure } {
  const lastFailure: ManifestFailure = { at, reason: failureReason(error) }
  if (error instanceof SegmentFailure) {
    lastFailure.segmentId = error.segmentId
    lastFailure.sectionId = error.sectionId
  }
  return { ...manifest, episodeStatus: 'draft', lastFailure }
}

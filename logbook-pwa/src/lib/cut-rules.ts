/**
 * Pure rules behind the producer controls on the episode page: where a
 * recording sits in the manifest, whether it is in the episode, whether it may
 * be there at all, and whether it can move.
 *
 * Eligibility is the important one. The public timeline shows every verified
 * recording, but only a contributor's recording may enter the cut, so the page
 * asks this before offering a control rather than after a producer has clicked.
 */

import { COMPASS_PUBKEY } from '../config'
import type { ManifestContent, Segment } from '../types/nostr'

export type CutState = 'in' | 'out'

/** Index of the section that references this recording, or -1. */
export function sectionIndexHolding(content: ManifestContent, segmentId: string): number {
  return content.sections.findIndex((section) =>
    section.order.includes(segmentId) || section.excluded.includes(segmentId))
}

export function cutStateOf(content: ManifestContent | null, segmentId: string): CutState {
  if (!content) return 'out'
  return content.sections.some((section) =>
    section.order.includes(segmentId) && !section.excluded.includes(segmentId)) ? 'in' : 'out'
}

export function isReviewedInCut(content: ManifestContent | null, segmentId: string): boolean {
  return Boolean(content?.sections.some((section) => section.reviewed.includes(segmentId)))
}

/** Compass narration plus contributors on the list; nobody else. */
export function isCutEligible(segment: Segment, contributors: ReadonlySet<string> | null): boolean {
  const author = segment.event.pubkey.toLowerCase()
  return author === COMPASS_PUBKEY.toLowerCase() || Boolean(contributors?.has(author))
}

/** The intro stays at position 0, so it neither moves nor gets displaced. */
export function canMoveInCut(
  content: ManifestContent | null,
  segmentId: string,
  direction: -1 | 1,
): boolean {
  if (!content) return false
  const holding = sectionIndexHolding(content, segmentId)
  if (holding < 0) return false
  const section = content.sections[holding]
  if (segmentId === section.introEventId) return false
  const index = section.order.indexOf(segmentId)
  if (index < 0) return false
  const first = section.introEventId ? 1 : 0
  const next = index + direction
  return next >= first && next < section.order.length
}

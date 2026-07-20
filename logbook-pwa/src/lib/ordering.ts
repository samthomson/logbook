/**
 * Seed order computation — depth-first reply-forest walk.
 *
 * Per SPEC.md §3 and PLAN.md §2:
 *   - Roots = segments with no responding_to, OR whose responding_to target
 *     is outside this section's segment set.
 *   - Walk depth-first: roots in chronological order, each root's replies
 *     in chronological order, each subtree kept contiguous.
 *   - Intro segment (isIntro=true) is always moved to position 0 after walk.
 *   - Cycle-safe: responding_to always points to a pre-existing event ID.
 *
 * Example:
 *   A (t=1, root), B (t=2, replies to A), C (t=3, root), D (t=4, replies to B)
 *   Result: [A, B, D, C]
 */

import type { Segment } from '../types/nostr'

/**
 * Compute the seed EDL order for a section's segments.
 * Returns an array of event IDs in playback order.
 */
export function computeSeedOrder(segments: Segment[]): string[] {
  if (!segments.length) return []

  const byId = new Map<string, Segment>()
  for (const seg of segments) {
    byId.set(seg.event.id, seg)
  }

  const sectionIds = new Set(segments.map((s) => s.event.id))

  // Build reply map: parentId → children (sorted by created_at)
  const children = new Map<string, Segment[]>()
  const roots: Segment[] = []

  for (const seg of segments) {
    const parentId = seg.respondingTo
    if (parentId && sectionIds.has(parentId)) {
      // This segment replies to another segment in this section
      const siblings = children.get(parentId) ?? []
      siblings.push(seg)
      children.set(parentId, siblings)
    } else {
      // Root: no responding_to, or target is outside this section
      roots.push(seg)
    }
  }

  // Sort roots and each child group chronologically
  roots.sort((a, b) => a.event.created_at - b.event.created_at)
  for (const [, siblings] of children) {
    siblings.sort((a, b) => a.event.created_at - b.event.created_at)
  }

  // Depth-first walk
  const order: string[] = []
  const visited = new Set<string>()

  function walk(seg: Segment): void {
    if (visited.has(seg.event.id)) return
    visited.add(seg.event.id)
    order.push(seg.event.id)
    for (const child of children.get(seg.event.id) ?? []) {
      walk(child)
    }
  }

  for (const root of roots) {
    walk(root)
  }

  // Append any segments unreachable due to mutual-reply cycles (sorted chronologically)
  for (const seg of [...segments].sort((a, b) => a.event.created_at - b.event.created_at)) {
    if (!visited.has(seg.event.id)) {
      order.push(seg.event.id)
    }
  }

  // Pin intro to position 0 (move from wherever it landed)
  const introIdx = order.findIndex((id) => byId.get(id)?.isIntro)
  if (introIdx > 0) {
    const [introId] = order.splice(introIdx, 1)
    order.unshift(introId)
  }

  return order
}

/**
 * Merge a new late-arriving segment ID into an existing EDL order.
 * Late segments always append to the tail, never mid-list.
 * Returns the updated order array.
 */
export function appendLateSegment(
  currentOrder: string[],
  newSegmentId: string,
): string[] {
  if (currentOrder.includes(newSegmentId)) return currentOrder
  return [...currentOrder, newSegmentId]
}

/**
 * Reorder segments by moving a segment from one index to another.
 * Used for admin drag-to-reorder.
 */
export function reorderSegments(
  order: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (fromIndex === toIndex) return order
  if (fromIndex < 0 || fromIndex >= order.length) return order
  if (toIndex < 0 || toIndex >= order.length) return order

  const result = [...order]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}

/**
 * Filter an order array to remove excluded segment IDs.
 * Used by the stitcher to get the final cut list.
 */
export function applyExclusions(order: string[], excluded: string[]): string[] {
  const excludedSet = new Set(excluded)
  return order.filter((id) => !excludedSet.has(id))
}

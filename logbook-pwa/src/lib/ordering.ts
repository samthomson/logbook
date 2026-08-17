/**
 * Seed order: depth-first reply forest, intro pinned at 0.
 *
 * A reply is a guest answering another note. The seed places it directly after
 * its parent so the producer does not have to reconstruct that by hand. The
 * producer's saved `order` is still what the stitcher plays.
 */

import type { Segment } from '../types/nostr'

export function computeSeedOrder(segments: Segment[]): string[] {
  if (!segments.length) return []

  const byId = new Map(segments.map((segment) => [segment.event.id, segment]))
  const inSection = new Set(byId.keys())
  const children = new Map<string, Segment[]>()
  const roots: Segment[] = []

  for (const segment of segments) {
    const parentId = segment.respondingTo
    if (parentId && inSection.has(parentId)) {
      const siblings = children.get(parentId) ?? []
      siblings.push(segment)
      children.set(parentId, siblings)
    } else {
      roots.push(segment)
    }
  }

  const byTime = (a: Segment, b: Segment) =>
    a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
  roots.sort(byTime)
  for (const siblings of children.values()) siblings.sort(byTime)

  const order: string[] = []
  const visited = new Set<string>()
  function walk(segment: Segment): void {
    if (visited.has(segment.event.id)) return
    visited.add(segment.event.id)
    order.push(segment.event.id)
    for (const child of children.get(segment.event.id) ?? []) walk(child)
  }
  for (const root of roots) walk(root)
  for (const segment of [...segments].sort(byTime)) walk(segment)

  const introIndex = order.findIndex((id) => byId.get(id)?.isIntro)
  if (introIndex > 0) {
    const [introId] = order.splice(introIndex, 1)
    order.unshift(introId)
  }
  return order
}

/**
 * Display walk: replies nest under the note they answer, even if the producer
 * moved them in the flat cut. Sibling order follows `preferredOrder`.
 */
export function nestDisplayOrder(
  segments: Segment[],
  preferredOrder: string[],
): Array<{ id: string; depth: number }> {
  if (!segments.length) return []

  const byId = new Map(segments.map((segment) => [segment.event.id, segment]))
  const inSection = new Set(byId.keys())
  const rank = new Map(preferredOrder.map((id, index) => [id, index]))
  const byRank = (a: Segment, b: Segment) =>
    (rank.get(a.event.id) ?? Number.POSITIVE_INFINITY) - (rank.get(b.event.id) ?? Number.POSITIVE_INFINITY)
    || a.event.created_at - b.event.created_at
    || a.event.id.localeCompare(b.event.id)

  const children = new Map<string, Segment[]>()
  const roots: Segment[] = []
  for (const segment of segments) {
    const parentId = segment.respondingTo
    if (parentId && inSection.has(parentId)) {
      const siblings = children.get(parentId) ?? []
      siblings.push(segment)
      children.set(parentId, siblings)
    } else {
      roots.push(segment)
    }
  }
  for (const siblings of children.values()) siblings.sort(byRank)
  roots.sort(byRank)

  const out: Array<{ id: string; depth: number }> = []
  const visited = new Set<string>()
  function walk(segment: Segment, depth: number): void {
    if (visited.has(segment.event.id)) return
    visited.add(segment.event.id)
    out.push({ id: segment.event.id, depth })
    for (const child of children.get(segment.event.id) ?? []) walk(child, Math.min(depth + 1, 4))
  }
  for (const root of roots) walk(root, 0)
  for (const segment of [...segments].sort(byRank)) walk(segment, 0)
  return out
}

export function appendLateSegment(
  currentOrder: string[],
  newSegmentId: string,
): string[] {
  if (currentOrder.includes(newSegmentId)) return currentOrder
  return [...currentOrder, newSegmentId]
}

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

export function applyExclusions(order: string[], excluded: string[]): string[] {
  const excludedSet = new Set(excluded)
  return order.filter((id) => !excludedSet.has(id))
}

/** Place a reply immediately after its parent when that parent is already in the cut. */
export function insertInCutOrder(order: string[], segment: Segment): string[] {
  const without = order.filter((id) => id !== segment.event.id)
  if (segment.respondingTo) {
    const at = without.indexOf(segment.respondingTo)
    if (at >= 0) return [...without.slice(0, at + 1), segment.event.id, ...without.slice(at + 1)]
  }
  return [...without, segment.event.id]
}

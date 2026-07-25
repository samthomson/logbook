/** Projects an authenticated manifest's section EDL over fetched segments.
 * Unknown or late segments stay visible at the deterministic chronological tail. */
export function orderTimelineSegments(
  segments: readonly { event: { id: string; created_at: number } }[],
  manifestOrder: readonly string[],
  excluded: readonly string[],
): string[] {
  const available = new Map(segments.map((segment) => [segment.event.id, segment]))
  const excludedIds = new Set(excluded)
  const ordered = manifestOrder.filter((id) => available.has(id) && !excludedIds.has(id))
  const alreadyOrdered = new Set(ordered)
  const late = segments
    .filter((segment) => !excludedIds.has(segment.event.id) && !alreadyOrdered.has(segment.event.id))
    .sort((a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id))
    .map((segment) => segment.event.id)
  return [...ordered, ...late]
}

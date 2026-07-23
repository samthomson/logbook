export interface TaggedEvent {
  id?: string
  created_at?: number
  tags: string[][]
}

function issueNumber(event: TaggedEvent): number | null {
  const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
  const match = dTag.match(/(\d+)$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Return Compass issue event IDs that lack a matching Logbook manifest d-tag.
 * The newest issues are returned first so a restarted watcher repairs the
 * currently actionable issue before historical gaps.
 */
export function missingManifestIssueIds(
  issues: TaggedEvent[],
  manifests: TaggedEvent[],
): string[] {
  const existing = new Set(
    manifests
      .map(issueNumber)
      .filter((number): number is number => number !== null),
  )

  return issues
    .filter((issue) => {
      const number = issueNumber(issue)
      return Boolean(issue.id) && number !== null && !existing.has(number)
    })
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .map((issue) => issue.id!)
}

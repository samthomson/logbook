export interface TaggedEvent {
  id?: string
  created_at?: number
  tags: string[][]
}

export interface ManifestEvent extends TaggedEvent {
  id: string
  pubkey: string
  content: string
}

export interface ManifestSelectionOptions {
  expectedPubkey: string
  verify: (event: ManifestEvent) => boolean
}

function manifestDTag(event: TaggedEvent): string | null {
  const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
  return typeof dTag === 'string' && dTag.length > 0 ? dTag : null
}

/**
 * Select only the latest verified manifest for each addressable d-tag. A newer
 * draft or published manifest must suppress an older cutting revision: Nostr
 * addressable events are replacement records, not an append-only job queue.
 */
export function latestCuttingManifests(
  events: ManifestEvent[],
  { expectedPubkey, verify }: ManifestSelectionOptions,
): ManifestEvent[] {
  const latest = new Map<string, ManifestEvent>()

  for (const event of events) {
    const issueId = manifestDTag(event)
    if (!issueId || event.pubkey !== expectedPubkey || !verify(event)) continue
    try {
      const content = JSON.parse(event.content) as { episodeStatus?: unknown }
      if (typeof content.episodeStatus !== 'string') continue
    } catch {
      continue
    }

    const prior = latest.get(issueId)
    const eventTime = event.created_at ?? 0
    const priorTime = prior?.created_at ?? 0
    const isNewer = !prior ||
      eventTime > priorTime ||
      (eventTime === priorTime && event.id > prior.id)
    if (isNewer) latest.set(issueId, event)
  }

  return [...latest.values()]
    .filter((event) => (JSON.parse(event.content) as { episodeStatus: string }).episodeStatus === 'cutting')
    .sort((a, b) => a.tags.find((tag) => tag[0] === 'd')![1].localeCompare(b.tags.find((tag) => tag[0] === 'd')![1]))
}

export function latestVerifiedManifest(
  events: ManifestEvent[],
  issueId: string,
  { expectedPubkey, verify }: ManifestSelectionOptions,
): ManifestEvent | null {
  return events
    .filter((event) => manifestDTag(event) === issueId && event.pubkey === expectedPubkey && verify(event))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || b.id.localeCompare(a.id))[0] ?? null
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

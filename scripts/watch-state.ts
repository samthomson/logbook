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
  /** One pubkey, or the trusted producer set (Compass plus its appointees). */
  expectedPubkey: string | ReadonlySet<string>
  verify: (event: ManifestEvent) => boolean
}

function manifestDTag(event: TaggedEvent): string | null {
  const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
  return typeof dTag === 'string' && dTag.length > 0 ? dTag : null
}

function authoredByTrusted(event: ManifestEvent, expected: string | ReadonlySet<string>): boolean {
  const pubkey = event.pubkey.toLowerCase()
  return typeof expected === 'string' ? pubkey === expected.toLowerCase() : expected.has(pubkey)
}

function episodeStatusOf(event: ManifestEvent): 'draft' | 'cutting' | 'published' | null {
  try {
    const parsed = JSON.parse(event.content) as { episodeStatus?: unknown }
    if (
      parsed.episodeStatus === 'draft'
      || parsed.episodeStatus === 'cutting'
      || parsed.episodeStatus === 'published'
    ) {
      return parsed.episodeStatus
    }
  } catch {
    return null
  }
  return null
}

function isNewerManifest(event: ManifestEvent, than: ManifestEvent): boolean {
  const eventTime = event.created_at ?? 0
  const thanTime = than.created_at ?? 0
  if (eventTime !== thanTime) return eventTime > thanTime
  return event.id > than.id
}

function newestOf(events: ManifestEvent[]): ManifestEvent | null {
  return events.reduce<ManifestEvent | null>((latest, event) => {
    if (!latest || isNewerManifest(event, latest)) return event
    return latest
  }, null)
}

function latestPerAuthor(events: ManifestEvent[]): ManifestEvent[] {
  const byAuthor = new Map<string, ManifestEvent[]>()
  for (const event of events) {
    const key = event.pubkey.toLowerCase()
    const group = byAuthor.get(key)
    if (group) group.push(event)
    else byAuthor.set(key, [event])
  }
  const heads: ManifestEvent[] = []
  for (const group of byAuthor.values()) {
    const picked = newestOf(group)
    if (picked) heads.push(picked)
  }
  return heads
}

/**
 * Each author has one current kind 34200. A producer draft or lock newer than
 * Compass's published event is the live cut. An older leftover lock must not
 * hide that publish.
 */
function selectAuthoritativeManifest(events: ManifestEvent[]): ManifestEvent | null {
  const heads = latestPerAuthor(events)
  const newest = newestOf(heads)
  if (!newest) return null
  const published = newestOf(heads.filter((event) => episodeStatusOf(event) === 'published'))
  if (!published) return newest
  const live = newestOf(heads.filter((event) => {
    const status = episodeStatusOf(event)
    if (status !== 'draft' && status !== 'cutting') return false
    return isNewerManifest(event, published)
  }))
  return live ?? published
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
  const byIssue = new Map<string, ManifestEvent[]>()

  for (const event of events) {
    const issueId = manifestDTag(event)
    if (!issueId || !authoredByTrusted(event, expectedPubkey) || !verify(event)) continue
    if (!episodeStatusOf(event)) continue
    const group = byIssue.get(issueId)
    if (group) group.push(event)
    else byIssue.set(issueId, [event])
  }

  return [...byIssue.values()]
    .map(selectAuthoritativeManifest)
    .filter((event): event is ManifestEvent => event !== null && episodeStatusOf(event) === 'cutting')
    .sort((a, b) => a.tags.find((tag) => tag[0] === 'd')![1].localeCompare(b.tags.find((tag) => tag[0] === 'd')![1]))
}

export function latestVerifiedManifest(
  events: ManifestEvent[],
  issueId: string,
  { expectedPubkey, verify }: ManifestSelectionOptions,
): ManifestEvent | null {
  return selectAuthoritativeManifest(
    events.filter((event) => manifestDTag(event) === issueId && authoredByTrusted(event, expectedPubkey) && verify(event)),
  )
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

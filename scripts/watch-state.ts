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

function previousIds(event: ManifestEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'previous' && typeof tag[1] === 'string' && tag[1].length > 0)
    .map((tag) => tag[1])
}

function cutBodyKey(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { issueRef?: unknown; sections?: unknown }
    if (!('sections' in parsed)) return null
    return JSON.stringify({ issueRef: parsed.issueRef ?? null, sections: parsed.sections })
  } catch {
    return null
  }
}

/**
 * Compass progress must not hide published. A leftover producer lock is the one
 * Compass kept writing after. A later producer lock of the same cut is live.
 */
function selectAuthoritativeManifest(events: ManifestEvent[]): ManifestEvent | null {
  if (events.length === 0) return null
  const published = newestOf(events.filter((event) => episodeStatusOf(event) === 'published'))
  if (!published) return newestOf(events)
  const namedDead = new Set(previousIds(published))
  const publishedBody = cutBodyKey(published.content)
  const publishedAuthor = published.pubkey.toLowerCase()
  const progress = events.filter((event) => (
    event.pubkey.toLowerCase() === publishedAuthor && episodeStatusOf(event) === 'cutting'
  ))
  const live = newestOf(events.filter((event) => {
    const status = episodeStatusOf(event)
    if (!isNewerManifest(event, published) && !previousIds(event).includes(published.id)) return false
    if (status === 'draft') return true
    if (status !== 'cutting') return false
    if (namedDead.has(event.id)) return false
    if (event.pubkey.toLowerCase() === publishedAuthor) return false
    if (previousIds(event).includes(published.id)) return true
    const body = cutBodyKey(event.content)
    const sameCut = Boolean(publishedBody && body && body === publishedBody)
    if (sameCut && namedDead.size === 0) {
      if (progress.some((item) => isNewerManifest(item, event))) return false
      if (progress.length === 0) return false
    }
    return true
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

/**
 * Every issue d-tag that has at least one verified manifest from a trusted
 * producer, in any state — the scope for which segments deserve VPS compute.
 */
export function verifiedManifestIssueIds(
  events: ManifestEvent[],
  { expectedPubkey, verify }: ManifestSelectionOptions,
): string[] {
  const issueIds = new Set<string>()
  for (const event of events) {
    const issueId = manifestDTag(event)
    if (!issueId || issueIds.has(issueId)) continue
    if (!authoredByTrusted(event, expectedPubkey) || !verify(event)) continue
    issueIds.add(issueId)
  }
  return [...issueIds]
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

import { latestCuttingManifests, latestVerifiedManifest, type ManifestEvent } from './watch-state.ts'

export interface WatcherCycleDependencies {
  fetchManifests: () => Promise<ManifestEvent[]>
  /** One pubkey, or the trusted producer set (Compass plus its appointees). */
  expectedPubkey: string | ReadonlySet<string>
  verify: (event: ManifestEvent) => boolean
  runStitch: (issueId: string) => number
  runPublish: (issueId: string) => number
}

export type WatcherCycleOutcome = 'stale' | 'stitch-failed' | 'publish-failed' | 'publish-unacknowledged' | 'published'
export interface WatcherCycleResult {
  issueId: string
  outcome: WatcherCycleOutcome
}

function dTag(event: ManifestEvent): string | null {
  return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
}

function isStatus(event: ManifestEvent, status: string): boolean {
  try {
    return (JSON.parse(event.content) as { episodeStatus?: unknown }).episodeStatus === status
  } catch {
    return false
  }
}

function isCutting(event: ManifestEvent): boolean {
  return isStatus(event, 'cutting')
}

/**
 * Run one bounded watcher cycle with every relay read and process side effect
 * injected. The exact selected revision is revalidated immediately before any
 * stitch/publish process is started.
 */
export async function runWatcherCycle(
  completed: Set<string>,
  dependencies: WatcherCycleDependencies,
  /** Revision event ids whose stitch already succeeded. Publish retries must
   *  not re-encode or re-upload; that is what exhausted the bunker. */
  stitchedRevisions: Set<string> = new Set(),
): Promise<WatcherCycleResult[]> {
  const initial = await dependencies.fetchManifests()
  const candidates = latestCuttingManifests(initial, {
    expectedPubkey: dependencies.expectedPubkey,
    verify: dependencies.verify,
  })
  const results: WatcherCycleResult[] = []

  for (const candidate of candidates) {
    const issueId = dTag(candidate)
    if (!issueId || completed.has(issueId)) continue

    const candidateIsCurrent = async (): Promise<boolean> => {
      const fresh = await dependencies.fetchManifests()
      const latest = latestVerifiedManifest(fresh, issueId, {
        expectedPubkey: dependencies.expectedPubkey,
        verify: dependencies.verify,
      })
      return Boolean(latest && latest.id === candidate.id && isCutting(latest))
    }
    if (!(await candidateIsCurrent())) {
      results.push({ issueId, outcome: 'stale' })
      continue
    }

    // Record only a fully acknowledged publication and key it by the stable
    // addressable d-tag, not a replaceable manifest revision ID.
    completed.add(issueId)
    if (!stitchedRevisions.has(candidate.id)) {
      if (dependencies.runStitch(issueId) !== 0) {
        completed.delete(issueId)
        results.push({ issueId, outcome: 'stitch-failed' })
        continue
      }
      stitchedRevisions.add(candidate.id)
    }
    if (!(await candidateIsCurrent())) {
      completed.delete(issueId)
      results.push({ issueId, outcome: 'stale' })
      continue
    }
    if (dependencies.runPublish(issueId) !== 0) {
      completed.delete(issueId)
      results.push({ issueId, outcome: 'publish-failed' })
      continue
    }
    // A child process exit is not an acknowledgement. Only durably suppress
    // retries after relays expose a newer verified terminal revision.
    const acknowledged = latestVerifiedManifest(await dependencies.fetchManifests(), issueId, {
      expectedPubkey: dependencies.expectedPubkey,
      verify: dependencies.verify,
    })
    if (!acknowledged || !isStatus(acknowledged, 'published')) {
      completed.delete(issueId)
      results.push({ issueId, outcome: 'publish-unacknowledged' })
      continue
    }
    results.push({ issueId, outcome: 'published' })
  }
  return results
}

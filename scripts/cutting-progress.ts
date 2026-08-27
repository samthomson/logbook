import { SimplePool } from 'nostr-tools/pool'
import { KINDS, RELAYS } from './config.ts'
import type { CompassSigner } from './amber-signer.ts'
import type { ManifestEvent } from './watch-state.ts'
import { failureReason, type ManifestFailure } from './stitch-failure.ts'

export const RELEASE_STEPS = ['audio', 'chapters', 'feed', 'podstr', 'announcement'] as const
export type ReleaseStep = (typeof RELEASE_STEPS)[number]

export interface CuttingManifest {
  issueRef?: unknown
  episodeStatus: string
  sections: unknown
  publishedRss?: unknown
  lastFailure?: unknown
  release?: { completed?: unknown; failed?: unknown }
}

const STEP_SET = new Set<string>(RELEASE_STEPS)

function mergeCompleted(existing: unknown, added: readonly ReleaseStep[]): ReleaseStep[] {
  const set = new Set<ReleaseStep>()
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string' && STEP_SET.has(item)) set.add(item as ReleaseStep)
    }
  }
  for (const item of added) set.add(item)
  return RELEASE_STEPS.filter((step) => set.has(step))
}

function mergePublishedRss(
  existing: unknown,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  if (patch) Object.assign(base, patch)
  return Object.keys(base).length > 0 ? base : null
}

export function withReleaseProgress<T extends CuttingManifest>(
  manifest: T,
  patch: {
    completed?: readonly ReleaseStep[]
    publishedRss?: Record<string, unknown> | null
    lastFailure?: ManifestFailure | null
    failed?: ReleaseStep | null
  },
): T {
  const completed = mergeCompleted(manifest.release?.completed, patch.completed ?? [])
  const failed = patch.failed === undefined
    ? (typeof manifest.release?.failed === 'string' && STEP_SET.has(manifest.release.failed)
      ? manifest.release.failed as ReleaseStep
      : undefined)
    : patch.failed ?? undefined
  return {
    ...manifest,
    episodeStatus: 'cutting',
    lastFailure: patch.lastFailure === undefined ? manifest.lastFailure : patch.lastFailure,
    publishedRss: mergePublishedRss(manifest.publishedRss, patch.publishedRss ?? undefined),
    release: failed ? { completed, failed } : { completed },
  }
}

export function releaseFailure(
  error: unknown,
  stage: ReleaseStep,
  at = Math.floor(Date.now() / 1000),
): ManifestFailure {
  return { at, reason: failureReason(error), stage }
}

/** A failure on a step already in `completed` is the next unfinished one. */
export function unfinishedReleaseStep(
  completed: unknown,
  claimed: ReleaseStep | null | undefined,
): ReleaseStep {
  const done = new Set(mergeCompleted(completed, []))
  if (claimed && STEP_SET.has(claimed) && !done.has(claimed)) return claimed
  return RELEASE_STEPS.find((step) => !done.has(step)) ?? 'announcement'
}

/** Compass progress names the lock (or prior progress) it is releasing. */
export function cuttingProgressTags(issueId: string, event: { id: string; tags: string[][] }): string[][] {
  const tags = event.tags.length > 0
    ? event.tags.map((tag) => [...tag])
    : [['d', issueId]]
  if (!tags.some((tag) => tag[0] === 'previous' && tag[1] === event.id)) {
    tags.push(['previous', event.id])
  }
  return tags
}

/** Compass-signed progress on a locked cut. Same d-tag; newer created_at. */
export async function writeCuttingProgress<T extends CuttingManifest>(params: {
  issueId: string
  manifest: T
  event: ManifestEvent
  signer: CompassSigner
  pool: SimplePool
  completed?: readonly ReleaseStep[]
  publishedRss?: Record<string, unknown> | null
  lastFailure?: ManifestFailure | null
  failed?: ReleaseStep | null
}): Promise<{ manifest: T; event: ManifestEvent }> {
  const content = withReleaseProgress(params.manifest, {
    completed: params.completed,
    publishedRss: params.publishedRss,
    lastFailure: params.lastFailure,
    failed: params.failed,
  })
  const now = Math.floor(Date.now() / 1000)
  const event = await params.signer.signEvent({
    kind: KINDS.MANIFEST,
    created_at: Math.max(now, (params.event.created_at ?? 0) + 1),
    tags: cuttingProgressTags(params.issueId, params.event),
    content: JSON.stringify(content),
  })
  await Promise.any(params.pool.publish(RELAYS, event))
  return { manifest: content, event: event as ManifestEvent }
}

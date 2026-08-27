import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManifestRevision {
  id: string
  createdAt: number
  dTag: string
  content: string
  contentDigest: string
  previousIds: string[]
}

export interface RevisionEvent {
  id: string
  created_at?: number
  tags: string[][]
  content: string
}

export interface RunMetadataBinding {
  manifest: ManifestRevision
}

export type ReleaseStage = 'artifacts' | 'feed' | 'podstr' | 'announcement' | 'manifest'

export interface ReleaseLedgerState {
  revision: ManifestRevision
  completed: Partial<Record<ReleaseStage, true>>
  terminal: boolean
}

export interface ReleaseLedger {
  load(): ReleaseLedgerState | null
  save(state: ReleaseLedgerState): void
}

const STAGES: readonly ReleaseStage[] = ['artifacts', 'feed', 'podstr', 'announcement', 'manifest']

function releaseCompletedOf(content: string): unknown {
  try {
    return (JSON.parse(content) as { release?: { completed?: unknown } }).release?.completed
  } catch {
    return undefined
  }
}

/** A lock that already names finished worker steps must not redo them. */
export function seedCompletedStages(completed: unknown): Partial<Record<ReleaseStage, true>> {
  const names = new Set(Array.isArray(completed) ? completed.filter((item) => typeof item === 'string') : [])
  const done: Partial<Record<ReleaseStage, true>> = {}
  if (names.has('feed')) {
    done.artifacts = true
    done.feed = true
  }
  if (names.has('podstr')) done.podstr = true
  if (names.has('announcement')) done.announcement = true
  return done
}

export function manifestRevision(event: RevisionEvent): ManifestRevision {
  const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
  if (!dTag) throw new Error('Verified manifest is missing its d-tag')
  const createdAt = event.created_at
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)) throw new Error('Verified manifest is missing its created_at timestamp')
  return {
    id: event.id,
    createdAt,
    dTag,
    content: event.content,
    contentDigest: createHash('sha256').update(event.content).digest('hex'),
    previousIds: event.tags
      .filter((tag) => tag[0] === 'previous' && typeof tag[1] === 'string' && tag[1].length > 0)
      .map((tag) => tag[1]),
  }
}

function sameRevision(left: ManifestRevision, right: ManifestRevision): boolean {
  return left.id === right.id &&
    left.createdAt === right.createdAt &&
    left.dTag === right.dTag &&
    left.contentDigest === right.contentDigest
}

function parseCut(content: string): { episodeStatus?: unknown; issueRef?: unknown; sections?: unknown } {
  try {
    return JSON.parse(content) as { episodeStatus?: unknown; issueRef?: unknown; sections?: unknown }
  } catch {
    return {}
  }
}

/** The locked cut, ignoring Compass progress fields (release, lastFailure, publishedRss). */
export function sameLockedCut(left: ManifestRevision, right: ManifestRevision): boolean {
  if (left.dTag !== right.dTag) return false
  const a = parseCut(left.content)
  const b = parseCut(right.content)
  if (a.episodeStatus !== 'cutting' || b.episodeStatus !== 'cutting') return false
  if (a.issueRef !== b.issueRef) return false
  return JSON.stringify(a.sections) === JSON.stringify(b.sections)
}

export function assertRunMatchesManifest(run: RunMetadataBinding, revision: ManifestRevision): void {
  if (!sameLockedCut(run.manifest, revision)) {
    throw new Error('Run metadata belongs to a different verified manifest revision')
  }
}

/** Any trusted event of this locked cut — producer lock or Compass progress. */
export function findMatchingLock(
  expected: ManifestRevision,
  events: readonly RevisionEvent[],
): ManifestRevision | null {
  const matches: ManifestRevision[] = []
  for (const event of events) {
    let revision: ManifestRevision
    try {
      revision = manifestRevision(event)
    } catch {
      continue
    }
    if (sameLockedCut(expected, revision) || sameRevision(expected, revision)) matches.push(revision)
  }
  return matches.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null
}

export class FileReleaseLedger implements ReleaseLedger {
  private readonly path: string
  private readonly root: string

  constructor(root: string, issueId: string, lockId = 'current') {
    this.root = root
    this.path = join(root, `${issueId}-${lockId}-release-ledger.json`)
  }

  load(): ReleaseLedgerState | null {
    if (!existsSync(this.path)) return null
    return JSON.parse(readFileSync(this.path, 'utf-8')) as ReleaseLedgerState
  }

  save(state: ReleaseLedgerState): void {
    // Initialization must happen before any state write, including a failed first run.
    mkdirSync(this.root, { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(temporary, this.path)
  }
}

export interface ReleaseStageRunner {
  ledger: ReleaseLedger
  revision: ManifestRevision
  /** Fetches and verifies the latest manifest revision from relays. */
  current(): Promise<ManifestRevision>
  stages: Record<ReleaseStage, () => Promise<void>>
}

async function assertCurrent(expected: ManifestRevision, current: () => Promise<ManifestRevision>): Promise<void> {
  const actual = await current()
  if (!sameLockedCut(expected, actual) && !sameRevision(expected, actual)) {
    throw new Error('Release stopped: stale or mismatched manifest revision')
  }
}

/** This lock, or in-flight Compass progress of it — not a later lock of the same recordings. */
export function ledgerAppliesTo(state: ReleaseLedgerState, revision: ManifestRevision): boolean {
  if (state.revision.id === revision.id || sameRevision(state.revision, revision)) return true
  if (state.terminal) return false
  if (!sameLockedCut(state.revision, revision)) return false
  return revision.previousIds.includes(state.revision.id)
    || state.revision.previousIds.includes(revision.id)
}

/**
 * Durable, restart-safe publication state machine. A stage is recorded only after
 * its acknowledgement succeeds; manifest publication is the sole terminal stage.
 */
export async function runReleaseStages({ ledger, revision, current, stages }: ReleaseStageRunner): Promise<ReleaseLedgerState> {
  let state = ledger.load()
  if (state && !ledgerAppliesTo(state, revision)) {
    state = null
  }
  if (state && !sameRevision(state.revision, revision)) {
    state = { ...state, revision }
    ledger.save(state)
  }
  if (!state) {
    state = { revision, completed: seedCompletedStages(releaseCompletedOf(revision.content)), terminal: false }
    ledger.save(state)
  }
  if (state.terminal) return state

  for (const stage of STAGES) {
    if (state.completed[stage]) continue
    await assertCurrent(revision, current)
    await stages[stage]()
    state = { ...state, completed: { ...state.completed, [stage]: true }, terminal: stage === 'manifest' }
    ledger.save(state)
  }
  return state
}

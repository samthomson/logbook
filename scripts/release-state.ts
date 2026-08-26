import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManifestRevision {
  id: string
  createdAt: number
  dTag: string
  content: string
  contentDigest: string
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

export class FileReleaseLedger implements ReleaseLedger {
  private readonly path: string

  constructor(private readonly root: string, issueId: string) {
    this.path = join(root, `${issueId}-release-ledger.json`)
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

/**
 * Durable, restart-safe publication state machine. A stage is recorded only after
 * its acknowledgement succeeds; manifest publication is the sole terminal stage.
 */
export async function runReleaseStages({ ledger, revision, current, stages }: ReleaseStageRunner): Promise<ReleaseLedgerState> {
  let state = ledger.load()
  if (state && !sameLockedCut(state.revision, revision) && !sameRevision(state.revision, revision)) {
    throw new Error('Release ledger belongs to a different verified manifest revision')
  }
  if (state && !sameRevision(state.revision, revision)) {
    state = { ...state, revision }
    ledger.save(state)
  }
  if (!state) {
    state = { revision, completed: {}, terminal: false }
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

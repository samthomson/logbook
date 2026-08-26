import type { ManifestContent, ReleaseStep } from '../types/nostr'

export const RELEASE_STEPS = [
  { id: 'lock', label: 'The cut is locked' },
  { id: 'audio', label: 'Episode audio is on Blossom' },
  { id: 'chapters', label: 'Chapters file is on Blossom' },
  { id: 'feed', label: 'RSS feed is hosted' },
  { id: 'podstr', label: 'Episode is listed for podcast apps' },
  { id: 'announcement', label: 'Compass note is posted' },
  { id: 'published', label: 'This episode is published' },
] as const

export type ChecklistStepId = (typeof RELEASE_STEPS)[number]['id']
export type ChecklistState = 'waiting' | 'ready' | 'happening' | 'done' | 'failed'

const WORKER_STEPS: readonly ReleaseStep[] = ['audio', 'chapters', 'feed', 'podstr', 'announcement']

const IN_PROGRESS: Record<Exclude<ChecklistStepId, 'lock' | 'published'>, string> = {
  audio: 'Episode audio is being made',
  chapters: 'Chapters file is being made',
  feed: 'RSS feed is being written',
  podstr: 'Episode is being listed for podcast apps',
  announcement: 'Compass note is being posted',
}

const NOT_YET: Record<ChecklistStepId, string> = {
  lock: 'The cut is not locked',
  audio: 'Episode audio is not on Blossom',
  chapters: 'Chapters file is not on Blossom',
  feed: 'RSS feed is not hosted',
  podstr: 'Episode is not listed for podcast apps',
  announcement: 'Compass note is not posted',
  published: 'This episode is not published',
}

function stepLabel(id: ChecklistStepId, state: ChecklistState): string {
  if (state === 'happening' && id !== 'lock' && id !== 'published') return IN_PROGRESS[id]
  if (state === 'done') return RELEASE_STEPS.find((step) => step.id === id)!.label
  return NOT_YET[id]
}

export interface ChecklistRow {
  id: ChecklistStepId
  label: string
  state: ChecklistState
  detail: string
  href?: string
  action?: 'lock' | 'retry'
  primary?: boolean
  scrollToSegmentId?: string
}

export interface ChecklistInput {
  content: ManifestContent | null
  publishReady: boolean
  waitingReason: string
  saving: boolean
}

function completedSet(content: ManifestContent | null): Set<ReleaseStep> {
  const items = content?.release?.completed ?? []
  return new Set(items.filter((item): item is ReleaseStep => WORKER_STEPS.includes(item)))
}

function failedStep(content: ManifestContent | null): ReleaseStep | null {
  const marked = content?.release?.failed
  if (marked && WORKER_STEPS.includes(marked)) return marked
  if (content?.episodeStatus === 'draft' && content.lastFailure) return 'audio'
  if (content?.episodeStatus === 'cutting' && content.lastFailure) {
    return marked && WORKER_STEPS.includes(marked) ? marked : firstIncomplete(completedSet(content))
  }
  return null
}

function firstIncomplete(completed: ReadonlySet<ReleaseStep>): ReleaseStep {
  return WORKER_STEPS.find((step) => !completed.has(step)) ?? 'announcement'
}

function hrefFor(id: ChecklistStepId, content: ManifestContent | null): string | undefined {
  const rss = content?.publishedRss
  if (!rss) return undefined
  if (id === 'audio') return rss.mp3Url
  if (id === 'chapters') return rss.chaptersUrl
  if (id === 'feed') return rss.feedUrl
  return undefined
}

/**
 * Per-step publish checklist for the produce strip. Labels say what is; verbs
 * stay on the row's button. One filled button across the rows (the current action).
 */
export function releaseChecklist({
  content,
  publishReady,
  waitingReason,
  saving,
}: ChecklistInput): ChecklistRow[] {
  const status = content?.episodeStatus ?? 'draft'
  const published = status === 'published'
  const cutting = status === 'cutting'
  const completed = completedSet(content)
  const failed = published ? null : failedStep(content)
  const happening = cutting && !failed ? firstIncomplete(completed) : null
  const failureReason = content?.lastFailure?.reason ?? ''

  const rows: ChecklistRow[] = RELEASE_STEPS.map((step) => {
    const href = hrefFor(step.id, content)
    if (step.id === 'lock') {
      const state: ChecklistState = cutting || published
        ? 'done'
        : publishReady
          ? 'ready'
          : 'waiting'
      return {
        id: step.id,
        label: stepLabel(step.id, state),
        state,
        detail: state === 'ready'
          ? 'The worker will make the audio and the feed from this running order. It cannot be undone.'
          : state === 'waiting'
            ? waitingReason
            : '',
        action: state === 'ready' || state === 'waiting' ? 'lock' : undefined,
      }
    }

    if (step.id === 'published') {
      return {
        id: step.id,
        label: stepLabel(step.id, published ? 'done' : 'waiting'),
        state: published ? 'done' : 'waiting',
        detail: published ? '' : 'Earlier steps first.',
      }
    }

    const id = step.id
    let state: ChecklistState = 'waiting'
    if (published || completed.has(id)) state = 'done'
    else if (failed === id) state = 'failed'
    else if (happening === id) state = 'happening'

    const detail = state === 'failed'
      ? failureReason
      : state === 'waiting'
        ? 'Earlier steps first.'
        : ''

    return {
      id,
      label: stepLabel(id, state),
      state,
      detail,
      href: state === 'done' ? href : undefined,
      action: state === 'failed' && cutting ? 'retry' : undefined,
      scrollToSegmentId: id === 'audio' && state === 'failed'
        ? content?.lastFailure?.segmentId
        : undefined,
    }
  })

  const current = rows.find((row) => row.action === 'retry')
    ?? rows.find((row) => row.action === 'lock' && row.state === 'ready')
  if (current && !saving) current.primary = true
  return rows
}

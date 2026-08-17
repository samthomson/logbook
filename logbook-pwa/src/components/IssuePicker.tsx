/**
 * IssuePicker — menu of all Compass issues from relays.
 *
 * Lists every kind 30023 issue from the Compass pubkey (not just ones with
 * manifests), newest first, with the current one highlighted. Tapping loads
 * that issue's timeline.
 */

import { useState, useEffect } from 'react'
import { fetchAllIssues, extractIssueNumber } from '../lib/compass'
import { fetchAllManifests, subscribeManifests } from '../lib/manifest'
import { selectNewestManifestRevision } from '../lib/manifest-revision'
import type { EpisodeStatus, IssueManifest, NostrEvent } from '../types/nostr'

interface Props {
  currentIssueNumber: number | null
  onSelect: (event: NostrEvent) => void
  onBack?: () => void
  /** Off for signed-out visitors: an episode in progress is not theirs to browse. */
  showUnpublished: boolean
}

// Module-level cache: revisiting Episodes is instant; relays re-validate in background
let issuesCache: NostrEvent[] | null = null

const STATUS_LABEL: Record<EpisodeStatus, { label: string; tone: string }> = {
  draft: { label: 'Recording', tone: 'recording' },
  cutting: { label: 'Making the audio', tone: 'releasing' },
  published: { label: 'Published', tone: 'released' },
}

export default function IssuePicker({ currentIssueNumber, onSelect, onBack, showUnpublished }: Props) {
  const [issues, setIssues] = useState<NostrEvent[]>(issuesCache ?? [])
  const [loading, setLoading] = useState(!issuesCache)
  const [error, setError] = useState<string | null>(null)
  const [manifestByIssue, setManifestByIssue] = useState<Map<number, IssueManifest>>(new Map())
  const [statusesLoaded, setStatusesLoaded] = useState(false)
  const statuses = new Map<number, EpisodeStatus>(
    [...manifestByIssue].map(([number, manifest]) => [number, manifest.content.episodeStatus]),
  )

  useEffect(() => {
    fetchAllIssues()
      .then((list) => { issuesCache = list; setIssues(list) })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  // Status comes from the newest trusted revision of each episode. Relays keep
  // older replaceable events, so "Making the audio" must not overwrite Published.
  useEffect(() => {
    let alive = true
    const apply = (manifest: IssueManifest) => {
      const number = Number(manifest.issueId.split('-').pop())
      if (!Number.isInteger(number)) return
      setManifestByIssue((current) => {
        const existing = current.get(number)
        if (existing && selectNewestManifestRevision([existing.event, manifest.event])?.id !== manifest.event.id) {
          return current
        }
        const next = new Map(current)
        next.set(number, manifest)
        return next
      })
    }

    fetchAllManifests()
      .then((manifests) => {
        if (!alive) return
        for (const manifest of manifests) apply(manifest)
      })
      .catch(() => {})
      .finally(() => { if (alive) setStatusesLoaded(true) })

    const unsubscribe = subscribeManifests((manifest) => {
      if (alive) apply(manifest)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const published = issues.filter((event) => statuses.get(extractIssueNumber(event)) === 'published')
  const inProgress = showUnpublished
    ? issues.filter((event) => statuses.get(extractIssueNumber(event)) !== 'published')
    : []
  const hidden = issues.length - published.length - inProgress.length

  const list = (events: NostrEvent[]) => (
    <ul className="issue-picker__list">
      {events.map((ev) => {
        const num = extractIssueNumber(ev)
        const title = ev.tags.find((t) => t[0] === 'title')?.[1] ?? `Issue ${num}`
        const date = new Date(ev.created_at * 1000)
        const label = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
        const isCurrent = num === currentIssueNumber
        const status = STATUS_LABEL[statuses.get(num) ?? 'draft']
        return (
          <li key={ev.id}>
            <button
              className={`issue-picker__item ${isCurrent ? 'issue-picker__item--current' : ''}`}
              onClick={() => onSelect(ev)}
            >
              <span className="issue-picker__item-title">{title}</span>
              <span className={`issue-picker__status issue-picker__status--${status.tone}`}>{status.label}</span>
              <span className="issue-picker__date">{label}</span>
              {isCurrent && <span className="issue-picker__badge">current</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <main className="issue-picker">
      <div className="issue-picker__header">
        {onBack && <button className="btn btn--ghost btn--small" onClick={onBack}>← Back</button>}
        <h2 className="issue-picker__title">Episodes</h2>
      </div>
      <p className="issue-picker__lead">
        {showUnpublished
          ? 'An episode is either being made or published. Pick one to open it.'
          : 'Published episodes. Log in to follow one that is still being made.'}
      </p>

      {(loading || !statusesLoaded) && <p className="issue-picker__loading">Loading…</p>}
      {error && <p className="issue-picker__error">Error: {error}</p>}
      {!loading && !error && issues.length === 0 && (
        <p className="issue-picker__empty">No issues found on relays.</p>
      )}

      {inProgress.length > 0 && (
        <>
          <h3 className="issue-picker__group">Being made</h3>
          {list(inProgress)}
        </>
      )}

      {published.length > 0 && (
        <>
          {inProgress.length > 0 && <h3 className="issue-picker__group">Published</h3>}
          {list(published)}
        </>
      )}

      {!loading && !error && statusesLoaded && published.length === 0 && inProgress.length === 0 && issues.length > 0 && (
        <p className="issue-picker__empty">No published episodes yet.</p>
      )}

      {statusesLoaded && hidden > 0 && (
        <p className="issue-picker__loading">
          {hidden === 1 ? '1 episode is' : `${hidden} episodes are`} still being made and not open yet.
        </p>
      )}
    </main>
  )
}

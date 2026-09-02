/**
 * IssuePicker — episode index.
 *
 * One list of Compass newsletters. Logbook state is on the row. A cut already
 * in progress stays openable; issues before 1 Aug 2026 without a cut are the
 * Compass article only.
 */

import { useState, useEffect } from 'react'
import { fetchAllIssues, extractIssueNumber } from '../lib/compass'
import { fetchAllManifests, subscribeManifests } from '../lib/manifest'
import { selectAuthoritativeManifestRevision } from '../lib/manifest-revision'
import { startPodcastDraft } from '../lib/start-podcast-draft'
import { compassArticleUrl, fetchCompassNewsletterLinks, indexRow, isNewsletterAddress } from '../lib/issue-index'
import { routeHash } from '../lib/route'
import type { LatestRequestGuard } from '../lib/latest-request'
import type { EpisodeStatus, IssueManifest, NostrEvent, NostrSigner } from '../types/nostr'

export interface PickerProducer {
  signer: NostrSigner
  pubkey: string
  writeRequests: LatestRequestGuard
}

interface Props {
  currentIssueNumber: number | null
  onDraftStarted: (issueNumber: number) => void
  onBack?: () => void
  /** Off for signed-out visitors: an episode in progress is not theirs to open. */
  showUnpublished: boolean
  producer: PickerProducer | null
}

let issuesCache: NostrEvent[] | null = null

export default function IssuePicker({
  currentIssueNumber,
  onDraftStarted,
  onBack,
  showUnpublished,
  producer,
}: Props) {
  const [issues, setIssues] = useState<NostrEvent[]>(issuesCache ?? [])
  const [loading, setLoading] = useState(issuesCache === null)
  const [error, setError] = useState<string | null>(null)
  const [manifestByIssue, setManifestByIssue] = useState<Map<number, IssueManifest>>(new Map())
  const [statusesLoaded, setStatusesLoaded] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [articleLinks, setArticleLinks] = useState<Map<number, string>>(new Map())
  const statuses = new Map<number, EpisodeStatus>(
    [...manifestByIssue].map(([number, manifest]) => [number, manifest.content.episodeStatus]),
  )

  useEffect(() => {
    fetchAllIssues()
      .then((list) => { issuesCache = list; setIssues(list) })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
    fetchCompassNewsletterLinks()
      .then(setArticleLinks)
      .catch(() => setArticleLinks(new Map()))
  }, [])

  useEffect(() => {
    let alive = true
    const apply = (manifest: IssueManifest) => {
      const number = Number(manifest.issueId.split('-').pop())
      if (!Number.isInteger(number)) return
      setManifestByIssue((current) => {
        const existing = current.get(number)
        if (
          existing
          && selectAuthoritativeManifestRevision([existing.event, manifest.event])?.id !== manifest.event.id
        ) {
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
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (alive) setStatusesLoaded(true) })

    const unsubscribe = subscribeManifests((manifest) => {
      if (alive) apply(manifest)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const startDraft = async (event: NostrEvent) => {
    if (!producer || startingId) return
    const request = producer.writeRequests.begin()
    setStartingId(event.id)
    setStartError(null)
    try {
      await startPodcastDraft({
        issueEvent: event,
        signer: producer.signer,
        expectedPubkey: producer.pubkey,
        assertActive: () => {
          if (!producer.writeRequests.isCurrent(request)) {
            throw new Error('Producer capability was revoked')
          }
        },
      })
      if (!producer.writeRequests.isCurrent(request)) return
      onDraftStarted(extractIssueNumber(event))
    } catch (err: unknown) {
      if (!producer.writeRequests.isCurrent(request)) return
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setStartingId((current) => (current === event.id ? null : current))
    }
  }

  return (
    <main className="issue-picker">
      <div className="issue-picker__header">
        {onBack && <button type="button" className="btn btn--ghost btn--small" onClick={onBack}>← Back</button>}
        <h2 className="issue-picker__title">Episodes</h2>
      </div>
      <p className="issue-picker__lead">
        Compass newsletters, newest first. Logbook state is on the row.
      </p>

      {(loading || !statusesLoaded) && <p className="issue-picker__loading">Loading…</p>}
      {error && <p className="issue-picker__error">Error: {error}</p>}
      {!loading && !error && issues.length === 0 && (
        <p className="issue-picker__empty">No Compass newsletters on these relays.</p>
      )}
      {startError && <p className="issue-picker__error">{startError}</p>}

      {statusesLoaded && issues.length > 0 && (
        <ul className="issue-picker__list">
          {issues.map((ev) => {
            const num = extractIssueNumber(ev)
            const status = isNewsletterAddress(ev) ? statuses.get(num) : undefined
            const row = indexRow(ev, status, {
              showUnpublished,
              producer: Boolean(producer),
            })
            const title = ev.tags.find((t) => t[0] === 'title')?.[1] ?? `Issue ${num}`
            const date = new Date(ev.created_at * 1000)
            const when = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
            const articleUrl = compassArticleUrl(ev, articleLinks)
            const isCurrent = row.canOpenEpisode && num === currentIssueNumber
            const busy = startingId !== null
            return (
              <li
                key={ev.id}
                className={`issue-picker__item issue-picker__item--${row.state}${isCurrent ? ' issue-picker__item--current' : ''}`}
              >
                <div className="issue-picker__item-copy">
                  <span className="issue-picker__item-title">{title}</span>
                  <span className="issue-picker__date">{when}</span>
                </div>
                <span className={`issue-picker__status issue-picker__status--${row.state}`}>
                  {row.label}
                </span>
                <div className="issue-picker__actions">
                  {row.canOpenEpisode && (
                    <a className="btn btn--small" href={routeHash({ kind: 'episode', issueNumber: num })}>
                      View
                    </a>
                  )}
                  {row.episodeDisabled && (
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled
                      title={row.state === 'archive'
                        ? 'Logbook episodes start 1 August 2026'
                        : row.state === 'none'
                          ? 'No episode has been started'
                          : 'Still being made'}
                    >
                      View
                    </button>
                  )}
                  {row.canStartDraft && (
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() => { void startDraft(ev) }}
                    >
                      {startingId === ev.id ? 'Starting…' : 'Start podcast draft'}
                    </button>
                  )}
                  {articleUrl && (
                    <a
                      className="issue-picker__offsite"
                      href={articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open article on nostrcompass.org (opens in a new tab)"
                    >
                      Open article
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

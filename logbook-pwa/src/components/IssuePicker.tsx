/**
 * IssuePicker — menu of all Compass issues from relays.
 *
 * Lists every kind 30023 issue from the Compass pubkey (not just ones with
 * manifests), newest first, with the current one highlighted. Tapping loads
 * that issue's timeline.
 */

import { useState, useEffect } from 'react'
import { fetchAllIssues, extractIssueNumber } from '../lib/compass'
import type { NostrEvent } from '../types/nostr'

interface Props {
  currentIssueNumber: number | null
  onSelect: (event: NostrEvent) => void
  onBack: () => void
}

export default function IssuePicker({ currentIssueNumber, onSelect, onBack }: Props) {
  const [issues, setIssues] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllIssues()
      .then(setIssues)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="issue-picker">
      <div className="issue-picker__header">
        <button className="btn btn--ghost btn--small" onClick={onBack}>← Back</button>
        <h2 className="issue-picker__title">Episodes</h2>
      </div>

      {loading && <p className="issue-picker__loading">Loading…</p>}
      {error && <p className="issue-picker__error">Error: {error}</p>}
      {!loading && !error && issues.length === 0 && (
        <p className="issue-picker__empty">No issues found on relays.</p>
      )}

      <ul className="issue-picker__list">
        {issues.map((ev) => {
          const num = extractIssueNumber(ev)
          const title = ev.tags.find((t) => t[0] === 'title')?.[1] ?? `Issue ${num}`
          const date = new Date(ev.created_at * 1000)
          const label = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
          const isCurrent = num === currentIssueNumber
          return (
            <li key={ev.id}>
              <button
                className={`issue-picker__item ${isCurrent ? 'issue-picker__item--current' : ''}`}
                onClick={() => onSelect(ev)}
              >
                <span className="issue-picker__num">#{num}</span>
                <span className="issue-picker__item-title">{title}</span>
                <span className="issue-picker__date">{label}</span>
                {isCurrent && <span className="issue-picker__badge">current</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

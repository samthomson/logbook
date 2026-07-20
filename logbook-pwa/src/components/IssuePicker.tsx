/**
 * IssuePicker — lists available Compass issues sorted by date.
 * Fetches kind 34200 manifests (always pins authors:[COMPASS_PUBKEY]).
 */

import { useState, useEffect } from 'react'
import { fetchAllManifests } from '../lib/manifest'
import type { IssueManifest } from '../types/nostr'

interface Props {
  onSelect: (manifest: IssueManifest) => void
  onBack: () => void
}

export default function IssuePicker({ onSelect, onBack }: Props) {
  const [manifests, setManifests] = useState<IssueManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllManifests()
      .then(setManifests)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="issue-picker">
      <div className="issue-picker__header">
        <button className="btn btn--ghost btn--small" onClick={onBack}>← Back</button>
        <h2 className="issue-picker__title">Episodes</h2>
      </div>

      {loading && <p className="issue-picker__loading">Loading episodes…</p>}
      {error && <p className="issue-picker__error">Error: {error}</p>}

      {!loading && !error && manifests.length === 0 && (
        <p className="issue-picker__empty">No episodes found.</p>
      )}

      <ul className="issue-picker__list">
        {manifests.map((m) => {
          const date = new Date(m.event.created_at * 1000)
          const label = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
          const statusClass = `issue-picker__status issue-picker__status--${m.content.episodeStatus}`
          return (
            <li key={m.issueId} className="issue-picker__item">
              <button
                className="issue-picker__btn"
                onClick={() => onSelect(m)}
              >
                <div className="issue-picker__item-info">
                  <span className="issue-picker__item-id">{m.issueId}</span>
                  <span className="issue-picker__item-date">{label}</span>
                </div>
                <span className={statusClass}>{m.content.episodeStatus}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </main>
  )
}

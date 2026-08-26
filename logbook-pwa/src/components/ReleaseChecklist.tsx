import type { ChecklistRow } from '../lib/release-checklist'

interface ReleaseChecklistProps {
  rows: ChecklistRow[]
  saving: boolean
  onLock: () => void
  onRetry: () => void
  onScrollToSegment?: (segmentId: string) => void
}

const STATE_LABEL: Record<ChecklistRow['state'], string> = {
  waiting: 'Waiting',
  ready: 'Ready',
  happening: 'In progress',
  done: 'Done',
  failed: 'Failed',
}

function openLabel(id: ChecklistRow['id']): string {
  if (id === 'audio') return 'Open the audio'
  if (id === 'chapters') return 'Open the chapters'
  if (id === 'feed') return 'Open the feed'
  return 'Open'
}

export default function ReleaseChecklist({
  rows,
  saving,
  onLock,
  onRetry,
  onScrollToSegment,
}: ReleaseChecklistProps) {
  return (
    <ol className="produce__checklist">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`produce__check produce__check--${row.state}`}
        >
          <div className="produce__check-text">
            <span className="produce__check-state">{STATE_LABEL[row.state]}</span>
            <span className="produce__check-label">{row.label}</span>
            {row.detail && <span className="produce__check-detail">{row.detail}</span>}
          </div>
          <div className="produce__check-actions">
            {row.href && (
              <a className="btn" href={row.href} target="_blank" rel="noreferrer">
                {openLabel(row.id)}
              </a>
            )}
            {row.scrollToSegmentId && onScrollToSegment && (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => onScrollToSegment(row.scrollToSegmentId!)}
              >
                Scroll to that voice note
              </button>
            )}
            {row.action === 'lock' && (
              <button
                type="button"
                className={`btn ${row.primary ? 'btn--primary' : ''}`}
                disabled={row.state !== 'ready' || saving}
                onClick={onLock}
              >
                Publish episode
              </button>
            )}
            {row.action === 'retry' && (
              <button
                type="button"
                className={`btn ${row.primary ? 'btn--primary' : ''}`}
                disabled={saving}
                onClick={onRetry}
              >
                Try again
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

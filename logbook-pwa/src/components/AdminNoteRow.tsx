import { useState, type CSSProperties } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { WorkspaceRow } from '../lib/admin-workspace'
import type { Profile } from '../lib/profiles'

export interface AdminNoteRowProps {
  row: WorkspaceRow
  profile?: Profile | null
  transcript?: string
  editable: boolean
  sortable: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onInclude: () => void
  onExclude: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function AdminNoteRow({
  row,
  profile,
  transcript,
  editable,
  sortable,
  canMoveUp,
  canMoveDown,
  onInclude,
  onExclude,
  onMoveUp,
  onMoveDown,
}: AdminNoteRowProps) {
  const [open, setOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.segmentId,
    disabled: !sortable,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
  }
  const author = row.segment?.event.pubkey
  const authorName = profile?.name ?? (author ? `${author.slice(0, 10)}…` : 'Unavailable recording')
  const authorInitial = authorName.trim().charAt(0).toUpperCase() || '?'

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`episode-note episode-note--${row.state}${row.unavailable ? ' episode-note--missing' : ''}`}
      data-segment-id={row.segmentId}
    >
      <div className="episode-note__line">
        <button
          type="button"
          className="episode-note__drag"
          aria-label={`Reorder recording by ${authorName}`}
          disabled={!sortable}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          className="episode-note__summary"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Listen to'} recording by ${authorName} and ${open ? 'hide' : 'view'} transcript`}
        >
          <span className="episode-note__avatar" aria-hidden="true">
            {profile?.picture ? <img src={profile.picture} alt="" /> : authorInitial}
          </span>
          <span className="episode-note__identity">
            <span className="episode-note__author">{authorName}</span>
            <span className="episode-note__meta">
              {row.segment ? `${row.segment.audio.duration.toFixed(1)} sec` : 'Recording unavailable'}
            </span>
          </span>
          <span className="episode-note__badges">
            {row.isIntro && <span className="episode-badge">intro</span>}
            {row.isNew && <span className="episode-badge episode-badge--new">new</span>}
            {row.problem && <span className="episode-badge episode-badge--warning">issue</span>}
          </span>
          <span className="episode-note__chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
      </div>
      {open && (
        <div className="episode-note__details">
          <div className="episode-note__player">
            <span>Voice message from {authorName}</span>
            {row.segment ? (
              <audio controls preload="metadata" src={row.segment.audio.url} />
            ) : (
              <p className="episode-note__empty">Event {row.segmentId.slice(0, 12)}… is referenced but unavailable.</p>
            )}
          </div>
          <div>
            <span className="episode-note__detail-label">Transcript</span>
            <div className="episode-note__transcript">
              {transcript ?? 'No trusted transcript published for this recording.'}
            </div>
          </div>
          {editable && (
            <div className="episode-note__controls">
              {sortable && (
                <div className="episode-note__move" aria-label="Recording position">
                  <span>Position</span>
                  <button type="button" className="btn btn--ghost btn--small" disabled={!canMoveUp} onClick={onMoveUp}>Move up</button>
                  <button type="button" className="btn btn--ghost btn--small" disabled={!canMoveDown} onClick={onMoveDown}>Move down</button>
                </div>
              )}
              {row.state === 'inventory' ? (
                <button type="button" className="btn btn--small" onClick={onInclude}>Add recording</button>
              ) : (
                <button type="button" className="btn btn--ghost btn--small" onClick={onExclude}>
                  {row.state === 'excluded' ? 'Restore recording' : 'Remove recording'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

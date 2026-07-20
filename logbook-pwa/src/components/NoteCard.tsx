/**
 * NoteCard — single segment card in the timeline.
 * Shows contributor pubkey, waveform thumbnail, duration, timestamp, reply chip.
 * Expands inline to play on tap.
 */

import { useState } from 'react'
import AudioPlayer from './AudioPlayer'
import type { Segment } from '../types/nostr'
import { formatDuration } from '../lib/utils'

interface Props {
  segment: Segment
  onReply?: (segment: Segment) => void
  onScrollToParent?: (eventId: string) => void
  isWhitelisted?: boolean
  highlightId?: string
}

export default function NoteCard({
  segment,
  onReply,
  onScrollToParent,
  isWhitelisted,
  highlightId,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  const { event, audio, isIntro, respondingTo } = segment
  const pubkeyShort = event.pubkey.slice(0, 8) + '…'
  const ts = new Date(event.created_at * 1000)
  const timeLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateLabel = ts.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const isHighlighted = highlightId === event.id

  return (
    <div
      id={`note-${event.id}`}
      className={`note-card ${isIntro ? 'note-card--intro' : ''} ${isHighlighted ? 'note-card--highlighted' : ''}`}
    >
      <div className="note-card__header">
        <div className="note-card__avatar" aria-hidden="true">
          {event.pubkey.slice(0, 2).toUpperCase()}
        </div>
        <div className="note-card__meta">
          <span className="note-card__pubkey">{isIntro ? 'AI Intro' : pubkeyShort}</span>
          <span className="note-card__time">{dateLabel} {timeLabel}</span>
        </div>
        <span className="note-card__duration">{formatDuration(audio.duration)}</span>
      </div>

      {respondingTo && (
        <button
          className="note-card__reply-chip"
          onClick={() => onScrollToParent?.(respondingTo)}
          aria-label="Jump to parent note"
        >
          ↩ in reply to
        </button>
      )}

      <div
        className="note-card__waveform-tap"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
        aria-label={expanded ? 'Collapse player' : 'Expand player'}
        aria-expanded={expanded}
      >
        <MiniWaveform waveform={audio.waveform} />
        {!expanded && <span className="note-card__play-hint">▶ tap to play</span>}
      </div>

      {expanded && (
        <AudioPlayer
          url={audio.url}
          waveform={audio.waveform}
          duration={audio.duration}
          onEnded={() => setExpanded(false)}
        />
      )}

      {isWhitelisted && onReply && !isIntro && (
        <div className="note-card__footer">
          <button
            className="btn btn--ghost btn--small"
            onClick={() => onReply(segment)}
            aria-label="Reply to this note"
          >
            Reply
          </button>
        </div>
      )}
    </div>
  )
}

function MiniWaveform({ waveform }: { waveform: number[] }) {
  const samples = waveform.length ? waveform : new Array(40).fill(0.3)
  return (
    <div className="mini-waveform" aria-hidden="true">
      {samples.map((v, i) => (
        <div
          key={i}
          className="mini-waveform__bar"
          style={{ height: `${Math.max(4, v * 100)}%` }}
        />
      ))}
    </div>
  )
}

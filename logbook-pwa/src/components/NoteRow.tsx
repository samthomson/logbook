/**
 * NoteRow — slim voice-note row in the timeline.
 *
 * One row per note: play/pause button, scrollable timeline scrubber,
 * duration, reply affordance. Tapping play starts the shared queue;
 * when this note ends the next note in the issue auto-plays.
 */

import { usePlayback } from '../lib/playback'
import type { Segment } from '../types/nostr'
import { formatDuration } from '../lib/utils'
import { useState } from 'react'

interface Props {
  segment: Segment
  onReply?: (segment: Segment) => void
  isWhitelisted?: boolean
  isNew?: boolean
}

export default function NoteRow({ segment, onReply, isWhitelisted, isNew }: Props) {
  const playback = usePlayback()
  const isCurrent = playback.currentId === segment.event.id
  const isPlaying = isCurrent && playback.playing

  // While dragging, the scrub value is local — timeupdate from the element
  // can't fight the user's thumb (review finding 3d).
  const [dragFrac, setDragFrac] = useState<number | null>(null)

  const progress =
    dragFrac ??
    (isCurrent && playback.duration > 0
      ? playback.currentTime / playback.duration
      : 0)

  const timeLabel = isCurrent
    ? `${formatDuration(playback.currentTime)} / ${formatDuration(playback.duration || segment.audio.duration)}`
    : formatDuration(segment.audio.duration)

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const frac = Number(e.target.value)
    setDragFrac(frac)
  }

  const commitScrub = () => {
    if (dragFrac === null) return
    const dur = playback.duration || segment.audio.duration
    if (!isCurrent) playback.play(segment.event.id)
    playback.seek(dragFrac * dur)
    setDragFrac(null)
  }

  const ts = new Date(segment.event.created_at * 1000)
  const dateLabel = ts.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <div
      className={`note-row ${isCurrent ? 'note-row--active' : ''} ${isNew ? 'note-row--new' : ''}`}
      data-note-id={segment.event.id}
    >
      <button
        className="note-row__play"
        onClick={() => playback.toggle(segment.event.id)}
        aria-label={isPlaying ? 'Pause note' : 'Play note'}
      >
        {isCurrent && playback.loading ? (
          <span className="note-row__spinner" aria-hidden="true" />
        ) : isPlaying ? (
          '⏸'
        ) : (
          '▶'
        )}
      </button>

      <div className="note-row__main">
        <div className="note-row__meta">
          <span className="note-row__author" title={segment.event.pubkey}>
            {segment.isIntro ? '🎙 Intro' : segment.event.pubkey.slice(0, 8)}
          </span>
          <span className="note-row__date">{dateLabel}</span>
          {isNew && <span className="note-row__new-badge">new</span>}
        </div>

        <input
          className="note-row__scrub"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress * 1000)}
          onChange={handleScrub}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
          aria-label={`Seek in note by ${segment.event.pubkey.slice(0, 8)}`}
          style={{ ['--progress' as string]: `${progress * 100}%` }}
        />
      </div>

      <span className="note-row__time">{timeLabel}</span>

      {isWhitelisted && onReply && !segment.isIntro && (
        <button
          className="note-row__reply"
          onClick={() => onReply(segment)}
          aria-label="Reply to this note"
          title="Reply"
        >
          ↩
        </button>
      )}
    </div>
  )
}

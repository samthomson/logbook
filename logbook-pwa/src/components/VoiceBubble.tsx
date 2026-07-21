/**
 * VoiceBubble — Telegram-style voice note bubble.
 *
 * One bubble per note: author avatar (kind 0 picture or initials), play/pause
 * button, progress track, time remaining, reply affordance. Own notes align
 * right (accent bubble), others left (surface bubble).
 */

import { usePlayback } from '../lib/playback'
import type { Segment } from '../types/nostr'
import type { Profile } from '../lib/profiles'
import { formatDuration, clamp } from '../lib/utils'
import { useState } from 'react'

interface Props {
  segment: Segment
  profile?: Profile
  onReply?: (segment: Segment) => void
  isWhitelisted?: boolean
  isNew?: boolean
  isOwn?: boolean
  justPublished?: boolean
}

export default function VoiceBubble({
  segment,
  profile,
  onReply,
  isWhitelisted,
  isNew,
  isOwn,
  justPublished,
}: Props) {
  const playback = usePlayback()
  const isCurrent = playback.currentId === segment.event.id
  const isPlaying = isCurrent && playback.playing
  const [dragFrac, setDragFrac] = useState<number | null>(null)

  const total = segment.audio.duration
  const elapsed = isCurrent ? playback.currentTime : 0
  const remaining = isCurrent ? Math.max(0, total - elapsed) : total
  const progress =
    dragFrac ?? (isCurrent && total > 0 ? clamp(elapsed / total, 0, 1) : 0)

  const commitScrub = () => {
    if (dragFrac === null) return
    if (!isCurrent) playback.play(segment.event.id)
    playback.seek(dragFrac * total)
    setDragFrac(null)
  }

  const name = profile?.name ?? segment.event.pubkey.slice(0, 8)
  const initial = (profile?.name ?? segment.event.pubkey).slice(0, 2).toUpperCase()

  return (
    <div className={`bubble ${isOwn ? 'bubble--own' : ''} ${isNew ? 'bubble--new' : ''}`}>
      <div className="bubble__avatar" aria-hidden="true">
        {profile?.picture ? (
          <img src={profile.picture} alt="" loading="lazy" />
        ) : (
          <span>{initial}</span>
        )}
      </div>

      <div className="bubble__body">
        <div className="bubble__meta">
          <span className="bubble__author">{name}</span>
          {isNew && <span className="bubble__new">new</span>}
          {justPublished && <span className="bubble__published" title="Published">✓</span>}
        </div>

        <div className="bubble__player">
          <button
            className="bubble__play"
            onClick={() => playback.toggle(segment.event.id)}
            aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
          >
            {isCurrent && playback.loading ? (
              <span className="note-row__spinner" aria-hidden="true" />
            ) : isPlaying ? (
              '⏸'
            ) : (
              '▶'
            )}
          </button>

          <input
            className="bubble__scrub"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(progress * 1000)}
            onChange={(e) => setDragFrac(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label={`Seek in voice note from ${name}`}
            style={{ ['--progress' as string]: `${progress * 100}%` }}
          />

          <span className="bubble__time">-{formatDuration(remaining)}</span>

          {isWhitelisted && onReply && !segment.isIntro && (
            <button
              className="bubble__reply"
              onClick={() => onReply(segment)}
              aria-label="Reply to this voice note"
              title="Reply"
            >
              ↩
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

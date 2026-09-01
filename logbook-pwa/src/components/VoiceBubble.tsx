/**
 * VoiceBubble — one voice note: author, play, length, and (for a contributor)
 * an audio-reply control. Replies indent under the note they answer.
 */

import { nip19 } from 'nostr-tools'
import { TranscriptCard } from './TranscriptCard'
import { usePlayback } from '../lib/playback'
import type { Segment, TranscriptChunk } from '../types/nostr'
import { avatarInitials, avatarStyle } from '../lib/avatar'
import { authorLabel, type Profile } from '../lib/profiles'
import { formatDuration, clamp } from '../lib/utils'
import { useState } from 'react'

/** Producer controls for this note, absent for everyone else. */
export interface BubbleCutControls {
  inCut: boolean
  reviewed: boolean
  eligible: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggleInCut: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleReviewed: () => void
}

/** Producer-only: ask the worker to produce or redo this note's transcript. */
export interface BubbleTranscribeControl {
  /** A request newer than the transcript is already in flight on the worker. */
  requested: boolean
  busy: boolean
  error?: string
  onRetranscribe: () => void
}

interface Props {
  segment: Segment
  profile?: Profile
  parentName?: string | null
  transcript?: string
  transcriptChunks?: TranscriptChunk[]
  isNew?: boolean
  isOwn?: boolean
  justPublished?: boolean
  /** Why this particular note stopped the episode being made. */
  problem?: string
  onAudioReply?: (segment: Segment) => void
  cut?: BubbleCutControls
  transcribe?: BubbleTranscribeControl
}

export default function VoiceBubble({
  segment,
  profile,
  parentName,
  transcript,
  transcriptChunks,
  isNew,
  isOwn,
  justPublished,
  problem,
  onAudioReply,
  cut,
  transcribe,
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

  const name = authorLabel(profile, segment.event.pubkey)
  const initials = avatarInitials(profile?.name, segment.event.pubkey)
  const avatarColors = avatarStyle(segment.event.pubkey)
  const npub = profile?.name?.trim() ? nip19.npubEncode(segment.event.pubkey) : null

  // The worker transcribes every upload automatically; only while that is
  // still plausibly in flight do we say so instead of "No transcript."
  const transcribingNow =
    !transcript && Date.now() / 1000 - segment.event.created_at < 5 * 60

  return (
    <div
      id={`voice-note-${segment.event.id}`}
      className={`bubble ${isOwn ? 'bubble--own' : ''} ${isNew ? 'bubble--new' : ''} ${cut && !cut.inCut ? 'bubble--out' : ''}`}
    >
      <div className="bubble__body">
        <div className="bubble__head">
          <div className="bubble__avatar" style={avatarColors} aria-hidden="true">
            {profile?.picture ? (
              <img src={profile.picture} alt="" loading="lazy" />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className="bubble__who">
            <span className="bubble__author">{name}</span>
            {npub && <span className="bubble__npub" title={npub}>{npub}</span>}
          </div>
          {isNew && <span className="bubble__new">new</span>}
          {justPublished && <span className="bubble__published" title="Published">✓</span>}
        </div>

        {segment.respondingTo && (
          <button
            type="button"
            className="bubble__reply-of"
            onClick={() => document
              .getElementById(`voice-note-${segment.respondingTo}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            Audio reply to {parentName ?? 'a voice note'}
          </button>
        )}

        <div className="bubble__player">
          <button
            className="bubble__play"
            onClick={() => playback.toggle(segment.event.id)}
            aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
          >
            {isCurrent && playback.loading ? (
              <span className="note-row__spinner" aria-hidden="true" />
            ) : isPlaying ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
              </svg>
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

          <span className="bubble__time">
            {isCurrent ? `-${formatDuration(remaining)}` : formatDuration(total)}
          </span>

          {onAudioReply && !segment.isIntro && (
            <button
              type="button"
              className="bubble__reply"
              onClick={() => onAudioReply(segment)}
              title="Record a voice note that answers this one"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5.4-3a5.4 5.4 0 0 1-10.8 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-1.6Z" />
              </svg>
              Audio reply
            </button>
          )}
        </div>

        {problem && (
          <p className="bubble__problem" role="alert">{problem}</p>
        )}
        <section className="transcript-box">
          {transcript ? (
            <TranscriptCard
              text={transcript}
              chunks={transcriptChunks}
              currentTime={isCurrent ? elapsed : 0}
              onChunkClick={(seconds) => {
                if (!isCurrent) playback.play(segment.event.id)
                playback.seek(seconds)
              }}
            />
          ) : transcribingNow ? (
            <p className="transcript-box__pending" role="status">
              <span className="spinner spinner--xs" aria-hidden="true" />
              Transcribing — the text appears here in about a minute.
            </p>
          ) : (
            <p className="transcript-box__pending">No transcript.</p>
          )}

            {transcribe && (
              <div className="bubble__transcribe">
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  disabled={transcribe.requested || transcribe.busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={transcribe.onRetranscribe}
                >
                  {transcript ? 'Transcribe again' : 'Transcribe'}
                </button>
                {transcribe.requested && !transcribe.busy && (
                  <span className="bubble__transcribe-note" role="status">
                    <span className="spinner spinner--xs" aria-hidden="true" />
                    Transcribing — the new text appears here in about a minute.
                  </span>
                )}
                {transcribe.error && (
                  <span className="bubble__transcribe-note" role="alert">{transcribe.error}</span>
                )}
              </div>
            )}
        </section>

        {cut && (
          <div className="bubble__cut">
            <label
              className="bubble__cut-check"
              title={cut.eligible && !cut.inCut ? 'Click to include' : undefined}
            >
              <input
                type="checkbox"
                checked={cut.inCut}
                disabled={!cut.eligible}
                onMouseDown={(event) => event.preventDefault()}
                onChange={cut.onToggleInCut}
              />
              <span>
                Included
                {cut.eligible && !cut.inCut ? ' (click to include)' : ''}
              </span>
            </label>

            {cut.inCut && (
              <>
                <div className="bubble__cut-group" role="group" aria-label="Order inside this chapter">
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    disabled={!cut.canMoveUp}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cut.onMoveUp}
                  >
                    <span aria-hidden="true">↑</span> Earlier
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    disabled={!cut.canMoveDown}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cut.onMoveDown}
                  >
                    <span aria-hidden="true">↓</span> Later
                  </button>
                </div>

                <label
                  className="bubble__cut-check"
                  title="Your own mark that you have listened to this one. It changes nothing in the audio."
                >
                  <input
                    type="checkbox"
                    checked={cut.reviewed}
                    onMouseDown={(event) => event.preventDefault()}
                    onChange={cut.onToggleReviewed}
                  />
                  <span>Reviewed</span>
                </label>
              </>
            )}

            {!cut.eligible && (
              <span className="bubble__cut-note">Author is not on the contributor list.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

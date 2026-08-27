import { useEffect, useRef, useState } from 'react'
import { usePlayback } from '../lib/playback'
import { clamp, formatDuration } from '../lib/utils'
import { RERUN_LABEL, type ChecklistRow, type InspectTarget } from '../lib/release-checklist'
import type { ReleaseStep } from '../types/nostr'

interface ReleaseChecklistProps {
  rows: ChecklistRow[]
  saving: boolean
  onLock: () => void
  onRetry: () => void
  onReopen?: () => void
  onRerun?: (from: ReleaseStep) => void
  onInspect?: (target: InspectTarget) => void
  onScrollToSegment?: (segmentId: string) => void
}

const STATE_LABEL: Record<ChecklistRow['state'], string> = {
  waiting: 'Waiting',
  ready: 'Ready',
  happening: 'In progress',
  queued: 'Queued',
  locked: 'Locked',
  done: 'Done',
  failed: 'Failed',
}

function inspectLabel(id: InspectTarget): string {
  if (id === 'lock') return 'View the cut'
  if (id === 'podstr') return 'View the listing'
  return 'View the note'
}

interface ChapterEntry {
  startTime: number
  title: string
}

function ChapterList({ src }: { src: string }) {
  const [chapters, setChapters] = useState<ChapterEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then((data: { chapters?: ChapterEntry[] }) => {
        if (!alive || !Array.isArray(data.chapters)) return
        setChapters(data.chapters.filter((item) => typeof item.title === 'string'))
      })
      .catch(() => {
        if (alive) setChapters(null)
      })
    return () => { alive = false }
  }, [src])

  if (!chapters?.length) return null
  return (
    <ol className="produce__chapters">
      {chapters.map((chapter, index) => (
        <li key={`${chapter.startTime}:${chapter.title}:${index}`}>
          <span className="produce__chapter-time">
            {formatDuration(chapter.startTime / 1000)}
          </span>
          {chapter.title}
        </li>
      ))}
    </ol>
  )
}

function FinishedEpisodeAudio({ src }: { src: string }) {
  const notes = usePlayback()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [dragFrac, setDragFrac] = useState<number | null>(null)

  useEffect(() => {
    const el = new Audio()
    el.preload = 'metadata'
    el.src = src
    audioRef.current = el
    const onTime = () => setCurrentTime(el.currentTime)
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    return () => {
      el.pause()
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      audioRef.current = null
    }
  }, [src])

  useEffect(() => {
    if (notes.playing && notes.currentId) audioRef.current?.pause()
  }, [notes.playing, notes.currentId])

  const total = duration
  const remaining = Math.max(0, total - currentTime)
  const progress = dragFrac ?? (total > 0 ? clamp(currentTime / total, 0, 1) : 0)

  const commitScrub = () => {
    if (dragFrac === null) return
    const el = audioRef.current
    if (el) el.currentTime = dragFrac * (Number.isFinite(el.duration) ? el.duration : total)
    setDragFrac(null)
  }

  return (
    <div className="bubble__player produce__episode-player">
      <button
        type="button"
        className="bubble__play"
        onClick={() => {
          const el = audioRef.current
          if (!el) return
          if (el.paused) {
            notes.pause()
            void el.play()
          } else {
            el.pause()
          }
        }}
        aria-label={playing ? 'Pause episode audio' : 'Play episode audio'}
      >
        {playing ? (
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
        onChange={(e) => setDragFrac(Number(e.target.value) / 1000)}
        onPointerUp={commitScrub}
        onKeyUp={commitScrub}
        onBlur={commitScrub}
        aria-label="Seek in episode audio"
        style={{ ['--progress' as string]: `${progress * 100}%` }}
      />
      <span className="bubble__time">
        {playing || currentTime > 0 ? `-${formatDuration(remaining)}` : formatDuration(total)}
      </span>
    </div>
  )
}

export default function ReleaseChecklist({
  rows,
  saving,
  onLock,
  onRetry,
  onReopen,
  onRerun,
  onInspect,
  onScrollToSegment,
}: ReleaseChecklistProps) {
  const stopped = rows.some((row) => row.state === 'failed')
  const busy = !stopped && rows.some((row) => (
    row.state === 'locked' || row.state === 'happening' || row.state === 'queued'
  ))
  return (
    <ol className={`produce__checklist${stopped ? ' produce__checklist--stopped' : busy ? ' produce__checklist--busy' : ''}`}>
      {rows.map((row) => (
        <li
          key={row.id}
          className={`produce__check produce__check--${row.state}`}
          aria-current={row.state === 'happening' ? 'step' : undefined}
          aria-busy={row.state === 'happening' || undefined}
        >
          <div className="produce__check-text">
            <span className="produce__check-state">
              {row.state === 'happening' && <span className="spinner spinner--small" aria-hidden="true" />}
              {STATE_LABEL[row.state]}
            </span>
            <span className="produce__check-label">{row.label}</span>
            {row.detail && <span className="produce__check-detail">{row.detail}</span>}
            {row.id === 'audio' && row.href && <FinishedEpisodeAudio src={row.href} />}
            {row.chaptersUrl && <ChapterList src={row.chaptersUrl} />}
          </div>
          <div className="produce__check-actions">
            {row.href && row.id === 'feed' && (
              <a
                className="btn"
                href={row.href}
                target="_blank"
                rel="noreferrer"
                onMouseDown={(event) => event.preventDefault()}
              >
                Open the feed
              </a>
            )}
            {row.inspect && onInspect && (
              <button
                type="button"
                className="btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInspect(row.inspect!)}
              >
                {inspectLabel(row.inspect)}
              </button>
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
                onMouseDown={(event) => event.preventDefault()}
                onClick={onLock}
              >
                Publish episode
              </button>
            )}
            {row.action === 'reopen' && onReopen && (
              <button
                type="button"
                className="btn"
                disabled={saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onReopen}
              >
                Edit the cut
              </button>
            )}
            {row.action === 'rerun' && row.rerunFrom && onRerun && (
              <button
                type="button"
                className="btn"
                disabled={saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRerun(row.rerunFrom!)}
              >
                {RERUN_LABEL[row.rerunFrom]}
              </button>
            )}
            {row.action === 'retry' && (
              <button
                type="button"
                className={`btn ${row.primary ? 'btn--primary' : ''}`}
                disabled={saving}
                onMouseDown={(event) => event.preventDefault()}
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

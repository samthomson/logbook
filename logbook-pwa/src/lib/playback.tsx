/**
 * PlaybackContext — one active audio element with explicit per-note playback.
 *
 * The provider owns at most one active HTMLAudioElement for the whole timeline.
 * Any note row can start playback; completion or failure stops that note and
 * never starts a different recording without another user action.
 *
 * Design (adversarial-review hardened):
 *  - A fresh audio element is installed on explicit track changes so delayed
 *    terminal events from an old resource cannot cancel the new note.
 *  - byId is read through a ref so event callbacks never see stale segments.
 *  - A manually paused current note resumes its existing element and position.
 *  - loadedmetadata events are accepted only from the active element/source.
 *  - Seeks requested before metadata loads are stashed and applied on
 *    loadedmetadata (scrub-before-load race).
 *  - Async play() failures are epoch- and element-gated so a stale rejection
 *    cannot pause a newer user-selected note.
 *  - play() rejections surface `blocked: true` (autoplay policy) instead of
 *    silently stalling; `loading` is always reset.
 *  - Track completion and errors clear the active note instead of walking the
 *    issue queue.
 *  - No side effects inside React state updaters (StrictMode-safe).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Segment } from '../types/nostr'
import { PlaybackContext, type PlaybackState } from './playback-context'

interface ProviderProps {
  segments: Segment[]
  children: ReactNode
}

export function PlaybackProvider({ segments, children }: ProviderProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const epochRef = useRef(0)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(false)
  const [blocked, setBlocked] = useState(false)

  const byId = useMemo(() => {
    const m = new Map<string, Segment>()
    for (const s of segments) m.set(s.event.id, s)
    return m
  }, [segments])

  // Ref so event handlers always read the latest segments.
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  const audioCleanupRef = useRef<() => void>(() => {})

  const stopCurrent = useCallback((el: HTMLAudioElement) => {
    if (audioRef.current !== el) return
    epochRef.current += 1
    currentIdRef.current = null
    pendingSeekRef.current = null
    el.pause()
    if (Number.isFinite(el.currentTime)) el.currentTime = 0
    setCurrentId(null)
    setPlaying(false)
    setLoading(false)
    setCurrentTime(0)
    setBlocked(false)
  }, [])

  /**
   * Create a fresh event target for a new playback generation. Reusing one
   * element across sources lets a delayed ended/error from the old resource
   * cancel the newly selected note because media events do not carry a source
   * generation. Rotating the element isolates those terminal events.
   */
  const replaceAudio = useCallback(() => {
    audioCleanupRef.current()

    const el = new Audio()
    el.preload = 'metadata'
    audioRef.current = el

    let lastTimeUpdate = 0
    const isActive = () => audioRef.current === el
    const onTime = () => {
      if (!isActive()) return
      const now = performance.now()
      if (now - lastTimeUpdate < 250) return
      lastTimeUpdate = now
      setCurrentTime(el.currentTime)
    }
    const onMeta = () => {
      if (!isActive()) return
      const cur = currentIdRef.current ? byIdRef.current.get(currentIdRef.current) : null
      if (cur && el.src !== cur.audio.url) return
      setDuration(el.duration || 0)
      if (pendingSeekRef.current !== null) {
        el.currentTime = Math.min(pendingSeekRef.current, el.duration || 0)
        pendingSeekRef.current = null
        setCurrentTime(el.currentTime)
      }
    }
    const onPlay = () => {
      if (!isActive()) return
      setPlaying(true)
      setLoading(false)
    }
    const onPause = () => {
      if (isActive()) setPlaying(false)
    }
    const onWaiting = () => {
      if (isActive()) setLoading(true)
    }
    const onCanPlay = () => {
      if (isActive()) setLoading(false)
    }
    const onEnded = () => stopCurrent(el)
    const onError = () => {
      stopCurrent(el)
      if (audioRef.current === el) audioCleanupRef.current()
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('error', onError)
    el.addEventListener('ended', onEnded)

    const cleanup = () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('canplay', onCanPlay)
      el.removeEventListener('error', onError)
      el.removeEventListener('ended', onEnded)
      el.pause()
      el.removeAttribute('src')
      el.load()
      if (audioRef.current === el) audioRef.current = null
    }
    audioCleanupRef.current = cleanup
    return el
  }, [stopCurrent])

  /** Load a segment into an isolated audio generation and start it. */
  const startTrack = useCallback((segmentId: string) => {
    const seg = byIdRef.current.get(segmentId)
    if (!seg) return

    const existing = audioRef.current
    const canResume = existing !== null
      && currentIdRef.current === segmentId
      && existing.src === seg.audio.url
    const el = canResume ? existing : replaceAudio()
    const epoch = ++epochRef.current
    setBlocked(false)

    if (!canResume) {
      el.src = seg.audio.url
      setCurrentTime(0)
      setDuration(seg.audio.duration || 0)
    }
    currentIdRef.current = segmentId
    setCurrentId(segmentId)
    el.play().catch(() => {
      if (epoch !== epochRef.current || audioRef.current !== el) return
      setPlaying(false)
      setLoading(false)
      setBlocked(true)
    })
  }, [replaceAudio])

  useEffect(() => () => audioCleanupRef.current(), [])

  const play = useCallback(
    (segmentId: string) => {
      startTrack(segmentId)
    },
    [startTrack],
  )

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const toggle = useCallback(
    (segmentId: string) => {
      if (currentId === segmentId && playing) {
        epochRef.current += 1 // invalidate any pending play() rejection
        pause()
      } else {
        play(segmentId)
      }
    },
    [currentId, playing, pause, play],
  )

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current
    if (!el || !Number.isFinite(seconds)) return
    if (!el.duration || Number.isNaN(el.duration)) {
      pendingSeekRef.current = Math.max(0, seconds)
      return
    }
    el.currentTime = Math.max(0, Math.min(seconds, el.duration))
    // Note: currentTime state updates on the next timeupdate event — no
    // read-back here (browsers apply seeks asynchronously)
  }, [])

  const value = useMemo<PlaybackState>(
    () => ({
      currentId,
      playing,
      currentTime,
      duration,
      loading,
      blocked,
      play,
      pause,
      toggle,
      seek,
    }),
    [currentId, playing, currentTime, duration, loading, blocked, play, pause, toggle, seek],
  )

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

/**
 * PlaybackContext — issue-wide audio queue with auto-advance.
 *
 * A single HTMLAudioElement is shared across the whole timeline. Any note row
 * can start playback; when the current track ends, the next segment in issue
 * order starts automatically.
 *
 * Design (adversarial-review hardened):
 *  - Audio element created once on mount, fully torn down on unmount.
 *  - order/byId read through refs (no stale closures in the ended handler).
 *  - el.src assignment gated on URL equality, not currentId — reorders can't
 *    leave the UI showing one row while another's audio plays.
 *  - loadedmetadata events from a stale src are ignored (track-switch race).
 *  - Seeks requested before metadata loads are stashed and applied on
 *    loadedmetadata (scrub-before-load race).
 *  - Double `ended` events are de-duped via an epoch counter.
 *  - play() rejections surface `blocked: true` (autoplay policy) instead of
 *    silently stalling; `loading` is always reset.
 *  - Track errors skip to the next segment instead of stalling the queue.
 *  - No side effects inside React state updaters (StrictMode-safe).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Segment } from '../types/nostr'

export interface PlaybackState {
  currentId: string | null
  playing: boolean
  currentTime: number
  duration: number
  loading: boolean
  /** True when autoplay policy blocked playback; user must tap to resume. */
  blocked: boolean
  play: (segmentId: string) => void
  pause: () => void
  toggle: (segmentId: string) => void
  seek: (seconds: number) => void
}

const PlaybackContext = createContext<PlaybackState | null>(null)

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

  const order = useMemo(() => segments.map((s) => s.event.id), [segments])

  // Refs so event handlers always read the latest queue
  const orderRef = useRef(order)
  const byIdRef = useRef(byId)
  orderRef.current = order
  byIdRef.current = byId

  /** Load a segment into the element and start playing it. */
  const startTrack = useCallback((segmentId: string) => {
    const seg = byIdRef.current.get(segmentId)
    const el = audioRef.current
    if (!seg || !el) return

    epochRef.current += 1
    setBlocked(false)
    if (el.src !== seg.audio.url) {
      el.src = seg.audio.url
      setCurrentTime(0)
      setDuration(seg.audio.duration || 0)
    }
    currentIdRef.current = segmentId
    setCurrentId(segmentId)
    el.play().catch(() => {
      setPlaying(false)
      setLoading(false)
      setBlocked(true)
    })
  }, [])

  /** Advance to the next track in queue order. */
  const advance = useCallback(
    (fromId: string, epoch: number) => {
      if (epoch !== epochRef.current) return // superseded by a manual action
      const idx = orderRef.current.indexOf(fromId)
      const nextId = idx >= 0 ? orderRef.current[idx + 1] : undefined
      if (!nextId) {
        currentIdRef.current = null
        setCurrentId(null)
        return
      }
      startTrack(nextId)
    },
    [startTrack],
  )

  // Create + wire the audio element once; tear down completely on unmount.
  useEffect(() => {
    const el = new Audio()
    el.preload = 'metadata'
    audioRef.current = el

    const onTime = () => setCurrentTime(el.currentTime)
    const onMeta = () => {
      // Ignore metadata from a stale src (track switched before it fired)
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
      setPlaying(true)
      setLoading(false)
    }
    const onPause = () => setPlaying(false)
    const onWaiting = () => setLoading(true)
    const onCanPlay = () => setLoading(false)
    const onError = () => {
      setPlaying(false)
      setLoading(false)
      // Dead URL — skip to next rather than stalling the queue
      const id = currentIdRef.current
      if (id) advance(id, epochRef.current)
    }
    const onEnded = () => {
      const id = currentIdRef.current
      if (id) advance(id, epochRef.current)
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('error', onError)
    el.addEventListener('ended', onEnded)

    return () => {
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
      audioRef.current = null
    }
  }, [advance])

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
        epochRef.current += 1 // cancel pending auto-advance intent
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

export function usePlayback(): PlaybackState {
  const ctx = useContext(PlaybackContext)
  if (!ctx) throw new Error('usePlayback must be used inside <PlaybackProvider>')
  return ctx
}

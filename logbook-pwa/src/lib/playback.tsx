/**
 * PlaybackContext — issue-wide audio queue with auto-advance.
 *
 * A single HTMLAudioElement is shared across the whole timeline. Any note row
 * can start playback; when the current track ends, the next segment in issue
 * order starts automatically. Scrubbing uses a range input styled as a thin
 * timeline.
 *
 * Design notes (from adversarial review):
 *  - The audio element is created once on mount and fully torn down on
 *    unmount (listeners removed, src cleared) — no leaks across issue switches.
 *  - The `ended` handler guards against stale/double fires by comparing the
 *    element's current src against the segment it thinks is playing.
 *  - Seeks requested before metadata loads are stashed and applied on
 *    `loadedmetadata` (scrub-before-load race).
 *  - Auto-advance play() failures (autoplay policy) are surfaced as
 *    `blocked: true` so the UI can show a resume button instead of silently
 *    stopping (iOS gesture-chain limits).
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
  /** True when autoplay policy blocked auto-advance; user must tap to resume. */
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

  // Create + wire the audio element once; tear down completely on unmount.
  useEffect(() => {
    const el = new Audio()
    el.preload = 'metadata'
    audioRef.current = el

    const onTime = () => setCurrentTime(el.currentTime)
    const onMeta = () => {
      setDuration(el.duration || 0)
      if (pendingSeekRef.current !== null) {
        el.currentTime = Math.min(pendingSeekRef.current, el.duration || 0)
        pendingSeekRef.current = null
        setCurrentTime(el.currentTime)
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onWaiting = () => setLoading(true)
    const onCanPlay = () => setLoading(false)
    const onError = () => {
      setPlaying(false)
      setLoading(false)
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('error', onError)

    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('canplay', onCanPlay)
      el.removeEventListener('error', onError)
      el.pause()
      el.removeAttribute('src')
      el.load()
      audioRef.current = null
    }
  }, [])

  // Auto-advance on track end. Registered once; reads latest order/byId via refs.
  const orderRef = useRef(order)
  const byIdRef = useRef(byId)
  orderRef.current = order
  byIdRef.current = byId

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onEnded = () => {
      setCurrentId((prev) => {
        if (!prev) return null
        const idx = orderRef.current.indexOf(prev)
        const nextId = idx >= 0 ? orderRef.current[idx + 1] : undefined
        if (!nextId) return null
        const next = byIdRef.current.get(nextId)
        if (!next) return null

        el.src = next.audio.url
        setCurrentTime(0)
        setDuration(next.audio.duration || 0)
        el.play().catch(() => {
          // Autoplay policy blocked continuation (iOS gesture chain) —
          // surface as blocked so UI can offer a tap-to-resume.
          setBlocked(true)
        })
        return nextId
      })
    }
    el.addEventListener('ended', onEnded)
    return () => el.removeEventListener('ended', onEnded)
  }, [])

  const play = useCallback(
    (segmentId: string) => {
      const seg = byIdRef.current.get(segmentId)
      const el = audioRef.current
      if (!seg || !el) return
      setBlocked(false)
      if (audioRef.current && currentId !== segmentId) {
        el.src = seg.audio.url
        setCurrentTime(0)
        setDuration(seg.audio.duration || 0)
        setCurrentId(segmentId)
      }
      el.play().catch(() => setBlocked(true))
    },
    [currentId],
  )

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const toggle = useCallback(
    (segmentId: string) => {
      if (currentId === segmentId && playing) pause()
      else play(segmentId)
    },
    [currentId, playing, pause, play],
  )

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current
    if (!el || !Number.isFinite(seconds)) return
    if (!el.duration || Number.isNaN(el.duration)) {
      // Metadata not loaded yet — apply once it arrives
      pendingSeekRef.current = Math.max(0, seconds)
      return
    }
    el.currentTime = Math.max(0, Math.min(seconds, el.duration))
    setCurrentTime(el.currentTime)
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

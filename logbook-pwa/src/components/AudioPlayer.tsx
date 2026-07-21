/**
 * AudioPlayer — minimal <audio> wrapper with waveform thumbnail and scrubber.
 * Supports byte-range via native <audio> element.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { formatDuration } from '../lib/utils'

interface Props {
  url: string
  waveform?: number[]   // 0–1 normalised samples
  duration?: number     // seconds (hint before metadata loads)
  autoPlay?: boolean
  onEnded?: () => void
}

export default function AudioPlayer({ url, waveform = [], duration, autoPlay, onEnded }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(duration ?? 0)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (autoPlay) el.play().catch(() => {})
    const onTime = () => setCurrentTime(el.currentTime)
    const onMeta = () => setTotalDuration(el.duration)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnd = () => { setPlaying(false); onEnded?.() }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnd)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnd)
    }
  }, [autoPlay, onEnded])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else el.play().catch(() => {})
  }, [playing])

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current
    if (!el) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrentTime(t)
  }, [])

  const cycleSpeed = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
    el.playbackRate = next
    setSpeed(next)
  }, [speed])

  const progress = totalDuration > 0 ? currentTime / totalDuration : 0

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={url} preload="metadata" />

      {waveform.length > 0 && (
        <WaveformProgress waveform={waveform} progress={progress} />
      )}

      <div className="audio-player__controls">
        <button
          className="audio-player__play-btn"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <input
          className="audio-player__scrubber"
          type="range"
          min={0}
          max={totalDuration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleScrub}
          aria-label="Seek"
        />

        <span className="audio-player__time">
          {formatDuration(currentTime)} / {formatDuration(totalDuration)}
        </span>

        <button
          className="audio-player__speed-btn"
          onClick={cycleSpeed}
          aria-label={`Playback speed: ${speed}x`}
        >
          {speed}x
        </button>
      </div>
    </div>
  )
}

// ─── Waveform progress overlay ────────────────────────────────────────────────

function WaveformProgress({ waveform, progress }: { waveform: number[]; progress: number }) {
  const filled = Math.floor(progress * waveform.length)
  return (
    <div className="audio-player__waveform" aria-hidden="true">
      {waveform.map((v, i) => (
        <div
          key={i}
          className={`audio-player__wf-bar ${i < filled ? 'audio-player__wf-bar--played' : ''}`}
          style={{ height: `${Math.max(4, Math.min(1, Math.max(0, v)) * 100)}%` }}
        />
      ))}
    </div>
  )
}

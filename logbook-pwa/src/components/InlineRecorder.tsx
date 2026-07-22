/**
 * InlineRecorder — Telegram-style inline voice recording.
 *
 * One compact row, three visual states in the SAME space (no boxes, no cards):
 *   idle:      [ ● mic ]                                     (one icon button)
 *   recording: [ ■ stop ] [ live waveform bars ] [ 0:07 ]    (same row height)
 *   done:      (parent swaps this row for the new VoiceBubble)
 *
 * No pitch picker, no trim UI, no review box — keeps the row minimal.
 * onRecorded(blob, waveform, duration) fires when the user stops.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { RECORDING_MIME, RECORDING_MIME_FALLBACK, WAVEFORM_SAMPLES } from '../config'

export interface InlineRecordingResult {
  blob: Blob
  waveform: number[]   // WAVEFORM_SAMPLES values 0–1
  duration: number
}

interface Props {
  onRecorded: (result: InlineRecordingResult) => void
  onCancel?: () => void
  onArm?: () => void   // called when recording actually starts (mic acquired)
  autoStart?: boolean
}

const MAX_RECORDING_SECONDS = 600 // 10 min hard cap

export default function InlineRecorder({ onRecorded, onCancel, onArm, autoStart }: Props) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [bars, setBars] = useState<number[]>(new Array(36).fill(0))
  const [micError, setMicError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const samplesRef = useRef<number[]>([])
  const startRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef = useRef(0)
  const cancelledRef = useRef(false)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    chunksRef.current = []
    samplesRef.current = []
    cancelledRef.current = false
    setElapsed(0)
    setBars(new Array(36).fill(0))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      setMicError('Microphone unavailable — check browser permission and retry.')
      console.error('getUserMedia failed:', err)
      return
    }
    streamRef.current = stream

    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const dest = ctx.createMediaStreamDestination()
    analyser.connect(dest)

    const mime = MediaRecorder.isTypeSupported(RECORDING_MIME)
      ? RECORDING_MIME
      : MediaRecorder.isTypeSupported(RECORDING_MIME_FALLBACK)
        ? RECORDING_MIME_FALLBACK
        : ''
    const mr = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined)
    mrRef.current = mr
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    mr.onstop = () => {
      if (cancelledRef.current) return
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
      const duration = (Date.now() - startRef.current) / 1000
      const waveform = downsample(samplesRef.current, WAVEFORM_SAMPLES)
      onRecorded({ blob, waveform, duration })
    }

    mr.start(100)
    startRef.current = Date.now()
    setRecording(true)
    onArm?.()

    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startRef.current) / 1000)
      setElapsed(secs)
      // Hard cap: auto-stop before chunk memory grows unbounded (desktop tabs
      // recording for many minutes otherwise accumulate giant in-memory blobs)
      if (secs >= MAX_RECORDING_SECONDS) stopRef.current()
    }, 500)

    const data = new Uint8Array(analyser.frequencyBinCount)
    const loop = () => {
      analyser.getByteFrequencyData(data)
      // Emphasize presence: square-root curve boosts low/mid amplitudes so
      // normal speech visibly moves the bars
      const avg = data.reduce((s, v) => s + v, 0) / data.length / 255
      const boosted = Math.min(1, Math.sqrt(avg) * 1.15)
      samplesRef.current.push(boosted)
      setBars((prev) => [...prev.slice(1), boosted])
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [onRecorded])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    const mr = mrRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    setRecording(false)
    cleanup()
  }, [cleanup])

  // Stable ref so the interval callback can trigger auto-stop
  const stopRef = useRef(stop)
  stopRef.current = stop

  const cancel = useCallback(() => {
    cancelledRef.current = true
    const mr = mrRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    setRecording(false)
    cleanup()
    onCancel?.()
  }, [cleanup, onCancel])

  useEffect(() => {
    if (autoStart) void start()
  }, [autoStart, start])

  if (!recording) {
    return (
      <span className="irec__idle">
        <button
          className="irec__btn"
          onClick={() => { setMicError(null); void start() }}
          aria-label="Record a voice note"
          title="Record"
        >
          <span className="irec__dot" aria-hidden="true" />
        </button>
        {micError && <span className="irec__error" role="alert">{micError}</span>}
      </span>
    )
  }

  return (
    <div className="irec irec--live">
      <button className="irec__stop" onClick={stop} aria-label="Stop and keep recording">
        ■
      </button>
      <div className="irec__bars" aria-hidden="true">
        {bars.map((v, i) => (
          <div key={i} className="irec__bar" style={{ height: `${Math.max(6, v * 100)}%` }} />
        ))}
      </div>
      <span className="irec__time">{elapsed}s</span>
      {onCancel && (
        <button className="irec__cancel" onClick={cancel} aria-label="Cancel recording">
          ×
        </button>
      )}
    </div>
  )
}

function downsample(samples: number[], target: number): number[] {
  if (!samples.length) return new Array(target).fill(0)
  if (samples.length <= target) return [...samples, ...new Array(target - samples.length).fill(0)]
  const out: number[] = []
  const step = samples.length / target
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * step)
    const end = Math.floor((i + 1) * step)
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    out.push(sum / (end - start))
  }
  return out
}

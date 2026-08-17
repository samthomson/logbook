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
import { isSilent, recordingPeak } from '../lib/silence'

export interface InlineRecordingResult {
  blob: Blob
  waveform: number[]   // WAVEFORM_SAMPLES values 0–1
  duration: number
}

interface Props {
  onRecorded: (result: InlineRecordingResult) => void
  onCancel?: () => void
  onArm?: () => void   // synchronously claims the shared recorder target
  autoStart?: boolean
  /** Idle-row wording, so a chapter that already has notes says so. */
  idleLabel?: string
}

const MAX_RECORDING_SECONDS = 600 // 10 min hard cap

export default function InlineRecorder({
  onRecorded,
  onCancel,
  onArm,
  autoStart,
  idleLabel = 'Add a voice note',
}: Props) {
  const [recording, setRecording] = useState(false)
  const [arming, setArming] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [bars, setBars] = useState<number[]>(new Array(36).fill(0))
  const [micError, setMicError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [review, setReview] = useState<InlineRecordingResult | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const samplesRef = useRef<number[]>([])
  const startRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef = useRef(0)
  const cancelledRef = useRef(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const activeStartRef = useRef(0)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    void wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  useEffect(() => () => {
    activeStartRef.current += 1
    cancelledRef.current = true
    const recorder = mrRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    cleanup()
  }, [cleanup])

  const start = useCallback(async () => {
    const generation = ++activeStartRef.current
    const isCurrent = () => activeStartRef.current === generation
    setArming(true)
    chunksRef.current = []
    samplesRef.current = []
    cancelledRef.current = false
    setElapsed(0)
    setBars(new Array(36).fill(0))

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen').catch(() => null)
        if (!isCurrent()) { cleanup(); return }
      }

      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      if (!isCurrent()) { cleanup(); return }

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
      if (!isCurrent()) { cleanup(); return }
      mrRef.current = mr
      mr.ondataavailable = (e) => {
        if (isCurrent() && e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        if (!isCurrent() || cancelledRef.current) return
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        const duration = (Date.now() - startRef.current) / 1000
        const waveform = downsample(samplesRef.current, WAVEFORM_SAMPLES)
        setChecking(true)
        void recordingPeak(blob)
          .then((peak) => {
            if (!isCurrent() || cancelledRef.current) return
            if (isSilent(peak)) {
              setMicError('That recording captured no sound. Check which microphone the browser is using, then record again.')
              return
            }
            setReview({ blob, waveform, duration })
          })
          .catch((err: unknown) => {
            if (!isCurrent() || cancelledRef.current) return
            setMicError('That recording could not be read back. Record it again.')
            console.error('Recording playback check failed:', err)
          })
          .finally(() => { if (isCurrent()) setChecking(false) })
      }

      mr.start(100)
      startRef.current = Date.now()
      setRecording(true)
      setArming(false)

      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startRef.current) / 1000)
        setElapsed(secs)
        if (secs >= MAX_RECORDING_SECONDS) stopRef.current()
      }, 500)

      const data = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        if (!isCurrent()) return
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, value) => sum + value, 0) / data.length / 255
        const boosted = Math.min(1, Math.sqrt(avg) * 1.15)
        samplesRef.current.push(boosted)
        setBars((previous) => [...previous.slice(1), boosted])
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      if (!isCurrent()) return
      cleanup()
      setArming(false)
      setRecording(false)
      setMicError('Microphone unavailable — check browser permission and retry.')
      console.error('Recorder setup failed:', err)
      onCancel?.()
    }
  }, [cleanup, onCancel])

  const startSafely = useCallback(() => { void start() }, [start])

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
    setArming(false)
    cleanup()
    onCancel?.()
  }, [cleanup, onCancel])

  useEffect(() => {
    if (autoStart) startSafely()
  }, [autoStart, startSafely])

  if (review) {
    return (
      <div className="irec irec--review" role="status">
        <audio className="irec__preview" controls src={URL.createObjectURL(review.blob)} aria-label="Preview recording" />
        <span className="irec__ready">{Math.ceil(review.duration)}s ready</span>
        <div className="irec__actions">
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => {
              const completed = review
              setReview(null)
              onRecorded(completed)
            }}
          >
            Publish
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setReview(null); startSafely() }}>
            Re-record
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setReview(null); onCancel?.() }}>
            Discard
          </button>
        </div>
      </div>
    )
  }

  if (checking) {
    return <span className="irec__idle" role="status">Checking the recording…</span>
  }

  if (arming) {
    return <span className="irec__idle" role="status">Opening microphone…</span>
  }

  if (!recording) {
    // Reads as one more row in the chapter, so recording looks like part of the
    // list it joins rather than a floating control.
    return (
      <div className="irec__idle">
        <button
          className="irec__add"
          aria-label="Record a voice note"
          onClick={() => {
            // Claim the shared recorder target before getUserMedia awaits, so
            // a second section cannot arm while browser permission is pending.
            onArm?.()
            setMicError(null)
            startSafely()
          }}
        >
          <span className="irec__add-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5.4-3a5.4 5.4 0 0 1-10.8 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-1.6Z" />
            </svg>
          </span>
          <span className="irec__add-label">{idleLabel}</span>
        </button>
        {micError && <span className="irec__error" role="alert">{micError}</span>}
      </div>
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

/**
 * Recorder — MediaRecorder + real-time AnalyserNode waveform + trim UI.
 *
 * States: idle → recording → recorded → trimming → done
 * On completion calls onRecorded(blob, waveformSamples, durationSeconds).
 *
 * Trim re-encodes via a second MediaRecorder pass to preserve WebM/Opus mime type.
 * Wake lock is acquired once on recording start and released on stop.
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { RECORDING_MIME, RECORDING_MIME_FALLBACK, WAVEFORM_SAMPLES } from '../config'
import { VoiceChanger } from '../lib/voiceChanger'

export interface RecordingResult {
  blob: Blob
  waveform: number[]   // WAVEFORM_SAMPLES normalised 0–1 values
  duration: number     // seconds
}

interface Props {
  onRecorded: (result: RecordingResult) => void
  onCancel: () => void
  disabled?: boolean
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'trimming'

// Pitch options: label → factor. Subtle shifts only — large factors sound
// artificial and risk glitching on short notes.
const PITCH_OPTIONS: { label: string; factor: number }[] = [
  { label: 'Normal', factor: 1.0 },
  { label: 'Higher', factor: 1.12 },
  { label: 'Lower', factor: 0.9 },
]

export default function Recorder({ onRecorded, onCancel, disabled }: Props) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [liveBars, setLiveBars] = useState<number[]>(new Array(60).fill(0))
  const [pitchIdx, setPitchIdx] = useState(0)  // index into PITCH_OPTIONS
  const [vcReady, setVcReady] = useState(false)  // true once AudioWorklet is loaded

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(1)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rawBlobRef = useRef<Blob | null>(null)
  const fullWaveformRef = useRef<number[]>([])
  const durationRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const voiceChangerRef = useRef<VoiceChanger | null>(null)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const acquireWakeLock = async () => {
    if (!('wakeLock' in navigator)) return
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
    } catch {
      // Best-effort — ignore
    }
  }

  const releaseWakeLock = () => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      voiceChangerRef.current?.dispose()
      audioCtxRef.current?.close()
      releaseWakeLock()
    }
  }, [])

  const pickMime = (): string => {
    if (MediaRecorder.isTypeSupported(RECORDING_MIME)) return RECORDING_MIME
    if (MediaRecorder.isTypeSupported(RECORDING_MIME_FALLBACK)) return RECORDING_MIME_FALLBACK
    return ''
  }

  const startRecording = useCallback(async () => {
    chunksRef.current = []
    fullWaveformRef.current = []
    setElapsed(0)
    setLiveBars(new Array(60).fill(0))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      alert('Microphone access denied. Please allow microphone access and try again.')
      return
    }
    streamRef.current = stream
    await acquireWakeLock()

    // Web Audio analyser for real-time waveform
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    // Chrome/Safari may start the context suspended even inside a click handler
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(() => {})
    }
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser

    // Load voice changer worklet and insert into graph: source → vc → analyser
    const vc = new VoiceChanger(audioCtx)
    voiceChangerRef.current = vc
    source.connect(vc.input)
    vc.load()
      .then(() => {
        vc.setPitch(PITCH_OPTIONS[pitchIdx]?.factor ?? 1.0)
        setVcReady(true)
      })
      .catch(() => {
        // Worklet unavailable — bypass silently
        setVcReady(false)
      })
    // Analyser reads from vc.output (bypass path works too since vc.output is always connected)
    vc.output.connect(analyser)

    // MediaRecorder captures the processed stream from a MediaStreamDestinationNode
    const dest = audioCtx.createMediaStreamDestination()
    analyser.connect(dest)

    const mime = pickMime()
    const mr = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined)
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    mr.start(100)
    startTimeRef.current = Date.now()
    setState('recording')

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 500)

    // Waveform animation loop
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const drawLoop = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length / 255
      fullWaveformRef.current.push(avg)
      setLiveBars((prev) => [...prev.slice(1), avg])
      animFrameRef.current = requestAnimationFrame(drawLoop)
    }
    animFrameRef.current = requestAnimationFrame(drawLoop)
  }, [])

  const stopRecording = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    releaseWakeLock()

    const mr = mediaRecorderRef.current
    if (!mr) return

    mr.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      voiceChangerRef.current?.dispose()
      voiceChangerRef.current = null
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      setVcReady(false)

      const mime = mr.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: mime })
      rawBlobRef.current = blob
      durationRef.current = (Date.now() - startTimeRef.current) / 1000
      setTrimStart(0)
      setTrimEnd(1)
      setState('recorded')
    }
    mr.stop()
  }, [])

  const handleUseRecording = useCallback(async () => {
    const raw = rawBlobRef.current
    if (!raw) return

    const totalDuration = durationRef.current
    const full = fullWaveformRef.current

    let finalBlob = raw
    let finalDuration = totalDuration
    let finalWaveformSrc = full

    // Trim via OfflineAudioContext + MediaRecorder re-encode to preserve WebM/Opus
    if (trimStart > 0.001 || trimEnd < 0.999) {
      setState('trimming')
      try {
        const arrayBuf = await raw.arrayBuffer()
        const decodeCtx = new AudioContext()
        const audioBuf = await decodeCtx.decodeAudioData(arrayBuf)
        await decodeCtx.close()

        const startSec = trimStart * audioBuf.duration
        const endSec = trimEnd * audioBuf.duration
        const trimmedDuration = endSec - startSec
        const sampleRate = audioBuf.sampleRate
        const offCtx = new OfflineAudioContext(
          audioBuf.numberOfChannels,
          Math.ceil(trimmedDuration * sampleRate),
          sampleRate,
        )
        const bufSrc = offCtx.createBufferSource()
        bufSrc.buffer = audioBuf
        bufSrc.connect(offCtx.destination)
        bufSrc.start(0, startSec, trimmedDuration)
        const trimmedBuf = await offCtx.startRendering()

        // Re-encode via MediaRecorder to keep WebM/Opus mime type
        const reEncoded = await reEncodeAudioBuffer(trimmedBuf, pickMime())
        finalBlob = reEncoded
        finalDuration = trimmedDuration

        const sliceStart = Math.floor(trimStart * full.length)
        const sliceEnd = Math.ceil(trimEnd * full.length)
        finalWaveformSrc = full.slice(sliceStart, sliceEnd)
      } catch (err) {
        console.warn('Trim failed, using full recording:', err)
        setState('recorded')
        return
      }
    }

    const waveform = downsample(finalWaveformSrc, WAVEFORM_SAMPLES)
    onRecorded({ blob: finalBlob, waveform, duration: finalDuration })
  }, [trimStart, trimEnd, onRecorded])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const handlePitchChange = useCallback((idx: number) => {
    setPitchIdx(idx)
    const vc = voiceChangerRef.current
    if (vc?.loaded) vc.setPitch(PITCH_OPTIONS[idx]?.factor ?? 1.0)
  }, [])

  if (state === 'trimming') {
    return (
      <div className="recorder recorder--trimming">
        <p className="recorder__status">Trimming audio…</p>
      </div>
    )
  }

  if (state === 'recorded') {
    const totalSecs = Math.round(durationRef.current)
    const startSec = Math.round(trimStart * totalSecs)
    const endSec = Math.round(trimEnd * totalSecs)
    const wf = fullWaveformRef.current

    return (
      <div className="recorder recorder--review">
        <p className="recorder__label">Review your recording ({formatTime(totalSecs)})</p>

        <WaveformTrimmer
          waveform={wf}
          trimStart={trimStart}
          trimEnd={trimEnd}
          onTrimStart={setTrimStart}
          onTrimEnd={setTrimEnd}
        />

        <p className="recorder__trim-range">
          {formatTime(startSec)} – {formatTime(endSec)}
        </p>

        <ReplayPreview rawBlobRef={rawBlobRef} trimStart={trimStart} trimEnd={trimEnd} />

        <div className="recorder__actions">
          <button className="btn btn--ghost" onClick={() => setState('idle')}>Re-record</button>
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={handleUseRecording}>
            Publish recording
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="recorder">
      {/* Pitch selector — shown in idle and recording states */}
      <div className="recorder__pitch-row" aria-label="Voice pitch">
        {PITCH_OPTIONS.map((opt, i) => (
          <button
            key={opt.label}
            className={`btn btn--ghost btn--small${pitchIdx === i ? ' btn--active' : ''}`}
            onClick={() => handlePitchChange(i)}
            aria-pressed={pitchIdx === i}
            title={vcReady && state === 'recording' ? `Pitch: ${opt.label}` : opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {state === 'recording' && (
        <>
          <div className="recorder__waveform" aria-hidden="true">
            {liveBars.map((v, i) => (
              <div
                key={i}
                className="recorder__bar"
                style={{ height: `${Math.max(4, Math.min(1, v) * 100)}%` }}
              />
            ))}
          </div>
          <p className="recorder__elapsed">{formatTime(elapsed)}</p>
        </>
      )}

      <div className="recorder__actions">
        {state === 'idle' && (
          <>
            <button
              className="btn btn--record"
              onClick={startRecording}
              disabled={disabled}
              aria-label="Start recording"
            >
              &#9679; Record
            </button>
            <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          </>
        )}
        {state === 'recording' && (
          <button
            className="btn btn--stop"
            onClick={stopRecording}
            aria-label="Stop recording"
          >
            &#9632; Stop
          </button>
        )}
      </div>
    </div>
  )
}

// ─── ReplayPreview ────────────────────────────────────────────────────────────

/**
 * Listen back to the recording before publishing — same interaction model as
 * the timeline note rows: round play button + scrollable timeline scrubber.
 * Respects the trim selection: playback starts at trimStart and stops at
 * trimEnd.
 */
function ReplayPreview({
  rawBlobRef,
  trimStart,
  trimEnd,
}: {
  rawBlobRef: React.RefObject<Blob | null>
  trimStart: number
  trimEnd: number
}) {
  const elRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Create/revoke object URL for the raw blob
  useEffect(() => {
    const blob = rawBlobRef.current
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [rawBlobRef])

  // Build the element once we have a URL
  useEffect(() => {
    if (!url) return
    const el = new Audio(url)
    el.preload = 'auto'
    elRef.current = el
    const onTime = () => {
      setCurrentTime(el.currentTime)
      // Stop at trim end
      if (el.duration && el.currentTime >= trimEnd * el.duration) {
        el.pause()
      }
    }
    const onMeta = () => setDuration(el.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.pause()
      elRef.current = null
    }
  }, [url, trimEnd])

  const toggle = useCallback(() => {
    const el = elRef.current
    if (!el) return
    if (playing) {
      el.pause()
      return
    }
    // Start at trim start (or resume within the trim window)
    if (el.duration) {
      const start = trimStart * el.duration
      const end = trimEnd * el.duration
      if (el.currentTime < start || el.currentTime >= end - 0.05) {
        el.currentTime = start
      }
    }
    void el.play().catch(() => setPlaying(false))
  }, [playing, trimStart, trimEnd])

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = elRef.current
    if (!el || !el.duration) return
    const frac = Number(e.target.value)
    const start = trimStart * el.duration
    const end = trimEnd * el.duration
    el.currentTime = start + frac * (end - start)
    setCurrentTime(el.currentTime)
  }

  const progress = (() => {
    if (!duration) return 0
    const start = trimStart * duration
    const end = trimEnd * duration
    if (end <= start) return 0
    return Math.max(0, Math.min(1, (currentTime - start) / (end - start)))
  })()

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec < 10 && m === 0 && s < 10 ? sec.toFixed(1) : String(Math.floor(sec)).padStart(2, '0')}`
  }

  return (
    <div className="note-row recorder__replay-row">
      <button
        type="button"
        className="note-row__play"
        onClick={toggle}
        aria-label={playing ? 'Pause preview' : 'Play preview'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div className="note-row__main">
        <div className="note-row__meta">
          <span className="note-row__author">Preview</span>
        </div>
        <input
          className="note-row__scrub"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(progress * 1000)}
          onChange={handleScrub}
          aria-label="Seek in preview"
          style={{ ['--progress' as string]: `${progress * 100}%` }}
        />
      </div>
      <span className="note-row__time">{fmt(Math.max(0, currentTime - trimStart * duration))}</span>
    </div>
  )
}

// ─── WaveformTrimmer ──────────────────────────────────────────────────────────

interface TrimmerProps {
  waveform: number[]
  trimStart: number
  trimEnd: number
  onTrimStart: (v: number) => void
  onTrimEnd: (v: number) => void
}

function WaveformTrimmer({ waveform, trimStart, trimEnd, onTrimStart, onTrimEnd }: TrimmerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const samples = downsample(waveform, 120)

  const handleDrag = (setter: (v: number) => void, other: number, side: 'start' | 'end') =>
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      const onMove = (ev: PointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        let frac = (ev.clientX - rect.left) / rect.width
        frac = Math.max(0, Math.min(1, frac))
        if (side === 'start') frac = Math.min(frac, other - 0.05)
        else frac = Math.max(frac, other + 0.05)
        setter(frac)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  return (
    <div className="trimmer" ref={containerRef}>
      <div className="trimmer__bars">
        {samples.map((v, i) => {
          const frac = i / samples.length
          const inRange = frac >= trimStart && frac <= trimEnd
          return (
            <div
              key={i}
              className={`trimmer__bar ${inRange ? 'trimmer__bar--active' : ''}`}
              style={{ height: `${Math.max(4, v * 100)}%` }}
            />
          )
        })}
      </div>

      <div
        className="trimmer__handle trimmer__handle--start"
        style={{ left: `${trimStart * 100}%` }}
        onPointerDown={handleDrag(onTrimStart, trimEnd, 'start')}
        role="slider"
        aria-label="Trim start"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(trimStart * 100)}
      />

      <div
        className="trimmer__handle trimmer__handle--end"
        style={{ left: `${trimEnd * 100}%` }}
        onPointerDown={handleDrag(onTrimEnd, trimStart, 'end')}
        role="slider"
        aria-label="Trim end"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(trimEnd * 100)}
      />

      <div
        className="trimmer__selection"
        style={{
          left: `${trimStart * 100}%`,
          width: `${(trimEnd - trimStart) * 100}%`,
        }}
      />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downsample(samples: number[], target: number): number[] {
  if (!samples.length) return new Array(target).fill(0)
  if (samples.length <= target) return [...samples, ...new Array(target - samples.length).fill(0)]
  const result: number[] = []
  const step = samples.length / target
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * step)
    const end = Math.floor((i + 1) * step)
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    result.push(sum / (end - start))
  }
  return result
}

/**
 * Re-encode an AudioBuffer to WebM/Opus via MediaRecorder.
 * This preserves the correct mime type required by the kind 4200 spec.
 */
function reEncodeAudioBuffer(buffer: AudioBuffer, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const ctx = new AudioContext({ sampleRate: buffer.sampleRate })
    const dest = ctx.createMediaStreamDestination()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(dest)

    const mime = mimeType || 'audio/webm'
    const mr = new MediaRecorder(dest.stream, MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    mr.onstop = () => {
      ctx.close()
      resolve(new Blob(chunks, { type: mr.mimeType || mime }))
    }
    mr.onerror = (e) => { ctx.close(); reject(e) }

    mr.start()
    src.start(0)
    src.onended = () => mr.stop()
  })
}

/**
 * Recorder — MediaRecorder + real-time AnalyserNode waveform + trim UI.
 *
 * States: idle → recording → recorded → trimming → done
 * On completion calls onRecorded(blob, waveformSamples, durationSeconds).
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { RECORDING_MIME, RECORDING_MIME_FALLBACK, WAVEFORM_SAMPLES } from '../config'

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

export default function Recorder({ onRecorded, onCancel, disabled }: Props) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)           // seconds while recording
  const [liveBars, setLiveBars] = useState<number[]>(new Array(60).fill(0))

  // Trim state (0–1 fractions of total duration)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(1)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rawBlobRef = useRef<Blob | null>(null)
  const fullWaveformRef = useRef<number[]>([])  // densely sampled during recording
  const durationRef = useRef(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
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
      // Wake lock is a best-effort enhancement — ignore failures
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
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser

    const mime = pickMime()
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    mediaRecorderRef.current = mr
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      audioCtx.close()
    }

    mr.start(100)  // collect chunks every 100ms
    startTimeRef.current = Date.now()
    setState('recording')
    acquireWakeLock()

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

      setLiveBars((prev) => {
        const next = [...prev.slice(1), avg]
        return next
      })

      animFrameRef.current = requestAnimationFrame(drawLoop)
    }
    animFrameRef.current = requestAnimationFrame(drawLoop)
  }, [])

  const stopRecording = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    releaseWakeLock()
    releaseWakeLock()

    const mr = mediaRecorderRef.current
    if (!mr) return

    mr.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
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

    // Trim via OfflineAudioContext if handles were moved
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

        // Encode back to webm via MediaRecorder trick (record silence + chunks)
        // Fallback: just re-slice the waveform data, keep raw blob for upload
        // For simplicity: wrap trimmed AudioBuffer as WAV blob
        finalBlob = audioBufferToWav(trimmedBuf)
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

    // Downsample waveform to WAVEFORM_SAMPLES
    const waveform = downsample(finalWaveformSrc, WAVEFORM_SAMPLES)

    onRecorded({ blob: finalBlob, waveform, duration: finalDuration })
  }, [trimStart, trimEnd, onRecorded])

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

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

        <div className="recorder__actions">
          <button className="btn btn--ghost" onClick={() => setState('idle')}>Re-record</button>
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={handleUseRecording}>
            Use recording
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="recorder">
      {state === 'recording' && (
        <>
          <div className="recorder__waveform" aria-hidden="true">
            {liveBars.map((v, i) => (
              <div
                key={i}
                className="recorder__bar"
                style={{ height: `${Math.max(4, v * 100)}%` }}
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

      {/* Start handle */}
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

      {/* End handle */}
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

      {/* Selection overlay */}
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

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const interleaved = new Float32Array(length * numChannels)

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      interleaved[i * numChannels + ch] = channelData[i]
    }
  }

  const dataView = encodeWAV(interleaved, numChannels, sampleRate)
  return new Blob([dataView.buffer as ArrayBuffer], { type: 'audio/wav' })
}

function encodeWAV(samples: Float32Array, numChannels: number, sampleRate: number): DataView {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  const floatTo16 = (v: number) => Math.max(-32768, Math.min(32767, v < 0 ? v * 32768 : v * 32767))

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, floatTo16(samples[i]), true)
  }
  return view
}

import type { NostrEvent, NostrSigner } from '../types/nostr'
import { publishTranscript } from './segment'

interface WordChunk {
  text: string
  timestamp: [number, number | null]
}

interface TranscribeResult {
  text: string
  chunks?: WordChunk[]
}

const LOCAL_TRANSCRIPTION_ENABLED = import.meta.env.VITE_ENABLE_LOCAL_TRANSCRIPTION === 'true'

/** Browser transcription is opt-in until its dependency tree has a clean audit. */
export function isLocalTranscriptionEnabled(): boolean {
  return LOCAL_TRANSCRIPTION_ENABLED
}

let worker: Worker | null = null
let pendingCallbacks = new Map<string, (result: TranscribeResult | null, error?: string) => void>()
let requestCounter = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event) => {
      const { id, text, chunks, error } = event.data
      const cb = pendingCallbacks.get(id)
      if (!cb) return
      pendingCallbacks.delete(id)
      if (error) {
        cb(null, error)
      } else {
        cb({ text, chunks })
      }
    })
  }
  return worker
}

export async function transcribeBlob(blob: Blob): Promise<TranscribeResult | null> {
  if (!LOCAL_TRANSCRIPTION_ENABLED) return null
  const id = String(++requestCounter)
  const arrayBuffer = await blob.arrayBuffer()

  // Decode to 16kHz mono Float32Array (Whisper requirement)
  const audioCtx = new OfflineAudioContext(1, 1, 16000)
  let decoded: AudioBuffer
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer)
  } catch {
    return null
  }

  // Resample to 16kHz mono
  const targetSampleRate = 16000
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSampleRate), targetSampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start(0)
  const resampled = await offlineCtx.startRendering()
  const audioData = resampled.getChannelData(0)

  return new Promise((resolve) => {
    pendingCallbacks.set(id, (result, error) => {
      if (error || !result) {
        console.error('Transcription error:', error)
        resolve(null)
      } else {
        resolve(result)
      }
    })
    getWorker().postMessage({ id, audioData }, [audioData.buffer])
  })
}

export async function transcribeAndPublish(
  blob: Blob,
  segmentEvent: NostrEvent,
  signer: NostrSigner,
  expectedPubkey: string,
  assertActive?: () => void,
): Promise<void> {
  try {
    assertActive?.()
    const result = await transcribeBlob(blob)
    assertActive?.()
    if (!result?.text) return

    const content = JSON.stringify({
      text: result.text,
      chunks: result.chunks ?? [],
    })

    await publishTranscript(segmentEvent, content, signer, expectedPubkey, undefined, assertActive)
    assertActive?.()
  } catch (err) {
    try {
      assertActive?.()
    } catch {
      // Revocation is an expected cancellation path; never surface it in a
      // replacement session or ask the stale signer for another signature.
      return
    }
    console.error('Failed to publish transcript:', err)
  }
}

export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  pendingCallbacks.clear()
}

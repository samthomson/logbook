/* eslint-disable @typescript-eslint/no-explicit-any */
import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false
;(env.backends as any).onnx.wasm.numThreads = 4

type TranscribeRequest = {
  id: string
  audioData: Float32Array
}

type TranscribeResponse = {
  id: string
  text: string
  chunks?: Array<{ text: string; timestamp: [number, number | null] }>
  error?: string
}

let transcriber: any = null

async function getTranscriber() {
  if (!transcriber) {
    transcriber = await (pipeline as any)(
      'automatic-speech-recognition',
      'Xenova/whisper-base',
      {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
      },
    )
  }
  return transcriber
}

async function configureBackend() {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter()
      if (adapter) {
        ;(env.backends as any).onnx.wasm.numThreads = 1
      }
    } catch {
      // stay with WASM
    }
  }
}

configureBackend()

self.addEventListener('message', async (event: MessageEvent<TranscribeRequest>) => {
  const { id, audioData } = event.data
  try {
    const asr = await getTranscriber()
    const result = await asr(audioData as any, {
      language: 'english',
      task: 'transcribe',
      return_timestamps: 'word',
    })

    const response: TranscribeResponse = {
      id,
      text: (result.text as string).trim(),
      chunks: result.chunks,
    }
    self.postMessage(response)
  } catch (err) {
    const response: TranscribeResponse = {
      id,
      text: '',
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
})

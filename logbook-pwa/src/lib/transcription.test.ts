import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('local transcription feature gate', () => {
  it('stays inert when VITE_ENABLE_LOCAL_TRANSCRIPTION is not true', async () => {
    vi.stubEnv('VITE_ENABLE_LOCAL_TRANSCRIPTION', 'false')
    const worker = vi.fn()
    const audioContext = vi.fn()
    vi.stubGlobal('Worker', worker)
    vi.stubGlobal('OfflineAudioContext', audioContext)

    const { isLocalTranscriptionEnabled, transcribeBlob } = await import('./transcription')
    expect(isLocalTranscriptionEnabled()).toBe(false)
    await expect(transcribeBlob(new Blob(['fixture']))).resolves.toBeNull()
    expect(worker).not.toHaveBeenCalled()
    expect(audioContext).not.toHaveBeenCalled()
  })

  it('transcribes an opt-in local fixture through mocked browser APIs', async () => {
    vi.stubEnv('VITE_ENABLE_LOCAL_TRANSCRIPTION', 'true')

    class FixtureOfflineAudioContext {
      destination = {}
      numberOfChannels: number
      length: number
      sampleRate: number
      constructor(
        numberOfChannels: number,
        length: number,
        sampleRate: number,
      ) {
        this.numberOfChannels = numberOfChannels
        this.length = length
        this.sampleRate = sampleRate
      }
      async decodeAudioData() {
        return { duration: 0.001 } as AudioBuffer
      }
      createBufferSource() {
        return { buffer: null, connect: vi.fn(), start: vi.fn() }
      }
      async startRendering() {
        return { getChannelData: () => new Float32Array([0.25, -0.25]) }
      }
    }

    class FixtureWorker {
      private listener?: (event: MessageEvent) => void
      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listener = listener
      }
      postMessage(message: { id: string }) {
        queueMicrotask(() => this.listener?.({
          data: {
            id: message.id,
            text: 'local fixture transcript',
            chunks: [{ text: 'local', timestamp: [0, 0.2] }],
          },
        } as MessageEvent))
      }
      terminate() {}
    }

    vi.stubGlobal('OfflineAudioContext', FixtureOfflineAudioContext)
    vi.stubGlobal('Worker', FixtureWorker)

    const { isLocalTranscriptionEnabled, transcribeBlob, terminateWorker } =
      await import('./transcription')
    expect(isLocalTranscriptionEnabled()).toBe(true)
    await expect(transcribeBlob(new Blob(['fixture audio']))).resolves.toEqual({
      text: 'local fixture transcript',
      chunks: [{ text: 'local', timestamp: [0, 0.2] }],
    })
    terminateWorker()
  })
})

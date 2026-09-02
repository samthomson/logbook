import { describe, expect, it, vi } from 'vitest'
import { prepareFinishedTake } from './InlineRecorder'

const waveform = [0.1, 0.4, 0.2]

function take() {
  return {
    blob: new Blob(['finished take'], { type: 'audio/webm' }),
    waveform,
    duration: 4.25,
  }
}

describe('prepareFinishedTake', () => {
  it('makes the finished take available for review before the audio check settles', async () => {
    let resolvePeak!: (peak: number) => void
    const peak = new Promise<number>((resolve) => { resolvePeak = resolve })
    const result = take()

    const prepared = prepareFinishedTake(result, () => peak)

    expect(prepared.result).toBe(result)
    expect(prepared.result.blob).toBe(result.blob)

    resolvePeak(0.25)
    await expect(prepared.warning).resolves.toBeNull()
  })

  it('keeps a silent take reviewable and returns a non-blocking warning', async () => {
    const result = take()
    const prepared = prepareFinishedTake(result, vi.fn().mockResolvedValue(0))

    expect(prepared.result).toBe(result)
    await expect(prepared.warning).resolves.toMatch(/may contain no sound/i)
  })

  it('keeps an undecodable take reviewable and returns a non-blocking warning', async () => {
    const result = take()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prepared = prepareFinishedTake(result, vi.fn().mockRejectedValue(new Error('decode failed')))

    expect(prepared.result).toBe(result)
    await expect(prepared.warning).resolves.toMatch(/could not verify/i)
    expect(consoleError).toHaveBeenCalledWith('Recording playback check failed:', expect.any(Error))
    consoleError.mockRestore()
  })
})

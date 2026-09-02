import { describe, expect, it } from 'vitest'
import { isSilent, peakAmplitude, SILENT_PEAK } from './silence'

function decoded(...channels: number[][]) {
  return {
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
  }
}

describe('peakAmplitude', () => {
  it('reads the loudest sample across every channel, ignoring sign', () => {
    expect(peakAmplitude(decoded([0, 0.1, -0.4], [0, 0.2, 0]))).toBeCloseTo(0.4)
  })

  it('is zero for a recording of digital silence', () => {
    expect(peakAmplitude(decoded(new Array(128).fill(0)))).toBe(0)
  })
})

describe('isSilent', () => {
  it('rejects a recording that captured nothing', () => {
    expect(isSilent(0)).toBe(true)
  })

  it('accepts a very quiet voice note, which is legitimate', () => {
    // −40 dBFS: far quieter than normal speech, still decades above silence.
    expect(isSilent(0.01)).toBe(false)
    expect(SILENT_PEAK).toBeLessThan(0.01)
  })
})

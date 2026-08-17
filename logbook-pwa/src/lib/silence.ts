/**
 * A recording that captured no sound cannot be published: it survives upload,
 * gets into the cut, and only fails hours later in the stitcher, where loudness
 * normalisation has nothing to normalise. It is caught here instead, at the one
 * moment the person is still holding the microphone.
 *
 * The test is the true peak sample, not loudness. A very quiet voice note is
 * legitimate; digital silence is not, and the two are decades apart in level.
 */

/** −66 dBFS: below any microphone's noise floor, above float rounding. */
export const SILENT_PEAK = 0.0005

interface DecodedAudio {
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export function peakAmplitude(buffer: DecodedAudio): number {
  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) {
      const magnitude = Math.abs(samples[i])
      if (magnitude > peak) peak = magnitude
    }
  }
  return peak
}

export function isSilent(peak: number): boolean {
  return peak < SILENT_PEAK
}

/**
 * Decode the recorded blob and report its loudest sample. A blob that cannot be
 * decoded is a broken recording, so this throws rather than assuming sound.
 */
export async function recordingPeak(blob: Blob): Promise<number> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    return peakAmplitude(decoded)
  } finally {
    void ctx.close().catch(() => {})
  }
}

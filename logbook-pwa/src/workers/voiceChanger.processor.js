/**
 * VoiceChangerProcessor — AudioWorkletProcessor for real-time pitch shift.
 *
 * Algorithm: WSOLA-lite variable-delay resampling.
 *   - Input goes into a ring buffer.
 *   - Output reads from the ring at (pitchFactor ×) speed with linear
 *     interpolation, trailing the write position by a fixed latency.
 *   - Reading faster than 1× = higher pitch; slower = lower pitch.
 *   - At factor 1.0 the path is an exact passthrough (no artifacts).
 *
 * Registered as 'voice-changer-processor'.
 * Messages: { type: 'setPitch', factor: number }  (1.0 = no change)
 */

const BUF_SIZE = 16384      // ring buffer length (power of 2, ~0.37s @ 44.1k)
const MASK = BUF_SIZE - 1
const LATENCY = 4096        // fixed read-behind latency in samples (~93ms)

class VoiceChangerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._pitchFactor = 1.0
    this._in = new Float32Array(BUF_SIZE)
    this._writePos = 0
    this._readPos = 0.0 // fractional

    this.port.onmessage = (e) => {
      if (e.data?.type === 'setPitch') {
        this._pitchFactor = Math.max(0.5, Math.min(2.0, Number(e.data.factor) || 1.0))
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!input || !output) return true

    const n = input.length
    const f = this._pitchFactor

    // Exact passthrough at unity
    if (Math.abs(f - 1.0) < 1e-6) {
      for (let i = 0; i < n; i++) output[i] = input[i]
      for (let i = 0; i < n; i++) {
        this._in[this._writePos] = input[i]
        this._writePos = (this._writePos + 1) & MASK
      }
      // Keep read pointer trailing the writer so engaging pitch has history
      this._readPos = this._writePos - LATENCY
      if (this._readPos < 0) this._readPos += BUF_SIZE
      return true
    }

    // Write input into the ring
    for (let i = 0; i < n; i++) {
      this._in[this._writePos] = input[i]
      this._writePos = (this._writePos + 1) & MASK
    }

    // Keep readPos within valid trailing range [writePos - BUF_SIZE, writePos]
    // (on first non-unity block after passthrough, readPos is already set)
    if (this._readPos < this._writePos - BUF_SIZE || this._readPos > this._writePos) {
      this._readPos = this._writePos - LATENCY
      if (this._readPos < 0) this._readPos += BUF_SIZE
    }

    // Read out at pitch rate with linear interpolation
    for (let i = 0; i < n; i++) {
      const p = this._readPos
      const i0 = Math.floor(p) & MASK
      const i1 = (i0 + 1) & MASK
      const frac = p - Math.floor(p)
      output[i] = this._in[i0] * (1 - frac) + this._in[i1] * frac

      this._readPos += f
      // Never let the reader overrun the writer — clamp to just behind it
      if (this._readPos >= this._writePos) {
        this._readPos = this._writePos - LATENCY
        if (this._readPos < 0) this._readPos += BUF_SIZE
      }
    }

    return true
  }
}

registerProcessor('voice-changer-processor', VoiceChangerProcessor)

/**
 * VoiceChangerProcessor — AudioWorkletProcessor for real-time pitch shift.
 *
 * Implements a simplified phase vocoder:
 *   1. Accumulate input samples into an overlap-add buffer
 *   2. On each hop, FFT the frame, shift bin frequencies by pitchFactor
 *   3. IFFT and overlap-add into output
 *
 * Registered as 'voice-changer-processor'.
 * Receives messages: { type: 'setPitch', factor: number }  (1.0 = no change)
 */

const FFT_SIZE = 2048
const HOP_SIZE = FFT_SIZE / 4   // 75% overlap
const WIN_SIZE = FFT_SIZE

/** Hann window coefficients */
function makeHann(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  return w
}

/** Bit-reversal permutation for Cooley-Tukey FFT */
function bitReverse(n) {
  const bits = Math.log2(n)
  const rev = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    let x = i
    let r = 0
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }
  return rev
}

/**
 * In-place Cooley-Tukey FFT.
 * re/im are Float32Arrays of length n (must be power of 2).
 * inverse=true performs IFFT (no 1/N scaling applied here).
 */
function fft(re, im, inverse) {
  const n = re.length
  const rev = bitReverse(n)
  // Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    if (rev[i] > i) {
      ;[re[i], re[rev[i]]] = [re[rev[i]], re[i]]
      ;[im[i], im[rev[i]]] = [im[rev[i]], im[i]]
    }
  }
  const sign = inverse ? 1 : -1
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (sign * 2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0
      for (let j = 0; j < half; j++) {
        const tRe = uRe * re[i + j + half] - uIm * im[i + j + half]
        const tIm = uRe * im[i + j + half] + uIm * re[i + j + half]
        re[i + j + half] = re[i + j] - tRe
        im[i + j + half] = im[i + j] - tIm
        re[i + j] += tRe
        im[i + j] += tIm
        const newURe = uRe * wRe - uIm * wIm
        uIm = uRe * wIm + uIm * wRe
        uRe = newURe
      }
    }
  }
}

class VoiceChangerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._pitchFactor = 1.0
    this._hann = makeHann(WIN_SIZE)
    // Input accumulation ring buffer
    this._inBuf = new Float32Array(WIN_SIZE)
    this._inPos = 0
    this._samplesAccum = 0
    // Output overlap-add buffer (2× window to hold pending output)
    this._outBuf = new Float32Array(WIN_SIZE * 2)
    this._outPos = 0
    // Phase vocoder state
    this._lastPhase = new Float32Array(FFT_SIZE / 2 + 1)
    this._synthPhase = new Float32Array(FFT_SIZE / 2 + 1)

    this.port.onmessage = (e) => {
      if (e.data?.type === 'setPitch') {
        this._pitchFactor = Math.max(0.5, Math.min(2.0, e.data.factor))
      }
    }
  }

  /**
   * Phase vocoder pitch shift on one FFT_SIZE frame.
   * Returns a Float32Array of WIN_SIZE time-domain samples.
   */
  _processFrame(frame) {
    const re = new Float32Array(FFT_SIZE)
    const im = new Float32Array(FFT_SIZE)
    // Apply Hann window
    for (let i = 0; i < WIN_SIZE; i++) {
      re[i] = frame[i] * this._hann[i]
    }
    fft(re, im, false)

    const numBins = FFT_SIZE / 2 + 1
    const outRe = new Float32Array(FFT_SIZE)
    const outIm = new Float32Array(FFT_SIZE)
    const freqPerBin = (2 * Math.PI * HOP_SIZE) / FFT_SIZE

    for (let k = 0; k < numBins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const phase = Math.atan2(im[k], re[k])
      // True frequency deviation
      let delta = phase - this._lastPhase[k] - k * freqPerBin
      // Wrap to [-π, π]
      delta -= Math.round(delta / (2 * Math.PI)) * 2 * Math.PI
      const trueFreq = k * freqPerBin + delta
      this._lastPhase[k] = phase

      // Map to shifted bin
      const kOut = Math.round(k * this._pitchFactor)
      if (kOut >= 0 && kOut < numBins) {
        this._synthPhase[kOut] += trueFreq * this._pitchFactor
        const sp = this._synthPhase[kOut]
        outRe[kOut] += mag * Math.cos(sp)
        outIm[kOut] += mag * Math.sin(sp)
      }
    }

    // Mirror for real IFFT
    for (let k = 1; k < numBins - 1; k++) {
      outRe[FFT_SIZE - k] = outRe[k]
      outIm[FFT_SIZE - k] = -outIm[k]
    }

    fft(outRe, outIm, true)

    // Scale + window
    const scale = 1 / FFT_SIZE
    const out = new Float32Array(WIN_SIZE)
    for (let i = 0; i < WIN_SIZE; i++) {
      out[i] = outRe[i] * scale * this._hann[i]
    }
    return out
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!input || !output) return true

    const blockSize = input.length  // typically 128

    // Accumulate input
    for (let i = 0; i < blockSize; i++) {
      this._inBuf[this._inPos] = input[i]
      this._inPos = (this._inPos + 1) % WIN_SIZE
      this._samplesAccum++
    }

    // Run phase vocoder when we have a full hop of new data
    while (this._samplesAccum >= HOP_SIZE) {
      // Extract WIN_SIZE samples ending at current position
      const frame = new Float32Array(WIN_SIZE)
      for (let i = 0; i < WIN_SIZE; i++) {
        frame[i] = this._inBuf[(this._inPos - WIN_SIZE + i + WIN_SIZE) % WIN_SIZE]
      }
      const processed = this._processFrame(frame)
      // Overlap-add into output buffer
      for (let i = 0; i < WIN_SIZE; i++) {
        this._outBuf[(this._outPos + i) % (WIN_SIZE * 2)] += processed[i]
      }
      this._outPos = (this._outPos + HOP_SIZE) % (WIN_SIZE * 2)
      this._samplesAccum -= HOP_SIZE
    }

    // Drain output buffer into output block
    for (let i = 0; i < blockSize; i++) {
      output[i] = this._outBuf[i % (WIN_SIZE * 2)]
      this._outBuf[i % (WIN_SIZE * 2)] = 0
    }

    return true
  }
}

registerProcessor('voice-changer-processor', VoiceChangerProcessor)

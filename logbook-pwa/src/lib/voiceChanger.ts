/**
 * VoiceChanger — loads the AudioWorklet processor and exposes pitch control.
 *
 * Usage:
 *   const vc = new VoiceChanger(audioCtx)
 *   await vc.load()
 *   source.connect(vc.input)
 *   vc.output.connect(destination)
 *   vc.setPitch(1.3)  // 30% higher pitch
 *   vc.bypass = true  // pass-through with no processing
 */

const PROCESSOR_URL = new URL('../workers/voiceChanger.processor.js', import.meta.url).href

export class VoiceChanger {
  private ctx: AudioContext
  private _node: AudioWorkletNode | null = null
  private _input: GainNode
  private _output: GainNode
  private _bypassGain: GainNode
  private _loaded = false
  private _pitchFactor = 1.0
  private _bypass = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this._input = ctx.createGain()
    this._output = ctx.createGain()
    this._bypassGain = ctx.createGain()
    // Default: bypass active until load() completes
    this._input.connect(this._bypassGain)
    this._bypassGain.connect(this._output)
  }

  async load(): Promise<void> {
    if (this._loaded) return
    await this.ctx.audioWorklet.addModule(PROCESSOR_URL)
    this._node = new AudioWorkletNode(this.ctx, 'voice-changer-processor')
    // Disconnect bypass, route through worklet
    this._input.disconnect(this._bypassGain)
    this._input.connect(this._node)
    this._node.connect(this._output)
    this._loaded = true
    this.setPitch(this._pitchFactor)
  }

  get input(): AudioNode { return this._input }
  get output(): AudioNode { return this._output }

  get loaded(): boolean { return this._loaded }

  setPitch(factor: number) {
    this._pitchFactor = Math.max(0.5, Math.min(2.0, factor))
    this._node?.port.postMessage({ type: 'setPitch', factor: this._pitchFactor })
  }

  get pitchFactor(): number { return this._pitchFactor }

  set bypass(on: boolean) {
    if (!this._loaded || !this._node) return
    if (on === this._bypass) return
    this._bypass = on
    if (on) {
      this._input.disconnect(this._node)
      this._input.connect(this._bypassGain)
    } else {
      this._input.disconnect(this._bypassGain)
      this._input.connect(this._node)
    }
  }

  get bypass(): boolean { return this._bypass }

  dispose() {
    try { this._node?.disconnect() } catch {}
    try { this._input.disconnect() } catch {}
    try { this._output.disconnect() } catch {}
    try { this._bypassGain.disconnect() } catch {}
    this._node = null
  }
}

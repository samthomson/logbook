import { describe, expect, it, vi } from 'vitest'
import { preserveScrollAfterMutation } from './pin-scroll'

describe('post-publication scroll position', () => {
  it('restores the position after the draft row is replaced across two frames', () => {
    const frames: FrameRequestCallback[] = []
    const write = vi.fn()
    const mutate = vi.fn()
    preserveScrollAfterMutation(mutate, () => 640, write, (callback) => { frames.push(callback); return frames.length })
    expect(mutate).toHaveBeenCalledOnce()
    frames.shift()!(0)
    frames.shift()!(0)
    expect(write).toHaveBeenCalledWith(640)
  })
})

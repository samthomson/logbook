import { describe, expect, it } from 'vitest'
import { SignerTimeoutError, withSignerTimeout } from './signer-timeout'

describe('withSignerTimeout', () => {
  it('returns a responsive signer result', async () => {
    await expect(withSignerTimeout(Promise.resolve('signed'), 'Amber signing', 20)).resolves.toBe('signed')
  })

  it('turns a stalled signer operation into a recoverable error', async () => {
    await expect(withSignerTimeout(new Promise<never>(() => {}), 'Amber signing', 5))
      .rejects.toBeInstanceOf(SignerTimeoutError)
  })
})

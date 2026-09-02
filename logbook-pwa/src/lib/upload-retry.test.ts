import { describe, expect, it } from 'vitest'
import { HttpError } from './http'
import { SignerTimeoutError } from './signer-timeout'
import { canAttemptDraft, classifyUploadFailure, retryDelayMs, shouldRetryDraft } from './upload-retry'

describe('durable upload retry policy', () => {
  it('retries recoverable connectivity failures with bounded exponential backoff', () => {
    expect(classifyUploadFailure(new HttpError('offline')).recoverable).toBe(true)
    expect(classifyUploadFailure(new HttpError('busy', 503)).recoverable).toBe(true)
    expect(classifyUploadFailure(new HttpError('forbidden', 403)).recoverable).toBe(false)
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 30000])
    const draft = { attempt: 1, retryAt: 100, failure: { recoverable: true } }
    expect(shouldRetryDraft(draft, false, 200)).toBe(false)
    expect(shouldRetryDraft(draft, true, 99)).toBe(false)
    expect(shouldRetryDraft(draft, true, 200)).toBe(true)
    expect(canAttemptDraft({ attempt: 5 }, true, 200)).toBe(false)
    expect(canAttemptDraft({ attempt: 1, retryAt: 300 }, true, 200)).toBe(false)
    expect(canAttemptDraft({ attempt: 1, retryAt: 100 }, false, 200)).toBe(false)
  })
  it('never retries signer rejection, signer timeout, or invalid recordings', () => {
    expect(classifyUploadFailure(new Error('User rejected request')).recoverable).toBe(false)
    expect(classifyUploadFailure(new SignerTimeoutError('Amber', 100)).recoverable).toBe(false)
    expect(classifyUploadFailure(new Error('Recording is empty')).recoverable).toBe(false)
  })
})

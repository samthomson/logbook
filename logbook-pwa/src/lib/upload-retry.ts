import { HttpError } from './http'
import { SignerTimeoutError } from './signer-timeout'
import { SignerIdentityError } from './signer-identity'

export type UploadFailureCategory = 'network' | 'signer-timeout' | 'signer-rejected' | 'invalid-recording' | 'authorization' | 'unknown'

export function classifyUploadFailure(error: unknown): { category: UploadFailureCategory; recoverable: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof SignerTimeoutError) return { category: 'signer-timeout', recoverable: false }
  if (error instanceof SignerIdentityError || /reject|denied|declined/i.test(message)) return { category: 'signer-rejected', recoverable: false }
  if (/empty|microphone captured nothing|invalid recording/i.test(message)) return { category: 'invalid-recording', recoverable: false }
  if (/authorization was revoked|access.*refresh/i.test(message)) return { category: 'authorization', recoverable: false }
  if (error instanceof HttpError) {
    const recoverable = error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500
    return { category: recoverable ? 'network' : 'authorization', recoverable }
  }
  if (error instanceof TypeError || /network|fetch|timed out|all blossom servers|publish.*relay/i.test(message)) return { category: 'network', recoverable: true }
  return { category: 'unknown', recoverable: false }
}

export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1))
}

export const MAX_DURABLE_UPLOAD_ATTEMPTS = 5

export function canAttemptDraft(
  draft: { attempt?: number; retryAt?: number | null },
  online: boolean,
  now = Date.now(),
): boolean {
  return online
    && (draft.attempt ?? 0) < MAX_DURABLE_UPLOAD_ATTEMPTS
    && (draft.retryAt ?? 0) <= now
}

export function shouldRetryDraft(
  draft: { attempt?: number; retryAt?: number | null; failure?: { recoverable: boolean } | null },
  online: boolean,
  now = Date.now(),
): boolean {
  return draft.failure?.recoverable === true && canAttemptDraft(draft, online, now)
}

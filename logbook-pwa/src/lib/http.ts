/**
 * Shared HTTP helpers — timeouts, retries with backoff, safe response handling.
 *
 * Every network call in the publish path must go through `fetchJson`/`fetchRaw`
 * so a hung server or flaky connection never leaves the UI stuck in
 * "Uploading…" forever and never swallows an error silently.
 */

export class HttpError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit | null
  /** Per-attempt timeout in ms. Default 20s. */
  timeoutMs?: number
  /** Max attempts including the first. Default 1 (no retry). */
  attempts?: number
  /** Base delay for exponential backoff (ms). Default 400. */
  backoffMs?: number
  /** Called on each retry with (attemptNumber, error). */
  onRetry?: (attempt: number, error: unknown) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** True for transient errors worth retrying (network, 5xx, 408, 429). */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    if (err.status === undefined) return true // network-level
    return err.status >= 500 || err.status === 408 || err.status === 429
  }
  // TypeError from fetch = network failure / CORS / abort
  return err instanceof TypeError
}

/**
 * fetch with timeout + optional exponential-backoff retry.
 * Rejects with HttpError on final failure. Never hangs indefinitely.
 */
export async function fetchRaw(url: string, opts: FetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = 20_000,
    attempts = 1,
    backoffMs = 400,
    onRetry,
    ...init
  } = opts

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      // Retry on transient HTTP statuses
      if (attempt < attempts && (res.status >= 500 || res.status === 408 || res.status === 429)) {
        lastErr = new HttpError(`HTTP ${res.status}`, res.status)
        onRetry?.(attempt, lastErr)
        await sleep(backoffMs * 2 ** (attempt - 1))
        continue
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      // Normalize abort → timeout error
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      lastErr = isAbort ? new HttpError(`Request timed out after ${timeoutMs}ms`) : err
      if (attempt < attempts && isRetryable(lastErr)) {
        onRetry?.(attempt, lastErr)
        await sleep(backoffMs * 2 ** (attempt - 1))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr))
}

/** fetch + JSON parse, throwing a descriptive HttpError on non-2xx. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchRaw(url, opts)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status)
  }
  return res.json() as Promise<T>
}

export class SignerTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} did not respond within ${Math.ceil(timeoutMs / 1000)} seconds. Reopen Amber and resume the saved upload.`)
    this.name = 'SignerTimeoutError'
  }
}

/** Bound a remote NIP-46 signer operation so a lost Amber connection is recoverable. */
export function withSignerTimeout<T>(promise: Promise<T>, operation: string, timeoutMs = 45_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SignerTimeoutError(operation, timeoutMs)), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

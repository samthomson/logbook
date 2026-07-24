const SHA256_HEX = /^[a-f0-9]{64}$/

/**
 * Validate that relay/server-provided media stays on a configured HTTPS Blossom
 * origin and uses the declared content hash as its canonical path.
 */
export function validateTrustedBlobUrl(
  rawUrl: string,
  sha256: string,
  servers: readonly string[],
): string {
  if (!SHA256_HEX.test(sha256)) throw new Error('Blob hash must be lowercase SHA-256 hex')

  let candidate: URL
  try {
    candidate = new URL(rawUrl)
  } catch {
    throw new Error('Blob URL is invalid')
  }
  if (candidate.protocol !== 'https:') throw new Error('Blob URL must use HTTPS')
  if (candidate.username || candidate.password || candidate.search || candidate.hash) {
    throw new Error('Blob URL must not include credentials, query, or fragment')
  }

  const trustedOrigins = new Set(servers.map((server) => {
    const parsed = new URL(server)
    if (parsed.protocol !== 'https:') throw new Error(`Configured Blossom server must use HTTPS: ${server}`)
    return parsed.origin
  }))
  if (!trustedOrigins.has(candidate.origin)) throw new Error('Blob URL origin is not configured')

  const canonicalPath = new RegExp(`^/${sha256}(\\.[a-z0-9]{1,10})?$`)
  if (!canonicalPath.test(candidate.pathname)) {
    throw new Error('Blob URL path must be the declared SHA-256 hash with an optional safe extension')
  }
  return candidate.toString()
}

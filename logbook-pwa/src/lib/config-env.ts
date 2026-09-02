/**
 * Configuration parsing. Required values have no defaults: unset or malformed
 * input fails at load. Fix the env — do not paper over it with a backup list.
 */

const HEX_64 = /^[0-9a-f]{64}$/

function isUnset(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === ''
}

function splitList(raw: string): string[] {
  return raw.split(',').map((value) => value.trim()).filter((value) => value !== '')
}

export function requirePubkey(raw: string | undefined, name: string): string {
  if (isUnset(raw)) throw new Error(`${name} is required`)
  const value = (raw as string).trim().toLowerCase()
  if (!HEX_64.test(value)) {
    throw new Error(`${name} must be a 64-character hex pubkey`)
  }
  return value
}

/** Optional list — blank means empty. Never substituted with a hidden default. */
export function parsePubkeyList(raw: string | undefined, name: string): string[] {
  if (isUnset(raw)) return []
  const values = splitList(raw as string).map((value) => value.toLowerCase())
  for (const value of values) {
    if (!HEX_64.test(value)) {
      throw new Error(`${name} entries must be 64-character hex pubkeys: ${value}`)
    }
  }
  return [...new Set(values)]
}

/**
 * Loopback keeps plaintext schemes available for an isolated local relay or
 * Blossom origin. Every other host must be encrypted.
 */
function assertScheme(value: string, name: string, transport: 'ws' | 'http'): void {
  const secure = transport === 'ws' ? 'wss:' : 'https:'
  const plaintext = transport === 'ws' ? 'ws:' : 'http:'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} entries must be absolute URLs: ${value}`)
  }
  if (url.protocol === secure) return
  const isLoopback = url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  if (url.protocol === plaintext && isLoopback) return
  throw new Error(`${name} entries must use ${secure} unless the host is loopback: ${value}`)
}

export function requireUrlList(
  raw: string | undefined,
  name: string,
  transport: 'ws' | 'http',
): string[] {
  if (isUnset(raw)) throw new Error(`${name} is required`)
  const values = splitList(raw as string)
  if (!values.length) throw new Error(`${name} must list at least one URL`)
  for (const value of values) assertScheme(value, name, transport)
  return [...new Set(values)]
}

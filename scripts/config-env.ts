/**
 * Runtime configuration parsing for the trusted worker.
 * Mirrors logbook-pwa/src/lib/config-env.ts — required env, no hidden defaults.
 */

const HEX_64 = /^[0-9a-f]{64}$/

function isUnset(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === ''
}

function splitList(raw: string): string[] {
  return raw.split(',').map((value) => value.trim()).filter((value) => value !== '')
}

/** Deny-list for seed tools only — never a config fallback. */
export const REAL_COMPASS_PUBKEY =
  '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80'

export function requirePubkey(raw: string | undefined, name: string): string {
  if (isUnset(raw)) throw new Error(`${name} is required`)
  const value = (raw as string).trim().toLowerCase()
  if (!HEX_64.test(value)) {
    throw new Error(`${name} must be a 64-character hex pubkey`)
  }
  return value
}

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

/**
 * Slugify a string for use in section IDs.
 * Lowercase, spaces → hyphens, non-alphanumeric removed, max 40 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** Detect iOS version from user agent string. Returns null if not iOS. */
export function getIOSVersion(): number | null {
  const ua = navigator.userAgent
  const match = ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/)
  if (!match) return null
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  return major + minor / 10
}

/** Returns true if the current device is iOS and version < minVersion. */
export function isUnsupportedIOS(minVersion: number): boolean {
  const version = getIOSVersion()
  if (version === null) return false
  return version < minVersion
}

/** SHA-256 hash a Blob, returns hex string. */
export async function sha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Get current unix timestamp in seconds. */
export function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Format seconds as mm:ss. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

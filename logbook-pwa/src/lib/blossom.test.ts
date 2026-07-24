import { describe, expect, it } from 'vitest'
import { validateUploadDescriptor } from './blossom'

const HASH = 'a'.repeat(64)
const SERVERS = ['https://blossom.example']
const blob = new Blob([new Uint8Array(128)], { type: 'audio/webm' })

describe('validateUploadDescriptor', () => {
  it('accepts a canonical content-addressed URL from the configured upload origin', () => {
    expect(validateUploadDescriptor({
      url: `https://blossom.example/${HASH}.webm`,
      sha256: HASH,
      size: 128,
      type: 'audio/webm',
    }, blob, HASH, SERVERS).url).toBe(`https://blossom.example/${HASH}.webm`)
  })

  it('rejects untrusted origins, insecure URLs, non-canonical paths, and hash mismatches', () => {
    for (const url of [
      `https://evil.example/${HASH}`,
      `http://blossom.example/${HASH}`,
      'https://blossom.example/not-the-hash',
    ]) {
      expect(() => validateUploadDescriptor({ url, sha256: HASH }, blob, HASH, SERVERS)).toThrow()
    }
    expect(() => validateUploadDescriptor({
      url: `https://blossom.example/${HASH}`,
      sha256: 'b'.repeat(64),
    }, blob, HASH, SERVERS)).toThrow(/integrity/i)
  })
})

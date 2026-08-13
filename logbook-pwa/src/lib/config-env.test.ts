import { describe, expect, it } from 'vitest'
import {
  parsePubkeyList,
  REAL_COMPASS_PUBKEY,
  requirePubkey,
  requireUrlList,
} from './config-env'

const OVERRIDE_PUBKEY = 'a'.repeat(64)

describe('requirePubkey', () => {
  it('requires a value', () => {
    expect(() => requirePubkey(undefined, 'X')).toThrow(/X is required/)
    expect(() => requirePubkey('   ', 'X')).toThrow(/X is required/)
  })

  it('accepts and normalizes hex', () => {
    expect(requirePubkey(` ${OVERRIDE_PUBKEY.toUpperCase()} `, 'X')).toBe(OVERRIDE_PUBKEY)
  })

  it('rejects non-hex', () => {
    expect(() => requirePubkey('npub1abc', 'X')).toThrow(/64-character hex/)
    expect(() => requirePubkey('a'.repeat(63), 'X')).toThrow(/64-character hex/)
    expect(() => requirePubkey('z'.repeat(64), 'X')).toThrow(/64-character hex/)
  })
})

describe('parsePubkeyList', () => {
  it('returns empty for blank', () => {
    expect(parsePubkeyList(undefined, 'X')).toEqual([])
    expect(parsePubkeyList('  ', 'X')).toEqual([])
  })

  it('dedupes and lowercases', () => {
    expect(parsePubkeyList(`${OVERRIDE_PUBKEY},${OVERRIDE_PUBKEY.toUpperCase()}`, 'X'))
      .toEqual([OVERRIDE_PUBKEY])
  })
})

describe('requireUrlList', () => {
  it('requires at least one URL', () => {
    expect(() => requireUrlList(undefined, 'X', 'ws')).toThrow(/X is required/)
    expect(() => requireUrlList(' , , ', 'X', 'ws')).toThrow(/at least one URL/)
  })

  it('allows wss and loopback ws', () => {
    expect(requireUrlList('wss://relay.example,ws://localhost:4869', 'X', 'ws'))
      .toEqual(['wss://relay.example', 'ws://localhost:4869'])
  })

  it('rejects plaintext non-loopback', () => {
    expect(() => requireUrlList('ws://relay.example', 'X', 'ws')).toThrow(/wss:/)
  })
})

describe('REAL_COMPASS_PUBKEY', () => {
  it('is the known production identity for deny-lists only', () => {
    expect(REAL_COMPASS_PUBKEY).toMatch(/^[0-9a-f]{64}$/)
  })
})

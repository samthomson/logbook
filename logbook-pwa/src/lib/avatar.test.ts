import { describe, expect, it } from 'vitest'
import { avatarInitials, avatarStyle, noteTint } from './avatar'

describe('avatarInitials', () => {
  it('uses first and last word for multi-word names', () => {
    expect(avatarInitials('Test user 1 - John', 'aa')).toBe('TJ')
    expect(avatarInitials('test profile 2 - Francisco', 'bb')).toBe('TF')
  })

  it('falls back to hex when there is no name', () => {
    expect(avatarInitials(null, 'abcdef12')).toBe('AB')
  })
})

describe('avatarStyle', () => {
  it('is stable for a pubkey', () => {
    const pk = 'a'.repeat(64)
    expect(avatarStyle(pk)).toEqual(avatarStyle(pk))
  })

  it('differs between distinct pubkeys', () => {
    const a = avatarStyle('a'.repeat(64))
    const b = avatarStyle('f'.repeat(64))
    expect(a.backgroundColor).not.toBe(b.backgroundColor)
  })

  it('tints the note card from the same colour', () => {
    const pk = 'c'.repeat(64)
    const avatar = avatarStyle(pk)
    const tint = noteTint(pk)
    expect(tint.backgroundColor).toBe(avatar.backgroundColor)
    expect(tint.borderColor).toBe(avatar.color)
  })
})

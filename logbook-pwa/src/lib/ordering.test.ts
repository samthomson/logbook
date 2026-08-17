import { describe, expect, it } from 'vitest'
import type { Segment } from '../types/nostr'
import { computeSeedOrder, insertInCutOrder, nestDisplayOrder } from './ordering'

function segment(
  id: string,
  created_at: number,
  extra: Partial<Pick<Segment, 'respondingTo' | 'isIntro'>> = {},
): Segment {
  return {
    event: {
      id,
      pubkey: 'a'.repeat(64),
      created_at,
      kind: 4200,
      tags: [],
      content: '',
      sig: 'b'.repeat(128),
    },
    audio: { url: 'https://blossom.example/a', sha256: 'c'.repeat(64), mime: 'audio/webm', duration: 1, waveform: [] },
    isIntro: extra.isIntro ?? false,
    sectionId: 'sec',
    issueId: 'logbook-1',
    respondingTo: extra.respondingTo ?? null,
    alt: null,
  }
}

describe('computeSeedOrder', () => {
  it('places a reply immediately after the note it answers', () => {
    const a = segment('a', 1)
    const c = segment('c', 3)
    const b = segment('b', 2, { respondingTo: 'a' })
    expect(computeSeedOrder([a, c, b])).toEqual(['a', 'b', 'c'])
  })

  it('pins an intro at position 0', () => {
    const intro = segment('intro', 9, { isIntro: true })
    const a = segment('a', 1)
    expect(computeSeedOrder([a, intro])).toEqual(['intro', 'a'])
  })
})

describe('nestDisplayOrder', () => {
  it('nests a reply under its parent even if the cut listed it first', () => {
    const parent = segment('parent', 1)
    const reply = segment('reply', 2, { respondingTo: 'parent' })
    expect(nestDisplayOrder([parent, reply], ['reply', 'parent'])).toEqual([
      { id: 'parent', depth: 0 },
      { id: 'reply', depth: 1 },
    ])
  })
})

describe('insertInCutOrder', () => {
  it('inserts a reply after its parent in the cut', () => {
    const reply = segment('reply', 2, { respondingTo: 'parent' })
    expect(insertInCutOrder(['parent', 'other'], reply)).toEqual(['parent', 'reply', 'other'])
  })
})

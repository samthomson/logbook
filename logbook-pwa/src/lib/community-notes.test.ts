import { describe, expect, it } from 'vitest'
import type { Segment } from '../types/nostr'
import { collectEpisodeNotes } from './community-notes'

function segment(id: string, pubkey: string, created_at: number): Segment {
  return {
    event: { id, pubkey, created_at, kind: 4200, tags: [], content: '', sig: '' },
    audio: { url: `https://audio.example/${id}.wav`, sha256: 'a'.repeat(64), mime: 'audio/wav', duration: 1, waveform: [] },
    isIntro: false,
    sectionId: 'section',
    issueId: 'logbook-31',
    respondingTo: null,
    alt: null,
  }
}

describe('collectEpisodeNotes', () => {
  it('keeps every episode note visible once even when the active signer authored it or it appears in multiple section lists', () => {
    const own = segment('own', 'compass', 1)
    const alice = segment('alice', 'alice-pubkey', 3)
    const bob = segment('bob', 'bob-pubkey', 2)

    expect(collectEpisodeNotes([[own, alice], [bob, alice]]).map((note) => note.event.id)).toEqual(['own', 'bob', 'alice'])
  })
})

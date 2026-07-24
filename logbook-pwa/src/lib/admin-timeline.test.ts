import { describe, expect, it } from 'vitest'
import type { Segment } from '../types/nostr'
import { collectWhitelistedTimeline } from './admin-timeline'

const segment = (id: string, pubkey: string, createdAt: number, sectionId = 'sec-a'): Segment => ({
  event: {
    id,
    pubkey,
    created_at: createdAt,
    kind: 4200,
    tags: [['section', sectionId], ['issue', 'logbook-31']],
    content: JSON.stringify({ audio: { url: 'https://audio.example/' + id, sha256: 'a'.repeat(64), mime: 'audio/webm', duration: 1, waveform: [] }, isIntro: false }),
    sig: 'b'.repeat(128),
  },
  audio: { url: 'https://audio.example/' + id, sha256: 'a'.repeat(64), mime: 'audio/webm', duration: 1, waveform: [] },
  isIntro: false,
  sectionId,
  issueId: 'logbook-31',
  respondingTo: null,
  alt: null,
})

describe('collectWhitelistedTimeline', () => {
  it('returns every unique recording by an allowed identity in deterministic timeline order', () => {
    const alice = 'a'.repeat(64)
    const bob = 'b'.repeat(64)
    const hidden = 'c'.repeat(64)
    const late = segment('late', alice, 20, 'sec-b')
    const early = segment('early', bob, 10)

    expect(collectWhitelistedTimeline([[late, early], [early, segment('hidden', hidden, 15)]], new Set([alice, bob])))
      .toEqual([early, late])
  })

  it('uses event id as a stable tie-breaker', () => {
    const alice = 'a'.repeat(64)
    const z = segment('z-event', alice, 10)
    const a = segment('a-event', alice, 10)

    expect(collectWhitelistedTimeline([[z, a]], new Set([alice])).map((item) => item.event.id))
      .toEqual(['a-event', 'z-event'])
  })
})

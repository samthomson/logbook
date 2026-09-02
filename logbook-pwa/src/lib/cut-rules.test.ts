import { describe, expect, it } from 'vitest'
import { COMPASS_PUBKEY } from '../config'
import type { ManifestContent, NostrEvent, Segment } from '../types/nostr'
import {
  canMoveInCut,
  cutStateOf,
  isCutEligible,
  isReviewedInCut,
  sectionIndexHolding,
} from './cut-rules'

const ID = {
  intro: '1'.repeat(64),
  first: '2'.repeat(64),
  second: '3'.repeat(64),
  out: '4'.repeat(64),
  unknown: '5'.repeat(64),
}

function segment(pubkey: string): Segment {
  const event: NostrEvent = {
    id: ID.first,
    pubkey,
    created_at: 1,
    kind: 4200,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
  }
  return {
    event,
    sectionId: 'sec-one-31',
    issueId: 'logbook-31',
    isIntro: false,
    respondingTo: null,
    alt: null,
    audio: { url: 'https://blossom.example/a', sha256: 'c'.repeat(64), mime: 'audio/webm', duration: 2, waveform: [] },
  }
}

function content(): ManifestContent {
  return {
    issueRef: 'naddr1fixture',
    episodeStatus: 'draft',
    publishedRss: null,
    sections: [{
      id: 'sec-one-31',
      title: 'One',
      introEventId: ID.intro,
      sectionExcluded: false,
      order: [ID.intro, ID.first, ID.second],
      excluded: [ID.out],
      reviewed: [ID.first],
    }],
  }
}

describe('cut rules', () => {
  it('reports what is in the episode and what is only referenced', () => {
    expect(cutStateOf(content(), ID.first)).toBe('in')
    expect(cutStateOf(content(), ID.out)).toBe('out')
    expect(cutStateOf(content(), ID.unknown)).toBe('out')
    expect(cutStateOf(null, ID.first)).toBe('out')
  })

  it('finds the section that references a recording either way', () => {
    expect(sectionIndexHolding(content(), ID.first)).toBe(0)
    expect(sectionIndexHolding(content(), ID.out)).toBe(0)
    expect(sectionIndexHolding(content(), ID.unknown)).toBe(-1)
  })

  it('marks reviewed only from the manifest', () => {
    expect(isReviewedInCut(content(), ID.first)).toBe(true)
    expect(isReviewedInCut(content(), ID.second)).toBe(false)
  })

  it('admits only Compass and listed contributors into the cut', () => {
    const contributors = new Set(['a'.repeat(64)])
    expect(isCutEligible(segment('a'.repeat(64)), contributors)).toBe(true)
    expect(isCutEligible(segment(COMPASS_PUBKEY.toUpperCase()), contributors)).toBe(true)
    expect(isCutEligible(segment('d'.repeat(64)), contributors)).toBe(false)
    expect(isCutEligible(segment('a'.repeat(64)), null)).toBe(false)
  })

  it('keeps the intro pinned at the front when moving recordings', () => {
    const draft = content()
    expect(canMoveInCut(draft, ID.intro, 1)).toBe(false)
    // ID.first sits directly after the intro, so it cannot displace it.
    expect(canMoveInCut(draft, ID.first, -1)).toBe(false)
    expect(canMoveInCut(draft, ID.first, 1)).toBe(true)
    expect(canMoveInCut(draft, ID.second, -1)).toBe(true)
    expect(canMoveInCut(draft, ID.second, 1)).toBe(false)
    expect(canMoveInCut(draft, ID.out, -1)).toBe(false)
    expect(canMoveInCut(null, ID.first, 1)).toBe(false)
  })
})

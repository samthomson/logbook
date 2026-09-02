import { describe, expect, it } from 'vitest'
import { cutView, formatEventJson } from './event-inspect'
import type { NostrEvent } from '../types/nostr'

function event(content: unknown): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: 34200,
    tags: [['d', 'logbook-34'], ['title', 'Logbook Episode 34']],
    content: typeof content === 'string' ? content : JSON.stringify(content),
    sig: 'c'.repeat(128),
  }
}

describe('formatEventJson', () => {
  it('expands JSON content instead of leaving it as one escaped string', () => {
    const json = formatEventJson(event({
      episodeStatus: 'published',
      issueRef: 'naddr1',
      sections: [],
    }))
    expect(json).toContain('\n')
    expect(json).toContain('"episodeStatus": "published"')
    expect(json).not.toContain('\\"episodeStatus\\"')
  })
})

describe('cutView', () => {
  it('lists recording ids in cut order and those left out', () => {
    const view = cutView(event({
      episodeStatus: 'draft',
      issueRef: 'naddr1',
      sections: [{
        id: 'sec-lead-34',
        title: 'Lead stories',
        introEventId: null,
        order: ['1111', '2222'],
        excluded: ['2222'],
        reviewed: [],
      }],
      publishedRss: null,
    }))
    expect(view).toEqual({
      status: 'draft',
      chapters: [{
        title: 'Lead stories',
        inCut: ['1111'],
        leftOut: ['2222'],
      }],
    })
  })
})

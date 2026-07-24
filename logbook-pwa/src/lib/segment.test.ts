import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { parseSegment, selectTrustedSegmentEvents, selectTrustedTranscripts } from './segment'

const HASH = 'a'.repeat(64)
const SERVERS = ['https://blossom.example']

function segment(issueId = 'logbook-31', url = `https://blossom.example/${HASH}`) {
  return finalizeEvent({
    kind: 4200,
    created_at: 1,
    tags: [
      ['x', HASH],
      ['section', 'sec-one-31'],
      ['issue', issueId],
      ['t', issueId],
    ],
    content: JSON.stringify({
      audio: { url, sha256: HASH, mime: 'audio/webm', duration: 2, waveform: [] },
      isIntro: false,
    }),
  }, generateSecretKey())
}

describe('selectTrustedSegmentEvents', () => {
  it('accepts only signed, issue-matched events with consistent hash metadata and a trusted blob URL', () => {
    const valid = segment()
    const forged = { ...segment(), pubkey: valid.pubkey, sig: '0'.repeat(128) }
    const wrongIssue = segment('logbook-32')
    const wrongUrl = segment('logbook-31', `https://evil.example/${HASH}`)

    expect(selectTrustedSegmentEvents([forged, wrongIssue, wrongUrl, valid], 'logbook-31', SERVERS)).toEqual([valid])
  })

  it('rejects an x tag that differs from the audio hash', () => {
    const event = segment()
    const key = generateSecretKey()
    const mismatched = finalizeEvent({
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags.map((tag) => tag[0] === 'x' ? ['x', 'b'.repeat(64)] : tag),
      content: event.content,
    }, key)
    expect(selectTrustedSegmentEvents([mismatched], 'logbook-31', SERVERS)).toEqual([])
  })
})

describe('selectTrustedTranscripts', () => {
  it('accepts only verified same-author companions and selects newest deterministically', () => {
    const author = generateSecretKey()
    const other = generateSecretKey()
    const segmentEvent = finalizeEvent({
      kind: 4200,
      created_at: 1,
      tags: [['x', HASH], ['section', 'sec-one-31'], ['issue', 'logbook-31'], ['t', 'logbook-31']],
      content: JSON.stringify({
        audio: { url: `https://blossom.example/${HASH}`, sha256: HASH, mime: 'audio/webm', duration: 2, waveform: [] },
        isIntro: false,
      }),
    }, author)
    const parsedSegment = parseSegment(segmentEvent)!
    const makeTranscript = (text: string, createdAt: number, key = author) => finalizeEvent({
      kind: 1111,
      created_at: createdAt,
      tags: [['e', segmentEvent.id, '', 'root'], ['k', '4200']],
      content: text,
    }, key)
    const older = makeTranscript(JSON.stringify({ text: 'older' }), 2)
    const newest = makeTranscript('newest', 3)
    const wrongAuthor = makeTranscript('wrong author', 4, other)
    const forged = { ...newest, sig: '0'.repeat(128) }

    expect(selectTrustedTranscripts(
      [parsedSegment],
      [wrongAuthor, forged, older, newest],
    ).get(segmentEvent.id)?.text).toBe('newest')
  })

  it('rejects a transcript with the wrong target-kind relationship', () => {
    const author = generateSecretKey()
    const segmentEvent = finalizeEvent({
      kind: 4200,
      created_at: 1,
      tags: [['x', HASH], ['section', 'sec-one-31'], ['issue', 'logbook-31'], ['t', 'logbook-31']],
      content: JSON.stringify({
        audio: { url: `https://blossom.example/${HASH}`, sha256: HASH, mime: 'audio/webm', duration: 2, waveform: [] },
        isIntro: false,
      }),
    }, author)
    const invalid = finalizeEvent({
      kind: 1111,
      created_at: 2,
      tags: [['e', segmentEvent.id], ['k', '1']],
      content: 'invalid',
    }, author)
    expect(selectTrustedTranscripts([parseSegment(segmentEvent)!], [invalid]).size).toBe(0)
  })
})

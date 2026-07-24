import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { selectTrustedSegmentEvents } from './segment'

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

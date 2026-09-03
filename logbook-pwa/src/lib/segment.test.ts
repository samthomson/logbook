import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { publishToRelays } from './relay'
import { mergeSegmentEventGroups, parseSegment, publishSegment, publishTranscript, selectRetranscribeRequests, selectTrustedSegmentEvents, selectTrustedTranscripts } from './segment'
import type { NostrEvent, NostrSigner } from '../types/nostr'

vi.mock('./relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relay')>()
  return { ...actual, publishToRelays: vi.fn() }
})

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

describe('mergeSegmentEventGroups', () => {
  it('preserves live arrivals while deduplicating a completed query snapshot', () => {
    const queried = segment()
    const live = segment()
    const merged = mergeSegmentEventGroups(
      new Map([['sec-one-31', [queried]]]),
      [live, queried],
    )

    expect(merged.get('sec-one-31')?.map((event) => event.id)).toEqual([queried.id, live.id])
  })
})

describe('selectTrustedTranscripts', () => {
  it('uses a verified Compass fallback only when no verified same-author transcript exists', () => {
    const author = generateSecretKey()
    const compass = generateSecretKey()
    const segmentEvent = finalizeEvent({
      kind: 4200,
      created_at: 1,
      tags: [['x', HASH], ['section', 'sec-one-31'], ['issue', 'logbook-31'], ['t', 'logbook-31']],
      content: JSON.stringify({ audio: { url: `https://blossom.example/${HASH}`, sha256: HASH, mime: 'audio/webm', duration: 2, waveform: [] }, isIntro: false }),
    }, author)
    const fallback = finalizeEvent({ kind: 1111, created_at: 4, tags: [['e', segmentEvent.id, '', 'root'], ['k', '4200']], content: 'Compass fallback' }, compass)
    const malformedNewer = finalizeEvent({ kind: 1111, created_at: 5, tags: [['e', segmentEvent.id], ['k', '1']], content: 'bad' }, compass)
    const primary = finalizeEvent({ kind: 1111, created_at: 3, tags: [['e', segmentEvent.id, '', 'root'], ['k', '4200']], content: 'Author primary' }, author)

    expect(selectTrustedTranscripts([parseSegment(segmentEvent)!], [fallback, malformedNewer], compass && fallback.pubkey).get(segmentEvent.id)?.text).toBe('Compass fallback')
    expect(selectTrustedTranscripts([parseSegment(segmentEvent)!], [fallback, primary], fallback.pubkey).get(segmentEvent.id)?.text).toBe('Author primary')
  })

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

  it('surfaces sentence chunks from worker transcripts and drops malformed timestamps', () => {
    const fallback = generateSecretKey()
    const segmentEvent = segment()
    const parsedSegment = parseSegment(segmentEvent)!
    const transcript = finalizeEvent({
      kind: 1111,
      created_at: 2,
      tags: [['e', segmentEvent.id, '', 'root'], ['k', '4200']],
      content: JSON.stringify({
        text: 'hello world',
        chunks: [
          { text: 'hello', timestamp: [0, 1.5] },
          { text: 'dropped', timestamp: ['x', 2] },
          { text: 'world', timestamp: [1.5, 2.6] },
        ],
      }),
    }, fallback)

    const selected = selectTrustedTranscripts([parsedSegment], [transcript], getPublicKey(fallback)).get(segmentEvent.id)!

    expect(selected.text).toBe('hello world')
    expect(selected.chunks).toEqual([
      { text: 'hello', timestamp: [0, 1.5] },
      { text: 'world', timestamp: [1.5, 2.6] },
    ])
  })

  it('treats a plain-text transcript as chunkless', () => {
    const segmentEvent = segment()
    const fallback = generateSecretKey()
    const transcript = finalizeEvent({
      kind: 1111,
      created_at: 2,
      tags: [['e', segmentEvent.id, '', 'root'], ['k', '4200']],
      content: 'spoken words',
    }, fallback)

    const selected = selectTrustedTranscripts([parseSegment(segmentEvent)!], [transcript], getPublicKey(fallback)).get(segmentEvent.id)!
    expect(selected.text).toBe('spoken words')
    expect(selected.chunks).toEqual([])
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

describe('publishTranscript authorization', () => {
  it('does not sign when the live signer identity differs from the authenticated principal', async () => {
    const signEvent = vi.fn()
    const signer: NostrSigner = {
      getPublicKey: async () => 'b'.repeat(64),
      signEvent,
    }

    await expect(publishTranscript(
      segment(),
      'fixture transcript',
      signer,
      'a'.repeat(64),
      ['wss://relay.example'],
      undefined,
    )).rejects.toThrow(/signer identity changed/i)
    expect(signEvent).not.toHaveBeenCalled()
    expect(publishToRelays).not.toHaveBeenCalled()
  })

  it('revalidates signer identity immediately before transcript publication', async () => {
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls === 1 ? 'a' : 'b').repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'd'.repeat(64),
        sig: 'e'.repeat(128),
      }) as NostrEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishTranscript(
      segment(),
      'fixture transcript',
      signer,
      'a'.repeat(64),
      ['wss://relay.example'],
    )).rejects.toThrow(/signer identity changed/i)
    expect(identityCalls).toBeGreaterThanOrEqual(2)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not sign after authorization is revoked during identity lookup', async () => {
    let active = true
    const signEvent = vi.fn(async (event) => ({
      ...event,
      id: 'd'.repeat(64),
      sig: 'e'.repeat(128),
    }) as NostrEvent)
    const signer: NostrSigner = {
      getPublicKey: async () => {
        active = false
        return 'a'.repeat(64)
      },
      signEvent,
    }

    await expect(publishTranscript(
      segment(),
      'fixture transcript',
      signer,
      'a'.repeat(64),
      ['wss://relay.example'],
      () => {
        if (!active) throw new Error('Publishing authorization was revoked.')
      },
    )).rejects.toThrow('Publishing authorization was revoked.')
    expect(signEvent).not.toHaveBeenCalled()
  })

  it('rejects when authorization is revoked while awaiting relay acknowledgement', async () => {
    let active = true
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()
    relayPublish.mockImplementationOnce(async () => {
      active = false
    })
    const signer: NostrSigner = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'd'.repeat(64),
        sig: 'e'.repeat(128),
      }) as NostrEvent,
    }

    await expect(publishTranscript(
      segment(),
      'fixture transcript',
      signer,
      'a'.repeat(64),
      ['wss://relay.example'],
      () => {
        if (!active) throw new Error('Publishing authorization was revoked.')
      },
    )).rejects.toThrow('Publishing authorization was revoked.')
    expect(relayPublish).toHaveBeenCalledOnce()
  })
})

describe('publishSegment authorization', () => {
  it('does not sign or publish when the live signer identity differs from the authenticated principal', async () => {
    const signEvent = vi.fn()
    const signer: NostrSigner = {
      getPublicKey: async () => 'b'.repeat(64),
      signEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishSegment({
      signer,
      expectedPubkey: 'a'.repeat(64),
      blob: {
        url: `https://blossom.example/${HASH}`,
        sha256: HASH,
        size: 1024,
        mime: 'audio/webm',
        uploaded: 1,
      },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://relay.example'],
    })).rejects.toThrow(/signer identity changed/i)
    expect(signEvent).not.toHaveBeenCalled()
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not publish when the signer changes identity while signing', async () => {
    const signer: NostrSigner = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async (event) => ({
        ...event,
        pubkey: 'b'.repeat(64),
        id: 'c'.repeat(64),
        sig: 'd'.repeat(128),
      }) as NostrEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishSegment({
      signer,
      expectedPubkey: 'a'.repeat(64),
      blob: {
        url: `https://blossom.example/${HASH}`,
        sha256: HASH,
        size: 1024,
        mime: 'audio/webm',
        uploaded: 1,
      },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://relay.example'],
    })).rejects.toThrow(/signer identity changed/i)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('revalidates signer identity immediately before relay publication', async () => {
    let identityCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => (++identityCalls === 1 ? 'a' : 'b').repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'c'.repeat(64),
        sig: 'd'.repeat(128),
      }) as NostrEvent,
    }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()

    await expect(publishSegment({
      signer,
      expectedPubkey: 'a'.repeat(64),
      blob: {
        url: `https://blossom.example/${HASH}`,
        sha256: HASH,
        size: 1024,
        mime: 'audio/webm',
        uploaded: 1,
      },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://relay.example'],
    })).rejects.toThrow(/signer identity changed/i)
    expect(identityCalls).toBeGreaterThanOrEqual(2)
    expect(relayPublish).not.toHaveBeenCalled()
  })

  it('does not sign or publish after authorization is revoked during an awaited signer step', async () => {
    let active = true
    let signCalls = 0
    const signer: NostrSigner = {
      getPublicKey: async () => {
        active = false
        return 'a'.repeat(64)
      },
      signEvent: async (event) => {
        signCalls += 1
        return { ...event, id: 'b'.repeat(64), sig: 'c'.repeat(128) } as NostrEvent
      },
    }

    await expect(publishSegment({
      signer,
      expectedPubkey: 'a'.repeat(64),
      blob: {
        url: `https://blossom.example/${HASH}`,
        sha256: HASH,
        size: 1024,
        mime: 'audio/webm',
        uploaded: 1,
      },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://relay.example'],
      assertActive: () => {
        if (!active) throw new Error('Publishing authorization was revoked.')
      },
    })).rejects.toThrow('Publishing authorization was revoked.')
    expect(signCalls).toBe(0)
  })

  it('rejects after relay acknowledgement when authorization is revoked while awaiting it', async () => {
    let active = true
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()
    relayPublish.mockImplementationOnce(async () => {
      active = false
    })
    const signer: NostrSigner = {
      getPublicKey: async () => 'a'.repeat(64),
      signEvent: async (event) => ({
        ...event,
        id: 'b'.repeat(64),
        sig: 'c'.repeat(128),
      }) as NostrEvent,
    }

    await expect(publishSegment({
      signer,
      expectedPubkey: 'a'.repeat(64),
      blob: {
        url: `https://blossom.example/${HASH}`,
        sha256: HASH,
        size: 1024,
        mime: 'audio/webm',
        uploaded: 1,
      },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://relay.example'],
      assertActive: () => {
        if (!active) throw new Error('Publishing authorization was revoked.')
      },
    })).rejects.toThrow('Publishing authorization was revoked.')
    expect(relayPublish).toHaveBeenCalledOnce()
  })

  it('persists and reuses the exact signed event after ambiguous relay failure', async () => {
    const key = generateSecretKey()
    const expectedPubkey = getPublicKey(key)
    const signEvent = vi.fn(async (event) => finalizeEvent(event, key))
    const signer: NostrSigner = { getPublicKey: async () => expectedPubkey, signEvent }
    const relayPublish = vi.mocked(publishToRelays)
    relayPublish.mockClear()
    relayPublish.mockRejectedValueOnce(new Error('Only 1 of 2 required relays accepted the event'))
    relayPublish.mockResolvedValueOnce(undefined)
    let saved: NostrEvent | null = null
    const params = {
      signer,
      expectedPubkey,
      blob: { url: `https://blossom.example/${HASH}`, sha256: HASH, size: 1024, mime: 'audio/webm', uploaded: 1 },
      duration: 2,
      waveform: [],
      sectionId: 'sec-one-31',
      issueNumber: 31,
      relays: ['wss://one.test', 'wss://two.test'],
      onSigned: async (event: NostrEvent) => { saved = event },
    }

    await expect(publishSegment(params)).rejects.toThrow(/only 1 of 2/i)
    expect(saved).not.toBeNull()
    const retried = await publishSegment({ ...params, signedEvent: saved })
    expect(retried.id).toBe(saved!.id)
    expect(signEvent).toHaveBeenCalledOnce()
    expect(relayPublish).toHaveBeenNthCalledWith(1, saved, params.relays)
    expect(relayPublish).toHaveBeenNthCalledWith(2, saved, params.relays)
  })
})

describe('selectRetranscribeRequests', () => {
  const producer = generateSecretKey()
  const producers = new Set([getPublicKey(producer)])
  function retranscribeRequest(author: Uint8Array, segmentId: string, created_at: number): NostrEvent {
    return finalizeEvent({
      kind: 34202,
      created_at,
      tags: [['e', segmentId]],
      content: '',
    }, author)
  }

  it('keeps the newest verified producer request per segment', () => {
    const seg = parseSegment(segment())!
    const newest = retranscribeRequest(producer, seg.event.id, 3000)

    const map = selectRetranscribeRequests(
      [seg],
      [retranscribeRequest(producer, seg.event.id, 2000), newest],
      producers,
    )

    expect(map.get(seg.event.id)).toBe(3000)
  })

  it('ignores requests from outside the producer set and kind 7 reactions', () => {
    const seg = parseSegment(segment())!
    const outsider = retranscribeRequest(generateSecretKey(), seg.event.id, 3000)
    const reaction = finalizeEvent({
      kind: 7,
      created_at: 3000,
      tags: [['e', seg.event.id]],
      content: '🔁',
    }, producer)
    const otherNote = retranscribeRequest(producer, 'f'.repeat(64), 3000)

    const map = selectRetranscribeRequests([seg], [outsider, reaction, otherNote], producers)

    expect(map.size).toBe(0)
  })
})

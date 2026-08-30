import assert from 'node:assert/strict'
import test from 'node:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'

// Config reads COMPASS_PUBKEY at import time; a real keypair here lets the
// tests sign genuine Compass-fallback transcripts for the coverage checks.
import type { TranscribeSweepDependencies } from '../transcribe-segments.ts'

const compassKey = generateSecretKey()
process.env.COMPASS_PUBKEY = getPublicKey(compassKey)

const { runTranscribeSweep, parseWhisperTranscription } =
  await import('../transcribe-segments.ts')

const producerKey = generateSecretKey()
const PRODUCER = getPublicKey(producerKey)
const COMPASS = getPublicKey(compassKey)
const OTHER_KEY = generateSecretKey()

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)
const SHA_E = 'e'.repeat(64)
const SHA_F = 'f'.repeat(64)
const SHA_G = '0'.repeat(64)

function segmentEvent(author: Uint8Array, issueId: string, sha: string): NostrEvent {
  return finalizeEvent({
    kind: 4200,
    created_at: 1000,
    tags: [['x', sha], ['section', 'sec-1'], ['issue', issueId], ['t', issueId]],
    content: JSON.stringify({
      audio: { url: `https://blossom.test/${sha}`, sha256: sha, mime: 'audio/webm', duration: 30, waveform: [] },
      isIntro: false,
    }),
  }, author)
}

function transcriptEvent(author: Uint8Array, segmentId: string, content: string, created_at = 2000): NostrEvent {
  return finalizeEvent({
    kind: 1111,
    created_at,
    tags: [['e', segmentId, '', 'root'], ['k', '4200']],
    content,
  }, author)
}

function manifestEvent(author: Uint8Array, issueId: string): NostrEvent {
  return finalizeEvent({
    kind: 34200,
    created_at: 500,
    tags: [['d', issueId]],
    content: JSON.stringify({ episodeStatus: 'draft', sections: [] }),
  }, author)
}

interface Recorded {
  published: NostrEvent[]
  removedWorkDirs: string[]
}

function makeDeps(
  overrides: Partial<TranscribeSweepDependencies> = {},
): { deps: TranscribeSweepDependencies; recorded: Recorded } {
  const recorded: Recorded = { published: [], removedWorkDirs: [] }
  const deps: TranscribeSweepDependencies = {
    fetchManifests: async () => [manifestEvent(producerKey, 'logbook-31')],
    expectedPubkey: PRODUCER,
    verify: () => true,
    fetchSegments: async () => [],
    fetchTranscriptEvents: async () => [],
    fetchRetranscribeRequests: async () => [],
    downloadVerified: async () => {},
    transcribe: () => ({ text: 'hello world', chunks: [{ text: 'hello world', timestamp: [0, 1.5] }] }),
    makeWorkDir: () => '/tmp/fake-workdir',
    removeWorkDir: (dir) => { recorded.removedWorkDirs.push(dir) },
    signEvent: async (unsigned) => ({
      ...unsigned,
      id: 'f'.repeat(64),
      pubkey: COMPASS,
      sig: 'f'.repeat(128),
    }) as NostrEvent,
    publish: async (event) => { recorded.published.push(event) },
    ...overrides,
  }
  return { deps, recorded }
}

test('transcribes an uncovered segment and publishes a chunked companion event', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const { deps, recorded } = makeDeps({ fetchSegments: async () => [segment] })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.transcribed, 1)
  assert.equal(result.missing, 1)
  assert.equal(result.skipped, 0)
  assert.equal(recorded.published.length, 1)
  const event = recorded.published[0]
  assert.equal(event.kind, 1111)
  assert.deepEqual(
    event.tags.find(([key]) => key === 'e'),
    ['e', segment.id, '', 'root'],
  )
  assert.deepEqual(event.tags.find(([key]) => key === 'k'), ['k', '4200'])
  assert.deepEqual(event.tags.find(([key]) => key === 'issue'), ['issue', 'logbook-31'])
  const content = JSON.parse(event.content) as { text: string; chunks: unknown[] }
  assert.equal(content.text, 'hello world')
  assert.equal(content.chunks.length, 1)
  assert.deepEqual(recorded.removedWorkDirs, ['/tmp/fake-workdir'])
})

test('a verified author or Compass transcript covers the segment; spam does not', async () => {
  const authorSegment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const compassSegment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_B)
  const forgedTarget = segmentEvent(OTHER_KEY, 'logbook-31', SHA_C)
  const thirdPartyTarget = segmentEvent(OTHER_KEY, 'logbook-31', SHA_D)
  const covered = [
    transcriptEvent(OTHER_KEY, authorSegment.id, 'author supplied'),
    transcriptEvent(compassKey, compassSegment.id, 'compass supplied'),
    { ...transcriptEvent(OTHER_KEY, forgedTarget.id, 'bad signature'), sig: '0'.repeat(128) },
    transcriptEvent(generateSecretKey(), thirdPartyTarget.id, 'third party'),
  ]
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [authorSegment, compassSegment, forgedTarget, thirdPartyTarget],
    fetchTranscriptEvents: async () => covered,
  })

  const result = await runTranscribeSweep(deps)

  // Only the forged-signature and third-party targets still need transcripts;
  // neither suppression hole is exploitable by relay content.
  assert.equal(result.missing, 2)
  assert.equal(result.transcribed, 2)
  assert.deepEqual(
    recorded.published.map((event) => event.tags.find(([key]) => key === 'e')?.[1]),
    [forgedTarget.id, thirdPartyTarget.id],
  )
})

function retranscribeRequest(author: Uint8Array, segmentId: string, created_at: number): NostrEvent {
  return finalizeEvent({
    kind: 34202,
    created_at,
    tags: [['e', segmentId]],
    content: '',
  }, author)
}

test('a kind 7 reaction from a producer is not a retranscribe request', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const covered = transcriptEvent(OTHER_KEY, segment.id, 'old text', 2000)
  const reaction = finalizeEvent({
    kind: 7,
    created_at: 3000,
    tags: [['e', segment.id]],
    content: '🔁',
  }, producerKey)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    fetchTranscriptEvents: async () => [covered],
    fetchRetranscribeRequests: async () => [reaction],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 0)
  assert.equal(recorded.published.length, 0)
})

test('a producer request newer than the companion retranscribes it', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const covered = transcriptEvent(OTHER_KEY, segment.id, 'old text', 2000)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    fetchTranscriptEvents: async () => [covered],
    fetchRetranscribeRequests: async () => [retranscribeRequest(producerKey, segment.id, 3000)],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 1)
  assert.equal(result.transcribed, 1)
  assert.equal(recorded.published.length, 1)
})

test('a request from outside the producer set is ignored', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const covered = transcriptEvent(OTHER_KEY, segment.id, 'old text', 2000)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    fetchTranscriptEvents: async () => [covered],
    fetchRetranscribeRequests: async () => [retranscribeRequest(OTHER_KEY, segment.id, 3000)],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 0)
  assert.equal(recorded.published.length, 0)
})

test('a request older than the companion it asked to redo is satisfied', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const covered = transcriptEvent(OTHER_KEY, segment.id, 'redone text', 4000)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    fetchTranscriptEvents: async () => [covered],
    fetchRetranscribeRequests: async () => [retranscribeRequest(producerKey, segment.id, 3000)],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 0)
  assert.equal(recorded.published.length, 0)
})

test('retranscribeAll redoes a covered segment with no request at all', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const covered = transcriptEvent(OTHER_KEY, segment.id, 'old text', 2000)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    fetchTranscriptEvents: async () => [covered],
  })

  const result = await runTranscribeSweep(deps, { retranscribeAll: true })

  assert.equal(result.missing, 1)
  assert.equal(result.transcribed, 1)
  assert.equal(recorded.published.length, 1)
})

test('segments of issues without a verified trusted manifest are out of scope', async () => {
  const inScope = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const otherIssue = segmentEvent(OTHER_KEY, 'logbook-99', SHA_B)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [inScope, otherIssue],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 1)
  assert.deepEqual(
    recorded.published.map((event) => event.tags.find(([key]) => key === 'e')?.[1]),
    [inScope.id],
  )
})

test('a manifest from outside the producer set never widens scope', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-77', SHA_A)
  const { deps } = makeDeps({
    fetchManifests: async () => [manifestEvent(generateSecretKey(), 'logbook-77')],
    fetchSegments: async () => [segment],
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.missing, 0)
})

test('unverifiable segments are skipped, not fatal', async () => {
  const good = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const badSignature = { ...segmentEvent(OTHER_KEY, 'logbook-31', SHA_B), sig: '0'.repeat(128) }
  const { deps, recorded } = makeDeps({ fetchSegments: async () => [good, badSignature] })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.transcribed, 1)
  assert.equal(result.skipped, 0)
  assert.deepEqual(
    recorded.published.map((event) => event.tags.find(([key]) => key === 'e')?.[1]),
    [good.id],
  )
})

test('the per-sweep cap defers the backlog to the next tick', async () => {
  const segments = [SHA_A, SHA_B, SHA_C, SHA_D, SHA_E, SHA_F, SHA_G].map(
    (sha, i) => segmentEvent(generateSecretKey(i), 'logbook-31', sha),
  )
  let askedFor: string[] = []
  const { deps } = makeDeps({
    fetchSegments: async () => segments,
    fetchTranscriptEvents: async (ids) => { askedFor = ids; return [] },
  })

  const result = await runTranscribeSweep(deps, { maxPerSweep: 2 })

  assert.equal(result.transcribed, 2)
  assert.equal(result.deferred, 5)
  assert.equal(askedFor.length, 7)
})

test('empty whisper output skips the segment without publishing', async () => {
  const segment = segmentEvent(OTHER_KEY, 'logbook-31', SHA_A)
  const { deps, recorded } = makeDeps({
    fetchSegments: async () => [segment],
    transcribe: () => ({ text: '', chunks: [] }),
  })

  const result = await runTranscribeSweep(deps)

  assert.equal(result.skipped, 1)
  assert.equal(recorded.published.length, 0)
})

test('signer failure aborts the sweep so a dead bunker is not hammered', async () => {
  const segments = [SHA_A, SHA_B].map((sha) => segmentEvent(OTHER_KEY, 'logbook-31', sha))
  let published = 0
  const { deps } = makeDeps({
    fetchSegments: async () => segments,
    signEvent: async () => {
      if (published === 1) throw new Error('bunker unavailable')
      published++
      return { kind: 1111, created_at: 0, tags: [], content: '', id: '0'.repeat(64), pubkey: COMPASS, sig: '0'.repeat(128) }
    },
  })

  await assert.rejects(runTranscribeSweep(deps), /bunker unavailable/)
})

test('parseWhisperTranscription converts millisecond offsets to second chunks', () => {
  const json = JSON.stringify({
    transcription: [
      { text: ' hello', offsets: { from: 0, to: 1500 }, tokens: [' h', 'ello'] },
      { text: ' world', offsets: { from: 1500, to: 2600 } },
      { text: '  ', offsets: { from: 2600, to: 3000 } },
      { text: ' dropped', offsets: { from: 'x', to: 3000 } },
    ],
  })

  const parsed = parseWhisperTranscription(json)

  assert.equal(parsed.text, 'hello world')
  assert.deepEqual(parsed.chunks, [
    { text: 'hello', timestamp: [0, 1.5] },
    { text: 'world', timestamp: [1.5, 2.6] },
  ])
})

test('parseWhisperTranscription rejects output with no usable segments', () => {
  assert.throws(() => parseWhisperTranscription('not json'))
  assert.throws(() => parseWhisperTranscription('{"other":1}'))
  assert.throws(() => parseWhisperTranscription('{"transcription":[]}'))
})

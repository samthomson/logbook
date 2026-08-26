import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertRunMatchesManifest,
  FileReleaseLedger,
  manifestRevision,
  runReleaseStages,
  sameLockedCut,
  type ReleaseLedger,
} from '../release-state.ts'

const event = {
  id: 'a'.repeat(64),
  created_at: 100,
  tags: [['d', 'logbook-31']],
  content: JSON.stringify({ episodeStatus: 'cutting', sections: [] }),
}
const revision = manifestRevision(event)

function memoryLedger(): { ledger: ReleaseLedger; saves: number } {
  let current: ReleaseLedger | null = null
  let saves = 0
  return {
    get saves() { return saves },
    ledger: {
      load: () => current,
      save: (next) => { current = structuredClone(next); saves += 1 },
    },
  }
}

test('run metadata accepts a progress rewrite of the same locked cut', () => {
  const progressed = manifestRevision({
    id: 'b'.repeat(64),
    created_at: 101,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify({
      episodeStatus: 'cutting',
      sections: [],
      release: { completed: ['audio'] },
    }),
  })
  assert.equal(sameLockedCut(revision, progressed), true)
  assert.doesNotThrow(() => assertRunMatchesManifest({ manifest: revision }, progressed))
})

test('run metadata refuses a different cut', () => {
  const other = manifestRevision({
    id: 'b'.repeat(64),
    created_at: 101,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify({ episodeStatus: 'cutting', sections: [{ id: 'other' }] }),
  })
  assert.throws(
    () => assertRunMatchesManifest({ manifest: revision }, other),
    /different verified manifest revision/,
  )
})

test('release stages resume durably without duplicating acknowledged external stages', async () => {
  const store = memoryLedger()
  const calls: string[] = []
  let failAnnouncement = true
  const stages = {
    artifacts: async () => { calls.push('artifacts') },
    feed: async () => { calls.push('feed') },
    podstr: async () => { calls.push('podstr') },
    announcement: async () => {
      calls.push('announcement')
      if (failAnnouncement) throw new Error('relay rejected announcement')
    },
    manifest: async () => { calls.push('manifest') },
  }
  const current = async () => revision

  await assert.rejects(() => runReleaseStages({ ledger: store.ledger, revision, current, stages }), /announcement/)
  assert.deepEqual(calls, ['artifacts', 'feed', 'podstr', 'announcement'])

  failAnnouncement = false
  await runReleaseStages({ ledger: store.ledger, revision, current, stages })
  assert.deepEqual(calls, ['artifacts', 'feed', 'podstr', 'announcement', 'announcement', 'manifest'])
  assert.equal(store.ledger.load()?.terminal, true)
})

test('release continues when the cutting revision only gained progress fields', async () => {
  const progressed = manifestRevision({
    id: 'b'.repeat(64),
    created_at: 101,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify({
      episodeStatus: 'cutting',
      sections: [],
      release: { completed: ['audio'] },
    }),
  })
  const store = memoryLedger()
  const calls: string[] = []
  await runReleaseStages({
    ledger: store.ledger,
    revision,
    current: async () => progressed,
    stages: {
      artifacts: async () => { calls.push('artifacts') },
      feed: async () => { calls.push('feed') },
      podstr: async () => { calls.push('podstr') },
      announcement: async () => { calls.push('announcement') },
      manifest: async () => { calls.push('manifest') },
    },
  })
  assert.deepEqual(calls, ['artifacts', 'feed', 'podstr', 'announcement', 'manifest'])
  assert.equal(store.ledger.load()?.terminal, true)
})

test('release refuses a stale manifest before every external stage and never records terminal success', async () => {
  const store = memoryLedger()
  const calls: string[] = []
  const handedBack = manifestRevision({
    id: 'c'.repeat(64),
    created_at: 102,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify({ episodeStatus: 'draft', sections: [] }),
  })
  let check = 0
  await assert.rejects(
    () => runReleaseStages({
      ledger: store.ledger,
      revision,
      current: async () => (++check === 3 ? handedBack : revision),
      stages: {
        artifacts: async () => { calls.push('artifacts') },
        feed: async () => { calls.push('feed') },
        podstr: async () => { calls.push('podstr') },
        announcement: async () => { calls.push('announcement') },
        manifest: async () => { calls.push('manifest') },
      },
    }),
    /stale or mismatched manifest revision/,
  )
  assert.deepEqual(calls, ['artifacts', 'feed'])
  assert.equal(store.ledger.load()?.terminal, false)
})

test('filesystem ledger creates its root before the first state write', () => {
  const root = `/tmp/logbook-release-ledger-${process.pid}-${Date.now()}`
  const ledger = new FileReleaseLedger(root, 'logbook-31')
  ledger.save({ revision, completed: {}, terminal: false })
  assert.deepEqual(ledger.load(), { revision, completed: {}, terminal: false })
})

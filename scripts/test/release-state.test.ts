import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  assertRunMatchesManifest,
  FileReleaseLedger,
  manifestRevision,
  runReleaseStages,
  type ReleaseLedger,
} from '../release-state.ts'

const revision = manifestRevision({
  id: 'a'.repeat(64),
  created_at: 100,
  tags: [['d', 'logbook-31']],
  content: JSON.stringify({ episodeStatus: 'cutting', sections: [] }),
})

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

test('run metadata is bound to the exact verified manifest event, timestamp, d-tag, and content digest', () => {
  const run = { manifest: revision }
  assert.doesNotThrow(() => assertRunMatchesManifest(run, revision))
  assert.throws(
    () => assertRunMatchesManifest(run, { ...revision, contentDigest: 'b'.repeat(64) }),
    /different verified manifest revision/,
  )
  assert.equal(revision.contentDigest, createHash('sha256').update(revision.content).digest('hex'))
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

test('release refuses a stale manifest before every external stage and never records terminal success', async () => {
  const store = memoryLedger()
  const calls: string[] = []
  let check = 0
  await assert.rejects(
    () => runReleaseStages({
      ledger: store.ledger,
      revision,
      current: async () => (++check === 3 ? { ...revision, id: 'c'.repeat(64) } : revision),
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

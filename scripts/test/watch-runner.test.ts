import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManifestEvent } from '../watch-state.ts'
import { runWatcherCycle } from '../watch-runner.ts'

const COMPASS = 'compass'
function manifest(id: string, created_at: number, status: string): ManifestEvent {
  return {
    id,
    created_at,
    pubkey: COMPASS,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify({ episodeStatus: status }),
  }
}

test('watcher cycle revalidates the exact latest cutting revision before side effects', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const draft = manifest('draft', 2, 'draft')
  const calls: string[] = []
  let fetchCount = 0
  const stitched = new Set<string>()
  const result = await runWatcherCycle(stitched, {
    fetchManifests: async () => (++fetchCount === 1 ? [cutting] : [cutting, draft]),
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId) => { calls.push(`publish:${issueId}`); return 0 },
  })
  assert.deepEqual(calls, [])
  assert.deepEqual(result, [{ issueId: 'logbook-31', outcome: 'stale' }])
  assert.equal(stitched.size, 0)
})

test('watcher cycle runs stitch then publish once for an exact revalidated revision', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const calls: string[] = []
  const stitched = new Set<string>()
  const deps = {
    fetchManifests: async () => [cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); return 0 },
  }
  assert.deepEqual(await runWatcherCycle(stitched, deps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
  assert.deepEqual(await runWatcherCycle(stitched, deps), [])

  const replacement = manifest('replacement-cutting', 2, 'cutting')
  const replacementDeps = { ...deps, fetchManifests: async () => [cutting, replacement] }
  assert.deepEqual(await runWatcherCycle(stitched, replacementDeps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.equal(stitched.has('replacement-cutting'), true)
})

test('watcher cycle retries a failed stage on a later cycle', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const stitched = new Set<string>()
  let stitchStatus = 1
  const deps = {
    fetchManifests: async () => [cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: () => stitchStatus,
    runPublish: () => 0,
  }
  assert.deepEqual(await runWatcherCycle(stitched, deps), [
    { issueId: 'logbook-31', outcome: 'stitch-failed' },
  ])
  assert.equal(stitched.size, 0)
  stitchStatus = 0
  assert.deepEqual(await runWatcherCycle(stitched, deps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
})

test('watcher cycle revalidates again after stitch and skips stale publication', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const replacement = manifest('replacement-draft', 2, 'draft')
  const calls: string[] = []
  let fetchCount = 0
  const completed = new Set<string>()
  const result = await runWatcherCycle(completed, {
    fetchManifests: async () => (++fetchCount <= 2 ? [cutting] : [cutting, replacement]),
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId) => { calls.push(`publish:${issueId}`); return 0 },
  })
  assert.deepEqual(calls, ['stitch:logbook-31'])
  assert.deepEqual(result, [{ issueId: 'logbook-31', outcome: 'stale' }])
  assert.equal(completed.size, 0)
})

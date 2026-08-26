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
  const published = manifest('published', 2, 'published')
  let acknowledged = false
  const calls: string[] = []
  const stitched = new Set<string>()
  const deps = {
    fetchManifests: async () => [acknowledged ? published : cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); acknowledged = true; return 0 },
  }
  assert.deepEqual(await runWatcherCycle(stitched, deps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
  assert.deepEqual(await runWatcherCycle(stitched, deps), [])

  const replacement = manifest('replacement-cutting', 2, 'cutting')
  const replacementDeps = { ...deps, fetchManifests: async () => [cutting, replacement] }
  assert.deepEqual(await runWatcherCycle(stitched, replacementDeps), [])
  assert.equal(stitched.has('logbook-31'), true)
})

test('watcher deduplicates acknowledged publications by stable d-tag across replacement revisions', async () => {
  const original = manifest('cutting-a', 1, 'cutting')
  const replacement = manifest('cutting-b', 2, 'cutting')
  const terminal = manifest('published', 3, 'published')
  let acknowledged = false
  const calls: string[] = []
  const completed = new Set<string>()
  const deps = {
    fetchManifests: async () => acknowledged ? [terminal] : [original, replacement],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); acknowledged = true; return 0 },
  }
  await runWatcherCycle(completed, deps)
  assert.deepEqual(completed, new Set(['logbook-31']))
  assert.deepEqual(await runWatcherCycle(completed, deps), [])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
})

test('watcher cycle retries publish without stitching again', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const published = manifest('published', 2, 'published')
  const completed = new Set<string>()
  const stitchedRevisions = new Set<string>()
  let publishStatus = 1
  let acknowledged = false
  const calls: string[] = []
  const deps = {
    fetchManifests: async () => acknowledged ? [published] : [cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => {
      calls.push(`publish:${issueId}`)
      if (publishStatus !== 0) return publishStatus
      acknowledged = true
      return 0
    },
  }
  assert.deepEqual(await runWatcherCycle(completed, deps, stitchedRevisions), [
    { issueId: 'logbook-31', outcome: 'publish-failed' },
  ])
  publishStatus = 0
  assert.deepEqual(await runWatcherCycle(completed, deps, stitchedRevisions), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31', 'publish:logbook-31'])
})

test('watcher cycle retries a failed stitch on a later cycle', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const stitched = new Set<string>()
  let stitchStatus = 1
  let acknowledged = false
  const published = manifest('published', 2, 'published')
  const deps = {
    fetchManifests: async () => acknowledged ? [published] : [cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: () => stitchStatus,
    runPublish: () => { acknowledged = true; return 0 },
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

test('watcher cycle continues publish after a progress rewrite of the same lock', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const progressed = manifest('progress', 2, 'cutting')
  progressed.content = JSON.stringify({ episodeStatus: 'cutting', release: { completed: ['audio'] } })
  const published = manifest('published', 3, 'published')
  let phase: 'pre' | 'stitched' | 'done' = 'pre'
  const calls: string[] = []
  const stitched = new Set<string>()
  const deps = {
    fetchManifests: async () => {
      if (phase === 'done') return [published]
      if (phase === 'stitched') return [progressed]
      return [cutting]
    },
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); phase = 'stitched'; return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); phase = 'done'; return 0 },
  }
  assert.deepEqual(await runWatcherCycle(stitched, deps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
})

test('watcher cycle skips stitch when audio is already on the manifest', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  cutting.content = JSON.stringify({
    episodeStatus: 'cutting',
    release: { completed: ['audio'] },
  })
  const published = manifest('published', 2, 'published')
  let acknowledged = false
  const calls: string[] = []
  const deps = {
    fetchManifests: async () => acknowledged ? [published] : [cutting],
    expectedPubkey: COMPASS,
    verify: () => true,
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); acknowledged = true; return 0 },
  }
  assert.deepEqual(await runWatcherCycle(new Set(), deps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, ['publish:logbook-31'])
})

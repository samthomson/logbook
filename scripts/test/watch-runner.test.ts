import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManifestEvent } from '../watch-state.ts'
import { runWatcherCycle } from '../watch-runner.ts'

const COMPASS = 'compass'
function manifest(id: string, created_at: number, status: string, extraTags: string[][] = []): ManifestEvent {
  return {
    id,
    created_at,
    pubkey: COMPASS,
    tags: [['d', 'logbook-31'], ...extraTags],
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
  const published = manifest('published', 2, 'published', [['previous', 'cutting']])
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

  const again = manifest('again', 3, 'cutting')
  again.pubkey = 'producer'
  const publishedAgain = manifest('published-2', 4, 'published', [['previous', 'again']])
  let republished = false
  const republishDeps = {
    ...deps,
    expectedPubkey: new Set([COMPASS, 'producer']),
    fetchManifests: async () => [published, republished ? publishedAgain : again],
    runStitch: (issueId: string) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId: string) => { calls.push(`publish:${issueId}`); republished = true; return 0 },
  }
  assert.deepEqual(await runWatcherCycle(stitched, republishDeps), [
    { issueId: 'logbook-31', outcome: 'published' },
  ])
  assert.deepEqual(calls, [
    'stitch:logbook-31',
    'publish:logbook-31',
    'stitch:logbook-31',
    'publish:logbook-31',
  ])
  assert.equal(stitched.has('again'), true)
})

test('watcher does not treat a later lock of the same episode as already done', async () => {
  const original = manifest('cutting-a', 1, 'cutting')
  const replacement = manifest('cutting-b', 2, 'cutting')
  const terminal = manifest('published', 3, 'published', [['previous', 'cutting-b']])
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
  assert.equal(completed.has('cutting-b'), true)
  assert.deepEqual(await runWatcherCycle(completed, deps), [])
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
})

test('watcher cycle retries publish without stitching again', async () => {
  const cutting = manifest('cutting', 1, 'cutting')
  const published = manifest('published', 2, 'published', [['previous', 'cutting']])
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
  const published = manifest('published', 2, 'published', [['previous', 'cutting']])
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
  const published = manifest('published', 3, 'published', [['previous', 'cutting']])
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
  const published = manifest('published', 2, 'published', [['previous', 'cutting']])
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

test('an older Compass publish does not acknowledge a later lock of the same episode', async () => {
  const lock = manifest('lock-2', 3, 'cutting')
  lock.pubkey = 'producer'
  const stalePublished = manifest('old-pub', 2, 'published', [['previous', 'lock-1']])
  const calls: string[] = []
  const result = await runWatcherCycle(new Set(), {
    fetchManifests: async () => [stalePublished, lock],
    expectedPubkey: new Set([COMPASS, 'producer']),
    verify: () => true,
    runStitch: (issueId) => { calls.push(`stitch:${issueId}`); return 0 },
    runPublish: (issueId) => { calls.push(`publish:${issueId}`); return 0 },
  })
  assert.deepEqual(calls, ['stitch:logbook-31', 'publish:logbook-31'])
  assert.deepEqual(result, [{ issueId: 'logbook-31', outcome: 'publish-unacknowledged' }])
})

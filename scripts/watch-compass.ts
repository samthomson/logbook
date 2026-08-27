import { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPASS_PUBKEY, RELAYS, KINDS } from './config.ts'
import { assertCompassSignerConfigured } from './amber-signer.ts'
import { materializeOriginFeed } from './origin-feed.ts'
import { runWatcherCycle } from './watch-runner.ts'
import { verifyNostrEvent } from './segment-security.ts'
import { fetchProducerPubkeys } from './producers.ts'

async function withPool<T>(run: (pool: SimplePool) => Promise<T>): Promise<T> {
  const pool = new SimplePool()
  try {
    return await run(pool)
  } finally {
    pool.close(RELAYS)
  }
}

async function pollCuttingManifests(
  completedIssueIds: Set<string>,
  stitchedRevisions: Set<string>,
): Promise<void> {
  const producers = await withPool((pool) => fetchProducerPubkeys(pool))
  const fetchManifests = async (): Promise<NostrEvent[]> => {
    const pool = new SimplePool()
    try {
      const compass = COMPASS_PUBKEY.toLowerCase()
      const others = [...producers].filter((pubkey) => pubkey.toLowerCase() !== compass)
      const base = { kinds: [KINDS.MANIFEST], limit: 50 }
      const batches = await Promise.all([
        pool.querySync(RELAYS, { ...base, authors: [COMPASS_PUBKEY] }),
        others.length > 0
          ? pool.querySync(RELAYS, { ...base, authors: others })
          : Promise.resolve([]),
      ])
      return batches.flat()
    } finally {
      pool.close(RELAYS)
    }
  }
  const __dir = dirname(fileURLToPath(import.meta.url))
  const results = await runWatcherCycle(completedIssueIds, {
    fetchManifests,
    expectedPubkey: producers,
    verify: (event) => verifyNostrEvent(event as NostrEvent),
    runStitch: (issueId) => {
      console.log(`[watch-compass] Manifest ${issueId} is cutting — triggering stitch`)
      return spawnSync(
        'npx',
        ['tsx', 'stitch.ts', '--issue', issueId],
        { cwd: __dir, stdio: 'inherit', env: process.env },
      ).status ?? 1
    },
    runPublish: (issueId) => spawnSync(
      'npx',
      ['tsx', 'publish-rss.ts', '--issue', issueId],
      { cwd: __dir, stdio: 'inherit', env: process.env },
    ).status ?? 1,
  }, stitchedRevisions)

  for (const result of results) {
    if (result.outcome === 'stale') {
      console.warn(`[watch-compass] Skipped stale cutting revision for ${result.issueId}`)
    } else if (result.outcome === 'stitch-failed') {
      console.error(`[watch-compass] stitch.ts failed for ${result.issueId}`)
    } else if (result.outcome === 'publish-failed') {
      console.error(`[watch-compass] publish-rss.ts failed for ${result.issueId}`)
    } else {
      console.log(`[watch-compass] Episode ${result.issueId} published successfully`)
    }
  }
}

async function main(): Promise<void> {
  await assertCompassSignerConfigured()
  console.log(`[watch-compass] Compass ${COMPASS_PUBKEY.slice(0, 12)}… signing via NIP-46 bunker`)
  console.log(`[watch-compass] Relays: ${RELAYS.join(', ')}`)
  console.log('[watch-compass] Drafts start from a producer in the PWA; watching for cutting manifests')
  await withPool(materializeOriginFeed)

  const completedIssueIds = new Set<string>()
  const stitchedRevisions = new Set<string>()

  let inFlight = false
  const tick = () => {
    if (inFlight) {
      console.log('[watch-compass] Previous cycle still running — skip')
      return
    }
    inFlight = true
    pollCuttingManifests(completedIssueIds, stitchedRevisions)
      .catch(console.error)
      .finally(() => { inFlight = false })
  }
  tick()
  setInterval(tick, 60 * 1000)
  console.log('[watch-compass] Polling every minute…')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

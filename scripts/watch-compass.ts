import { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import type { SubCloser } from 'nostr-tools/pool'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPASS_PUBKEY, KINDS, RELAYS, WHISPER_MODEL_PATH } from './config.ts'
import { assertCompassSignerConfigured, createCompassAmberSigner, type CompassSigner } from './amber-signer.ts'
import { materializeOriginFeed } from './origin-feed.ts'
import { runWatcherCycle } from './watch-runner.ts'
import { verifyNostrEvent } from './segment-security.ts'
import { fetchProducerPubkeys } from './producers.ts'
import { assertWhisperConfigured, isVerifiedRetranscribeRequest, makeTranscribeSweepDependencies, runTranscribeSweep } from './transcribe-segments.ts'

async function withPool<T>(run: (pool: SimplePool) => Promise<T>): Promise<T> {
  const pool = new SimplePool()
  try {
    return await run(pool)
  } finally {
    pool.close(RELAYS)
  }
}

async function pollCycle(
  completedIssueIds: Set<string>,
  stitchedRevisions: Set<string>,
  signer: CompassSigner,
): Promise<ReadonlySet<string>> {
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
    } else if (result.outcome === 'publish-unacknowledged') {
      console.error(`[watch-compass] ${result.issueId} publish-rss exited but Compass has no published event for this lock`)
    } else {
      console.log(`[watch-compass] Episode ${result.issueId} published successfully`)
    }
  }

  // Transcription runs after the release cycle so a stitch's ffmpeg and
  // whisper never compete for CPU inside one tick.
  const transcribed = await withPool((pool) => runTranscribeSweep(
    makeTranscribeSweepDependencies(pool, signer, {
      modelPath: WHISPER_MODEL_PATH,
      fetchManifests,
      expectedPubkey: producers,
      verify: (event) => verifyNostrEvent(event as NostrEvent),
    }),
  ))
  if (transcribed.missing > 0) {
    console.log(`[watch-compass] Transcripts: ${transcribed.transcribed} published, ${transcribed.skipped} skipped, ${transcribed.deferred} deferred`)
  }
  return producers
}


async function main(): Promise<void> {
  await assertCompassSignerConfigured()
  assertWhisperConfigured(WHISPER_MODEL_PATH)
  const signer = createCompassAmberSigner()

  /** Lock event ids whose release finished. A later lock of the same episode still runs. */
  const completedIssueIds = new Set<string>()
  const stitchedRevisions = new Set<string>()

  let inFlight = false
  let liveQueued = false
  const runCycle = () => {
    inFlight = true
    pollCycle(completedIssueIds, stitchedRevisions, signer)
      .then(syncLiveProducers)
      .catch(console.error)
      .finally(() => {
        inFlight = false
        // Only a live request queues a follow-up; the interval must keep its
        // minute spacing even when a cycle (stitch + publish) overruns it.
        if (liveQueued) {
          liveQueued = false
          setTimeout(runCycle, 0)
        }
      })
  }
  const tick = () => {
    if (inFlight) {
      console.log('[watch-compass] Previous cycle still running — skip')
      return
    }
    runCycle()
  }
  const requestCycle = () => {
    if (inFlight) {
      liveQueued = true
      return
    }
    runCycle()
  }

  // Every Logbook write-path event wakes a cycle immediately — a new voice
  // note (transcribe it), a manifest revision (a cutting lock starts the
  // stitch), a retranscribe request — instead of waiting for the next tick.
  // A wake is only a hint: the cycle re-verifies and scopes everything, and
  // its newest-wins rules make repeats idempotent, so a live wake racing the
  // interval can never transcribe or stitch twice. The minute interval stays
  // as the fallback for anything the subscriptions miss.
  const livePool = new SimplePool()
  let liveProducers: ReadonlySet<string> = new Set()
  let liveSubs: SubCloser[] = []
  let lastLiveWake = 0
  const wakeFromLive = (reason: string) => {
    // Debounced so a flood of events (or hostile junk on a public relay)
    // cannot keep the worker cycling back to back.
    if (Date.now() - lastLiveWake < 10_000) return
    lastLiveWake = Date.now()
    console.log(`[watch-compass] ${reason} — running cycle`)
    requestCycle()
  }
  const syncLiveProducers = (producers: ReadonlySet<string>) => {
    if ([...producers].sort().join(',') === [...liveProducers].sort().join(',')) return
    liveProducers = producers
    for (const sub of liveSubs) sub.close()
    const since = Math.floor(Date.now() / 1000)
    liveSubs = [
      livePool.subscribeMany(
        RELAYS,
        // Producer-authored events only; the stored-event sweep still reads
        // anything published while the worker was down.
        { kinds: [KINDS.MANIFEST, KINDS.RETRANSCRIBE], authors: [...producers], since },
        {
          onevent: (event) => {
            if (event.kind === KINDS.RETRANSCRIBE
              && !isVerifiedRetranscribeRequest(event as NostrEvent, liveProducers)) return
            wakeFromLive(event.kind === KINDS.RETRANSCRIBE ? 'Retranscribe request received' : 'Manifest received')
          },
        },
      ),
      // Segments come from any contributor, so this subscription cannot pin
      // authors; junk wakes are bounded by the debounce and change nothing —
      // the sweep parses and scopes every segment before spending compute.
      livePool.subscribeMany(
        RELAYS,
        { kinds: [KINDS.SEGMENT], since },
        { onevent: () => wakeFromLive('Segment received') },
      ),
    ]
  }

  tick()
  setInterval(tick, 60 * 1000)
  console.log('[watch-compass] Polling every minute, listening live for Logbook events…')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

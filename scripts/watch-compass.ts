import { SimplePool } from 'nostr-tools'
import type { Filter, NostrEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPASS_PUBKEY, RELAYS, KINDS, ISSUE_PREFIX } from './config.ts'
import {
  assertCompassSignerConfigured,
  createCompassAmberSigner,
  type CompassSigner,
} from './amber-signer.ts'
import { requiredChapterTargets } from './issue-targets.ts'
import { missingManifestIssueIds } from './watch-state.ts'
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

// ── types ────────────────────────────────────────────────────────────────────

interface Section {
  id: string
  title: string
  items: SubItem[]
}

interface SubItem {
  title: string
}

// ── issue parsing ────────────────────────────────────────────────────────────

function extractIssueNumber(event: NostrEvent): number {
  const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? ''
  const plain = parseInt(dTag, 10)
  if (!isNaN(plain)) return plain
  const prefixed = dTag.match(/(\d+)$/)
  if (prefixed) return parseInt(prefixed[1], 10)
  return event.created_at
}

function parseIssue(event: NostrEvent, issueNumber: number): Section[] {
  const lines = event.content.split('\n')
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      const title = line.slice(3).trim()
      // SPEC §4: sec-<slug>-<issueNumber>, slug truncated to 40 chars
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
      current = { id: `sec-${slug}-${issueNumber}`, title, items: [] }
    } else if (line.startsWith('### ') && current) {
      current.items.push({ title: line.slice(4).trim() })
    }
  }
  if (current) sections.push(current)
  return sections
}

// ── manifest creation ────────────────────────────────────────────────────────

async function createManifest(event: NostrEvent, signer: CompassSigner): Promise<void> {
  const issueNumber = extractIssueNumber(event)
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  // The canonical target projection includes H3 recording targets and never
  // manufactures unused H2-only chapters when a group is only a container.
  const sections = requiredChapterTargets(event.content, issueNumber)

  // SPEC §2: content must carry issueRef + sections[].introEventId/order/excluded[]/reviewed[]
  const issueRef = nip19.naddrEncode({
    kind: KINDS.COMPASS_ISSUE,
    pubkey: COMPASS_PUBKEY,
    identifier: event.tags.find(t => t[0] === 'd')?.[1] ?? '',
  })

  const manifestContent = JSON.stringify({
    issueRef,
    issueNumber,
    title: event.tags.find(t => t[0] === 'title')?.[1] ?? `Logbook #${issueNumber}`,
    sections: sections.map(s => ({
      id: s.id,
      title: s.title,
      introEventId: null,
      order: [],
      excluded: [] as string[],
      reviewed: [] as string[],
    })),
    episodeStatus: 'draft',
    publishedRss: null,
    createdAt: Math.floor(Date.now() / 1000),
  })

  const template = {
    kind: KINDS.MANIFEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', issueId],
      ['title', `Logbook #${issueNumber}`],
      ['issue', issueId],
      ['a', `${KINDS.COMPASS_ISSUE}:${COMPASS_PUBKEY}:${event.tags.find(t => t[0] === 'd')?.[1] ?? ''}`],
    ],
    content: manifestContent,
  }

  const signed = await signer.signEvent(template)
  const pool = new SimplePool()
  try {
    await Promise.any(pool.publish(RELAYS, signed))
  } finally {
    pool.close(RELAYS)
  }
  console.log(`[watch-compass] Published manifest for issue ${issueId}`)
}

// ── AUTO-01: stitch trigger ──────────────────────────────────────────────────

async function pollCuttingManifests(
  completedIssueIds: Set<string>,
  stitchedRevisions: Set<string>,
): Promise<void> {
  const producers = await withPool((pool) => fetchProducerPubkeys(pool))
  const fetchManifests = async (): Promise<NostrEvent[]> => {
    const pool = new SimplePool()
    try {
      return await pool.querySync(RELAYS, {
        kinds: [KINDS.MANIFEST],
        authors: [...producers],
        limit: 20,
      })
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

// ── watcher ──────────────────────────────────────────────────────────────────

/** Bound relay reads so an unreachable relay surfaces instead of hanging forever. */
const RELAY_QUERY_TIMEOUT_MS = 15_000

async function poll(signer: CompassSigner, seen: Set<string>): Promise<void> {
  const pool = new SimplePool()
  const filter: Filter = {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    limit: 5,
  }

  const events = await pool.querySync(RELAYS, filter, { maxWait: RELAY_QUERY_TIMEOUT_MS })
  pool.close(RELAYS)

  for (const event of events) {
    if (event.pubkey !== COMPASS_PUBKEY || !verifyNostrEvent(event)) {
      console.warn(`[watch-compass] Ignoring unverified issue ${event.id}`)
      continue
    }
    if (seen.has(event.id)) continue
    seen.add(event.id)
    console.log(`[watch-compass] New issue detected: ${event.id}`)
    await createManifest(event, signer)
  }
}

async function main(): Promise<void> {
  // Report what this instance is pointed at and prove a signer is reachable
  // before the first relay query. Without this the worker can sit silent
  // indefinitely against an unreachable relay, looking healthy while doing
  // nothing.
  await assertCompassSignerConfigured()
  console.log(`[watch-compass] Compass ${COMPASS_PUBKEY.slice(0, 12)}… signing via NIP-46 bunker`)
  console.log(`[watch-compass] Relays: ${RELAYS.join(', ')}`)

  const signer = createCompassAmberSigner()
  const seen = new Set<string>()

  // Bootstrap existing issues, then idempotently backfill any that do not
  // already have a valid Compass-authored manifest. This fixes the historical
  // gap created when the watcher first starts after an issue has published.
  const pool = new SimplePool()
  const bootstrapProducers = await fetchProducerPubkeys(pool)
  const filter: Filter = { kinds: [KINDS.COMPASS_ISSUE], authors: [COMPASS_PUBKEY], limit: 50 }
  const [existing, manifests] = await Promise.all([
    pool.querySync(RELAYS, filter, { maxWait: RELAY_QUERY_TIMEOUT_MS }),
    pool.querySync(
      RELAYS,
      { kinds: [KINDS.MANIFEST], authors: [...bootstrapProducers], limit: 50 },
      { maxWait: RELAY_QUERY_TIMEOUT_MS },
    ),
  ])
  pool.close(RELAYS)
  const validIssues = existing.filter((event) => event.pubkey === COMPASS_PUBKEY && verifyNostrEvent(event))
  // A producer-authored manifest already covers its issue: backfilling a second
  // Compass draft would fork the episode.
  const validManifests = manifests.filter(
    (event) => bootstrapProducers.has(event.pubkey.toLowerCase()) && verifyNostrEvent(event),
  )
  const issueById = new Map(validIssues.map((event) => [event.id, event]))
  const missingIds = missingManifestIssueIds(validIssues, validManifests)
  for (const id of missingIds) {
    const issue = issueById.get(id)
    if (!issue) continue
    console.log(`[watch-compass] Backfilling missing manifest for ${id}`)
    await createManifest(issue, signer)
  }
  for (const event of validIssues) seen.add(event.id)
  console.log(`[watch-compass] Bootstrapped with ${seen.size} verified issues; backfilled ${missingIds.length} manifest(s)`)

  const completedIssueIds = new Set<string>()
  const stitchedRevisions = new Set<string>()

  const tick = () => {
    poll(signer, seen).catch(console.error)
    pollCuttingManifests(completedIssueIds, stitchedRevisions).catch(console.error)
  }
  tick()
  setInterval(tick, 60 * 1000)
  console.log('[watch-compass] Polling every minute…')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

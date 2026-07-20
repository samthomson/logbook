import { SimplePool } from 'nostr-tools'
import type { Filter, NostrEvent } from 'nostr-tools'
import { finalizeEvent } from 'nostr-tools'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPASS_PUBKEY, DEFAULT_RELAYS, KINDS, ISSUE_PREFIX, loadPrivateKey } from './config.ts'

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

function parseIssue(event: NostrEvent): Section[] {
  const lines = event.content.split('\n')
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      const title = line.slice(3).trim()
      const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      current = { id: slug, title, items: [] }
    } else if (line.startsWith('### ') && current) {
      current.items.push({ title: line.slice(4).trim() })
    }
  }
  if (current) sections.push(current)
  return sections
}

// ── manifest creation ────────────────────────────────────────────────────────

async function createManifest(event: NostrEvent, privkey: Uint8Array): Promise<void> {
  const issueNumber = extractIssueNumber(event)
  const issueId = `${ISSUE_PREFIX}-${issueNumber}`
  const sections = parseIssue(event)

  const manifestContent = JSON.stringify({
    issueId,
    issueNumber,
    title: event.tags.find(t => t[0] === 'title')?.[1] ?? `Logbook #${issueNumber}`,
    sections: sections.map(s => ({
      id: s.id,
      title: s.title,
      order: [],
      excluded: false,
    })),
    episodeStatus: 'draft',
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

  const signed = finalizeEvent(template, privkey)
  const pool = new SimplePool()
  await Promise.any(pool.publish(DEFAULT_RELAYS, signed))
  pool.close(DEFAULT_RELAYS)
  console.log(`[watch-compass] Published manifest for issue ${issueId}`)
}

// ── AUTO-01: stitch trigger ──────────────────────────────────────────────────

interface ManifestContent {
  issueId: string
  episodeStatus: string
}

async function pollCuttingManifests(stitched: Set<string>): Promise<void> {
  const pool = new SimplePool()
  const events = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],
    limit: 20,
  })
  pool.close(DEFAULT_RELAYS)

  for (const event of events) {
    if (event.pubkey !== COMPASS_PUBKEY) continue
    let content: ManifestContent
    try {
      content = JSON.parse(event.content) as ManifestContent
    } catch {
      continue
    }
    if (content.episodeStatus !== 'cutting') continue
    if (stitched.has(content.issueId)) continue
    stitched.add(content.issueId)

    console.log(`[watch-compass] Manifest ${content.issueId} is cutting — triggering stitch`)
    const __dir = dirname(fileURLToPath(import.meta.url))

    const stitchResult = spawnSync(
      'node',
      ['--loader', 'ts-node/esm', 'stitch.ts', '--issue', content.issueId],
      { cwd: __dir, stdio: 'inherit', env: process.env },
    )
    if (stitchResult.status !== 0) {
      console.error(`[watch-compass] stitch.ts failed for ${content.issueId}`)
      stitched.delete(content.issueId) // allow retry next cycle
      continue
    }

    const rssResult = spawnSync(
      'node',
      ['--loader', 'ts-node/esm', 'publish-rss.ts', '--issue', content.issueId],
      { cwd: __dir, stdio: 'inherit', env: process.env },
    )
    if (rssResult.status !== 0) {
      console.error(`[watch-compass] publish-rss.ts failed for ${content.issueId}`)
    } else {
      console.log(`[watch-compass] Episode ${content.issueId} published successfully`)
    }
  }
}

// ── watcher ──────────────────────────────────────────────────────────────────

async function poll(privkey: Uint8Array, seen: Set<string>): Promise<void> {
  const pool = new SimplePool()
  const filter: Filter = {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    limit: 5,
  }

  const events = await pool.querySync(DEFAULT_RELAYS, filter)
  pool.close(DEFAULT_RELAYS)

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    console.log(`[watch-compass] New issue detected: ${event.id}`)
    await createManifest(event, privkey)
  }
}

async function main(): Promise<void> {
  const privkey = await loadPrivateKey()
  const seen = new Set<string>()

  // Bootstrap — mark existing issues as seen without creating manifests
  const pool = new SimplePool()
  const filter: Filter = { kinds: [KINDS.COMPASS_ISSUE], authors: [COMPASS_PUBKEY], limit: 50 }
  const existing = await pool.querySync(DEFAULT_RELAYS, filter)
  pool.close(DEFAULT_RELAYS)
  for (const e of existing) seen.add(e.id)
  console.log(`[watch-compass] Bootstrapped with ${seen.size} existing issues`)

  const stitched = new Set<string>()

  const INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
  setInterval(() => poll(privkey, seen).catch(console.error), INTERVAL_MS)
  setInterval(() => pollCuttingManifests(stitched).catch(console.error), INTERVAL_MS)
  console.log('[watch-compass] Polling every 10 minutes…')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

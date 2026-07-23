/**
 * publish-rss.ts — Podcasting 2.0 RSS feed generator
 *
 * Reads the stitched episode from AUDIO_DIR, reads the manifest from relay,
 * and writes a Podcasting 2.0 compliant RSS feed to RSS_PATH.
 *
 * Usage:
 *   COMPASS_NSEC=nsec1... node --loader ts-node/esm publish-rss.ts --issue logbook-31
 *
 * After writing the RSS file, also publishes a kind 1 note from the Compass
 * npub pointing to the episode URL.
 */

import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent } from 'nostr-tools'
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMPASS_PUBKEY,
  DEFAULT_RELAYS,
  KINDS,
  AUDIO_DIR,
  RSS_PATH,
  STATIC_DIR,
  BASE_URL,
  loadPrivateKey,
} from './config.ts'
import { uploadToBlossom } from './blossom.ts'
import { verifyNostrEvent } from './segment-security.ts'

// ── npubs.yml loading ─────────────────────────────────────────────────────────

interface ContributorEntry {
  pubkey: string
  name: string
  lightning?: string
}

function loadRoster(): ContributorEntry[] {
  const __dir = dirname(fileURLToPath(import.meta.url))
  const rosterPath = join(__dir, '../logbook-pwa/public/data/npubs.yml')
  if (!existsSync(rosterPath)) return []
  const raw = readFileSync(rosterPath, 'utf-8')
  // Minimal YAML parser for the simple list format we use
  const entries: ContributorEntry[] = []
  let current: Partial<ContributorEntry> | null = null
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- pubkey:')) {
      if (current?.pubkey) entries.push(current as ContributorEntry)
      current = { pubkey: trimmed.replace('- pubkey:', '').trim().replace(/^"|"$/g, '') }
    } else if (trimmed.startsWith('name:') && current) {
      current.name = trimmed.replace('name:', '').trim().replace(/^"|"$/g, '')
    } else if (trimmed.startsWith('lightning:') && current) {
      current.lightning = trimmed.replace('lightning:', '').trim().replace(/^"|"$/g, '')
    }
  }
  if (current?.pubkey) entries.push(current as ContributorEntry)
  return entries
}

function buildValueBlock(participantPubkeys: string[]): string {
  const roster = loadRoster()
  // Filter to contributors who actually participated and have lightning addresses
  const active = roster.filter(
    (c) => c.lightning && (participantPubkeys.includes(c.pubkey) || c.pubkey === COMPASS_PUBKEY),
  )
  if (!active.length) {
    // Fallback: Compass gets 100%
    return `    <podcast:value type="lightning" method="keysend">
      <podcast:valueRecipient name="Nostr Compass" type="node" address="${escapeXml(COMPASS_PUBKEY)}" split="100" />
    </podcast:value>`
  }
  // Equal split among all active participants
  const splitPct = Math.floor(100 / active.length)
  const remainder = 100 - splitPct * active.length
  const recipients = active.map((c, i) => {
    const split = i === 0 ? splitPct + remainder : splitPct
    return `      <podcast:valueRecipient name="${escapeXml(c.name)}" type="lnaddress" address="${escapeXml(c.lightning!)}" split="${split}" />`
  })
  return `    <podcast:value type="lightning" method="keysend">
${recipients.join('\n')}
    </podcast:value>`
}

// ── types ─────────────────────────────────────────────────────────────────────

interface ManifestSection {
  id: string
  title: string
  introEventId: string | null
  order: string[]
  excluded: string[]     // SPEC §2: array of excluded segment ids
  reviewed: string[]
}

interface ManifestContent {
  issueRef: string
  issueNumber?: number
  title?: string
  sections: ManifestSection[]
  episodeStatus: string
  publishedRss: unknown
}

interface Chapter {
  startTime: number // milliseconds
  title: string
}

interface ChaptersFile {
  version: string
  chapters: Chapter[]
}

interface FeedMeta {
  title: string
  description: string
  link: string
  imageUrl: string
  author: string
  email: string
  language: string
  baseUrl: string
}

// ── config ────────────────────────────────────────────────────────────────────

const FEED_META: FeedMeta = {
  title: 'Logbook by Nostr Compass',
  description: 'Async voice podcast where Nostr Compass contributors leave voice notes on the newsletter.',
  link: BASE_URL,
  imageUrl: `${BASE_URL}/icon-512.png`,
  author: 'Nostr Compass',
  email: 'noreply@nostrcompass.com',
  language: 'en',
  baseUrl: BASE_URL,
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rfc822(date: Date): string {
  return date.toUTCString()
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── relay helpers ─────────────────────────────────────────────────────────────

async function fetchManifest(issueId: string, pool: SimplePool): Promise<ManifestContent> {
  const events = await pool.querySync(DEFAULT_RELAYS, {
    kinds: [KINDS.MANIFEST],
    authors: [COMPASS_PUBKEY],
    '#d': [issueId],
    limit: 1,
  })

  if (!events.length) throw new Error(`No manifest found for ${issueId}`)

  const event = events[0]
  if (event.pubkey !== COMPASS_PUBKEY || !verifyNostrEvent(event)) {
    throw new Error(`Manifest failed Compass author or signature verification for ${issueId}`)
  }

  return JSON.parse(event.content) as ManifestContent
}

// ── mp3 duration via ffprobe ──────────────────────────────────────────────────

function getMp3Duration(mp3Path: string): number {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp3Path],
    { encoding: 'utf-8' },
  )
  return parseFloat(result.stdout.trim()) || 0
}

// ── RSS generation ────────────────────────────────────────────────────────────

interface EpisodeData {
  issueId: string
  issueNumber: number
  issueTitle: string
  mp3Url: string
  chaptersUrl: string
  transcriptUrl: string | null
  mp3Size: number
  durationSeconds: number
  pubDate: Date
  chapters: Chapter[]
  description: string
  participantPubkeys?: string[]
}

function buildEpisodeXml(ep: EpisodeData, meta: FeedMeta): string {
  const chaptersContent = ep.chapters
    .map(
      (c) =>
        `        <podcast:chapter startTime="${(c.startTime / 1000).toFixed(3)}" title="${escapeXml(c.title)}" />`,
    )
    .join('\n')

  return `    <item>
      <title>${escapeXml(ep.issueTitle)}</title>
      <description>${escapeXml(ep.description)}</description>
      <enclosure url="${escapeXml(ep.mp3Url)}" length="${ep.mp3Size}" type="audio/mpeg" />
      <guid isPermaLink="false">logbook-${ep.issueId}</guid>
      <pubDate>${rfc822(ep.pubDate)}</pubDate>
      <itunes:duration>${formatDuration(ep.durationSeconds)}</itunes:duration>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:episode>${ep.issueNumber}</itunes:episode>
      <podcast:chapters url="${escapeXml(ep.chaptersUrl)}" type="application/json+chapters" />
      <podcast:chapters>
${chaptersContent}
      </podcast:chapters>${ep.transcriptUrl ? `\n      <podcast:transcript url="${escapeXml(ep.transcriptUrl)}" type="application/json" />` : ''}
    </item>`
}

function buildFeedXml(meta: FeedMeta, episodes: EpisodeData[], participantPubkeys: string[] = []): string {
  const itemsXml = episodes.map((ep) => buildEpisodeXml(ep, meta)).join('\n\n')
  const valueBlock = buildValueBlock(participantPubkeys)

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(meta.link)}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>${meta.language}</language>
    <atom:link href="${escapeXml(meta.baseUrl + '/feed.xml')}" rel="self" type="application/rss+xml" />
    <itunes:author>${escapeXml(meta.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${escapeXml(meta.author)}</itunes:name>
      <itunes:email>${escapeXml(meta.email)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${escapeXml(meta.imageUrl)}" />
    <image>
      <url>${escapeXml(meta.imageUrl)}</url>
      <title>${escapeXml(meta.title)}</title>
      <link>${escapeXml(meta.link)}</link>
    </image>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Technology" />
    <podcast:guid>${escapeXml(COMPASS_PUBKEY)}</podcast:guid>
    <podcast:medium>podcast</podcast:medium>
${valueBlock}

${itemsXml}
  </channel>
</rss>`
}

// ── publish kind 1 note ───────────────────────────────────────────────────────

async function publishAnnouncement(
  ep: EpisodeData,
  privateKey: Uint8Array,
  pool: SimplePool,
): Promise<void> {
  const content = `🎙️ ${ep.issueTitle} is live on Logbook!\n\n${ep.description}\n\nListen: ${ep.mp3Url}\nRSS: ${BASE_URL}/feed.xml`

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['r', ep.mp3Url],
        ['r', `${BASE_URL}/feed.xml`],
      ],
      content,
    },
    privateKey,
  )

  await Promise.allSettled(DEFAULT_RELAYS.map((r) => pool.publish([r], event)))
  console.log(`[publish-rss] Published kind 1 announcement: ${event.id}`)
}

// ── manifest status write-back ────────────────────────────────────────────────

/**
 * Re-publish the manifest with episodeStatus='published' + publishedRss so the
 * Admin UI (and any future stitch run) sees the episode is done. Addressable
 * event — same d-tag, newer created_at wins.
 */
async function publishManifestStatus(
  issueId: string,
  manifest: ManifestContent,
  ep: EpisodeData,
  privateKey: Uint8Array,
  pool: SimplePool,
): Promise<void> {
  const updated = {
    ...manifest,
    episodeStatus: 'published',
    publishedRss: {
      feedUrl: `${BASE_URL}/feed.xml`,
      mp3Url: ep.mp3Url,
      publishedAt: Math.floor(Date.now() / 1000),
    },
  }
  const event = finalizeEvent(
    {
      kind: KINDS.MANIFEST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', issueId],
        ['title', ep.issueTitle],
        ['issue', issueId],
      ],
      content: JSON.stringify(updated),
    },
    privateKey,
  )
  await Promise.any(pool.publish(DEFAULT_RELAYS, event))
  console.log(`[publish-rss] Manifest ${issueId} marked published`)
}

// ── podstr episode event (kind 30054) ─────────────────────────────────────────

/**
 * Addressable podcast episode event in the shape podstr/Nostr podcast clients
 * consume (podstr usePublishEpisode.ts): title, published, summary, image,
 * audio (url + mime), duration, explicit, episode, t tags. Content = HTML
 * description. This is what surfaces the episode on podcast.nostrcompass.org
 * and in its generated feed.
 */
async function publishPodstrEpisode(
  ep: EpisodeData,
  privateKey: Uint8Array,
  pool: SimplePool,
): Promise<void> {
  const tags: string[][] = [
    ['d', `logbook-${ep.issueId}`],
    ['title', ep.issueTitle],
    ['published', String(Math.floor(ep.pubDate.getTime() / 1000))],
    ['summary', ep.description],
    ['image', FEED_META.imageUrl],
    ['audio', ep.mp3Url, 'audio/mpeg'],
    ['duration', String(Math.round(ep.durationSeconds))],
    ['explicit', 'no'],
    ['episode', String(ep.issueNumber)],
    ['t', 'nostr'],
    ['t', 'compass'],
    ['alt', `Podcast episode: ${ep.issueTitle} — Logbook by Nostr Compass`],
  ]
  if (ep.chaptersUrl) tags.push(['podcast:chapters', ep.chaptersUrl, 'application/json+chapters'])
  if (ep.transcriptUrl) tags.push(['podcast:transcript', ep.transcriptUrl, 'application/json'])
  for (const pk of ep.participantPubkeys ?? []) tags.push(['p', pk])

  const event = finalizeEvent(
    {
      kind: 30054,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: `<p>${ep.description}</p>`,
    },
    privateKey,
  )
  await Promise.any(pool.publish(DEFAULT_RELAYS, event))
  console.log(`[publish-rss] Published podstr episode event: ${event.id}`)
}

// ── run metadata (written by stitch.ts) ───────────────────────────────────────

interface RunMeta {
  issueId: string
  mp3Url: string
  mp3Urls: string[]
  mp3Sha256: string
  mp3Size: number
  durationSeconds: number
  chaptersUrl: string | null
  segmentIds: string[]
  contributorPubkeys: string[]
  stitchedAt: number
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const issueFlag = args.indexOf('--issue')
  if (issueFlag === -1 || !args[issueFlag + 1]) {
    console.error('Usage: publish-rss.ts --issue <issueId> [--no-announce]')
    process.exit(1)
  }
  const issueId = args[issueFlag + 1]
  const noAnnounce = args.includes('--no-announce')

  const privateKey = await loadPrivateKey()
  const pool = new SimplePool()

  console.log(`[publish-rss] Fetching manifest for ${issueId}…`)
  const manifest = await fetchManifest(issueId, pool)

  // Run metadata from stitch.ts carries the canonical Blossom mp3 URL.
  const metaPath = join(AUDIO_DIR, `${issueId}-run.json`)
  if (!existsSync(metaPath)) {
    throw new Error(`Run metadata not found: ${metaPath}. Run stitch.ts first.`)
  }
  const run = JSON.parse(readFileSync(metaPath, 'utf-8')) as RunMeta

  // Upload chapters JSON to Blossom so podcatchers can fetch it from anywhere.
  const chaptersPath = join(AUDIO_DIR, `${issueId}-chapters.json`)
  let chapters: Chapter[] = []
  let chaptersUrl = run.chaptersUrl
  if (existsSync(chaptersPath)) {
    const cf = JSON.parse(readFileSync(chaptersPath, 'utf-8')) as ChaptersFile
    chapters = cf.chapters
    if (!chaptersUrl) {
      const blob = await uploadToBlossom(
        Buffer.from(JSON.stringify(cf, null, 2)),
        'application/json',
        privateKey,
      )
      chaptersUrl = blob.url
      run.chaptersUrl = chaptersUrl
      writeFileSync(metaPath, JSON.stringify(run, null, 2))
    }
  }

  // Collect contributor pubkeys + transcripts from relay
  const segmentEvents =
    run.segmentIds.length > 0
      ? await pool.querySync(DEFAULT_RELAYS, { kinds: [KINDS.SEGMENT], ids: run.segmentIds })
      : []
  const participantPubkeys = [...new Set(segmentEvents.map((e) => e.pubkey))]

  // Companion transcripts (kind 1111 with e-tag → segment) for podcast:transcript
  const transcriptEvents =
    run.segmentIds.length > 0
      ? await pool.querySync(DEFAULT_RELAYS, { kinds: [KINDS.TRANSCRIPT], '#e': run.segmentIds, limit: 200 })
      : []
  const transcriptBySegment = new Map<string, string>()
  for (const t of transcriptEvents) {
    const segRef = t.tags.find((tag) => tag[0] === 'e')?.[1]
    if (segRef && !transcriptBySegment.has(segRef)) transcriptBySegment.set(segRef, t.content)
  }
  // Stitch a full-episode transcript in segment order (used as transcript JSON)
  const fullTranscript = run.segmentIds
    .map((id) => transcriptBySegment.get(id))
    .filter(Boolean)
    .join('\n\n')
  let transcriptUrl: string | null = null
  if (fullTranscript) {
    const blob = await uploadToBlossom(
      Buffer.from(JSON.stringify({ version: '1.0.0', transcript: fullTranscript }, null, 2)),
      'application/json',
      privateKey,
    )
    transcriptUrl = blob.url
  }

  const issueNumber = manifest.issueNumber ?? parseInt(issueId.replace(/^\D+/, ''), 10) ?? 0
  const issueTitle = manifest.title ?? `Logbook Episode ${issueNumber}`
  const ep: EpisodeData = {
    issueId,
    issueNumber,
    issueTitle,
    mp3Url: run.mp3Url,
    chaptersUrl: chaptersUrl ?? '',
    transcriptUrl,
    mp3Size: run.mp3Size,
    durationSeconds: run.durationSeconds,
    pubDate: new Date(run.stitchedAt * 1000),
    chapters,
    description: `Async voice notes from Nostr Compass contributors on issue #${issueNumber}.`,
    participantPubkeys,
  }

  // Episode state file → regenerate feed from scratch (idempotent). Ensure the
  // configured static root exists before the first episode writes its state.
  mkdirSync(STATIC_DIR, { recursive: true })
  const episodeStatePath = join(STATIC_DIR, 'episodes.json')
  let existingEpisodes: EpisodeData[] = []
  if (existsSync(episodeStatePath)) {
    existingEpisodes = JSON.parse(readFileSync(episodeStatePath, 'utf-8')) as EpisodeData[]
  }
  const filtered = existingEpisodes.filter((e) => e.issueId !== issueId)
  const allEpisodes = [ep, ...filtered].slice(0, 50)
  writeFileSync(episodeStatePath, JSON.stringify(allEpisodes, null, 2))

  const xml = buildFeedXml(FEED_META, allEpisodes, ep.participantPubkeys ?? [])
  writeFileSync(RSS_PATH, xml, 'utf-8')
  console.log(`[publish-rss] RSS written: ${RSS_PATH}`)
  console.log(`[publish-rss] Episodes in feed: ${allEpisodes.length}`)
  console.log(`[publish-rss] NOTE: feed.xml must be reachable at ${BASE_URL}/feed.xml —`)
  console.log(`[publish-rss] sync ${STATIC_DIR} to the podcast.nostrcompass.org host (or set LOGBOOK_BASE_URL).`)

  // Mark the manifest published so the Admin UI shows the final state
  await publishManifestStatus(issueId, manifest, ep, privateKey, pool)

  // Podstr-compatible episode event (kind 30054) so the podcast appears on
  // podcast.nostrcompass.org and in Nostr podcast clients.
  await publishPodstrEpisode(ep, privateKey, pool)

  if (!noAnnounce) {
    await publishAnnouncement(ep, privateKey, pool)
  }

  pool.close(DEFAULT_RELAYS)
  console.log('[publish-rss] Done.')
}

main().catch((err) => {
  console.error('[publish-rss] Fatal:', err)
  process.exit(1)
})

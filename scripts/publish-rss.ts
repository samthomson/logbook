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
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import {
  COMPASS_PUBKEY,
  DEFAULT_RELAYS,
  KINDS,
  AUDIO_DIR,
  RSS_PATH,
  STATIC_DIR,
  loadPrivateKey,
} from './config.ts'

// ── types ─────────────────────────────────────────────────────────────────────

interface ManifestSection {
  id: string
  title: string
  order: string[]
  excluded: boolean
}

interface ManifestContent {
  issueId: string
  issueNumber: number
  issueTitle: string
  sections: ManifestSection[]
  episodeStatus: string
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

const BASE_URL = process.env.LOGBOOK_BASE_URL ?? 'https://logbook.nostrcompass.com'

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
  if (event.pubkey !== COMPASS_PUBKEY) {
    throw new Error(`Manifest pubkey mismatch for ${issueId}`)
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
  mp3Size: number
  durationSeconds: number
  pubDate: Date
  chapters: Chapter[]
  description: string
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
      </podcast:chapters>
    </item>`
}

function buildFeedXml(meta: FeedMeta, episodes: EpisodeData[]): string {
  const itemsXml = episodes.map((ep) => buildEpisodeXml(ep, meta)).join('\n\n')

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
    <podcast:value type="lightning" method="keysend">
      <podcast:valueRecipient name="Nostr Compass" type="node" address="${escapeXml(COMPASS_PUBKEY)}" split="100" />
    </podcast:value>

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

  // Verify mp3 exists
  const mp3Path = join(AUDIO_DIR, `${issueId}.mp3`)
  if (!existsSync(mp3Path)) {
    throw new Error(`mp3 not found: ${mp3Path}. Run stitch.ts first.`)
  }

  const chaptersPath = join(AUDIO_DIR, `${issueId}-chapters.json`)
  let chapters: Chapter[] = []
  if (existsSync(chaptersPath)) {
    const cf = JSON.parse(readFileSync(chaptersPath, 'utf-8')) as ChaptersFile
    chapters = cf.chapters
  }

  const mp3Size = statSync(mp3Path).size
  const durationSeconds = getMp3Duration(mp3Path)
  const mp3Url = `${BASE_URL}/audio/${basename(mp3Path)}`
  const chaptersUrl = `${BASE_URL}/audio/${basename(chaptersPath)}`

  const ep: EpisodeData = {
    issueId,
    issueNumber: manifest.issueNumber,
    issueTitle: manifest.issueTitle,
    mp3Url,
    chaptersUrl,
    mp3Size,
    durationSeconds,
    pubDate: new Date(),
    chapters,
    description: `Async voice notes from Nostr Compass contributors on issue #${manifest.issueNumber}.`,
  }

  // Load existing feed to prepend new episode
  let existingEpisodes: EpisodeData[] = []
  if (existsSync(RSS_PATH)) {
    // Simple approach: don't parse existing XML — just regenerate from scratch
    // In production you'd maintain a episodes.json state file
    const episodeStatePath = join(STATIC_DIR, 'episodes.json')
    if (existsSync(episodeStatePath)) {
      existingEpisodes = JSON.parse(readFileSync(episodeStatePath, 'utf-8')) as EpisodeData[]
    }
  }

  // Upsert this episode (replace if same issueId, otherwise prepend)
  const episodeStatePath = join(STATIC_DIR, 'episodes.json')
  const filtered = existingEpisodes.filter((e) => e.issueId !== issueId)
  const allEpisodes = [ep, ...filtered].slice(0, 50) // cap at 50 episodes
  writeFileSync(episodeStatePath, JSON.stringify(allEpisodes, null, 2))

  const xml = buildFeedXml(FEED_META, allEpisodes)
  writeFileSync(RSS_PATH, xml, 'utf-8')
  console.log(`[publish-rss] RSS written: ${RSS_PATH}`)
  console.log(`[publish-rss] Episodes in feed: ${allEpisodes.length}`)

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

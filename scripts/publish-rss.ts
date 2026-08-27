/**
 * publish-rss.ts — Podcasting 2.0 RSS feed generator
 *
 * Reads the stitched episode from AUDIO_DIR, reads the manifest from relay,
 * and writes a Podcasting 2.0 compliant RSS feed to RSS_PATH.
 *
 * Usage (NIP-46 via COMPASS_BUNKER_URI + COMPASS_BUNKER_CLIENT_KEY):
 *   npm run rss -- --issue logbook-31
 *
 * After writing the RSS file, also publishes a kind 1 note from the Compass
 * npub pointing to the episode URL.
 */

import { SimplePool } from 'nostr-tools/pool'
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  COMPASS_PUBKEY,
  RELAYS,
  KINDS,
  D_PODSTR,
  AUDIO_DIR,
  RSS_PATH,
  STATIC_DIR,
  BASE_URL,
  BLOSSOM_SERVERS,
} from './config.ts'
import { uploadToBlossom } from './blossom.ts'
import { verifyNostrEvent } from './segment-security.ts'
import { createCompassAmberSigner, type CompassSigner } from './amber-signer.ts'
import { latestVerifiedManifest, type ManifestEvent } from './watch-state.ts'
import { fetchProducerPubkeys } from './producers.ts'
import { assertPublishableManifest, selectTrustedReleaseMetadata } from './rss-state.ts'
import { FileReleaseLedger, assertRunMatchesManifest, findMatchingLock, manifestRevision, runReleaseStages, type ManifestRevision } from './release-state.ts'
import { acknowledgeStaticSync, originFeedReadbackUrl, readBackHostedFeed } from './static-sync.ts'
import { releaseFailure, unfinishedReleaseStep, writeCuttingProgress, type ReleaseStep } from './cutting-progress.ts'

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
  sectionExcluded?: boolean
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
  lastFailure?: unknown
  release?: { completed?: unknown; failed?: unknown }
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

export function rfc822(value: unknown): string {
  return coercePubDate(value).toUTCString()
}

/** episodes.json round-trips through JSON, so this accepts a Date, unix seconds, or ISO string. */
export function coercePubDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 1e12 ? value : value * 1000)
  }
  if (typeof value === 'string' && value) {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed
  }
  return new Date(0)
}

function pubDateUnix(value: unknown): number {
  return Math.floor(coercePubDate(value).getTime() / 1000)
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── relay helpers ─────────────────────────────────────────────────────────────

async function fetchManifest(issueId: string, pool: SimplePool): Promise<{
  manifest: ManifestContent
  event: ManifestEvent
  events: ManifestEvent[]
  knownCreatedAt: number
}> {
  const producers = await fetchProducerPubkeys(pool)
  const compass = COMPASS_PUBKEY.toLowerCase()
  const others = [...producers].filter((pubkey) => pubkey.toLowerCase() !== compass)
  const base = { kinds: [KINDS.MANIFEST], '#d': [issueId], limit: 500 }
  const raw = (
    await Promise.all([
      pool.querySync(RELAYS, { ...base, authors: [COMPASS_PUBKEY] }),
      others.length > 0
        ? pool.querySync(RELAYS, { ...base, authors: others })
        : Promise.resolve([]),
    ])
  ).flat() as ManifestEvent[]

  const options = {
    expectedPubkey: producers,
    verify: (candidate: ManifestEvent) => verifyNostrEvent(candidate as never),
  }
  const events = raw.filter((candidate) => (
    options.verify(candidate)
    && candidate.tags.some((tag) => tag[0] === 'd' && tag[1] === issueId)
    && producers.has(candidate.pubkey.toLowerCase())
  ))
  const event = latestVerifiedManifest(events, issueId, options)
  if (!event) throw new Error(`No verified manifest found for ${issueId}`)

  const knownCreatedAt = events.reduce((max, candidate) => (
    Math.max(max, candidate.created_at ?? 0)
  ), 0)

  return {
    manifest: JSON.parse(event.content) as ManifestContent,
    event,
    events,
    knownCreatedAt,
  }
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
  pubDate: Date | number | string
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

export function writeRss(episodes: EpisodeData[]): void {
  mkdirSync(STATIC_DIR, { recursive: true })
  const stored = episodes.map((ep) => ({ ...ep, pubDate: pubDateUnix(ep.pubDate) }))
  const xml = buildFeedXml(
    FEED_META,
    stored,
    [...new Set(stored.flatMap((ep) => ep.participantPubkeys ?? []))],
  )
  writeFileSync(join(STATIC_DIR, 'episodes.json'), JSON.stringify(stored, null, 2))
  writeFileSync(RSS_PATH, Buffer.from(xml, 'utf-8'))
}

export function episodeFromPublished(issueId: string, manifest: ManifestContent): EpisodeData | null {
  if (manifest.episodeStatus !== 'published') return null
  const rss = manifest.publishedRss
  if (!rss || typeof rss !== 'object' || Array.isArray(rss)) return null
  const mp3Url = (rss as { mp3Url?: unknown }).mp3Url
  if (typeof mp3Url !== 'string' || !mp3Url) return null
  const chaptersUrl = (rss as { chaptersUrl?: unknown }).chaptersUrl
  const publishedAt = (rss as { publishedAt?: unknown }).publishedAt
  const parsed = Number.parseInt(issueId.replace(/^\D+/, ''), 10)
  const issueNumber = manifest.issueNumber ?? (Number.isFinite(parsed) ? parsed : 0)
  return {
    issueId,
    issueNumber,
    issueTitle: manifest.title ?? `Logbook Episode ${issueNumber}`,
    mp3Url,
    chaptersUrl: typeof chaptersUrl === 'string' ? chaptersUrl : '',
    transcriptUrl: null,
    mp3Size: 0,
    durationSeconds: 0,
    pubDate: typeof publishedAt === 'number' ? publishedAt : 0,
    chapters: [],
    description: `Async voice notes from Nostr Compass contributors on issue #${issueNumber}.`,
  }
}

// ── publish kind 1 note ───────────────────────────────────────────────────────

async function publishAnnouncement(
  ep: EpisodeData,
  signer: CompassSigner,
  pool: SimplePool,
): Promise<string> {
  const content = `🎙️ ${ep.issueTitle} is live on Logbook!\n\n${ep.description}\n\nListen: ${ep.mp3Url}\nRSS: ${BASE_URL}/feed.xml`

  const event = await signer.signEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['r', ep.mp3Url],
      ['r', `${BASE_URL}/feed.xml`],
    ],
    content,
  })

  await Promise.allSettled(RELAYS.map((r) => pool.publish([r], event)))
  console.log(`[publish-rss] Published kind 1 announcement: ${event.id}`)
  return event.id
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
  signer: CompassSigner,
  pool: SimplePool,
  previousEventIds: readonly string[],
  supersedesCreatedAt: number,
): Promise<void> {
  const updated = {
    ...manifest,
    episodeStatus: 'published',
    // A reason from an earlier failed run does not describe a published episode.
    lastFailure: null,
    publishedRss: {
      ...(manifest.publishedRss && typeof manifest.publishedRss === 'object'
        ? manifest.publishedRss as Record<string, unknown>
        : {}),
      mp3Url: ep.mp3Url,
      chaptersUrl: ep.chaptersUrl || undefined,
      feedUrl: `${BASE_URL}/feed.xml`,
      publishedAt: Math.floor(Date.now() / 1000),
    },
    release: {
      completed: ['audio', 'chapters', 'feed', 'podstr', 'announcement'],
    },
  }
  const event = await signer.signEvent({
    kind: KINDS.MANIFEST,
    // A producer-signed lock is a different addressable event, so the terminal
    // Compass revision must win on created_at rather than tie with it.
    created_at: Math.max(Math.floor(Date.now() / 1000), supersedesCreatedAt + 1),
    tags: [
      ['d', issueId],
      ['title', ep.issueTitle],
      ['issue', issueId],
      ...[...new Set(previousEventIds.filter((id) => id.length > 0))].map((id) => ['previous', id]),
    ],
    content: JSON.stringify(updated),
  })
  await Promise.any(pool.publish(RELAYS, event))
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
  signer: CompassSigner,
  pool: SimplePool,
): Promise<void> {
  const tags: string[][] = [
    ['d', D_PODSTR(ep.issueId)],
    ['title', ep.issueTitle],
    ['published', String(pubDateUnix(ep.pubDate))],
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

  const event = await signer.signEvent({
    kind: KINDS.PODSTR_EPISODE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: `<p>${ep.description}</p>`,
  })
  await Promise.any(pool.publish(RELAYS, event))
  console.log(`[publish-rss] Published podstr episode event: ${event.id}`)
}

// ── run metadata (written by stitch.ts) ───────────────────────────────────────

interface RunMeta {
  issueId: string
  manifest: ManifestRevision
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
    console.error('Usage: publish-rss.ts --issue <issueId>')
    process.exit(1)
  }
  const issueId = args[issueFlag + 1]
  const signer = createCompassAmberSigner()
  const pool = new SimplePool()
  let failedStage: ReleaseStep = 'feed'
  let live: { manifest: ManifestContent; event: ManifestEvent } | null = null
  let knownCreatedAt = 0

  try {
    console.log(`[publish-rss] Fetching manifest for ${issueId}…`)
    const fetched = await fetchManifest(issueId, pool)
    assertPublishableManifest(fetched.manifest)
    live = fetched
    knownCreatedAt = fetched.knownCreatedAt

    const note = async (
      completed: ReleaseStep[],
      publishedRss?: Record<string, unknown>,
    ): Promise<void> => {
      const next = await writeCuttingProgress({
        issueId,
        manifest: live!.manifest,
        event: live!.event,
        signer,
        pool,
        completed,
        publishedRss,
        lastFailure: null,
        failed: null,
      })
      live = next
    }

    // Run metadata from stitch.ts carries the canonical Blossom mp3 URL.
    const metaPath = join(AUDIO_DIR, `${issueId}-run.json`)
    if (!existsSync(metaPath)) {
      throw new Error(`Run metadata not found: ${metaPath}. Run stitch.ts first.`)
    }
    const run = JSON.parse(readFileSync(metaPath, 'utf-8')) as RunMeta
    const revision = manifestRevision(live.event)
    assertRunMatchesManifest(run, revision)
    const assertExactCut = async (): Promise<void> => {
      const match = findMatchingLock(revision, (await fetchManifest(issueId, pool)).events)
      if (!match) throw new Error('Release stopped: stale or mismatched manifest revision')
    }

    // Upload chapters JSON to Blossom so podcatchers can fetch it from anywhere.
    failedStage = 'chapters'
    const chaptersPath = join(AUDIO_DIR, `${issueId}-chapters.json`)
    let chapters: Chapter[] = []
    let chaptersUrl = run.chaptersUrl
    if (existsSync(chaptersPath)) {
      const cf = JSON.parse(readFileSync(chaptersPath, 'utf-8')) as ChaptersFile
      chapters = cf.chapters
      if (!chaptersUrl) {
        await assertExactCut()
        const blob = await uploadToBlossom(
          Buffer.from(JSON.stringify(cf, null, 2)),
          'application/json',
          signer,
        )
        chaptersUrl = blob.url
        run.chaptersUrl = chaptersUrl
        writeFileSync(metaPath, JSON.stringify(run, null, 2))
      }
      await note(
        ['audio', 'chapters'],
        { mp3Url: run.mp3Url, chaptersUrl },
      )
    }

    // Collect contributor pubkeys + transcripts from relay
    const segmentEvents =
      run.segmentIds.length > 0
        ? await pool.querySync(RELAYS, { kinds: [KINDS.SEGMENT], ids: run.segmentIds })
        : []
    // Companion transcripts (kind 1111 with e-tag → segment) for podcast:transcript
    const transcriptEvents =
      run.segmentIds.length > 0
        ? await pool.querySync(RELAYS, { kinds: [KINDS.TRANSCRIPT], '#e': run.segmentIds, limit: 200 })
        : []
    const { participantPubkeys, transcriptBySegment } = selectTrustedReleaseMetadata(
      run.segmentIds,
      segmentEvents,
      transcriptEvents,
      BLOSSOM_SERVERS,
    )
    // Stitch a full-episode transcript in segment order (used as transcript JSON)
    const fullTranscript = run.segmentIds
      .map((id) => transcriptBySegment.get(id))
      .filter(Boolean)
      .join('\n\n')
    let transcriptUrl: string | null = null
    if (fullTranscript) {
      await assertExactCut()
      const blob = await uploadToBlossom(
        Buffer.from(JSON.stringify({ version: '1.0.0', transcript: fullTranscript }, null, 2)),
        'application/json',
        signer,
      )
      transcriptUrl = blob.url
    }

    const issueNumber = live.manifest.issueNumber ?? parseInt(issueId.replace(/^\D+/, ''), 10) ?? 0
    const issueTitle = live.manifest.title ?? `Logbook Episode ${issueNumber}`
    const ep: EpisodeData = {
      issueId,
      issueNumber,
      issueTitle,
      mp3Url: run.mp3Url,
      chaptersUrl: chaptersUrl ?? '',
      transcriptUrl,
      mp3Size: run.mp3Size,
      durationSeconds: run.durationSeconds,
      pubDate: pubDateUnix(run.stitchedAt),
      chapters,
      description: `Async voice notes from Nostr Compass contributors on issue #${issueNumber}.`,
      participantPubkeys,
    }

    // Episode state file → regenerate feed from scratch (idempotent). Ensure the
    // configured static root exists before the first episode writes its state.
    failedStage = 'feed'
    mkdirSync(STATIC_DIR, { recursive: true })
    const episodeStatePath = join(STATIC_DIR, 'episodes.json')
    let existingEpisodes: EpisodeData[] = []
    if (existsSync(episodeStatePath)) {
      const raw = JSON.parse(readFileSync(episodeStatePath, 'utf-8')) as unknown
      existingEpisodes = Array.isArray(raw)
        ? raw.map((item) => {
          const episode = item as EpisodeData
          return { ...episode, pubDate: pubDateUnix(episode.pubDate) }
        })
        : []
    }
    const filtered = existingEpisodes.filter((e) => e.issueId !== issueId)
    const allEpisodes = [ep, ...filtered].slice(0, 50)
    writeFileSync(episodeStatePath, JSON.stringify(allEpisodes, null, 2))

    const xml = buildFeedXml(FEED_META, allEpisodes, ep.participantPubkeys ?? [])
    const xmlBytes = Buffer.from(xml, 'utf-8')
    writeFileSync(RSS_PATH, xmlBytes)
    console.log(`[publish-rss] RSS written: ${RSS_PATH}`)
    console.log(`[publish-rss] Episodes in feed: ${allEpisodes.length}`)

    const feedDigest = createHash('sha256').update(xmlBytes).digest('hex')
    const ledger = new FileReleaseLedger(STATIC_DIR, issueId, run.manifest.id)
    await runReleaseStages({
      ledger,
      revision,
      // Progress writes change the event id; the locked cut (sections) must not.
      current: async () => {
        const match = findMatchingLock(revision, (await fetchManifest(issueId, pool)).events)
        if (!match) throw new Error('Release stopped: stale or mismatched manifest revision')
        return match
      },
      stages: {
        artifacts: async () => assertRunMatchesManifest(run, revision),
        feed: async () => {
          failedStage = 'feed'
          const originFeed = originFeedReadbackUrl(BASE_URL)
          await acknowledgeStaticSync(feedDigest, () => readBackHostedFeed(originFeed))
          console.log(`[publish-rss] Feed hosted: ${originFeed}`)
          await note(
            ['audio', 'chapters', 'feed'],
            { mp3Url: run.mp3Url, chaptersUrl: chaptersUrl || undefined, feedUrl: `${BASE_URL}/feed.xml` },
          )
        },
        podstr: async () => {
          failedStage = 'podstr'
          await publishPodstrEpisode(ep, signer, pool)
          await note(['audio', 'chapters', 'feed', 'podstr'])
        },
        announcement: async () => {
          failedStage = 'announcement'
          const announcementId = await publishAnnouncement(ep, signer, pool)
          await note(
            ['audio', 'chapters', 'feed', 'podstr', 'announcement'],
            { announcementId },
          )
        },
        manifest: async () => publishManifestStatus(
          issueId,
          live!.manifest,
          ep,
          signer,
          pool,
          [run.manifest.id, live!.event.id],
          Math.max(knownCreatedAt, live!.event.created_at ?? 0),
        ),
      },
    })

    console.log('[publish-rss] Done.')
  } catch (err) {
    console.error('[publish-rss] Fatal:', err)
    if (live) {
      try {
        const failed = unfinishedReleaseStep(live.manifest.release?.completed, failedStage)
        await writeCuttingProgress({
          issueId,
          manifest: live.manifest,
          event: live.event,
          signer,
          pool,
          lastFailure: releaseFailure(err, failed),
          failed,
        })
        console.log(`[publish-rss] Manifest still cutting; ${failed} is the step that failed`)
      } catch (writeErr) {
        console.error('[publish-rss] Could not write the failure on the manifest:', writeErr)
      }
    }
    process.exit(1)
  } finally {
    pool.close(RELAYS)
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch((err) => {
    console.error('[publish-rss] Fatal:', err)
    process.exit(1)
  })
}

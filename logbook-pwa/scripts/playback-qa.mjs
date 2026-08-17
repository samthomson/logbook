import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'
import { episodeHref } from './qa-episode.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.env.COMPASS_PUBKEY ??= 'a'.repeat(64)
process.env.RELAYS ??= 'wss://relay.test'
process.env.DISCOVERY_RELAYS ??= 'wss://discovery.test'
process.env.BLOSSOM_SERVERS ??= 'https://blossom.test'
const sectionId = 'sec-lead-stories-public-chapter-32'
const issueEvent = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  created_at: 1_700_000_000,
  kind: 30_023,
  tags: [['d', 'newsletter-32']],
  content: '## Lead stories\n### Public chapter\nDeterministic playback content',
  sig: '3'.repeat(128),
}
const fixtureIssue = {
  issueNumber: 32,
  title: 'Fixture Compass issue',
  event: issueEvent,
  sections: [{
    id: 'sec-lead-stories-32',
    title: 'Lead stories',
    items: [{ id: sectionId, title: 'Public chapter', body: 'Deterministic playback content' }],
  }],
}
const olderIssueEvent = {
  ...issueEvent,
  id: '0'.repeat(64),
  created_at: issueEvent.created_at - 86_400,
  tags: [['d', 'newsletter-31']],
}
const olderFixtureIssue = {
  ...fixtureIssue,
  issueNumber: 31,
  title: 'Older fixture Compass issue',
  event: olderIssueEvent,
}
const fixtureSegments = [2, 2, 2].map((duration, index) => ({
  event: {
    id: String(index + 4).repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1_700_000_100 + index,
    kind: 4_200,
    tags: [],
    content: '',
    sig: '5'.repeat(128),
  },
  audio: {
    url: `data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=#note-${index + 1}`,
    sha256: String(index + 6).repeat(64),
    mime: 'audio/webm',
    duration,
    waveform: [],
  },
  isIntro: false,
  sectionId,
  issueId: 'logbook-32',
  respondingTo: null,
  alt: null,
}))

const compassId = '\0playback-compass-fixture'
const segmentId = '\0playback-segment-fixture'
const profilesId = '\0playback-profiles-fixture'
const poolId = '\0playback-pool-fixture'
const manifestId = '\0playback-manifest-fixture'
const fixturePlugin = {
  name: 'playback-fixtures',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('/lib/compass') && importer?.includes('/src/App.tsx')) return compassId
    if (source.endsWith('/lib/segment') && importer?.includes('/components/IssueTimeline.tsx')) return segmentId
    if (source.endsWith('/lib/profiles')) return profilesId
    if (source.endsWith('/lib/pool')) return poolId
    if (source.endsWith('/lib/manifest')) return manifestId
  },
  load(id) {
    if (id === manifestId) return `
      export async function fetchManifest() {
        return {
          content: {
            episodeStatus: 'published',
            publishedRss: null,
            issueRef: 'naddr1qa',
            sections: [{
              id: ${JSON.stringify(sectionId)},
              order: ${JSON.stringify(fixtureSegments.map((segment) => segment.event.id))},
              excluded: [],
            }],
          },
        }
      }
      export function subscribeManifest() { return () => {} }
      export function subscribeManifests() { return () => {} }
      export async function fetchAllManifests() { return [] }
      export async function updateManifest() { throw new Error('no writes in playback QA') }
      export function buildInitialManifest() {
        return { episodeStatus: 'draft', publishedRss: null, issueRef: 'naddr1qa', sections: [] }
      }
    `
    if (id === compassId) return `
      const event = ${JSON.stringify(issueEvent)}
      const issue = ${JSON.stringify(fixtureIssue)}
      const olderEvent = ${JSON.stringify(olderIssueEvent)}
      const olderIssue = ${JSON.stringify(olderFixtureIssue)}
      export async function fetchIssueByDTag(dTag) { return dTag === 'newsletter-31' ? olderEvent : event }
      export async function fetchLatestIssue() { return event }
      export async function fetchLatestIssueWithSegments() { return event }
      export function extractIssueNumber(value) { return value.id === olderEvent.id ? 31 : 32 }
      export function parseIssue(value) { return value.id === olderEvent.id ? olderIssue : issue }
    `
    if (id === segmentId) return `
      const segments = ${JSON.stringify(fixtureSegments)}
      export async function fetchSegmentsForIssue() {
        return new Map([[${JSON.stringify(sectionId)}, segments.map((segment) => segment.event)]])
      }
      export function parseSegment(event) { return segments.find((segment) => segment.event.id === event.id) ?? null }
      export async function fetchTranscripts() { return new Map() }
      export function selectTrustedSegmentEvents(events) { return events }
      export async function publishSegment() { throw new Error('Publishing is unavailable in playback QA') }
    `
    if (id === profilesId) return `
      export async function fetchProfiles(pubkeys) {
        return new Map(pubkeys.map((pubkey) => [pubkey, { name: 'Evolve' }]))
      }
      export function authorLabel(profile, pubkey) { return profile?.name || pubkey.slice(0, 8) }
    `
    if (id === poolId) return `
      const pool = {
        async querySync() { return [] },
        subscribeMany() { return { close() {} } },
        publish() { return [] },
      }
      export function getPool() { return pool }
    `
  },
}

const server = await createServer({
  root,
  logLevel: 'error',
  plugins: [fixturePlugin],
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite QA server did not expose a port')
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 320, height: 900, deviceScaleFactor: 1, isMobile: true })
  await page.evaluateOnNewDocument(() => {
    window.__qaPlaySources = []
    window.__qaAudios = []
    window.__qaDeferNextPlay = false
    window.__qaRejectDeferredPlay = null
    const NativeAudio = window.Audio
    window.Audio = function Audio(...args) {
      const audio = new NativeAudio(...args)
      let source = ''
      Object.defineProperty(audio, 'src', {
        configurable: true,
        get: () => source,
        set: (value) => { source = String(value) },
      })
      window.__qaAudios.push(audio)
      return audio
    }
    window.Audio.prototype = NativeAudio.prototype
    HTMLMediaElement.prototype.play = function play() {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      window.__qaPlaySources.push(this.src)
      this.dispatchEvent(new Event('play'))
      if (window.__qaDeferNextPlay) {
        window.__qaDeferNextPlay = false
        return new Promise((_resolve, reject) => { window.__qaRejectDeferredPlay = reject })
      }
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function pause() {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
      this.dispatchEvent(new Event('pause'))
    }
  })

  const origin = `http://127.0.0.1:${address.port}/`
  await page.goto(episodeHref(origin, 32), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bubble__play')
  await page.waitForFunction(() => document.querySelectorAll('.bubble__play').length === 3)
  await page.waitForFunction(() => document.querySelectorAll('.timeline__community-links button').length === 3)

  const failures = []
  const index = await page.evaluate(() => ({
    heading: document.querySelector('.timeline__contents-label')?.textContent?.trim(),
    labels: [...document.querySelectorAll('.timeline__community-links button')].map((link) => link.textContent?.trim()),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }))
  if (index.heading !== 'Jump to a voice note') {
    failures.push(`Episode note index heading is ambiguous: ${JSON.stringify(index)}`)
  }
  if (new Set(index.labels).size !== 3) {
    failures.push(`Episode note links are indistinguishable: ${JSON.stringify(index)}`)
  }
  if (index.scrollWidth > index.innerWidth) failures.push(`Episode note index overflows at 320px: ${JSON.stringify(index)}`)

  await page.click('.bubble__play')
  await page.waitForFunction(() => window.__qaPlaySources.length === 1)
  const firstAudioCount = await page.evaluate(() => window.__qaAudios.length)
  await page.click('.bubble__play')
  await page.waitForFunction(() => document.querySelector('.bubble__play')?.getAttribute('aria-label') === 'Play voice note')
  await page.click('.bubble__play')
  await page.waitForFunction(() => window.__qaPlaySources.length === 2)
  const resumed = await page.evaluate((expectedAudioCount) => ({
    audioCount: window.__qaAudios.length,
    expectedAudioCount,
    uniqueSources: new Set(window.__qaPlaySources).size,
  }), firstAudioCount)
  if (resumed.audioCount !== resumed.expectedAudioCount || resumed.uniqueSources !== 1) {
    failures.push(`Manual pause/resume replaced or changed the current note: ${JSON.stringify(resumed)}`)
  }
  await page.evaluate(() => { window.__qaPlaySources = [] })
  await page.evaluate(() => window.__qaAudios.at(-1)?.dispatchEvent(new Event('ended')))
  await new Promise((resolve) => setTimeout(resolve, 50))
  await page.evaluate(() => window.__qaAudios.at(-1)?.dispatchEvent(new Event('error')))
  await new Promise((resolve) => setTimeout(resolve, 50))

  const playback = await page.evaluate(() => ({
    playInvocations: window.__qaPlaySources.length,
    sources: window.__qaPlaySources,
    activePauseButtons: [...document.querySelectorAll('.bubble__play')]
      .filter((button) => button.getAttribute('aria-label') === 'Pause voice note').length,
  }))
  if (playback.playInvocations !== 0 || playback.activePauseButtons !== 0) {
    failures.push(`A terminal event activated additional playback: ${JSON.stringify(playback)}`)
  }

  await page.evaluate(() => {
    window.__qaPlaySources = []
    window.__qaDeferNextPlay = true
  })
  await page.click('.bubble__play')
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Pause voice note"]').length === 1)
  await page.evaluate(() => { window.__qaOldRaceAudio = window.__qaAudios.at(-1) })
  await page.evaluate(() => document.querySelectorAll('.bubble__play')[1]?.click())
  await page.waitForFunction(() => window.__qaPlaySources.length === 2)
  const beforeReject = await page.evaluate(() => ({
    activePauseButtons: [...document.querySelectorAll('.bubble__play')]
      .filter((button) => button.getAttribute('aria-label') === 'Pause voice note').length,
    secondNotePlaying: document.querySelectorAll('.bubble__play')[1]?.getAttribute('aria-label') === 'Pause voice note',
  }))
  await page.evaluate(() => {
    window.__qaOldRaceAudio?.dispatchEvent(new Event('ended'))
    window.__qaOldRaceAudio?.dispatchEvent(new Event('error'))
  })
  await page.evaluate(() => window.__qaRejectDeferredPlay?.(new Error('stale play rejection')))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const race = await page.evaluate(() => ({
    activePauseButtons: [...document.querySelectorAll('.bubble__play')]
      .filter((button) => button.getAttribute('aria-label') === 'Pause voice note').length,
    secondNotePlaying: document.querySelectorAll('.bubble__play')[1]?.getAttribute('aria-label') === 'Pause voice note',
  }))
  if (!race.secondNotePlaying || race.activePauseButtons !== 1) {
    failures.push(`A stale terminal event or play() rejection cancelled the newly selected note: ${JSON.stringify({ beforeReject, afterReject: race })}`)
  }

  const stalePage = await browser.newPage()
  await stalePage.setViewport({ width: 320, height: 900, deviceScaleFactor: 1, isMobile: true })
  await stalePage.evaluateOnNewDocument(() => localStorage.setItem('logbook_selected_issue', '31'))
  await stalePage.goto(episodeHref(origin, 31), { waitUntil: 'domcontentloaded' })
  await stalePage.waitForFunction(() => document.querySelector('.notice--episode')?.textContent?.includes('Compass #32 is newer'))
  const staleOverflow = await stalePage.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (staleOverflow) failures.push('Newer-episode notice overflows at 320px')
  await stalePage.click('.notice--episode button')
  await stalePage.waitForFunction(() => document.querySelector('.timeline__issue-title')?.textContent?.includes('Compass #32'))
  const selectedIssue = await stalePage.evaluate(() => localStorage.getItem('logbook_selected_issue'))
  if (selectedIssue !== '32') failures.push(`Newer-episode action did not persist the selection: ${selectedIssue}`)
  await stalePage.close()

  if (failures.length) throw new Error(failures.join('\n'))
  console.log(`Playback QA passed: pause/resume retained, completion/error isolated, stale events ignored, newer episode exposed, 3 distinct note links`)
} finally {
  await browser?.close().catch(() => {})
  await server.close().catch(() => {})
}

import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const pubkey = '3c457108865e05d95ce3848aa0bc51cd64f984c5c61689a3d49809ab71fa1d64'
const sectionId = 'sec-lead-stories-public-chapter-32'
const secondSectionId = 'sec-lead-stories-second-chapter-32'
const fixtureEvent = {
  id: '1'.repeat(64), pubkey: '775954f7314112489a4a29ec692b72386fd60bcceb0308d423101ea979c57a80',
  created_at: 1_700_000_000, kind: 30_023, tags: [['d', 'newsletter-32']],
  content: '## Lead stories\n### Public chapter\nDeterministic content', sig: '2'.repeat(128),
}
const fixtureIssue = {
  issueNumber: 32, title: 'Fixture Compass issue', event: fixtureEvent,
  sections: [{ id: 'sec-lead-stories-32', title: 'Lead stories', items: [
    { id: sectionId, title: 'Public chapter', body: 'Fixture body' },
    { id: secondSectionId, title: 'Second chapter', body: 'Second fixture body' },
  ] }],
}
const secondIssueEvent = {
  ...fixtureEvent,
  id: '6'.repeat(64),
  created_at: fixtureEvent.created_at + 1,
  tags: [['d', 'newsletter-33'], ['title', 'Fixture Compass issue 33']],
}
const secondIssue = {
  ...fixtureIssue,
  issueNumber: 33,
  title: 'Fixture Compass issue 33',
  event: secondIssueEvent,
  sections: fixtureIssue.sections.map((section) => ({
    ...section,
    id: section.id.replace(/32$/, '33'),
    items: section.items.map((item) => ({ ...item, id: item.id.replace(/32$/, '33') })),
  })),
}
async function clickButton(page, label) {
  const clicked = await page.evaluate((text) => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
    if (!button) return false
    button.click()
    return true
  }, label)
  if (!clicked) throw new Error(`Button not found: ${label}`)
}
const modules = new Map([
  ['compass', `
    const event=${JSON.stringify(fixtureEvent)}; const issue=${JSON.stringify(fixtureIssue)};
    const secondEvent=${JSON.stringify(secondIssueEvent)}; const secondIssue=${JSON.stringify(secondIssue)};
    export async function fetchIssueByDTag(){return event}
    export async function fetchLatestIssue(){return event}
    export async function fetchLatestIssueWithSegments(){return event}
    export async function fetchAllIssues(){return [secondEvent,event]}
    export function extractIssueNumber(value){return value.id===secondEvent.id?33:32}
    export function parseIssue(value){return value.id===secondEvent.id?secondIssue:issue}
  `],
  ['segment', `
    export async function fetchSegmentsForIssue(){return new Map()}
    export async function fetchTranscripts(){return new Map()}
    export function mergeSegmentEventGroups(base){return new Map(base)}
    export function parseSegment(){return null}
    export function selectTrustedSegmentEvents(){return []}
    export async function publishSegment(){throw new Error('unexpected publish')}
  `],
  ['manifest', `export async function fetchManifest(){return null}`],
  ['profiles', `export async function fetchProfiles(){return new Map()}`],
  ['whitelist', `
    export async function fetchAccessLists(){return {contributors:new Set(),admins:new Set(),sources:new Map(),degraded:false,adminsFromBootstrap:false}}
  `],
  ['pool', `export function getPool(){return {subscribeMany(){return {close(){}}}}}`],
  ['blossom', `
    const attempts=[]
    globalThis.__qaUploads=attempts
    globalThis.__qaRejectUpload=(index)=>attempts[index]?.reject(new Error('stale upload rejected'))
    export async function uploadBlob(blob, signer, pubkey, servers, onProgress){
      onProgress?.('Waiting for Amber signature')
      return await new Promise((resolve,reject)=>attempts.push({resolve,reject}))
    }
  `],
])
const fixturePlugin = {
  name: 'concurrent-recording-fixtures', enforce: 'pre',
  resolveId(source) {
    for (const name of modules.keys()) if (source.endsWith(`/lib/${name}`)) return `\0qa-${name}`
  },
  load(id) { return modules.get(id.replace('\0qa-', '')) },
}
const server = await createServer({ root, logLevel: 'error', plugins: [fixturePlugin], server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite QA server did not expose a port')
  const appUrl = `http://127.0.0.1:${address.port}/`
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error('PAGEERROR', error.message))
  page.on('console', (message) => { if (message.type() === 'error') console.error('CONSOLE', message.text()) })
  await page.setViewport({ width: 390, height: 844, isMobile: true })
  await page.evaluateOnNewDocument((identity) => {
    Object.defineProperty(window, 'nostr', { configurable: true, value: {
      getPublicKey: async () => identity,
      signEvent: async () => new Promise(() => {}),
    } })
    const stream = { getTracks: () => [{ stop() {} }] }
    globalThis.__qaDeferMedia = false
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: () => globalThis.__qaDeferMedia
        ? new Promise((resolve) => { globalThis.__qaReleaseMedia = () => resolve(stream) })
        : Promise.resolve(stream),
    } })
    class FakeAudioContext {
      state = 'running'
      createMediaStreamSource() { return { connect() {} } }
      createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, connect() {}, getByteFrequencyData(data) { data.fill(20) } } }
      createMediaStreamDestination() { return { stream } }
      async resume() {}
      async close() {}
    }
    class FakeMediaRecorder {
      static isTypeSupported() { return true }
      state = 'inactive'
      mimeType = 'audio/webm'
      constructor() {}
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([new Uint8Array(200)], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder })
  }, pubkey)
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.timeline__issue-title')
  await page.evaluate(async ({ ownerPubkey, targetId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('logbook-recording-drafts', 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('drafts', { keyPath: 'id' })
        store.createIndex('issueNumber', 'issueNumber')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const drafts = ['draft-one', 'draft-two'].map((id, index) => ({
      id, issueNumber: 32, ownerPubkey,
      target: { sectionId: targetId, respondingTo: null },
      blob: new Blob([new Uint8Array(200)], { type: 'audio/webm' }),
      duration: index + 1, waveform: [0.2, 0.4], descriptor: null, updatedAt: 100 + index,
    }))
    await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts'); store.clear(); drafts.forEach((draft) => store.put(draft))
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, { ownerPubkey: pubkey, targetId: sectionId })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.timeline__issue-title')
  await page.waitForSelector('.app-login')
  await clickButton(page, 'Sign in to record')
  await page.waitForSelector('.auth-screen')
  await clickButton(page, 'Sign in with extension')
  await page.waitForSelector('.app-identity')
  await page.waitForFunction(() => document.querySelectorAll('.bubble--upload').length > 0)

  const before = await page.evaluate(() => ({
    pending: document.querySelectorAll('.bubble--upload').length,
    recorders: document.querySelectorAll('[aria-label="Record a voice note"]').length,
  }))
  const failures = []
  if (before.pending !== 2) failures.push(`restored ${before.pending} pending drafts instead of 2`)
  if (before.recorders === 0) failures.push('restored draft blocked every new recorder')

  await clickButton(page, 'Resume upload')
  await page.waitForFunction(() => document.body.textContent?.includes('Waiting for Amber signature'))
  await page.waitForFunction(() => window.__qaUploads?.length === 1)

  // Revoke attempt A, restore the same owner/draft, and start attempt B. When A
  // settles late it must not clear B's stage or active marker.
  await clickButton(page, 'Log out')
  await page.waitForSelector('.app-login')
  await clickButton(page, 'Sign in to record')
  await page.waitForSelector('.auth-screen')
  await clickButton(page, 'Sign in with extension')
  await page.waitForSelector('.app-identity')
  await page.waitForFunction(() => document.querySelectorAll('.bubble--upload').length === 2)
  await clickButton(page, 'Resume upload')
  await page.waitForFunction(() => window.__qaUploads?.length === 2)
  await page.evaluate(() => window.__qaRejectUpload(0))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const staleAttempt = await page.evaluate(() => ({
    uploading: document.querySelectorAll('.bubble__upload-icon--pending').length,
    waiting: document.body.textContent?.includes('Waiting for Amber signature'),
  }))
  if (staleAttempt.uploading !== 1 || !staleAttempt.waiting) {
    failures.push(`stale same-draft attempt cleared its replacement ${JSON.stringify(staleAttempt)}`)
  }

  const during = await page.evaluate(() => ({
    pending: document.querySelectorAll('.bubble--upload').length,
    recorders: document.querySelectorAll('[aria-label="Record a voice note"]').length,
  }))
  if (during.pending !== 2) failures.push(`in-flight upload hid a pending draft (${during.pending}/2 visible)`)
  if (during.recorders === 0) failures.push('in-flight Amber/Blossom upload blocked every new recorder')
  let permissionClaimed = false
  if (during.recorders > 0) {
    await page.evaluate(() => { globalThis.__qaDeferMedia = true })
    await page.click('[aria-label="Record a voice note"]')
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Record a voice note"]').length === 0)
    permissionClaimed = true
    await page.evaluate(() => { globalThis.__qaDeferMedia = false; globalThis.__qaReleaseMedia?.() })
    await page.waitForSelector('.irec--live')
  }
  const recordingStarted = Boolean(await page.$('.irec--live'))
  if (!recordingStarted) failures.push('new recording could not start during the in-flight upload')
  if (!permissionClaimed) failures.push('recorder target was not claimed while microphone permission was pending')
  const competingRecorders = await page.$$eval('[aria-label="Record a voice note"]', (nodes) => nodes.length)
  if (competingRecorders !== 0) failures.push(`${competingRecorders} competing recorder remained armable while another recording owned its target`)
  if (recordingStarted) {
    await page.click('[aria-label="Stop and keep recording"]')
    await page.waitForSelector('.irec--review')
    await clickButton(page, 'Publish')
    await page.waitForFunction(() => document.querySelectorAll('.bubble--upload').length === 3)
    await page.waitForFunction(() => document.querySelectorAll('.bubble__upload-icon--pending').length === 2)
  }
  const parallel = await page.evaluate(() => ({
    pending: document.querySelectorAll('.bubble--upload').length,
    uploading: document.querySelectorAll('.bubble__upload-icon--pending').length,
    recorders: document.querySelectorAll('[aria-label="Record a voice note"]').length,
  }))
  if (parallel.pending !== 3 || parallel.uploading !== 2) failures.push(`second take did not upload independently ${JSON.stringify(parallel)}`)
  if (parallel.recorders === 0) failures.push('two in-flight uploads blocked the next recorder')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.timeline__issue-title')
  await page.waitForSelector('.app-identity')
  await page.waitForFunction(() => document.querySelectorAll('.bubble--upload').length > 0)
  const restored = await page.evaluate(() => ({
    pending: document.querySelectorAll('.bubble--upload').length,
    recorders: document.querySelectorAll('[aria-label="Record a voice note"]').length,
  }))
  if (restored.pending !== 3) failures.push(`reload restored ${restored.pending} pending drafts instead of 3`)
  if (restored.recorders === 0) failures.push('reload restored drafts but kept recording blocked')

  await page.evaluate(() => { globalThis.__qaDeferMedia = true })
  await page.click('[aria-label="Record a voice note"]')
  await page.waitForSelector('.irec__idle[role="status"]')
  await clickButton(page, 'Episodes')
  await page.waitForSelector('.issue-picker__item')
  await page.click('.issue-picker__item')
  await page.waitForFunction(() => document.querySelector('.timeline__issue-title')?.textContent?.includes('33'))
  await page.evaluate(() => { globalThis.__qaDeferMedia = false; globalThis.__qaReleaseMedia?.() })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const staleRecorder = await page.evaluate(() => ({
    title: document.querySelector('.timeline__issue-title')?.textContent,
    live: document.querySelectorAll('.irec--live').length,
    recorders: document.querySelectorAll('[aria-label="Record a voice note"]').length,
  }))
  if (!staleRecorder.title?.includes('33') || staleRecorder.live !== 0 || staleRecorder.recorders === 0) {
    failures.push(`stale microphone acquisition mutated the replacement issue ${JSON.stringify(staleRecorder)}`)
  }

  if (failures.length) throw new Error(failures.join('\n'))
  console.log(`Concurrent recording QA passed: ${JSON.stringify({ before, staleAttempt, during, permissionClaimed, recordingStarted, competingRecorders, parallel, restored, staleRecorder })}`)
} finally {
  await browser?.close().catch(() => {})
  await server.close().catch(() => {})
}

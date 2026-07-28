import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'

const widths = [320, 360, 390]
const root = fileURLToPath(new URL('..', import.meta.url))
const fixtureEvent = {
  id: '1'.repeat(64),
  pubkey: '2'.repeat(64),
  created_at: 1_700_000_000,
  kind: 30_023,
  tags: [['d', 'newsletter-32']],
  content: '## Lead stories\n### Public chapter\nDeterministic anonymous content',
  sig: '3'.repeat(128),
}
const fixtureIssue = {
  issueNumber: 32,
  title: 'Fixture Compass issue',
  event: fixtureEvent,
  sections: [{
    id: 'sec-lead-stories-32',
    title: 'Lead stories',
    items: [{ id: 'sec-lead-stories-public-chapter-32', title: 'Public chapter', body: 'Deterministic anonymous content' }],
  }],
}
const fixtureModuleId = '\0public-compass-fixture'
const publicCompassFixture = {
  name: 'public-compass-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source.endsWith('/lib/compass') && importer?.includes('/src/App.tsx')) return fixtureModuleId
  },
  load(id) {
    if (id !== fixtureModuleId) return
    return `
      const event = ${JSON.stringify(fixtureEvent)}
      const issue = ${JSON.stringify(fixtureIssue)}
      export async function fetchIssueByDTag() { return event }
      export async function fetchLatestIssue() { return event }
      export async function fetchLatestIssueWithSegments() { return event }
      export function extractIssueNumber() { return 32 }
      export function parseIssue() { return issue }
    `
  },
}
const server = await createServer({
  root,
  logLevel: 'error',
  plugins: [publicCompassFixture],
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Vite QA server did not expose a port')
  const appUrl = `http://127.0.0.1:${address.port}/`
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  const failures = []
  for (const width of widths) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: true })
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.app-login')
    await page.waitForFunction(() => document.querySelector('.timeline__issue-title')?.textContent?.includes('Compass #32'))
    const layout = await page.evaluate(() => {
      const login = document.querySelector('.app-login')
      const header = document.querySelector('.app-header')
      if (!login || !header) throw new Error('Public application header did not render')
      const offenders = [...document.querySelectorAll('body *')].filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.right > innerWidth + 0.5 || rect.left < -0.5
      }).map((element) => ({ name: element.className || element.tagName, rect: element.getBoundingClientRect().toJSON() }))
      return {
        innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        offenders,
        authScreen: Boolean(document.querySelector('.auth-screen')),
        loginText: login.textContent?.trim(),
        issueText: document.querySelector('.timeline__issue-title')?.textContent?.trim(),
        publicContent: document.body.textContent?.includes('Deterministic anonymous content'),
        recorderCount: document.querySelectorAll('[aria-label="Record a voice note"]').length,
        adminCount: [...document.querySelectorAll('.app-nav button')].filter((button) => button.textContent?.trim() === 'Admin').length,
        headerHeight: header.getBoundingClientRect().height,
      }
    })
    if (layout.authScreen) failures.push(`${width}px: anonymous readers were forced into the auth screen`)
    if (layout.loginText !== 'Sign in to record') failures.push(`${width}px: explicit recording sign-in action missing`)
    if (!layout.issueText?.includes('Compass #32') || !layout.publicContent) failures.push(`${width}px: deterministic public issue content did not load ${JSON.stringify(layout)}`)
    if (layout.recorderCount || layout.adminCount) failures.push(`${width}px: anonymous shell exposed write/admin controls ${JSON.stringify(layout)}`)
    if (layout.docScrollWidth > width || layout.bodyScrollWidth > width || layout.offenders.length) {
      failures.push(`${width}px: horizontal overflow ${JSON.stringify(layout)}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  console.log(`Public shell QA passed at ${widths.join('/')}px`)
} finally {
  await browser?.close().catch(() => {})
  await server.close().catch(() => {})
}

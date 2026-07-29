import { createReadStream } from 'node:fs'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { NostrConnectSigner } from 'applesauce-signers/signers/nostr-connect-signer'
import puppeteer from 'puppeteer'

const mime = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

const root = new URL('..', import.meta.url).pathname
const fixture = await mkdtemp(join(tmpdir(), 'logbook-navigation-cache-'))
await cp(join(root, 'dist'), fixture, { recursive: true })
const indexPath = join(fixture, 'index.html')
const originalIndex = await readFile(indexPath, 'utf8')
const withVersion = (version) => originalIndex.replace('</head>', `<meta name="qa-version" content="${version}"></head>`)
const accountPubkey = '1'.repeat(64)
const offlineSession = NostrConnectSigner.createNbunksec({
  remote: '3'.repeat(64),
  clientKey: '2'.repeat(64),
  relays: ['wss://offline.invalid'],
})
await writeFile(indexPath, withVersion('v1'))

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const target = normalize(join(fixture, relative))
    if (!target.startsWith(fixture)) throw new Error('Invalid path')
    const info = await stat(target)
    if (!info.isFile()) throw new Error('Not a file')
    response.statusCode = 200
    response.setHeader('Content-Type', mime[extname(target)] ?? 'application/octet-stream')
    response.setHeader('Cache-Control', 'no-store')
    createReadStream(target).pipe(response)
  } catch {
    response.statusCode = 404
    response.end('Not found')
  }
})

let browser
let serverClosed = false
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('QA server did not expose a port')
  const appUrl = `http://127.0.0.1:${address.port}/`
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  await page.goto(appUrl, { waitUntil: 'networkidle0' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 5_000 })
  }
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    throw new Error('Service worker did not control the fixture page')
  }

  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const initialOfflineVersion = await page.$eval('meta[name="qa-version"]', (element) => element.getAttribute('content'))
  if (initialOfflineVersion !== 'v1') {
    throw new Error(`Freshly installed offline shell was unavailable: ${initialOfflineVersion}`)
  }
  await page.setOfflineMode(false)

  await writeFile(indexPath, withVersion('v2'))
  await page.reload({ waitUntil: 'networkidle0' })
  const servedVersion = await page.$eval('meta[name="qa-version"]', (element) => element.getAttribute('content'))
  if (servedVersion !== 'v2') {
    throw new Error(`Controlled online navigation served stale ${servedVersion}; expected network-first v2`)
  }
  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const offlineVersion = await page.$eval('meta[name="qa-version"]', (element) => element.getAttribute('content'))
  if (offlineVersion !== 'v2') {
    throw new Error(`Controlled offline navigation did not retain the latest shell: ${offlineVersion}`)
  }
  await page.setOfflineMode(false)

  const authLoads = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\/assets\/auth-[^/]+\.js(?:\?|$)/.test(name)))
  if (authLoads.length > 0) throw new Error(`Auth code loaded before restoration: ${authLoads.join(', ')}`)

  await page.evaluate((session, pubkey) => {
    sessionStorage.setItem('logbook_auth', JSON.stringify({ method: 'amber', session, pubkey }))
  }, offlineSession, accountPubkey)
  await new Promise((resolve) => server.close(resolve))
  serverClosed = true
  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  try {
    await page.waitForSelector('button[aria-label="Log out"]', { timeout: 5_000 })
  } catch {
    const alert = await page.$eval('[role="alert"]', (element) => element.textContent).catch(() => 'no alert')
    throw new Error(`Saved Amber session did not restore offline: ${alert}`)
  }
  await page.setOfflineMode(false)
  console.log('Navigation cache QA passed: fresh offline v1, online v2, runtime-cache offline v2, offline Amber restore')
} finally {
  await browser?.close().catch(() => {})
  if (!serverClosed) await new Promise((resolve) => server.close(resolve))
  await rm(fixture, { recursive: true, force: true })
}

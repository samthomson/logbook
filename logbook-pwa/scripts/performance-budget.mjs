import { gzipSync } from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const html = readFileSync(new URL('index.html', dist), 'utf8')
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="\.\/(assets\/index-[^"]+\.js)"/)
if (!entryMatch) throw new Error('Unable to find the production entry script in dist/index.html')

const entryPath = entryMatch[1]
const entry = readFileSync(new URL(entryPath, dist))
const rawKiB = entry.length / 1024
const gzipKiB = gzipSync(entry).length / 1024
const failures = []

if (rawKiB > 500) failures.push(`entry JavaScript ${rawKiB.toFixed(1)} KiB exceeds 500 KiB`)
if (gzipKiB > 175) failures.push(`entry JavaScript gzip ${gzipKiB.toFixed(1)} KiB exceeds 175 KiB`)

const sw = readFileSync(new URL('sw.js', dist), 'utf8')
const precacheUrls = [...sw.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1])
const uniquePrecacheUrls = [...new Set(precacheUrls)]
if (!uniquePrecacheUrls.includes('index.html')) failures.push('service worker precache manifest was not detected')
if (uniquePrecacheUrls.includes('pwa-512x512.png')) failures.push('large install artwork is eagerly precached')
const optionalChunks = uniquePrecacheUrls.filter((url) => /assets\/AuthScreen-/.test(url))
if (optionalChunks.length) failures.push(`optional chunks are eagerly precached: ${optionalChunks.join(', ')}`)
const authChunks = uniquePrecacheUrls.filter((url) => /assets\/auth-[^/]+\.js$/.test(url))
if (authChunks.length !== 1) failures.push(`offline auth restoration requires one precached auth chunk; found ${authChunks.length}`)

const precacheBytes = uniquePrecacheUrls.reduce((total, url) => {
  try { return total + statSync(resolve(new URL('.', dist).pathname, url)).size } catch { return total }
}, 0)
const precacheKiB = precacheBytes / 1024
if (precacheKiB > 700) failures.push(`precache ${precacheKiB.toFixed(1)} KiB exceeds 700 KiB`)

if (failures.length) {
  console.error(`Performance budget failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Performance budget passed: entry ${rawKiB.toFixed(1)} KiB raw / ${gzipKiB.toFixed(1)} KiB gzip; precache ${precacheKiB.toFixed(1)} KiB across ${uniquePrecacheUrls.length} files`)

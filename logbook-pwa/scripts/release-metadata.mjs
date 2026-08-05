import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const release = JSON.parse(readFileSync(new URL('../dist/release.json', import.meta.url), 'utf8'))

if (typeof release.release !== 'string' || release.release.length < 7) {
  throw new Error('release.json does not contain a usable release identifier')
}

const escaped = release.release.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
if (!new RegExp(`<meta[^>]+name=["']logbook-release["'][^>]+content=["']${escaped}["']`).test(html)) {
  throw new Error('index.html release marker does not match release.json')
}

console.log(`Release metadata passed: ${release.release}`)

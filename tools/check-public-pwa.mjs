import { pathToFileURL } from 'node:url'

const RELEASE_META = /<meta\s+name=["']logbook-release["']\s+content=["']([^"']+)["'][^>]*>/i

export async function checkPublicPwa({ baseUrl, expectedRelease, fetchImpl = fetch }) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
    throw new Error('public PWA check requires HTTPS except on localhost')
  }

  const response = await fetchImpl(base, { redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw new Error(`public PWA returned HTTP ${response.status}`)
  const html = await response.text()
  const release = html.match(RELEASE_META)?.[1]
  if (!release) throw new Error('public PWA is missing the logbook-release marker')
  if (expectedRelease && release !== expectedRelease) {
    throw new Error(`public PWA release ${release} does not match expected ${expectedRelease}`)
  }

  return {
    checkedAt: new Date().toISOString(),
    baseUrl: base.href,
    release,
  }
}

async function main() {
  const [baseUrl, expectedRelease] = process.argv.slice(2)
  if (!baseUrl) throw new Error('usage: check-public-pwa.mjs <base-url> [expected-release]')
  console.log(JSON.stringify(await checkPublicPwa({ baseUrl, expectedRelease }), null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function localReferences(html) {
  const paths = new Set(['index.html', 'release.json', 'manifest.webmanifest', 'registerSW.js', 'sw.js'])
  for (const match of html.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)["']/g)) {
    paths.add(match[1])
  }
  return [...paths].sort()
}

export async function verifyDeployment({ baseUrl, distDir, fetchImpl = fetch }) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
    throw new Error('deployment verification requires HTTPS except on localhost')
  }

  const localHtml = await readFile(resolve(distDir, 'index.html'))
  const references = localReferences(localHtml.toString('utf8'))
  const files = []

  for (const path of references) {
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`${path}: release contains a non-local asset path`)
    }
    const local = await readFile(resolve(distDir, path))
    const url = new URL(path, base)
    if (url.origin !== base.origin) throw new Error(`${path}: release asset leaves the gateway origin`)
    const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store' })
    if (!response.ok) throw new Error(`${path}: gateway returned HTTP ${response.status}`)
    const remote = Buffer.from(await response.arrayBuffer())
    const localHash = sha256(local)
    const remoteHash = sha256(remote)
    if (local.length !== remote.length || localHash !== remoteHash) {
      throw new Error(`${path}: public bytes do not match the release candidate`)
    }
    files.push({ path, url: url.href, bytes: local.length, sha256: localHash })
  }

  const release = JSON.parse(await readFile(resolve(distDir, 'release.json'), 'utf8'))
  const html = localHtml.toString('utf8')
  if (!html.includes(`name="logbook-release" content="${release.release}"`)) {
    throw new Error('local release marker is inconsistent')
  }

  return {
    verifiedAt: new Date().toISOString(),
    baseUrl: base.href,
    release: release.release,
    files,
  }
}

async function main() {
  const [baseUrl, distDir = 'logbook-pwa/dist'] = process.argv.slice(2)
  if (!baseUrl) throw new Error('usage: verify-pwa-deployment.mjs <base-url> [dist-dir]')
  console.log(JSON.stringify(await verifyDeployment({ baseUrl, distDir }), null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

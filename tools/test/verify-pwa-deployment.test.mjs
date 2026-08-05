import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyDeployment } from '../verify-pwa-deployment.mjs'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'logbook-deploy-'))
  await mkdir(join(dir, 'assets'))
  const release = '0123456789abcdef'
  await writeFile(join(dir, 'index.html'), `<meta name="logbook-release" content="${release}"><script src="./assets/app.js"></script><link href="./assets/app.css">`)
  await writeFile(join(dir, 'release.json'), `${JSON.stringify({ release })}\n`)
  await writeFile(join(dir, 'manifest.webmanifest'), '{}')
  await writeFile(join(dir, 'registerSW.js'), 'register()')
  await writeFile(join(dir, 'sw.js'), 'worker')
  await writeFile(join(dir, 'assets/app.js'), 'app')
  await writeFile(join(dir, 'assets/app.css'), 'body{}')
  return dir
}

async function serve(dir) {
  const server = createServer(async (request, response) => {
    try {
      const path = request.url === '/' ? 'index.html' : request.url.slice(1)
      response.end(await import('node:fs/promises').then(({ readFile }) => readFile(join(dir, path))))
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

test('verifies exact deployed bytes and emits a release receipt', async (t) => {
  const dir = await fixture()
  const { server, url } = await serve(dir)
  t.after(() => server.close())
  const receipt = await verifyDeployment({ baseUrl: url, distDir: dir })
  assert.equal(receipt.release, '0123456789abcdef')
  assert.deepEqual(receipt.files.map(({ path }) => path), [
    'assets/app.css', 'assets/app.js', 'index.html', 'manifest.webmanifest', 'registerSW.js', 'release.json', 'sw.js',
  ])
})

test('rejects stale gateway bytes', async (t) => {
  const dir = await fixture()
  const { server, url } = await serve(dir)
  t.after(() => server.close())
  await writeFile(join(dir, 'assets/app.js'), 'changed-after-deploy')
  const staleFetch = async (input, init) => {
    if (new URL(input).pathname === '/assets/app.js') {
      return new Response('stale', { status: 200 })
    }
    return fetch(input, init)
  }
  await assert.rejects(
    verifyDeployment({ baseUrl: url, distDir: dir, fetchImpl: staleFetch }),
    /public bytes do not match/,
  )
})

test('rejects a release that references a parent path', async (t) => {
  const dir = await fixture()
  await writeFile(join(dir, 'index.html'), '<script src="./../outside.js"></script>')
  const { server, url } = await serve(dir)
  t.after(() => server.close())
  await assert.rejects(
    verifyDeployment({ baseUrl: url, distDir: dir }),
    /non-local asset path/,
  )
})

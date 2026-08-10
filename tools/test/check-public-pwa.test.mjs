import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { checkPublicPwa } from '../check-public-pwa.mjs'

const url = 'https://example.test/'

test('reports the public commit-bound release marker', async () => {
  const result = await checkPublicPwa({
    baseUrl: url,
    expectedRelease: 'abc123',
    fetchImpl: async () => new Response('<meta name="logbook-release" content="abc123">'),
  })
  assert.equal(result.baseUrl, url)
  assert.equal(result.release, 'abc123')
})

test('rejects a public page without a release marker', async () => {
  await assert.rejects(
    checkPublicPwa({ baseUrl: url, fetchImpl: async () => new Response('<main>Logbook</main>') }),
    /missing the logbook-release marker/,
  )
})

test('rejects a release marker that differs from the expected release', async () => {
  await assert.rejects(
    checkPublicPwa({
      baseUrl: url,
      expectedRelease: 'expected',
      fetchImpl: async () => new Response('<meta name="logbook-release" content="stale">'),
    }),
    /does not match expected/,
  )
})

test('rejects redirects and failed endpoint responses', async () => {
  await assert.rejects(
    checkPublicPwa({ baseUrl: url, fetchImpl: async () => new Response('', { status: 503 }) }),
    /HTTP 503/,
  )
})

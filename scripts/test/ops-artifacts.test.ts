import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFile(resolve(repoRoot, path), 'utf8')

test('CI validates both the PWA and trusted worker when either surface changes', async () => {
  const workflow = await read('.github/workflows/logbook-pwa.yml')
  assert.match(workflow, /- 'scripts\/\*\*'/)
  assert.match(workflow, /scripts\/package-lock\.json/)
  assert.match(workflow, /working-directory: scripts/)
  assert.match(workflow, /npm run typecheck/)
})

test('tracked worker service is hardened, restartable, and never asks for a hot Compass nsec', async () => {
  const service = await read('deploy/systemd/logbook-worker.service')
  const runbook = await read('deploy/README.md')
  assert.doesNotMatch(runbook, /npm ci --omit=dev/)
  assert.match(runbook, /npm ci --no-audit --no-fund/)
  assert.match(service, /User=logbook/)
  assert.match(service, /EnvironmentFile=-\/etc\/logbook\/logbook\.env/)
  assert.match(service, /Restart=on-failure/)
  assert.match(service, /StateDirectory=logbook/)
  assert.match(service, /NoNewPrivileges=true/)
  assert.doesNotMatch(service, /COMPASS_NSEC/)
})

test('nsyte config is authoritative and build-only tooling is not a production dependency', async () => {
  const config = JSON.parse(await read('logbook-pwa/.nsite/config.json')) as {
    relays?: unknown[]
    servers?: unknown[]
    title?: string
  }
  const packageJson = JSON.parse(await read('logbook-pwa/package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  assert.equal(packageJson.dependencies?.['vite-plugin-pwa'], undefined)
  assert.ok(packageJson.devDependencies?.['vite-plugin-pwa'])
  assert.equal(config.title, 'Logbook')
  assert.ok((config.relays?.length ?? 0) >= 3)
  assert.ok((config.servers?.length ?? 0) >= 3)
  await assert.rejects(read('nsite.toml'))
  await assert.rejects(read('logbook-pwa/nsite.toml'))
})

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

test('container worker reproduces the systemd sandbox and pins an ffmpeg the stitcher can use', async () => {
  const compose = await read('compose.yml')
  const dockerfile = await read('scripts/Dockerfile')

  // Bookworm's ffmpeg 5.1 silently empties every episode, so the base image is
  // the guarantee that the stitcher runs on a version whose silenceremove works.
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:[\d.]+-trixie-slim$/m)
  // Every stage must share that base so the copied venv links against the same
  // Python minor version the runtime provides.
  assert.doesNotMatch(dockerfile, /^FROM (?!\$\{NODE_IMAGE\})/m)
  assert.match(dockerfile, /USER logbook/)
  // nak sits on the signing path; an unverified download would be a supply-chain hole.
  assert.match(dockerfile, /sha256sum -c -/)

  assert.match(compose, /read_only: true/)
  assert.match(compose, /cap_drop: \[ALL\]/)
  assert.match(compose, /no-new-privileges:true/)
  // Signer session from env vars (Dokploy / .env), not a file mount or baked secret.
  assert.match(compose, /COMPASS_BUNKER_URI: \$\{COMPASS_BUNKER_URI\}/)
  assert.match(compose, /COMPASS_BUNKER_CLIENT_KEY: \$\{COMPASS_BUNKER_CLIENT_KEY\}/)
  assert.doesNotMatch(compose, /COMPASS_BUNKER_DIR/)
  assert.doesNotMatch(compose, /compass-publish/)
  // Untrusted audio is downloaded into scratch space, which must not be executable.
  assert.match(compose, /- \/tmp:noexec/)
  // No key material in the tracked file.
  assert.doesNotMatch(compose, /COMPASS_NSEC/)
  assert.doesNotMatch(compose, /nsec1[0-9a-z]{20,}/)
  assert.doesNotMatch(compose, /[0-9a-f]{64}/)
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
  assert.equal(packageJson.dependencies?.['@huggingface/transformers'], undefined)
  assert.equal(config.title, 'Logbook')
  assert.ok((config.relays?.length ?? 0) >= 3)
  assert.ok((config.servers?.length ?? 0) >= 3)
  await assert.rejects(read('nsite.toml'))
  await assert.rejects(read('logbook-pwa/nsite.toml'))
})

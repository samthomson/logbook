import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFile(resolve(repoRoot, path), 'utf8')

test('local verification validates both the PWA and trusted worker', async () => {
  const verifier = await read('tools/verify-all.sh')
  assert.match(verifier, /logbook-pwa/)
  assert.match(verifier, /npm run test:browser/)
  assert.match(verifier, /npm run build/)
  assert.match(verifier, /scripts/)
  assert.match(verifier, /npm run typecheck/)
  assert.match(verifier, /npm audit --omit=dev --audit-level=high/)
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
  const compose = await read('docker-compose.yml')
  const dockerfile = await read('scripts/Dockerfile')
  const pwaDockerfile = await read('logbook-pwa/Dockerfile')

  // Bookworm's ffmpeg 5.1 silently empties every episode, so the base image is
  // the guarantee that the stitcher runs on a version whose silenceremove works.
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:[\d.]+-trixie-slim@sha256:[0-9a-f]{64}$/m)
  // Every stage must share that base so the copied venv links against the same
  // Python minor version the runtime provides.
  assert.doesNotMatch(dockerfile, /^FROM (?!\$\{NODE_IMAGE\})/m)
  assert.match(dockerfile, /USER logbook/)
  // nak sits on the signing path; an unverified download would be a supply-chain hole.
  assert.match(dockerfile, /COPY --from=nak \/usr\/local\/bin\/nak/)
  // whisper-cli is on the transcript-publishing path; its source tarball and
  // model weights are pinned and baked in so a release never waits on a
  assert.match(dockerfile, /COPY --from=whisper \/opt\/whisper-model\/ggml-small\.en\.bin/)
  assert.match(dockerfile, /ARG WHISPER_MODEL_SHA256=[0-9a-f]{64}/)
  assert.match(dockerfile, /COPY --from=whisper \/usr\/local\/bin\/whisper-cli/)
  assert.match(dockerfile, /LOGBOOK_WHISPER_MODEL=\/opt\/whisper-model\/ggml-small\.en\.bin/)
  assert.match(await read('scripts/watch-compass.ts'), /assertWhisperConfigured/)

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
  assert.match(compose, /logbook-www:\/var\/www\/logbook/)
  assert.match(compose, /\.\/scripts:\/opt\/logbook\/scripts:ro/)
  assert.match(compose, /127\.0\.0\.1:8080:8080/)
  assert.doesNotMatch(compose, /LOGBOOK_FEED_READBACK_URL: http:\/\/origin:8080\/feed\.xml/)
  assert.match(compose, /LOGBOOK_FEED_READBACK_URL: \$\{LOGBOOK_FEED_READBACK_URL:-\}/)
  const originNginx = await read('deploy/origin-nginx.conf')
  assert.match(originNginx, /root \/var\/www\/logbook/)
  assert.match(originNginx, /location = \/feed\.xml/)
  assert.match(originNginx, /location ~ \^\/audio\/.+\\\.mp3\$/)
  assert.match(originNginx, /location ~ \^\/audio\/.+-chapters\\\.json\$/)
  assert.match(originNginx, /location \/ \{\s*return 404;/)
  assert.equal(originNginx.match(/^\s*location /gm)?.length, 4, 'origin must expose only three artifact routes')
  assert.doesNotMatch(await read('scripts/watch-compass.ts'), /origin-server/)
  // No key material in the tracked file.
  assert.doesNotMatch(compose, /COMPASS_NSEC/)
  assert.doesNotMatch(compose, /nsec1[0-9a-z]{20,}/)
  assert.match(pwaDockerfile, /^FROM node:[\d.]+-bookworm-slim@sha256:[0-9a-f]{64} AS deps$/m)
  assert.match(pwaDockerfile, /^FROM nginxinc\/nginx-unprivileged:[\w.-]+@sha256:[0-9a-f]{64}$/m)
  assert.match(compose, /image: busybox:[\d.]+@sha256:[0-9a-f]{64}/)
  assert.match(compose, /image: nginxinc\/nginx-unprivileged:[\w.-]+@sha256:[0-9a-f]{64}/)
})

test('repository tooling never starts a hot-key bunker or puts signer secrets in nsyte argv', async () => {
  const deploy = await read('scripts/deploy-nsite.sh')
  const readme = await read('README.md')
  const envExample = await read('.env.example')

  await assert.rejects(read('scripts/start-bunker.sh'))
  assert.doesNotMatch(readme, /start-bunker|\.secrets\/compass-publish/)
  assert.doesNotMatch(envExample, /COMPASS_NSYTE_SEC/)
  assert.doesNotMatch(deploy, /--sec|COMPASS_NSYTE_SEC|createNbunksec/)
  assert.match(deploy, /bunkerPubkey/)
  assert.match(deploy, /COMPASS_PUBKEY/)
  assert.match(deploy, /\.well-known\/nostr\.json/)
})

test('feed read-back configuration is portable across compose and systemd', async () => {
  const rootEnv = await read('.env.example')
  const systemdEnv = await read('deploy/systemd/logbook.env.example')
  const runbook = await read('deploy/README.md')

  assert.match(rootEnv, /LOGBOOK_FEED_READBACK_URL/)
  assert.match(systemdEnv, /LOGBOOK_FEED_READBACK_URL/)
  assert.match(runbook, /defaults to `LOGBOOK_BASE_URL\/feed\.xml`/)
})

test('watcher restores feed state before its first publishing tick', async () => {
  const watcher = await read('scripts/watch-compass.ts')
  const recovery = watcher.indexOf('await withPool((pool) => materializeOriginFeed(pool))')
  const firstTick = watcher.indexOf('\n  tick()')
  assert.ok(recovery >= 0, 'watcher must invoke origin recovery')
  assert.ok(firstTick > recovery, 'origin recovery must finish before the first tick')
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

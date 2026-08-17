# Trusted worker deployment

These files provision the long-running Logbook watcher on a trusted Linux host. The service runs as the dedicated `logbook` account and reuses that account's already-authorized Compass NIP-46 session. It does **not** require or accept a hot Compass nsec in the unit or environment file.

## Install

1. Check out the repository at `/opt/logbook` and run `npm ci --no-audit --no-fund` in `scripts/`. The worker executes TypeScript with `tsx`, so do not omit dev dependencies from this source checkout.
2. Create the `logbook` system account and `/etc/logbook/logbook.env` from `logbook.env.example`.
3. Set `COMPASS_BUNKER_URI` and `COMPASS_BUNKER_CLIENT_KEY` in the environment
   (NIP-46 session for the Compass identity). Same variables in Docker/Dokploy.
4. Install `logbook-worker.service` into `/etc/systemd/system/`, run `systemctl daemon-reload`, then enable/start it.
5. Verify `systemctl status logbook-worker` and inspect the durable release-stage ledger before treating any episode as published.

The service's writable scope is limited to `/var/www/logbook`, `/var/lib/logbook`, and `/var/cache/logbook`. Publication must remain idempotent: a restart resumes incomplete stages; it must not recreate a successful Nostr or feed stage.

### Host requirements

`ffmpeg` must be version 7 or newer. Older builds accept the stitcher's `silenceremove` arguments but discard every clip, producing an empty episode rather than an error — Debian 12 ships 5.1 and is therefore unsuitable without a backport. `requireFfmpeg()` refuses to start a stitch on an older build, so this surfaces as a failed run rather than published silence.

## Container deployment

`compose.yml` at the repository root builds and runs the same worker with an image-pinned ffmpeg 7, Node, `nak`, and TTS runtime, and reproduces this unit's sandbox: unprivileged `logbook` user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, and an explicit set of writable volumes. Use it for local work, staging, and any host where pinning the toolchain matters more than matching the distro. The root `README.md` covers first-run setup.

## PWA deployment

The authoritative nsyte configuration is `logbook-pwa/.nsite/config.json`. From
the repo root, with `.env` filled (including Compass bunker vars):

```sh
./scripts/deploy-nsite.sh
```

That builds the PWA and runs `nsyte deploy dist --sync` signed as Compass
(`COMPASS_BUNKER_URI` or `COMPASS_NSYTE_SEC`). A successful upload is not release
proof: verify a gateway whose HTML references the exact local bundle, compare
the served bundle SHA-256 with `dist/assets`, and confirm a marker from the
shipped change before sharing a URL. Point `gatewayHostnames` in
`.nsite/config.json` at your gateway (e.g. Relaykit).

# Trusted worker deployment

These files provision the long-running Logbook watcher on a trusted Linux host. The service runs as the dedicated `logbook` account and reuses that account's already-authorized Compass NIP-46 session. It does **not** require or accept a hot Compass nsec in the unit or environment file.

## Install

1. Check out the repository at `/opt/logbook` and run `npm ci --no-audit --no-fund` in `scripts/`. The worker executes TypeScript with `tsx`, so do not omit dev dependencies from this source checkout.
2. Create the `logbook` system account and `/etc/logbook/logbook.env` from `logbook.env.example`.
3. Authenticate the Compass signer outside Hermes so `/home/logbook/.config/compass-publish/bunker.json` and `client_key` exist with mode `0600` and owner `logbook:logbook`.
4. Install `logbook-worker.service` into `/etc/systemd/system/`, run `systemctl daemon-reload`, then enable/start it.
5. Verify `systemctl status logbook-worker` and inspect the durable release-stage ledger before treating any episode as published.

The service's writable scope is limited to `/var/www/logbook`, `/var/lib/logbook`, and `/var/cache/logbook`. Publication must remain idempotent: a restart resumes incomplete stages; it must not recreate a successful Nostr or feed stage.

## PWA deployment

The authoritative nsyte configuration is `logbook-pwa/.nsite/config.json`. Build with `npm run build`, then deploy from `logbook-pwa/` with the existing authorized signer using `nsyte deploy dist --sync`. A successful upload is not release proof: verify a gateway whose HTML references the exact local bundle, compare the served bundle SHA-256 with `dist/assets`, and confirm a marker from the shipped change before sharing a URL.

# Worker on a host

Prefer Docker: root `docker-compose.yml`, same `.env` names as local. Dokploy with no
profile starts the worker and the feed origin (nginx on loopback :8080).

Bare metal: `systemd/logbook-worker.service` plus `systemd/logbook.env.example`
copied to `/etc/logbook/logbook.env`. In `/opt/logbook/scripts`,
`npm ci --no-audit --no-fund`. Needs ffmpeg 7+ (`requireFfmpeg` refuses
older). Writable paths: `/var/www/logbook`, `/var/lib/logbook`,
`/var/cache/logbook`. The worker verifies hosted feed bytes at
`LOGBOOK_FEED_READBACK_URL`, which defaults to `LOGBOOK_BASE_URL/feed.xml`.
Set the override only when the host exposes the same feed through a separate
loopback or origin URL and public-host verification is intentionally unavailable.
The bundled origin exposes only `feed.xml`, MP3s, and chapter JSON; worker state
such as `episodes.json`, run metadata, and release ledgers is never public.

PWA: preconfigure nsyte with the externally managed, already-authorized Compass
bunker in its OS keychain or encrypted store, select `COMPASS_PUBKEY` with
`nsyte bunker use`, then run `./scripts/deploy-nsite.sh` from the repo root.
The script never accepts signer material on argv and verifies the configured
signer identity plus the built NIP-05 document before upload (see root README).

The worker must use the dedicated `logbook` account and its already-authorized
Compass NIP-46 session; do not put a hot Compass nsec in the service or
environment file. Signer files stay outside Hermes with mode `0600`. Inspect
the durable release-stage ledger before treating an episode as published. A
restart resumes incomplete stages and must not recreate a successful Nostr or
feed stage. An nsite upload is not a release until a gateway serves the exact
candidate HTML and referenced JS/CSS bytes plus the release-specific marker;
follow `../docs/operations-and-testing.md`.

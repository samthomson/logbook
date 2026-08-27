# Worker on a host

Prefer Docker: root `docker-compose.yml`, same `.env` names as local. Dokploy with no
profile starts the worker and the feed origin (nginx on loopback :8080).

Bare metal: `systemd/logbook-worker.service` plus `systemd/logbook.env.example`
copied to `/etc/logbook/logbook.env`. In `/opt/logbook/scripts`,
`npm ci --no-audit --no-fund`. Needs ffmpeg 7+ (`requireFfmpeg` refuses
older). Writable paths: `/var/www/logbook`, `/var/lib/logbook`,
`/var/cache/logbook`.

PWA: `./scripts/deploy-nsite.sh` from the repo root (see root README).

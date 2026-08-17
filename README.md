# Logbook

Asynchronous voice-podcast client for Nostr Compass. Each week it ingests the latest
Compass issue, splits it into sections, and lets whitelisted contributors leave voice
notes under each section and respond to each other. The collection is cut into a
produced ~90-min episode published as a Podcasting 2.0 RSS feed. Static nsite + PWA;
the VPS acts as one admin Nostr client (publishes AI intros, runs the stitcher).

Status: active implementation. The PWA, signed admin workspace, trusted
stitcher, and release scripts have executable coverage. Production device,
signer, media-publication, RSS-hosting, and exact nsite-gateway validation remain
separate operational gates; a green unit/build run is not release evidence.

## Folder

- `logbook-pwa/DESIGN.md` — minimal UI design system (tokens, type, components).
- `PLAN.md` — event schema, ordering algorithm, component architecture, and
  phased build plan (v0 spike through v3), with every review-round fix folded in.
- `research/findings.md` — consolidated technical research and locked decisions from
  the four scoping rounds.
- `research/open-questions.md` — live design questions, including the async ordering
  problem that killed the flat-chronology model (resolved in `PLAN.md` §2).
- `deploy/` — hardened trusted-worker unit, public environment template, and
  installation/recovery runbook.

## Roles

- **Compass** (`COMPASS_PUBKEY` + bunker) — the podcast identity. Nobody logs
  in as it; the worker signs newsletters and releases with its bunker.
- **Producer** (`ADMIN_PUBKEYS`, comma-separated hex) — curates and locks
  episodes. Put your personal key here and log in with it. Compass publishes
  this list (kind 34201, `d=logbook-wl-admins`); only Compass can change it.
- **Contributor** — anyone on the issue whitelist. Records voice notes. A
  producer can also be a contributor; the two are independent.

There is one page per episode (`#/episode/<naddr>`). Contributors get record rows
on it; a producer additionally gets the in/out and ordering controls on each
voice note and the publish bar at the end. Once published, the episode takes no
more recordings and links the finished audio.

## Run it locally

Everything runs in Docker; you do not need Node, ffmpeg, or Python on your
machine.

1. Create a burner Compass identity (`nak bunker` is fine). Leave the bunker
   running. Put `COMPASS_BUNKER_URI` and `COMPASS_BUNKER_CLIENT_KEY` in `.env`
   (same vars on Dokploy — no secret file mounts).

2. `cp .env.example .env` — set `COMPASS_PUBKEY`, `ADMIN_PUBKEYS`, `RELAYS`
   (Logbook write/query), `DISCOVERY_RELAYS` (kind 0 / NIP-05, read-only),
   `BLOSSOM_SERVERS`, and the bunker vars above. Same names everywhere. No
   defaults: missing values fail at startup.

3. App + worker: `docker compose --profile dev up --build` (PWA on
   `localhost:$PWA_DEV_PORT` with Vite HMR). Use `--profile prod` for the built
   nginx PWA on `localhost:$PWA_PORT`. Dokploy passes no profile, so it starts
   the worker alone.

4. Seed a fake newsletter + whitelist (bunker must be running):

   ```sh
   docker compose run --rm worker npm run seed -- 1
   ```

5. Publish the PWA as an nsite (Compass identity — same bunker as the worker):

   ```sh
   ./scripts/deploy-nsite.sh
   ```

   Needs `nsyte` on PATH. Optional: `nsyte ci` once and
   set `COMPASS_NSYTE_SEC` for a stable deploy credential.

The worker validates the bunker session at startup and exits with an explanation
if it's missing.

Dokploy: set the same variables plus `COMPOSE_PROFILES=prod`, without which a
plain `docker compose up` starts only the worker.

Identity is compiled into the PWA bundle (Vite inlines `import.meta.env`), so
changing `COMPASS_PUBKEY` needs a rebuild, not just a restart. The worker
container runs unprivileged with a read-only root filesystem, mirroring the
systemd sandbox in `deploy/`.

## Locked decisions (short version)

- Custom event envelope; interop with Amethyst/Nostur is a non-goal.
- Audio on Blossom (own VPS origin + mirror); episode is the durable artifact.
- Final output: Podcasting 2.0 RSS (mp3), NIP-73 note for Fountain discussion.
- Stitching runs on the VPS; author-curated cut, drag-to-reorder.
- Host the PWA through nsyte/nsite; host feed and episode media on the trusted
  HTTPS origin. A gateway URL is shareable only after exact bundle verification.
- Remote signers default (NIP-46); Amber on Android; nsec paste discouraged.
- AI intro written on this machine in the Compass pipeline, published by Compass npub.
- ~90-min episode; 2-5 min typical per note, longer allowed, no chunking.

## Validation

Run `npm test && npm run lint && npm run build` in `logbook-pwa/`, and
`npm test && npm run typecheck` in `scripts/`. The worker suite also runs in the
container via `docker compose run --rm worker npm test`, where three ops tests
fail by design because they read repository files (CI workflow, systemd unit)
that are deliberately not shipped in a runtime image. Privileged signer, relay,
Blossom, RSS, and nsite checks must use the controlled staging procedure in
`docs/operations-and-testing.md`; never substitute static inspection for those
external acknowledgements.

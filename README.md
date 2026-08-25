# Logbook

Async voice podcast for Nostr Compass. Contributors record, producers cut, the
worker stitches and publishes RSS. Two roles only; Compass is the podcast
account nobody logs into.

## Local

```sh
cp .env.example .env   # Compass, ADMIN_PUBKEYS, relays, blossom, bunker
docker compose --profile dev up --build
```

PWA: `http://localhost:$PWA_DEV_PORT`. Optional fake issue:

```sh
docker compose run --rm worker npm run seed -- 1
```

`--profile prod` serves the built PWA on `$PWA_PORT`. Dokploy with no profile
starts the worker only.

## Publish the PWA (nsite)

`nsyte` on PATH ([install](https://nsyte.run/docs/installation)). Compass bunker
running. `.env` has `COMPASS_PUBKEY`, `NSYTE_RELAYS`, `NSYTE_BLOSSOM_SERVERS`,
and either `COMPASS_NSYTE_SEC` or both `COMPASS_BUNKER_URI` +
`COMPASS_BUNKER_CLIENT_KEY` (same session as the worker).

```sh
./scripts/deploy-nsite.sh
```

Open via the gateway in `logbook-pwa/.nsite/config.json` (`nsite.lol`) with the
Compass npub. Changing `COMPASS_PUBKEY` needs a rebuild; Vite inlines it.

## Design

`PLAN.md` is the locked event schema. `AGENTS.md` is for agents, not operators.

## Later

- Seed issues reuse one stub outline (same H2/H3 every time). A real test is a
  pasted Compass 30023, not another run of `seed`.
- Tag a guest on a chapter, not only on the episode whitelist. Today an `npub`
  in the newsletter is a suggested add for the whole issue.

## todo

- dark themed ui, AMOLED black
- Producer UI: browse real Compass kind 30023 issues on relays → pick one → “Start podcast draft” → publish kind 34200 manifest from that newsletter’s sections (not seed stub)
- normalise audio levels in ffmpeg when stitching a podcast together
- mobile ux ui++ (recorder, tap targets, sticky release bar)
- ai transcription of uploads

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

# Logbook

Async voice podcast for Nostr Compass. Contributors record, producers cut, the
worker stitches and publishes RSS. Two roles only; Compass is the podcast
account nobody logs into.

## Local

```sh
cp .env.example .env   # Compass, ADMIN_PUBKEYS, relays, blossom, bunker
docker compose --profile dev up --build
```

PWA: `http://localhost:$PWA_DEV_PORT`. Feed origin: `$LOGBOOK_BASE_URL/feed.xml`
(compose `origin` nginx, same as Dokploy).

`--profile prod` serves the built PWA on `$PWA_PORT` (not the feed origin port).

```sh
docker compose run --rm worker npm run seed -- 1
```

Dokploy with no profile starts the worker and the feed origin.

## Compass signer (bunker)

The worker and nsite publish sign through a NIP-46 bunker holding the Compass
key. Run it in a terminal you keep open whenever you're testing:

```sh
./scripts/start-bunker.sh
```

One-time: put the Compass hex sec in `.secrets/compass-publish/sec` (gitignored,
`chmod 600`). The script derives `-k`/`-s` from `.env`, so restarts change
nothing else.

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

## Nostr protocol

Logbook's kinds are its own (the 342xx band); only Logbook publishes and reads
them. Producers are named on the Compass-signed producer list (34201); every
manifest query pins and re-verifies authors against that set.

| Kind | What it is | Who signs it |
|---|---|---|
| 4200 | Voice-note segment (audio JSON, `x` sha256 tag) | Contributor |
| 34200 | Episode manifest / cut (addressable; the stitcher's only order input) | Producer |
| 34201 | Producer + contributor lists (`d=logbook-wl-admins`, `logbook-wl-standing`, `logbook-wl-<n>`) | Compass only |
| 34202 | Retranscribe request (one `e` tag naming a 4200) | Producer |
| 1111 | Transcript companion (sentence chunks, `e` → 4200, `k` → 4200) | Worker (Compass npub) |

The worker subscribes live to 4200/34200/34202 on `RELAYS` and reacts
immediately (transcribe, stitch, retranscribe); a once-a-minute poll of stored
events is the fallback, so nothing published while the worker was down is
missed. Transcription itself never runs in a browser — whisper.cpp (small.en,
pinned) runs only in the worker container.

## Later

- Seed issues reuse one stub outline (same H2/H3 every time). A real test is a
  pasted Compass 30023, not another run of `seed`.
- Tag a guest on a chapter, not only on the episode whitelist. Today an `npub`
  in the newsletter is a suggested add for the whole issue.

## todo

- [x] dark themed ui, AMOLED black
- [x] Producer UI: browse real Compass kind 30023 issues on relays → pick one → “Start podcast draft” → publish kind 34200 manifest from that newsletter’s sections (not seed stub)
- [x] normalise audio levels in ffmpeg when stitching a podcast together
- [x] ai transcription of uploads (worker whisper.cpp small.en; producer retranscribe button; live response)
- [x] make publishing feel more robust, for each episode show a checklist of sorts of what tasks get done and are done (ie producing various xml files and publishing to blossom). have individual states/buttons for each


- [/] Prove release end-to-end on staging — the actual milestone blocker, not in README

- [ ] Whitelist Derek/MrBlack + run the test — ops actions, fair to omit from a code todo list
- [ ] mobile ux ui++ (recorder, tap targets, sticky release bar)


- [ ] Move the "transcribe again" button inline with the other buttons to save vertical space
- [ ] Clarify if the browser tab must remain open during episode processing after publishing
- [ ] Ensure code blocks are rendered properly
- [ ] Add a voice message field before the first item for intros
- [ ] Fix scrolling bug that causes a jump after recording and uploading a message
- [ ] Create a broad default contributor allow list (anyone ever mentioned in a compass)
  - [ ] Allow anyone to publish, but flag them as "validated" vs. "random" contributors in the producer section
- [ ] Implement automatic retry for uploads when internet connection is lost/restored
- [ ] "Btw, I keep getting logged out of the PWA after its installed in graphene."

- [ ] after a failed upload (eg internet failure) the upload should auto retry, not awaiting the user to explicitly retry
- [ ] Fix failed uploads getting stuck on a "waiting" sign or approval in Ember
  - [ ] Log in to investigate the upload/approval state from the admin side

- [ ] Implement server AI to pre-select and order nodes for human validation

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

- `PLAN.md` — event schema, ordering algorithm, component architecture, and
  phased build plan (v0 spike through v3), with every review-round fix folded in.
- `research/findings.md` — consolidated technical research and locked decisions from
  the four scoping rounds.
- `research/open-questions.md` — live design questions, including the async ordering
  problem that killed the flat-chronology model (resolved in `PLAN.md` §2).
- `deploy/` — hardened trusted-worker unit, public environment template, and
  installation/recovery runbook.

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
`npm test && npm run typecheck` in `scripts/`. Privileged signer, relay,
Blossom, RSS, and nsite checks must use the controlled staging procedure in
`docs/operations-and-testing.md`; never substitute static inspection for those
external acknowledgements.

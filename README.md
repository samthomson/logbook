# Logbook

Asynchronous voice-podcast client for Nostr Compass. Each week it ingests the latest
Compass issue, splits it into sections, and lets whitelisted contributors leave voice
notes under each section and respond to each other. The collection is cut into a
produced ~90-min episode published as a Podcasting 2.0 RSS feed. Static nsite + PWA;
the VPS acts as one admin Nostr client (publishes AI intros, runs the stitcher).

Status: planned. No code yet. `PLAN.md` has been through three review rounds
(feasibility, completeness, weekly-operational stress test) and is ready to
back the v0 spike.

## Folder

- `PLAN.md` — event schema, ordering algorithm, component architecture, and
  phased build plan (v0 spike through v3), with every review-round fix folded in.
- `research/findings.md` — consolidated technical research and locked decisions from
  the four scoping rounds.
- `research/open-questions.md` — live design questions, including the async ordering
  problem that killed the flat-chronology model (resolved in `PLAN.md` §2).

## Locked decisions (short version)

- Custom event envelope; interop with Amethyst/Nostur is a non-goal.
- Audio on Blossom (own VPS origin + mirror); episode is the durable artifact.
- Final output: Podcasting 2.0 RSS (mp3), NIP-73 note for Fountain discussion.
- Stitching runs on the VPS; author-curated cut, drag-to-reorder.
- Host on GitHub Pages under the Compass domain.
- Remote signers default (NIP-46); Amber on Android; nsec paste discouraged.
- AI intro written on this machine in the Compass pipeline, published by Compass npub.
- ~90-min episode; 2-5 min typical per note, longer allowed, no chunking.

## Next step

Kick off the v0 spike per `PLAN.md` §4: NIP-46 login, one Compass issue fetched
and split into sections, one recorded note uploaded to Blossom, one segment
event published and played back.

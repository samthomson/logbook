# Logbook

## What This Is

Logbook is an asynchronous voice-podcast client built exclusively for Nostr Compass. Each week it ingests the latest Compass newsletter, splits it into sections, and lets whitelisted contributors record voice notes under each section and reply to each other. The resulting collection is assembled by a VPS stitcher into a produced ~90-min Podcasting 2.0 RSS episode. It is a static nsite + PWA with no app-specific backend — all data lives on Nostr relays and Blossom blob servers.

## Core Value

Contributors leave a voice note in under 60 seconds; it appears under the right section for everyone else immediately.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Fetch latest Compass issue (kind 30023) and split into H2/H3 sections
- [ ] Nostr login: NIP-46 bunker primary, NIP-55/Amber on Android, nsec paste fallback
- [ ] Whitelist enforcement: per-podcast JSON of mentioned npubs gates recording
- [ ] Record voice note locally (WebM/Opus), upload to Blossom, publish custom Nostr event
- [ ] Display voice notes threaded under their section with waveform + transcript
- [ ] Reply to existing voice note (soft context pointer, no deep tree)
- [ ] In-browser transcription (transformers.js Whisper-base / Moonshine via WebGPU)
- [ ] Admin view: drag-to-reorder EDL per section, trigger VPS stitcher
- [ ] VPS stitcher: concat + loudnorm (EBU R128) + silence-trim + crossfades → MP3
- [ ] Publish Podcasting 2.0 RSS feed + NIP-73 scoped note for Fountain
- [ ] PWA: service worker, installable, offline draft queue
- [ ] nsite: deployable as Nostr nsite and on GitHub Pages

### Out of Scope (v1)

- Voice changer / anonymizer — post-MVP
- TTS intro generation in-client — intro is pre-published by Compass pipeline
- Native iOS/Android apps — PWA first
- NIP-74 podcast kinds — unmerged, low adoption
- Real-time collaboration / live rooms
- In-browser ffmpeg stitching — too heavy for mobile (1.3 GB RAM)

## Context

- Compass already maintains `data/npubs.yml` (name→npub) and a per-issue whitelist JSON emitted by `publish/dm-outreach.ts` — whitelist is pre-computed.
- Compass issues are published as kind 30023 with `nostr:npub...` inline mentions for all covered projects; sections split cleanly at H2/H3 boundaries (~35 projects/issue).
- NIP-A0 (voice messages, kind 1222/1244) is merged to nips master. We do NOT inherit its reply-tree shape — interop is a non-goal; we use a custom envelope.
- Blossom: sha256-addressed blobs, kind 24242 upload auth, BUD-04 mirroring. Public servers have no retention SLA — run own Blossom origin on VPS, mirror out.
- iOS ≥ 18.4 required for WebM/Opus recording + wake-lock in installed PWAs.
- Final episode format: MP3 (Apple RSS rejects Opus). Podcasting 2.0 RSS with `podcast:value` splits and `podcast:chapters` per contributor.
- Hosting: GitHub Pages under existing Compass domain. Gateway-eviction fragility avoided by stable domain.

## Constraints

- **Stack**: Static SPA (Vite + React or Svelte) — no SSR, no app backend
- **Signing**: NIP-46 bunker required; no server holds private keys ever
- **Storage**: Nostr relays (events) + Blossom (blobs) — no proprietary DB
- **Stitching**: VPS-side only (ffmpeg) — not in-browser
- **Whitelist**: Client-side filtering is sufficient for MVP (blobs are world-readable by URL)
- **Episode length**: ~90 min target; per-contribution 2-5 min typical, up to ~30 min for developer deep-dives

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Custom event envelope (not NIP-A0 shape) | Interop non-goal; need section-ID tag, EDL ordering, transcript pointer, intro flag | — Pending spec |
| VPS stitcher, not ffmpeg.wasm | 1.3 GB RAM decoding 1 hr PCM kills mobile tabs | ✓ Good |
| GitHub Pages hosting, not pure nsite gateway | Stable origin for PWA service worker + cached drafts | ✓ Good |
| NIP-46 bunker primary (not extension/nsec) | Remote signers work on all platforms including iOS | ✓ Good |
| Podcasting 2.0 RSS (not NIP-74) | NIP-74 unmerged, low adoption; RSS is what Fountain/Wavlake use | ✓ Good |
| Intro track pre-published by Compass pipeline | Anti-slop + claim-verification gates already exist there | ✓ Good |
| Section = primary ordering key (not global created_at) | Async recording scrambles topics if sorted by time | ✓ Good |
| EDL (explicit ordered list) for within-section order | Author curates final cut; drag-to-reorder in admin view | — Pending impl |

---
*Last updated: 2026-07-20 after initialization*

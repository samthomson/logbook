# Logbook — Agent Instructions & TODO

## Communication rules (read first)

- Answer the question that was asked, then stop. No preamble, no recap.
- Default to a few sentences. Prose, not headed sections, unless asked.
- Never narrate your own debugging. Fixing a bug you introduced is not a finding
  and does not go in the summary. Report only what changes what the user does.
- State the outcome first. Cut anything that does not change their next action.
- Do not infer context from unrelated things on the machine (other containers,
  processes, files). Ask or check; never assume they belong to this project.

## Coding philosophy — work or fail (mandatory)

Never plan to fail. Code has one intended path: it works, or it hard-errors so
the operator can fix the root cause. Do not add "backup" options, silent
fallbacks, secondary lists, or soft defaults that paper over misconfiguration.

- Two relay roles, two names, both required (no silent defaults):
  - `RELAYS` — Logbook write/query (segments, manifests, whitelists, publish).
  - `DISCOVERY_RELAYS` — read-only discovery (kind 0 profiles, NIP-05 hints).
  Same names in `.env`, PWA, and worker. Never rename with `VITE_` / `LOGBOOK_`.
- Required identity and endpoints are required: unset or invalid → throw at
  load. Do not substitute production Compass keys or Blossom mirrors when env
  is blank.
- Deny-lists (e.g. refuse seeding against the real Compass pubkey) are fine;
  that is refusing a dangerous operation, not a config backup.
- Browser capability checks (e.g. MediaRecorder mime support) are not "backup
  systems" — they detect what the runtime can do. Config and infrastructure
  must not get the same treatment.
- If something is broken, catch it and fix it. Do not ship a second path that
  "usually works instead."

This file is the executable handoff for the next agent(s). Read `.planning/PROJECT.md`,
`.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, and `PLAN.md` for full context before
starting any phase. The design in `PLAN.md` is locked; do not re-debate architecture.

## Project Summary

Logbook is an async voice-podcast PWA for Nostr Compass. Contributors leave voice notes on
Nostr (kind 4200 segments), the VPS assembles them into a Podcasting 2.0 episode. Stack:
React + Vite + TypeScript, Nostr (nostr-tools), Blossom (BUD-01/BUD-04), transformers.js
(v2 only), ffmpeg (VPS stitcher). Static build, GitHub Pages or nsite hosting.

## Pre-conditions (do these BEFORE writing any code)

- [ ] **BRAND**: Confirm "Logbook" npub, NIP-05 handle, and subdomain availability under the
  Compass brand. Do not lock in any public-facing string until this is confirmed.
- [ ] **KIND CHECK**: Re-check kinds 4200 and 34200 against the live NIPs kinds registry
  (https://github.com/nostr-protocol/nostr/blob/master/README.md or the kind registry).
  Squatted-but-unregistered is the only collision risk remaining.

---

## Phase 0: v0 Spike — Core Loop

**Goal:** Prove record → upload → publish → playback end to end. No manifest, no whitelist, no stitching.

### Setup

- [ ] **SETUP-01**: `npm create vite@latest logbook-pwa -- --template react-ts` in the project root
- [ ] **SETUP-02**: Install core deps: `nostr-tools`, `@noble/hashes`, `@blossom-drive/sdk` (or raw fetch for BUD-01/BUD-04)
- [ ] **SETUP-03**: Configure Vite for static build + GitHub Pages base path (`/logbook/` or confirm actual path)
- [ ] **SETUP-04**: Add PWA plugin (`vite-plugin-pwa`) with minimal manifest (name, icons, start_url)
- [ ] **SETUP-05**: Set up TypeScript strict mode; add `src/types/nostr.ts` with kind 4200 / 34200 type definitions from PLAN.md §1

### Auth

- [ ] **AUTH-01**: Implement NIP-46 bunker connection (`nostr-tools/nip46`): parse bunker URI, connect, expose `signEvent()` / `getPublicKey()`
- [ ] **AUTH-02**: Implement NIP-55/Amber intent via `window.nostr` shim detection (Android WebView); fall back to prompt if not available
- [ ] **AUTH-03**: Add "advanced" toggle that reveals nsec/ncryptsec paste input; use `nip49` to decrypt ncryptsec; store key in memory only (never localStorage)
- [ ] **AUTH-04**: Detect iOS < 18.4 via user agent; show clear in-app notice if recording is unsupported

### Issue Ingest

- [ ] **INGEST-01**: `src/lib/compass.ts` — `fetchLatestIssue(compassPubkey: string): Promise<NostrEvent>` — queries relays with `{kinds:[30023], authors:[compassPubkey], limit:1}`, returns the most recent event
- [ ] **INGEST-02**: `src/lib/parser.ts` — `parseIssue(event: NostrEvent): Section[]` — splits markdown content on H2 (`## `) into sections, H3 (`### `) into sub-items; returns `{id: string, title: string, items: SubItem[]}[]`. Section id = slugified H2 title + issue number.

### Recording

- [ ] **REC-01**: `src/components/Recorder.tsx` — uses `MediaRecorder` with `{audio: true}`, mimeType `audio/webm;codecs=opus`; collects chunks into a `Blob`
- [ ] **REC-02**: Real-time waveform using `AnalyserNode` from Web Audio API; render as `<canvas>` or SVG bars
- [ ] **REC-03**: Trim UI: show recorded waveform, let user drag start/end handles; use `OfflineAudioContext` to slice the buffer

### Upload & Publish

- [ ] **PUB-01**: `src/lib/blossom.ts` — `uploadBlob(blob: Blob, serverUrl: string, signEvent: SignFn): Promise<BlobDescriptor>` — implements BUD-01 PUT with kind 24242 auth event; returns `{url, sha256, size, mime}`
- [ ] **PUB-02**: `uploadBlob` mirrors to VPS origin + one public Blossom server; each mirror gets its own fresh kind 24242 auth
- [ ] **PUB-03**: VPS Blossom origin must be reachable over public HTTPS with CORS and byte-range support — verify this before upload
- [ ] **PUB-04**: `src/lib/segment.ts` — `publishSegment(params): Promise<NostrEvent>` — builds kind 4200 event per PLAN.md §1 schema; signs and publishes to configured relays
- [ ] **PUB-05**: Segment content is `JSON.stringify({audio:{url,sha256,mime,duration,waveform}, isIntro:false})`
- [ ] **PUB-06**: Add `["x", sha256]` tag to segment event
- [ ] **PUB-07**: Add `["section", sectionId]` and `["issue", issueId]` tags
- [ ] **PUB-08**: For reply segments, add `["responding_to", targetEventId]` tag

### Playback

- [ ] **PLAY-01**: `src/components/AudioPlayer.tsx` — takes a Blossom URL, uses `<audio>` element with byte-range support; shows waveform thumbnail and duration

### Spike Verification

- [ ] **VERIFY-01**: End-to-end smoke test: log in via NIP-46 bunker on desktop Chrome, fetch latest Compass issue, record 30s note, upload to VPS Blossom, verify kind 4200 event on relay, play back from the Blossom URL
- [ ] **VERIFY-02**: Test on Android (Amber login), confirm upload and playback work
- [ ] **VERIFY-03**: Test on iOS 18.4+, confirm recording works; test on iOS < 18.4, confirm in-app notice appears

---

## Phase 1: v1 MVP — Timeline & Recording UI

**Goal:** Full contributor-facing timeline. Sections in newsletter order, notes in EDL seed order, reply chips, whitelist gating, PWA installable.

### Timeline

- [ ] **TIMELINE-01**: `src/components/IssueTimeline.tsx` — renders sections in newsletter order; each section expands to show its note list
- [ ] **TIMELINE-02**: `src/lib/ordering.ts` — `computeSeedOrder(segments: Segment[]): string[]` — depth-first reply-forest walk per PLAN.md §2. Roots = segments with no `responding_to` or whose target is outside this section. Walk: roots in chronological order, each root's replies chronological, subtree kept contiguous before moving to next root.
- [ ] **TIMELINE-03**: Each note card shows: contributor avatar + npub, waveform thumbnail, duration, timestamp. No transcript yet (v2).
- [ ] **TIMELINE-04**: "In reply to" chip renders below the note card for threaded notes; clicking it scrolls to the parent note. No nested indentation.
- [ ] **TIMELINE-05**: Inline `<AudioPlayer>` per note; expand-to-play on tap (transcript-first rendering activates in v2)

### Whitelist

- [ ] **WL-01**: `src/lib/whitelist.ts` — `fetchWhitelist(issueId: string): Promise<Set<string>>` — GETs `/data/whitelist-{issueId}.json`; merges with standing roster from `/data/npubs.yml` (parse YAML client-side or pre-process at build time)
- [ ] **WL-02**: Record button hidden/disabled for pubkeys not in the whitelist set. This is UI-only; no relay/Blossom ACL.
- [ ] **WL-03**: Whitelist JSON files are versioned per issue (`whitelist-31.json`, `whitelist-32.json`); old files are never overwritten

### Issue Picker

- [ ] **PICKER-01**: `src/components/IssuePicker.tsx` — queries relays for kind 34200 with `{authors:[compassPubkey]}` (no d-tag filter to get all); renders list sorted by `created_at` desc; tapping an issue loads its manifest

### PWA

- [ ] **PWA-01**: `vite-plugin-pwa` config: `registerType: 'autoUpdate'`, cache strategy for static assets; offline shell shows "connecting to relays…" when offline
- [ ] **PWA-02**: `public/manifest.json` with name "Logbook", correct icons, `display: standalone`, `start_url`

### Verification

- [ ] **VERIFY-01**: Install PWA on Android; confirm timeline loads from a cached shell when offline
- [ ] **VERIFY-02**: Whitelist gating: log in as a non-whitelisted pubkey; confirm record button is not visible
- [ ] **VERIFY-03**: Post a reply segment; confirm "in reply to" chip appears and seed order places it correctly after parent

---

## Phase 2: v1 MVP — VPS Manifest Pipeline

**Goal:** VPS auto-creates draft manifests on new Compass issues; security model enforced.

- [ ] **VPS-SETUP**: Node.js or Python script on VPS; signs via NIP-46 bunker only (same path in every environment). Never put a hot nsec on the host.
- [ ] **CRON-01**: `scripts/watch-compass.ts` — polls relay every 10 minutes for new kind 30023 from compassPubkey; on detection, calls `createManifest(event)`
- [ ] **CRON-02**: `createManifest(event)` — parses sections, builds kind 34200 content per PLAN.md §1, signs with Compass npub, publishes to relays
- [ ] **CRON-03**: `createManifest` also runs `dm-outreach.ts` to generate `whitelist-{issueId}.json` and commits/pushes it to the repo so GitHub Pages picks it up (or uploads to VPS static path)
- [ ] **SECURITY-01**: All relay queries for kind 34200 pin `authors: [compassPubkey]`; client re-verifies `event.pubkey === compassPubkey` before treating as authoritative
- [ ] **SECURITY-02**: Write a unit test: given a spoofed kind 34200 from a different pubkey with the same d-tag, confirm the client rejects it

---

## Phase 3: v1 MVP — Admin Mode & Curation

- [ ] **ADMIN-01**: Admin mode detected via `pubkey === compassPubkey || adminKeys.includes(pubkey)`; admin keys configurable in `src/config.ts`
- [ ] **ADMIN-02**: Drag-to-reorder uses `@dnd-kit/core`; on drop, updates manifest `order` array and publishes a new kind 34200 (addressable, replaces the previous)
- [ ] **ADMIN-03**: Include/exclude toggle per segment: excluded segment ids stored in a separate array in manifest content; excluded segments render greyed out in admin mode, hidden in contributor view
- [ ] **ADMIN-04**: Section-level exclude toggle: sections with no contributor segment AND not manually included are excluded from the stitcher run
- [ ] **ADMIN-05**: Reviewed/unreviewed marker: stored in manifest content per segment id; renders as a checkbox in admin mode
- [ ] **ADMIN-06**: 1.5x / 2x playback speed: `audioElement.playbackRate = 1.5 | 2.0`
- [ ] **ADMIN-07**: "Lock episode" button: confirm dialog, then publishes updated manifest with `episodeStatus: "cutting"`; button becomes "Episode locked" post-action

---

## Phase 4: v1 MVP — Stitcher & RSS

**Goal:** VPS stitcher produces a gap-free mp3 with chapters from the curated manifest.

### Stitcher

- [ ] **STITCH-01**: `scripts/stitch.ts` (or Python) — reads kind 34200 manifest from relay; downloads all segment audio blobs from Blossom URLs
- [ ] **STITCH-02**: Per clip: `ffmpeg -i clip.webm -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 48000 -ac 2 clip_norm.wav` (two-pass: first pass measures, second applies; use `loudnorm=print_format=json` to capture measured values)
- [ ] **STITCH-03**: Silence trim per clip: `ffmpeg -i clip_norm.wav -af silenceremove=start_periods=1:start_silence=0.5:stop_periods=1:stop_silence=0.5 clip_trimmed.wav`
- [ ] **STITCH-04**: Per section: `ffmpeg` concat filter on section clips in manifest `order`
- [ ] **STITCH-05**: Across sections: pairwise `acrossfade` (duration=0.3s): iterate section WAVs, acrossfade each pair; final encode to mp3 at 128kbps stereo (96kbps mono option)
- [ ] **STITCH-06**: Skip sections where `order` contains only the intro segment (no contributor segment) unless admin has manually included them
- [ ] **STITCH-07**: Derive `podcast:chapters` array from clip boundaries; each chapter name = contributor display name + section title

### RSS

- [ ] **RSS-01**: `scripts/publish-rss.ts` — generates Podcasting 2.0 RSS XML with `podcast:chapters`, `podcast:transcript` (v2), `podcast:value` (v3); writes to VPS static path
- [ ] **RSS-02**: Confirm nginx serves byte-range requests on the mp3 URL (test with `curl --range 0-1023 <url>`)
- [ ] **RSS-03**: Publish kind 1111 NIP-73-scoped note from Compass npub pointing to the RSS episode URL

### Verification

- [ ] **VERIFY-01**: Full stitcher run on a mock manifest with 10 clips; output mp3 is gap-free and within 5% of expected duration
- [ ] **VERIFY-02**: RSS validates via `podcastindex.org/validator` or equivalent
- [ ] **VERIFY-03**: Episode appears in Fountain discussion view within 30 minutes of kind 1111 publish

---

## Phase 5: v2 — Client-Side Transcription

- [ ] **TRANS-01**: add a reviewed, zero-high browser transcription dependency; the worker receives an audio blob and returns transcript text plus word timestamps
- [ ] **TRANS-02**: Worker uses `env.backends.onnx.wasm.numThreads = 4`; detect WebGPU availability and set backend accordingly
- [ ] **TRANS-03**: Main thread: after segment event publishes, post audio blob to worker; on result, publish companion transcript event with `["e", segmentId]` + `["k", "4200"]` tags
- [ ] **TRANS-04**: VPS fallback: cron job checks for segments older than 30 minutes with no companion transcript event; runs `whisper` CLI on downloaded audio; publishes companion event via Compass npub
- [ ] **TRANS-05**: Timeline: `src/components/TranscriptCard.tsx` — renders transcript text; `<AudioPlayer>` activates on text tap; word-level highlighting during playback if timestamps available
- [ ] **TRANS-06**: `src/lib/search.ts` — local full-text search over cached transcripts using `MiniSearch`; results highlight matching segment cards

---

## Phase 6: v2 — AI Intro & Curation Polish

- [ ] **INTRO-01**: `scripts/generate-intros.ts` — for each section in a new manifest, calls LLM (Claude claude-sonnet-4-6 or local model) with section prose to generate 30s–3min spoken-register script; review gate before TTS
- [ ] **INTRO-02**: TTS via Kokoro (`kokoro-onnx` npm package or Python kokoro); output WAV; upload to Blossom; publish kind 4200 with `isIntro: true`
- [ ] **INTRO-03**: NIP-31 `alt` tag on all segment events: short plain-text summary (first 280 chars of transcript if available, else section title + contributor name)
- [ ] **CUR-01**: After stitcher completes, publish kind 7 reaction (`🎙️`) from Compass npub on each segment id included in the episode
- [ ] **CUR-02**: Late-arriving notes: kind 34200 manifest watcher detects new kind 4200 events on published sections; auto-appends to section `order` tail with `newAfterLock: true` flag; timeline shows "new" badge
- [ ] **CUR-03**: RSS feed includes `podcast:transcript` pointing to companion event content; `podcast:chapters` auto-generated from stitcher run

---

## Phase 7: v3 — Voice Changer

- [ ] **VC-01**: Pitch/formant DSP: `src/lib/voiceChanger.ts` — `AudioWorkletProcessor` that applies pitch shift + formant correction in real time during recording; target: < 200ms perceived latency
- [ ] **VC-02**: Transcribe-then-TTS: post-recording pipeline — Whisper transcription → TTS with a different voice (Kokoro or ElevenLabs BYOK) → upload processed audio instead of original

---

## Phase 8: v3 — Lightning & Automation

- [ ] **LN-01**: Extend `data/npubs.yml` schema to include optional `lightning` field (LNURL or Lightning address); update whitelist JSON generation to include it
- [ ] **LN-02**: RSS feed `podcast:value` block with splits derived from whitelist; percentage = equal split across contributors present in episode
- [ ] **AUTO-01**: VPS: "lock episode" kind 34200 publish triggers stitcher run automatically via webhook or relay subscription
- [ ] **HOST-01**: Deploy as nsite via `nsite` CLI; configure multi-gateway fallback; test via `wss://relay.nostr.band` nsite resolution

---

## Tech Stack Reference

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | React 19 + Vite 6 + TypeScript | Static build |
| Nostr | nostr-tools 2.x | NIP-46, NIP-55, event signing |
| Blossom | Raw fetch (BUD-01/04) | No heavy SDK needed |
| Audio recording | MediaRecorder (webm/opus) | iOS 18.4+ floor |
| Waveform | Web Audio API AnalyserNode | Canvas or SVG |
| Drag-to-reorder | @dnd-kit/core | Admin mode |
| Transcription | @xenova/transformers Whisper-base | v2; Web Worker |
| Search | MiniSearch | v2; local full-text |
| TTS | kokoro-onnx (VPS) | v2 AI intro; v3 voice changer |
| Stitcher | ffmpeg (VPS) | EBU R128, acrossfade, mp3 |
| RSS | Custom XML generation | Podcasting 2.0 spec |
| Hosting | GitHub Pages (shell) + VPS (audio/RSS) | |
| PWA | vite-plugin-pwa | Service worker, offline shell |

## Key Files to Create

```
logbook-pwa/
  src/
    types/nostr.ts          # Kind 4200, 34200 type definitions
    config.ts               # compassPubkey, adminKeys, relayUrls, blossomUrls
    lib/
      compass.ts            # fetchLatestIssue, parseIssue
      blossom.ts            # uploadBlob, BUD-04 mirror
      segment.ts            # publishSegment, publishTranscript
      manifest.ts           # fetchManifest, updateManifest, computeSeedOrder
      whitelist.ts          # fetchWhitelist
      ordering.ts           # computeSeedOrder (depth-first reply-forest)
      search.ts             # MiniSearch over transcripts (v2)
    components/
      Recorder.tsx          # MediaRecorder + waveform + trim
      AudioPlayer.tsx       # <audio> + waveform thumbnail
      IssueTimeline.tsx     # Section list + note list
      NoteCard.tsx          # Single segment card
      TranscriptCard.tsx    # Transcript text + audio sync (v2)
      IssuePicker.tsx       # Past issues list
      AdminPanel.tsx        # Drag-to-reorder + lock episode
    workers/
      transcribe.worker.ts  # Whisper (v2)
      voiceChanger.worker.ts # DSP (v3)
  scripts/ (VPS, run via ts-node or node --esm)
    watch-compass.ts        # Cron: detect new issue, create manifest
    generate-intros.ts      # AI intro pipeline (v2)
    stitch.ts               # ffmpeg stitcher
    publish-rss.ts          # Podcasting 2.0 RSS
  data/
    npubs.yml               # Standing contributor roster
  public/
    manifest.json           # PWA manifest
    data/                   # Per-issue whitelist JSONs (generated)
```

## Locked Decisions — Do Not Revisit

- Kind 4200 content is JSON (not bare URL). `x` sha256 tag is required alongside it.
- Transcript is a companion event, NOT in the segment content (segment is immutable).
- Manifest `order` array is the stitcher's only input for cut order. `created_at` is irrelevant for ordering.
- Seed order algorithm: depth-first reply-forest walk (see PLAN.md §2 for the exact spec and worked example).
- All manifest relay queries must pin `authors: [compassPubkey]` and re-verify pubkey client-side.
- Whitelist is UI-only. Relay and Blossom access stay public.
- Episode audio and RSS feed live on the VPS, not GitHub Pages.
- iOS recording floor: 18.4.
- Intro segment is always position 0 in its section's manifest order.
- Published episode is immutable (`episodeStatus: published` is terminal).

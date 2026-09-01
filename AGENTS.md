# Logbook — Agent Instructions & TODO

## Communication rules (read first)

- Fewest words that carry the information. No preamble, no recap, no summary of
  work already visible in the diff. Prose, not headed sections, unless asked.
- Short answers, always. One direct answer, the decision, the risk — expand
  only when strictly necessary. No essays, no multi-section analyses, no lists
  of generic recommendations. If asked to recommend, give the ONE you'd bet on
  and why, in a line or two; name what you'd drop.
- Only three things earn space: the operator's next action, a direct answer to
  what was asked, or a specific question with the trade-off of each option.
- A found problem is reported once, in one line, with what it costs. Never
  narrate your own debugging or a bug you introduced.
- Exception: raise an unasked security, data-loss, or performance issue when it
  is real and not already covered. Nothing else gets an exception.
- Do not infer context from unrelated things on the machine (other containers,
  processes, files). Ask or check; never assume they belong to this project.

## How the operator works (do not fight this)

- Docker is the only local workflow. `docker compose --profile dev up --build`
  runs the worker plus the PWA with Vite HMR, in the foreground, in the
  operator's own terminal. Never propose `-d`, a host `npm run dev`, or a manual
  `npm run build` "to check" — typecheck, lint, and unit tests already cover
  that, and `--profile prod` builds the real bundle.
- Never ask the operator to run a command whose only purpose is your own
  verification. Run it yourself or leave it out.
- Never commit, amend, or push. The operator does all git writes, always, even
  when the work is finished and tests pass. Read-only git (status, diff, log) is
  fine.
- Never edit the operator's `.env`, `.secrets/`, or any environment the
  operator owns (Dokploy env included). Report the exact variable and value
  needed; the operator applies it. Repo files (`.env.example`) are the place to
  document required values.
- Publish targets are exactly what the env vars say — no more, no less.
  `NSYTE_RELAYS` and `NSYTE_BLOSSOM_SERVERS` are the complete target list for
  an nsite publish; never add a relay or server, never widen a target, never
  override or work around an env definition (inline env included). The
  operator's infrastructure choices are not an agent decision and are never
  relitigated.
- One compose file. One `.env`. Same variable names in `.env`, PWA, and worker.
- Comments record a non-obvious constraint or why, never what the next line
  already says. Do not annotate a variable with a restatement of its name.
- Smallest diff that does the job. Change the value passed, not the parameter's
  name. Do not rename `relays` because the list is now discovery. Do not add
  parameters to thread a list the callee already imports from config.

## UI/UX rules (the operator judges the app by these)

- Two roles, no third. **Producer** curates and releases; **Contributor**
  records. Compass is the podcast account nobody logs into. Do not invent extra
  role words ("Listener", "Admin", "Reader"). No badge is better than a new one.
- Role must not depend on the current page. Producer comes from the key (the
  Compass-signed producer list); contributor status is per episode.
- Labels state what *is*, never what to do: "Nothing in the cut", not "Add a
  recording". Verbs belong on buttons.
- A button must look like a button. Every `.btn` has a border and a background;
  the primary action of a view is the only filled one.
- Route structure is real and visible in the URL (hash routes: `#/`,
  `#/episode/<naddr>`, `#/login`). Home is the episode index — no
  episode-specific content on it, and it separates episodes being made from
  published ones. An episode is addressed by the newsletter's naddr; an address
  naming another author or kind resolves to home, so a URL can never widen what
  the app loads.
- One page per episode, no per-role pages and no tabs. The same page gains
  controls with the viewer: a contributor gets record rows, a producer also gets
  the in/out and ordering controls on each voice note plus the release bar at the
  end. Never build a second view of the same episode.
- An episode is either being made or published, never both. A published page has
  no record rows until a producer opens the cut again.
- Show people, not keys: kind 0 name and picture from `DISCOVERY_RELAYS`, with a
  short npub only as a last resort. Never cache a failed profile lookup.
- Actions live where the decision is made (release actions at the end of the
  cut), each with one line of plain guidance saying what happens next and why an
  action is disabled.
- No duplicated warnings. State appears once, next to the thing it describes.
  An empty list is one sentence; do not also claim the opposite.
- An episode in progress is not for signed-out visitors: the index lists only
  published episodes for them, and a direct link says "still being made". This
  is presentation only — the events stay public, so never describe it as access
  control.

## Coding philosophy — work or fail (mandatory)

Never plan to fail. Code has one intended path: it works, or it hard-errors so
the operator can fix the root cause. Do not add "backup" options, silent
fallbacks, secondary lists, or soft defaults that paper over misconfiguration.

No fallbacks, anywhere, ever — config or code. No `${VAR:-default}`
substitutions in compose files, Dockerfiles, or scripts: an unset variable is
an error at load, naming the variable. A genuinely optional value's unset
state is itself the answer; never invent a default to keep going. The only
acceptable `${VAR:-}` use is an empty-default presence check for a documented
optional override whose required alternative is still validated separately.

- Two relay roles, two names, both required (no silent defaults):
  - `RELAYS` — Logbook write/query (segments, manifests, whitelists, publish).
  - `DISCOVERY_RELAYS` — read-only discovery (kind 0 profiles, NIP-05 hints, Compass kind 30023).
  Kind 30023 is authored by the production Compass npub (`REAL_COMPASS_PUBKEY`).
  `COMPASS_PUBKEY` is this deployment's Logbook signer and may be a staging key;
  do not pin newsletter queries to it. `REAL_COMPASS_PUBKEY` is never a fallback
  for an unset `COMPASS_PUBKEY`.
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

This file is the executable handoff for the next agent(s). How to run: `README.md`.
The design in `PLAN.md` is locked; do not re-debate architecture. `.planning/` is a
frozen GSD import — do not treat it as current runtime or UI.

## Project Summary

Logbook is an async voice-podcast PWA for Nostr Compass. Contributors leave voice notes on
Nostr (kind 4200 segments), the VPS assembles them into a Podcasting 2.0 episode and
transcribes every upload. Stack: React + Vite + TypeScript, Nostr (nostr-tools), Blossom
(BUD-01/BUD-04), whisper.cpp (VPS transcription), ffmpeg (VPS stitcher). Static build,
GitHub Pages or nsite hosting.

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
- [x] **PUB-08**: For reply segments, add `["responding_to", targetEventId]` tag

### Playback

- [ ] **PLAY-01**: `src/components/AudioPlayer.tsx` — takes a Blossom URL, uses `<audio>` element with byte-range support; shows waveform thumbnail and duration

### Spike Verification

- [ ] **VERIFY-01**: End-to-end smoke test: log in via NIP-46 bunker on desktop Chrome, fetch latest Compass issue, record 30s note, upload to VPS Blossom, verify kind 4200 event on relay, play back from the Blossom URL
- [ ] **VERIFY-02**: Test on Android (Amber login), confirm upload and playback work
- [ ] **VERIFY-03**: Test on iOS 18.4+, confirm recording works; test on iOS < 18.4, confirm in-app notice appears

---

## Phase 1: v1 MVP — Timeline & Recording UI

**Goal:** Full contributor-facing timeline. Sections in newsletter order, notes in EDL seed order, audio replies, whitelist gating, PWA installable.

### Timeline

- [ ] **TIMELINE-01**: `src/components/IssueTimeline.tsx` — renders sections in newsletter order; each section expands to show its note list
- [x] **TIMELINE-02**: `src/lib/ordering.ts` — `computeSeedOrder` depth-first reply forest, intro pinned at 0. Display nests replies under the parent (`nestDisplayOrder`). The producer's saved `order` is what the stitcher plays.
- [ ] **TIMELINE-03**: Each note card shows: contributor avatar + npub, waveform thumbnail, duration, timestamp. No transcript yet (v2).
- [x] **TIMELINE-04**: Audio reply control on a contributor's note; the reply indents under its parent.
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
- [ ] **VERIFY-03**: Post an audio reply; confirm it indents under the parent and seed order places it after the parent

---

## Phase 2: v1 MVP — VPS Manifest Pipeline

**Goal:** VPS auto-creates draft manifests on new Compass issues; security model enforced.

- [ ] **VPS-SETUP**: Node.js or Python script on VPS; signs via NIP-46 bunker only (same path in every environment). Never put a hot nsec on the host.
- [ ] **CRON-01**: `scripts/watch-compass.ts` — polls relay every 10 minutes for new kind 30023 from compassPubkey; on detection, calls `createManifest(event)`
- [ ] **CRON-02**: `createManifest(event)` — parses sections, builds kind 34200 content per PLAN.md §1, signs with Compass npub, publishes to relays
- [ ] **CRON-03**: `createManifest` also runs `dm-outreach.ts` to generate `whitelist-{issueId}.json` and commits/pushes it to the repo so GitHub Pages picks it up (or uploads to VPS static path)
- [x] **SECURITY-01**: All relay queries for kind 34200 pin `authors` to the trusted producer set (Compass + the Compass-signed producer list); client re-verifies the author against that set before treating it as authoritative
- [x] **SECURITY-02**: Unit tests cover a spoofed kind 34200 sharing the d-tag from a pubkey outside the producer set — rejected in the PWA (`admin-state.test.ts`) and in the worker/stitch path (`watch-state.test.ts`)

---

## Phase 3: v1 MVP — Admin Mode & Curation

- [x] **ADMIN-01**: Producer mode is granted by the Compass-signed producer list (relay-verified), with `ADMIN_PUBKEYS` as the seed and offline bootstrap only
- [x] **ADMIN-02**: Reorder on the episode page itself — "Earlier"/"Later" per voice note updates the manifest `order` array; saving publishes a new kind 34200 (addressable, replaces the previous). The intro stays pinned at position 0
- [x] **ADMIN-03**: In/out toggle per voice note ("Put in" / "Take out"); excluded ids live in the manifest's `excluded` array. A producer sees the excluded ones greyed and labelled; contributors do not see them at all
- [ ] **ADMIN-04**: Section-level exclude toggle: sections with no contributor segment AND not manually included are excluded from the stitcher run
- [x] **ADMIN-05**: Reviewed marker per voice note, stored in manifest content; shown as a tag on the note
- [ ] **ADMIN-06**: 1.5x / 2x playback speed: `audioElement.playbackRate = 1.5 | 2.0`
- [x] **ADMIN-07**: "Publish episode" at the end of the episode page: confirm dialog, then publishes the manifest with `episodeStatus: "cutting"`; the page then reads as final and stops taking recordings

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

## Phase 5: v2 — Transcription

Transcription runs on the VPS, not in the browser: the worker watch loop picks up every
verified segment of an issue that has a trusted manifest, downloads the audio from the
configured Blossom origins, and publishes a kind 1111 companion (sentence-level chunks in
the content JSON) from the Compass npub. Browser-side transcription was built once and
removed in 93cb11b — `@xenova/transformers` had a critical dependency chain and
`@huggingface/transformers` four no-fix high audit findings plus a 23 MB WASM asset. Do
not reintroduce either without a clean audit.

- [x] **TRANS-01**: `scripts/transcribe-segments.ts` — sweep core; scope = manifest issues,
      coverage = verified author-or-Compass companions only (spam cannot suppress), capped
      at 5 segments per tick; data failures skip, signer/relay failures abort the sweep
- [x] **TRANS-02**: obsolete — no browser engine; whisper-cli + small.en are baked into the
      worker image, pinned by tarball and model sha256 (base.en produced unusable
      transcripts on domain speech and was replaced)
- [x] **TRANS-03**: obsolete — the PWA never transcribes; the worker publishes companions
- [x] **TRANS-04**: `watch-compass.ts` runs the sweep each tick after the release cycle;
      `npm run transcribe-missing -- [--hours N]` remains the manual backfill CLI
- [x] **TRANS-05**: `TranscriptCard` renders sentence chunks with tap-to-seek and
      active-sentence highlighting inside `VoiceBubble`; plain text still renders as text
- [ ] **TRANS-06**: `src/lib/search.ts` — local full-text search over cached transcripts using `MiniSearch`; results highlight matching segment cards
- [x] **TRANS-07**: Producer-only "Transcribe" / "Transcribe again" on each voice note
      (`VoiceBubble`): publishes a kind 34202 retranscribe request on the segment. The
      worker listens live and transcribes when a request is newer than the companion
      (the once-a-minute sweep stays as fallback). After a model bump,
      `transcribe-missing -- --retranscribe-all` refreshes every companion in one run.

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
- [x] **AUTO-01**: the worker's live subscription wakes a cycle on any producer
      kind 34200 publish; the cycle sees the cutting lock and runs the stitcher.
      The once-a-minute poll remains the fallback path.
- [ ] **HOST-01**: Deploy as nsite via `nsite` CLI; configure multi-gateway fallback; test via `wss://relay.nostr.band` nsite resolution

---

## Tech Stack Reference

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | React 19 + Vite 6 + TypeScript | Static build |
| Nostr | nostr-tools 2.x | NIP-46, NIP-55, event signing |
| Audio recording | MediaRecorder (webm/opus) | iOS 18.4+ floor |
| Waveform | Web Audio API AnalyserNode | Canvas or SVG |
| Drag-to-reorder | @dnd-kit/core | Admin mode |
| Transcription | whisper.cpp (VPS worker) | base.en, pinned sha256, baked into image |
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
      ordering.ts           # computeSeedOrder (reply forest), nestDisplayOrder
      search.ts             # MiniSearch over transcripts (v2)
    components/
      Recorder.tsx          # MediaRecorder + waveform + trim
      IssueTimeline.tsx     # The episode page: chapters, notes, record rows,
                            # and the producer's cut controls + release bar
      VoiceBubble.tsx       # One voice note, with its cut controls for a producer
      TranscriptCard.tsx    # Transcript text + audio sync (v2)
      IssuePicker.tsx       # Episode index: being made / published
    lib/
      use-episode-cut.ts    # Manifest state behind the episode page
      cut-rules.ts          # Pure rules: in/out, eligibility, ordering limits
    workers/
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
- Seed order algorithm: depth-first reply-forest walk (PLAN.md §2). Display
  nests an audio reply under the note it answers. The producer's saved `order`
  is still the stitcher's only input.
- Two roles only: **Contributor** records; **Producer** curates and releases.
  Compass is the podcast account, not a person who signs in. Producers are named
  on the Compass-signed producer list (kind 34201, `d=logbook-wl-admins`), seeded
  from `ADMIN_PUBKEYS`. Only Compass can change that list, so authority has one
  root and no key can appoint itself.
- All manifest relay queries must pin `authors` to that trusted producer set and
  re-verify the author against the same set client-side. Never query unpinned.
- Whitelist is UI-only. Relay and Blossom access stay public. It does bound the
  cut, though: only Compass or a listed contributor's recording may go into an
  episode, so the page offers no control for anyone else's.
- Episode audio and RSS feed live on the VPS, not GitHub Pages.
- iOS recording floor: 18.4.
- Intro segment is always position 0 in its section's manifest order.
- A producer can open a published cut again (`draft`). Recordings and order can
  change; the next publish stitches a replacement. Previous audio stays in the
  feed until that publish lands. `cutting` is still a lock the worker owns.
- A stitch run that fails hands the episode back: the worker republishes the
  manifest as `draft` with `lastFailure` (one-line reason + time), which the
  episode page shows to the producer. `cutting` is therefore not terminal, and
  the next publish clears the reason. Never leave a locked episode that only the
  worker can retry.
- A recording that captured no sound is refused at the microphone (true peak
  below −66 dBFS). Silence cannot be normalised — loudness normalisation would
  apply ~80 dB of gain to the noise floor — so it must never reach the cut.
- Transcription is VPS-only (whisper.cpp, small.en) and covers every verified
  segment of a manifested issue; the transcript companion carries sentence-level
  chunks. Browser-side transcription is a hard line, not an audit outcome: the
  browser is an uncontrolled runtime, and config-as-code plus a containerized,
  pinned worker is the reproducibility bar. Both browser transformer packages
  also failed dependency review and were removed (93cb11b) — do not reintroduce
  them or any successor engine. Only a verified author or Compass companion
  marks a segment as covered — third-party or forged companions never suppress
  the sweep.
- Retranscription is requested, never executed client-side: a producer's kind
  34202 event on a segment (Logbook's own application kind, sibling of the
  34200 manifest — not a Nostr reaction) orders the worker to republish the
  companion once the request is newer than it. The worker subscribes to these
  requests live and keeps the minute sweep as fallback, so a click transcribes
  in seconds; producers only, and the sweep's newest-wins rule makes repeats
  and racing triggers idempotent.

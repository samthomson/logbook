# Project State: Logbook

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-20)

**Core value:** Contributors can leave and discover voice reactions to Compass newsletter sections, and those recordings assemble automatically into a listenable podcast episode.
**Current milestone:** Milestone 1 — v0 spike + v1 MVP

## Status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Event Spec & Repo Bootstrap | ✓ Complete | SPEC.md, types, config, build passing |
| 1 | Issue Ingestion + Auth + Whitelist | ✓ Complete | compass.ts, auth.ts (applesauce-signers), whitelist.ts |
| 2 | Record → Upload → Publish | ✓ Complete | Recorder.tsx, blossom.ts (BUD-01/04), segment.ts |
| 3 | Playback Timeline | ✓ Complete | IssueTimeline.tsx, NoteCard.tsx, AudioPlayer.tsx, ordering.ts |
| 4 | Admin EDL | ✓ Complete | AdminPanel.tsx (dnd-kit), manifest.ts, lock episode |
| 5 | VPS Stitcher + RSS + PWA | ✓ Complete | stitch.ts, publish-rss.ts, watch-compass.ts, vite-plugin-pwa |
| 6 | v2 — Voice Changer | ✓ Complete | VoiceChanger AudioWorklet in Recorder.tsx, pitch selector |
| 7 | v2 — Transcription | ✓ Complete | transcribe.worker.ts (Whisper), TranscriptCard.tsx, transcription.ts |
| 8 | v2 — TTS Intro + Lightning | ✓ Complete | generate-intros.ts, LN splits in publish-rss.ts |

**Build:** `npm run build` passes cleanly (441 modules, 348 kB index bundle).
**E2E:** `node e2e-smoke.mts` passes against live relays + Blossom (commit ea903b7).

## Verified Working (2026-07-21)

- **Core loop E2E** (e2e-smoke.mts): issue fetch → WAV upload to blossom.band `/upload` (201) → BUD-04 mirror to ditto.pub + oxtr.dev (200) → kind 4200 publish to 3 relays → fetch-back via `#t` filter → byte-range playback (206). ✅
- **UI whitelisted login** (test key `3c457108…`): timeline loads Issue #1, 4 sections, record buttons visible, recorder opens with pitch selector, zero JS errors. ✅
- **UI whitelist gating** (non-whitelisted key): timeline + playback work, record/reply hidden. ✅
- `tsc -b` clean (client), `tsc --noEmit` clean (scripts), `oxlint` 0 errors. ✅

## Fixed in commit ea903b7

1. `blossom.ts` — BUD-01 upload endpoint `PUT /upload` (was `/<sha256>` → 404; the core breakage)
2. `Recorder.tsx` — conditional-hook crash (useCallback after early return)
3. `App.tsx` — Connect button permanently disabled in extension mode
4. `whitelist.ts` — parser now handles `- pubkey:` list YAML + quotes
5. `watch-compass.ts` — section IDs `sec-<slug>-<N>` per SPEC §4; manifest content per SPEC §2 (issueRef, excluded[], reviewed[], publishedRss); cutting trigger reads d-tag
6. `stitch.ts` / `publish-rss.ts` — SPEC manifest types; per-segment exclusion arrays; section sentinel
7. `scripts/config.ts` — relay list aligned with client; prod Compass key documented for go-live

## What's Been Built

### PWA (`logbook-pwa/`)

**Auth:**
- NIP-46 bunker via `NostrConnectSigner` (applesauce-signers)
- NIP-55/Amber via `ExtensionSigner`
- nsec/ncryptsec paste via `PrivateKeySigner` / `PasswordSigner` (in-memory only)
- iOS < 18.4 in-app notice

**Issue Ingestion:**
- `lib/compass.ts` — `fetchLatestIssue()`, `fetchAllIssues()`, `fetchIssueByDTag()`, `parseIssue()` (H2/H3 markdown splitting)
- `lib/whitelist.ts` — per-issue JSON + standing npubs.yml roster, in-memory cache

**Recording:**
- `Recorder.tsx` — MediaRecorder + AnalyserNode waveform + WaveformTrimmer (drag start/end handles)
- Voice changer: `VoiceChanger` AudioWorklet with pitch factor, Normal/Higher/Lower/Robot presets
- Wake lock on recording start
- Re-encode via OfflineAudioContext to preserve WebM/Opus

**Upload & Publish:**
- `lib/blossom.ts` — BUD-01 PUT + BUD-04 mirror, kind 24242 auth per server
- `lib/segment.ts` — kind 4200 with JSON content, `x`/`section`/`issue`/`alt`/`responding_to` tags
- Transcript: kind 1111 companion events
- Live subscription for late-arriving segments (since=mountedAt)

**Timeline:**
- `IssueTimeline.tsx` — sections in newsletter order, seed order via `computeSeedOrder()`, optimistic add after publish
- `NoteCard.tsx` — avatar, waveform thumbnail, duration, timestamp, "in reply to" chip, expand-to-play, "new" badge
- `AudioPlayer.tsx` — native `<audio>`, waveform progress overlay, scrubber, 1×/1.5×/2× speed
- `TranscriptCard.tsx` — transcript text + audio sync

**Admin:**
- `AdminPanel.tsx` — drag-to-reorder (@dnd-kit/core), include/exclude per segment, reviewed marker, section exclude, lock episode (→ `cutting`)
- 1.5× / 2× speed toggle, inline audio preview per segment

**Other components:**
- `IssuePicker.tsx` — lists all kind 34200 manifests from relay, sorted by date
- `InstallPrompt.tsx` — PWA install banner

### VPS Scripts (`scripts/`)

- `watch-compass.ts` — polls relay every 10 min for new kind 30023; creates kind 34200 manifest; polls for `cutting` manifests and auto-triggers stitch + RSS
- `stitch.ts` — downloads blobs, two-pass EBU R128 loudnorm, silence trim, section concat, acrossfade between sections, mp3 128kbps, chapters JSON; publishes kind 7 `🎙️` reaction per included segment
- `publish-rss.ts` — Podcasting 2.0 RSS with `podcast:chapters`, `podcast:value` Lightning splits, `podcast:transcript`; publishes kind 1111 NIP-73 note from Compass npub
- `generate-intros.ts` — LLM (Claude) + Kokoro TTS pipeline for AI section intros

## Pre-conditions Still Pending

1. **BRAND**: Confirm "Logbook" npub, NIP-05 handle, subdomain under Compass brand — must be done before any public-facing string is published
2. **KIND CHECK**: Re-verify kinds 4200 and 34200 against live NIPs registry before first relay publish
3. **VPS deploy**: Deploy scripts/ to VPS, set `COMPASS_NSEC` env, confirm nginx byte-range on mp3 URLs

## Known Gaps / Next Work

- No e2e smoke test yet (VERIFY-01 in Phase 0 checklist): login via NIP-46 on desktop Chrome, record, upload, verify kind 4200 on relay, play back
- `data/npubs.yml` and `public/data/whitelist-*.json` files need to be populated for whitelist gating to work
- VPS scripts haven't been deployed yet — `COMPASS_NSEC`, `AUDIO_DIR`, `RSS_BASE_URL` env vars unset
- `IssuePicker` selects from kind 34200 manifests — works only after VPS watch-compass has published at least one manifest
- Transcription worker path: `transcribe.worker.ts` loads Whisper-base; first load is slow — consider caching with `env.cacheDir`
- RSS feed URL for the published mp3 is a placeholder (`RSS_BASE_URL` from scripts/config.ts)

---
*State updated: 2026-07-20 — full codebase audit; all phases 0–8 implemented and building cleanly*

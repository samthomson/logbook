# Roadmap: Logbook

**8 phases** | **47 v1 requirements** | All requirements covered ✓

---

### Phase 0: Event Spec & Repo Bootstrap

**Goal:** Lock the custom Nostr event envelope (kinds, tag schema, ordering model) and scaffold the PWA repo. No guessing later — every subsequent phase depends on this spec.

**Success Criteria:**
1. `SPEC.md` exists in repo with: kind numbers, full tag schema, section-ID format, transcript storage decision, EDL manifest format, intro-flag convention, soft reply-pointer convention
2. Open questions in `research/open-questions.md` are all resolved (default seed order, late-note policy, transcript home)
3. Vite + React/TS PWA scaffold builds and passes lint
4. TypeScript types for all custom event kinds match SPEC.md exactly

**Requirements:** Pre-flight for all phases (unblocks EVENT-01–04)

---

### Phase 1: Issue Ingestion + Auth + Whitelist

**Goal:** User can log in, see the latest Compass issue split into sections, and know whether they are on the whitelist.

**Success Criteria:**
1. Login flow works for NIP-46 bunker (desktop Chrome) and NIP-55/Amber (Android)
2. Latest Compass kind 30023 is fetched and rendered as a section list matching newsletter order
3. Whitelisted user sees record button; non-whitelisted user sees read-only indicator
4. Issue and auth state survive a page refresh (cached)
5. iOS < 18.4 shows an explicit in-app notice about recording unsupported

**Requirements:** INGEST-01–04, AUTH-01–05, WL-01–04

---

### Phase 2: Record → Upload → Publish

**Goal:** Whitelisted user can record a voice note, upload it to Blossom, and publish a valid Logbook event to relays. End-to-end core loop proven.

**Success Criteria:**
1. Record → upload → publish completes on desktop Chrome and Android Amber
2. Published event is valid per SPEC.md (kinds, all required tags present, sha256 verified)
3. Draft survives tab crash (IndexedDB persistence)
4. Transcription runs after recording; transcript attached to event
5. Reply to existing note creates event with soft reply pointer tag

**Requirements:** REC-01–06, BLOB-01–04, EVENT-01–04, TRANS-01–04

---

### Phase 3: Playback Timeline

**Goal:** Full contributor-facing timeline. Sections in newsletter order, voice notes in EDL seed order, reply grouping, real-time updates.

**Success Criteria:**
1. All sections render in newsletter order; voice notes within section in seed order
2. Transcript shown below waveform for all transcribed notes
3. Reply notes visually grouped with parent (max 1 UI level)
4. New note from another contributor appears without page refresh
5. Playback works on iOS 18.4+, Android, desktop

**Requirements:** PLAY-01–05

---

### Phase 4: Admin EDL + VPS Stitcher + RSS

**Goal:** Admin can curate the episode cut and trigger the VPS stitcher. Output is a valid Podcasting 2.0 RSS feed published to the Compass domain.

**Success Criteria:**
1. Admin drag-to-reorder changes EDL order; omitted notes excluded from manifest
2. Manifest event is signed and published; VPS stitcher reads it and starts job
3. Output MP3 passes Podcasting 2.0 validation (podcast:value splits, podcast:chapters)
4. NIP-73 scoped note published; episode appears in Fountain within 30 min
5. Admin can upload pre-generated intro track on behalf of Compass npub

**Requirements:** ADMIN-01–04, STITCH-01–05, RSS-01–03

---

### Phase 5: PWA Polish + nsite Deploy

**Goal:** App is installable, works offline for browsing, deploys as both GitHub Pages and Nostr nsite.

**Success Criteria:**
1. PWA installs on Android and iOS 18.4+ home screen
2. Cached issue browsable offline; draft queue survives offline
3. Wake lock requested during recording (prevents screen-sleep on long takes)
4. nsite deploy via `nsite` CLI resolves via Nostr gateway
5. GitHub Pages deploy at Compass subdomain confirmed live

**Requirements:** PWA-01–05

---

### Phase 6: v2 — Voice Changer (post-MVP)

**Goal:** Contributors can anonymize their voice before upload.

**Success Criteria:**
1. Voice changer applies pitch/formant shift in-browser before upload
2. Processed audio uploads identically to normal flow (same Blossom + event pipeline)

**Requirements:** ANON-01–02

---

### Phase 7: v2 — TTS Intro + Enhanced Search (post-MVP)

**Goal:** Admin can generate TTS intros in-client; full-text search over transcripts.

**Success Criteria:**
1. Admin generates TTS intro from text (Kokoro local or ElevenLabs BYOK)
2. Full-text search returns relevant sections and voice notes
3. AI summary per section rendered in timeline

**Requirements:** TTS-01, SEARCH-01–02

---

## Backlog

- Native iOS / Android apps (NATIVE-01–02) — blocked on PWA feature parity assessment
- Open contributions (no whitelist) — future consideration after MVP validation

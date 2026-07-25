# Requirements: Logbook

**Defined:** 2026-07-20
**Core Value:** Contributors leave a voice note in under 60 seconds; it appears under the right section for everyone else immediately.

## v1 Requirements

### Newsletter Ingestion

- [ ] **INGEST-01**: App fetches the latest Nostr Compass issue (kind 30023) from configured relays on load
- [ ] **INGEST-02**: App parses issue into ordered sections (H2 = topic group, H3 = individual project)
- [ ] **INGEST-03**: Each section displays its title, summary text, and any linked npubs from the issue
- [ ] **INGEST-04**: App caches the current issue locally (service worker) so it loads offline

### Identity / Login

- [ ] **AUTH-01**: User can connect via NIP-46 bunker (connection string or QR)
- [ ] **AUTH-02**: User can connect via NIP-55 / Amber intent on Android
- [ ] **AUTH-03**: User can paste nsec / ncryptsec (flagged with a warning; not recommended)
- [ ] **AUTH-04**: Logged-in identity (npub, display name, avatar) persists across sessions
- [ ] **AUTH-05**: User can log out and switch accounts

### Whitelist

- [ ] **WL-01**: App loads per-podcast whitelist (JSON array of npubs) from configured URL
- [ ] **WL-02**: Only whitelisted npubs can record and publish voice notes
- [ ] **WL-03**: Non-whitelisted users can view and listen but see a "read-only" indicator
- [ ] **WL-04**: Admin npub(s) bypass whitelist and have access to admin controls

### Voice Recording

- [ ] **REC-01**: Whitelisted user can record a voice note under any section (tap-to-record)
- [ ] **REC-02**: Recording uses MediaRecorder API (WebM/Opus on supported platforms)
- [ ] **REC-03**: User can preview playback before publishing
- [ ] **REC-04**: User can discard and re-record before publishing
- [ ] **REC-05**: Draft recording is persisted locally (IndexedDB) so a tab crash doesn't lose it
- [ ] **REC-06**: User can record a reply to an existing voice note (soft context pointer — no deep tree)

### Blossom Upload

- [ ] **BLOB-01**: On publish, audio blob is uploaded to configured Blossom server(s) with kind 24242 auth
- [ ] **BLOB-02**: Upload retries automatically on transient failure
- [ ] **BLOB-03**: sha256 of blob is verified before the Nostr event is published
- [ ] **BLOB-04**: Upload progress is shown to user

### Nostr Event Publishing

- [ ] **EVENT-01**: Published voice note uses the Logbook custom event envelope (kind TBD, spec in SPEC.md)
- [ ] **EVENT-02**: Event uses the canonical `SPEC.md` envelope: author pubkey plus `t`, `section`, `issue`, `x`, and optional `responding_to` tags; audio metadata and intro flag are in signed JSON content
- [ ] **EVENT-03**: Event is published to configured relay set
- [ ] **EVENT-04**: Transcript (if available) is attached per the transcript spec (SPEC.md §transcript)

### Playback & Timeline

- [ ] **PLAY-01**: Each section shows a chronological list of voice notes with contributor avatar, name, duration, waveform
- [ ] **PLAY-02**: User can play any voice note inline (HTML5 audio)
- [ ] **PLAY-03**: Transcript is shown below (or alongside) the waveform when available
- [ ] **PLAY-04**: Reply notes are visually grouped with their parent (indented / connected) but max 1 level deep in the UI
- [ ] **PLAY-05**: New voice notes appear in real-time via relay subscription (no manual refresh)

### Admin / EDL

- [ ] **ADMIN-01**: Admin user sees a drag-to-reorder list of all voice notes per section (the EDL)
- [ ] **ADMIN-02**: Admin can omit notes from the episode cut (soft delete from EDL, not from Nostr)
- [ ] **ADMIN-03**: Admin can trigger VPS stitcher job by publishing a signed manifest event


### Stitcher (VPS)

- [ ] **STITCH-01**: VPS stitcher reads the signed manifest event, downloads blobs in EDL order
- [ ] **STITCH-02**: Stitcher applies loudnorm (EBU R128), silence-trim, crossfades between clips
- [ ] **STITCH-03**: Output is MP3 (not Opus — Apple RSS requirement)
- [ ] **STITCH-04**: Stitcher uploads final episode MP3 to Blossom and publishes the RSS feed
- [ ] **STITCH-05**: Stitcher posts a NIP-73 scoped note linking the episode for Fountain discovery

### RSS / Distribution

- [ ] **RSS-01**: Published RSS is valid Podcasting 2.0 and binds the exact verified manifest revision used by the stitcher
- [ ] **RSS-02**: Publication is resumable and reaches the trusted HTTPS origin, Podstr event, and NIP-73 discussion before the manifest becomes terminal
- [ ] **RSS-03**: Feed URL is stable and served from the trusted HTTPS origin with byte-range media support

### PWA / Hosting

- [ ] **PWA-01**: App is installable as a PWA (manifest, service worker, icons)
- [ ] **PWA-02**: App works offline for browsing cached issue and queued drafts
- [ ] **PWA-03**: Wake lock is requested during recording to prevent screen-sleep killing a long take
- [ ] **PWA-04**: App is deployable with current nsyte/NIP-5A tooling
- [ ] **PWA-05**: A release is live only after same-gateway HTML, exact bundle SHA-256, and change-marker verification

## v2 Requirements

### Transcription

- **TRANS-01**: Trusted-worker fallback publishes a verified Compass-authored transcript when no verified contributor transcript exists
- **TRANS-02**: Browser transcription remains opt-in until its shipped dependency path has no unresolved high-severity audit findings
- **TRANS-03**: User sees transcription progress and can publish audio without waiting
- **TRANS-04**: Transcript uses the verified kind-1111 contract in `SPEC.md`

### Episode enrichment

- **ADMIN-04**: Compass admin can insert a generated/uploaded intro into the signed manifest cut
- **RSS-CHAPTERS-01**: RSS includes `podcast:chapters` entries derived from the exact stitched boundaries
- **CUT-01**: PWA displays verified “made the cut” reactions

### TTS Intro Generation (in-client)

- **TTS-01**: Admin can generate a TTS intro track from text using Kokoro (local) or ElevenLabs (BYOK)

### Enhanced Search

- **SEARCH-01**: Full-text search across all transcripts for the current issue
- **SEARCH-02**: AI-generated summary of all voice notes per section

## v3 Requirements

### Voice Changer / Anonymizer

- **ANON-01**: User can apply a voice changer effect before upload (reference: Amethyst VoiceAnonymizer)
- **ANON-02**: Voice changer parameters are configurable (pitch shift, formant)

### Lightning distribution

- **VALUE-01**: `podcast:value` splits use explicit contributor Lightning addresses from the signed access workflow; npubs are not payment destinations

### Native Apps

- **NATIVE-01**: iOS app (Swift / React Native) for users below iOS 18.4 WebM/Opus threshold
- **NATIVE-02**: Android app

## Out of Scope

| Feature | Reason |
|---------|--------|
| NIP-74 podcast kinds | Unmerged, low adoption — RSS is the right artifact |
| In-browser ffmpeg stitching | ~1.3 GB RAM for 1 hr decode kills mobile tabs |
| Real-time live rooms | Different product entirely |
| Open contributions (no whitelist) | Future consideration; whitelist enforces quality for MVP |
| Server-side search index | No backend; transcripts on Nostr are sufficient for v1 |
| DM notifications | Out of scope for recording client |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01–04 | Phase 1 | Pending |
| AUTH-01–05 | Phase 1 | Pending |
| WL-01–04 | Phase 1 | Pending |
| REC-01–06 | Phase 2 | Pending |
| BLOB-01–04 | Phase 2 | Pending |
| EVENT-01–04 | Phase 2 | Pending |
| TRANS-01–04 | v2 | Deferred/security-gated |
| PLAY-01–05 | Phase 3 | Pending |
| ADMIN-01–04 | Phase 4 | Pending |
| STITCH-01–05 | Phase 4 | Pending |
| RSS-01–03 | Phase 4 | Pending |
| PWA-01–05 | Phase 5 | Pending |

---
*Requirements defined: 2026-07-20*
*Last updated: 2026-07-25 after implementation audit and hosting/security reconciliation*

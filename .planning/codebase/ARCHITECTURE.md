---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# Architecture

**Analysis Date:** 2026-07-27

## Pattern Overview

**Overall:** Static event-driven PWA plus a separate trusted batch worker.

**Key Characteristics:**
- No application backend or database for the contributor discussion loop.
- Nostr relays carry signed state; Blossom carries content-addressed media.
- Browser handles reading, recording, draft persistence, and contributor publication.
- Compass-authored curation is an addressable signed manifest consumed by a trusted Linux worker.
- Trust is re-established at every boundary through signature, author, tag, hash, MIME, and revision checks.
- Release stages are revision-bound and resumable; local execution and external publication are distinct states.

## Layers

**PWA shell and navigation:**
- Purpose: public timeline, issue selection, authentication, capability gates, and admin routing.
- Contains: `logbook-pwa/src/App.tsx`, `logbook-pwa/src/main.tsx`, and top-level CSS.
- Depends on: issue, auth, access-list, profile, and cache libraries.
- Used by: browser entry point and responsive browser QA.

**PWA components:**
- Purpose: timeline rendering, recording, playback, uploads, replies, and episode curation.
- Contains: `logbook-pwa/src/components/IssueTimeline.tsx`, `Recorder.tsx`, `VoiceBubble.tsx`, `AdminPanel.tsx`, and related rows/panels.
- Depends on: pure trust/state helpers in `src/lib/` and shared types.
- Used by: `App.tsx` mounted production paths.

**PWA protocol and trust libraries:**
- Purpose: Nostr queries/publication, signatures, deterministic revision selection, auth restoration, draft ownership, Blossom integrity, and capability revocation.
- Contains: `logbook-pwa/src/lib/segment.ts`, `manifest.ts`, `manifest-revision.ts`, `whitelist.ts`, `auth.ts`, `session.ts`, `drafts.ts`, `blossom.ts`, and `relay.ts`.
- Depends on: nostr-tools, noble cryptography, applesauce signers, IndexedDB, and fetch.
- Used by: mounted components and collocated unit tests.

**Trusted worker orchestration:**
- Purpose: discover eligible Compass issues/manifests and run bounded stitch/release processes.
- Contains: `scripts/watch-compass.ts`, `watch-runner.ts`, and `watch-state.ts`.
- Depends on: verified manifest selection, child processes, and Compass signer adapter.
- Used by: systemd service through `npm run watch`.

**Trusted media pipeline:**
- Purpose: fetch exact manifest-listed segments, validate content, process audio, and bind outputs to a revision.
- Contains: `scripts/stitch.ts`, `stitch-download.ts`, `segment-security.ts`, `stitch-media.ts`, and `stitch-state.ts`.
- Depends on: Nostr relay reads, configured Blossom origins, SHA-256, ffprobe, and ffmpeg.
- Used by: watcher and controlled dry-run/operator invocations.

**Release pipeline:**
- Purpose: construct feed metadata, persist idempotent release stages, require hosted-feed acknowledgement, and publish external events in order.
- Contains: `scripts/publish-rss.ts`, `release-state.ts`, `rss-state.ts`, `static-sync.ts`, and `made-the-cut.ts`.
- Depends on: exact stitch run metadata, current verified manifest revision, authorized Compass NIP-46 signer, relays, Blossom, and external static hosting.
- Used by: watcher after successful stitch.

**Deployment and operations:**
- Purpose: least-privilege worker runtime and repeatable verification.
- Contains: `deploy/systemd/logbook-worker.service`, `deploy/systemd/logbook.env.example`, and `docs/operations-and-testing.md`.
- Depends on: dedicated Linux account, authorized signer files, journald, HTTPS origin, and native tools.

## Data Flow

**Public read flow:**
1. `App.tsx` restores the non-secret selected issue independently of authentication.
2. `lib/compass.ts` fetches Compass kind `30023` events from relays.
3. `filterVerified` and author checks reject forged relay data.
4. The issue parser builds stable H2/H3 recording targets.
5. `IssueTimeline.tsx` fetches one bounded issue segment inventory, validates segments, and groups them client-side.
6. Profiles and transcripts enrich the already trusted segment set; anonymous users can read and play it.

**Record, upload, and publish flow:**
1. Access lists derive `canRecord` and `isAdmin` from one request in `App.tsx`.
2. Recorder captures WebM/Opus and writes an owner-bound IndexedDB draft before remote work.
3. A compound capability token and expected pubkey are captured for the operation.
4. `lib/blossom.ts` hashes the blob, obtains fresh kind `24242` auth, uploads to a primary, verifies the descriptor, and mirrors.
5. Segment publication rechecks capability/signer identity and writes a signed kind `4200` event to relays.
6. Success replaces the in-place pending state; failure preserves a resumable draft/descriptor.

**Admin curation flow:**
1. Admin workspace projects a deduplicated trusted recording inventory and current signed manifest.
2. Human edits remain a local draft until deliberate Save.
3. Save checks optimistic revision identity, expected Compass signer, signature validity, relay acknowledgement, and propagation.
4. Lock publishes a newer `cutting` revision only when all required chapters have valid active recordings.

**Trusted release flow:**
1. Watcher groups all verified manifests by d-tag and chooses newest `(created_at, id)` revisions.
2. Before each child process, `watch-runner.ts` re-fetches and confirms the same cutting revision is current.
3. Stitcher independently fetches the Compass newsletter, derives required targets, validates every segment/blob, runs ffmpeg, and writes revision/hash-bound run metadata.
4. Publisher recreates feed state, computes the feed digest, and resumes a durable stage ledger.
5. External hosting must acknowledge the exact digest; then Podstr, announcement, and terminal manifest stages run in order.
6. Watcher suppresses retries only after a verified terminal revision is observable on relays.

**State Management:**
- Browser: React state, revocable request generations, local/session storage, and IndexedDB drafts/cache.
- Protocol: signed Nostr events and deterministic replaceable-event selection.
- Media: immutable hash-addressed Blossom blobs.
- Worker: JSON run metadata, feed episode state, and release ledgers on the trusted filesystem.

## Key Abstractions

**Latest-request/capability guard:**
- Purpose: revoke stale async auth, issue, access, admin, and publish continuations.
- Examples: `logbook-pwa/src/lib/latest-request.ts` and guard instances in `App.tsx`.
- Pattern: monotonically increasing generation token checked before and after awaits.

**Expected signer identity:**
- Purpose: prevent stable signer objects from silently switching principals.
- Examples: `logbook-pwa/src/lib/signer-identity.ts`, `scripts/amber-signer.ts`.
- Pattern: capture expected pubkey, validate signer response and signed event, recheck before side effects.

**Verified replaceable revision:**
- Purpose: make relay arrival order irrelevant.
- Examples: `logbook-pwa/src/lib/manifest-revision.ts`, `scripts/watch-state.ts`, `scripts/release-state.ts`.
- Pattern: pin author/d-tag, verify signatures, select max `(created_at, id)`, and bind downstream state to event identity plus content digest.

**Trusted blob descriptor:**
- Purpose: ensure event metadata resolves to allowed bytes.
- Examples: `logbook-pwa/src/lib/blob-trust.ts`, `scripts/stitch-download.ts`.
- Pattern: configured HTTPS origin + canonical hash path + SHA-256 read-back + media-stream inspection.

**Release ledger:**
- Purpose: resume external publication without duplicating acknowledged stages.
- Examples: `scripts/release-state.ts` and `scripts/static-sync.ts`.
- Pattern: durable stage acknowledgements scoped to one exact manifest revision.

## Entry Points

**PWA:**
- Location: `logbook-pwa/src/main.tsx` → `App.tsx`.
- Triggers: browser load of static Vite bundle.
- Responsibilities: mount public shell and route to timeline/auth/admin surfaces.

**Development/build:**
- Location: `logbook-pwa/package.json`.
- Triggers: `npm run dev`, `npm test`, `npm run build`.
- Responsibilities: local server, unit/browser checks, and static bundle generation.

**Worker watcher:**
- Location: `scripts/watch-compass.ts` via `npm run watch`.
- Triggers: systemd service or operator invocation.
- Responsibilities: issue backfill, cutting-manifest polling, and stitch/release process orchestration.

**Stitch/release commands:**
- Locations: `scripts/stitch.ts` and `scripts/publish-rss.ts`.
- Triggers: watcher child processes or explicit operator commands with `--issue`.
- Responsibilities: exact-cut media production and ordered external publication.

## Error Handling

**Strategy:** Fail closed at trust boundaries, preserve recoverable local state, and surface errors at the owning UI/process boundary.

**Patterns:**
- Pure validators throw descriptive `Error` or specific signer/HTTP error classes.
- PWA components catch remote failures, show visible notices/pending draft actions, and invalidate stale state writes.
- Worker top-level `main().catch(...)` logs a prefixed fatal error and exits non-zero.
- Watcher converts child exits and missing relay acknowledgement into retryable outcomes.
- Remote retries are bounded and distinguish non-retryable 4xx/signer identity failures from network/5xx failures.

## Cross-Cutting Concerns

**Logging:**
- Browser console at external boundaries plus user-visible state; worker stdout/stderr captured by journald.

**Validation:**
- Explicit runtime guards for event signatures, authors, d-tags, signed content, URLs, hashes, MIME/audio streams, and revision freshness.

**Authentication:**
- Amber/bunker NIP-46 is primary; NIP-07 and memory-only key paths remain compatibility options.
- Public reads never depend on authentication.

**Security:**
- No raw production private key in service config.
- Drafts and pending descriptors are owner-bound.
- Remote side effects require current capability and expected identity.

---

*Architecture analysis: 2026-07-27*
*Update when major patterns change*

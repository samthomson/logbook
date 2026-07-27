# Logbook

## What This Is

Logbook is an asynchronous voice-podcast PWA for Nostr Compass contributors and listeners. It turns each Compass newsletter into a public, sectioned voice discussion, lets authorized contributors record notes and replies, lets Compass curate a signed episode cut, and lets a trusted Linux worker produce the public podcast artifacts.

The browser owns reading, recording, draft recovery, and curation; Nostr and Blossom carry signed state and content-addressed media; the trusted worker owns canonical episode assembly and distribution.

## Core Value

A contributor can leave a durable voice reaction under the correct Compass newsletter item without joining a live call, while the editor retains deterministic control over the final episode.

## Requirements

### Validated

- ✓ Anyone can read verified Compass newsletters, contributor profiles, voice notes, replies, playback, and trusted transcripts without authentication — brownfield baseline
- ✓ Authorized contributors can record WebM/Opus, preserve owner-bound drafts, upload/mirror verified Blossom blobs, and publish kind `4200` segments — brownfield baseline
- ✓ Amber/NIP-46, bunker, NIP-07, and memory-only nsec/ncryptsec authentication paths are implemented with stale-request and signer-identity protection — brownfield baseline
- ✓ Compass-signed kind `34201` contributor/admin lists and Compass-only mutations gate recording and curation — brownfield baseline
- ✓ The admin workspace can review, include/exclude, reorder, save, and lock an exact kind `34200` episode manifest — brownfield baseline
- ✓ The worker can verify newsletters/manifests/segments/blobs, run native ffmpeg, and bind stitched artifacts to an exact manifest revision — brownfield baseline
- ✓ The release pipeline can build Podcasting 2.0 RSS, persist a resumable ledger, and publish Podstr, announcement, and terminal-manifest stages in order — brownfield baseline
- ✓ The production bundle excludes browser transcription and its former model/runtime dependency path — release `93cb11b`
- ✓ The PWA is published under the canonical Compass nsite identity with exact same-gateway bundle verification — release `93cb11b`

### Active

- [ ] Install and prove the trusted worker under the dedicated account on the canonical host, including authorized signer identity and restart recovery
- [ ] Integrate the public feed/media host with digest-bound upload acknowledgement, HTTPS read-back, and byte-range verification
- [ ] Complete one staging issue through every release-ledger stage and verify the primary real-device Amber/microphone path
- [ ] Complete one production issue through terminal manifest publication with hashes, URLs, event IDs, and relay acknowledgements preserved
- [ ] Verify a podcast client can ingest the public feed and play the released episode

### Out of Scope

- App-specific centralized backend for the contributor discussion loop — signed Nostr state and Blossom media remain the architecture
- In-browser episode stitching — native ffmpeg on a trusted worker is the canonical path
- Blob privacy claims from a client-side whitelist — Nostr events and Blossom URLs are public
- Raw production signing keys in worker configuration — Compass operations use the authorized NIP-46 session
- Live rooms or synchronous recording — Logbook is deliberately asynchronous
- Browser transcription in the current milestone — it can return only after explicit security, privacy, memory, latency, and precache gates
- Native clients in the current milestone — reconsider only if measured PWA gaps remain material

## Context

- The PWA and worker code are implemented and repository-tested, but repository tests do not prove production worker health, signer availability, feed hosting, relay acceptance, or podcast-client ingestion.
- Current release commit: `93cb11b31fd03332a9a9854fa102c9c5e211b685`.
- Current verified PWA: `https://npub1wav4fae3gyfy3xj298kxj2mj8phavz7vavps34przq02j7w902qq902923.nsite.lol/`.
- Canonical sources: `SPEC.md` for wire/trust rules, `PLAN.md` for architecture, `docs/operations-and-testing.md` for evidence, and `.planning/codebase/` for the imported brownfield map.
- Historical material under `research/` is non-authoritative.
- The working tree contains a pre-existing documentation refactor and several source-comment/config corrections; GSD work must stage only explicit `.planning/` artifacts.

## Constraints

- **Trust:** Every authoritative Nostr event is signature-verified, author-pinned, d-tag checked, and selected deterministically — relays are untrusted transport and ordering layers.
- **Identity:** Every async write remains revocable and bound to the expected signer pubkey — a stable signer object is not a stable principal.
- **Media:** Every accepted blob URL uses a configured HTTPS origin and expected hash path; worker downloads must pass SHA-256 and ffprobe validation.
- **Draft safety:** Recordings are owner- and issue-bound in IndexedDB before remote work; resume is explicit and never crosses principals.
- **Distribution:** A local `feed.xml`, child-process exit, or completed relay attempt is not external publication proof.
- **Signing:** Production Compass events use the operator-authorized NIP-46 session under the trusted service account; no hot nsec in systemd or tracked env files.
- **Hosting:** PWA release links are shared only after exact same-gateway HTML and asset hashes plus a change marker match the local build.
- **Compatibility:** PWA targets Node 22.12+ development and supported WebM/Opus browsers, including iOS 18.4+ for recording.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Custom immutable kind `4200` voice envelope | Needs stable issue/section/hash/reply metadata without depending on unmerged podcast conventions | ✓ Good |
| Compass-authored kind `34200` manifest | Gives the editor deterministic signed control over order, exclusions, and terminal state | ✓ Good |
| Compass-authored kind `34201` access lists | Replaces static authorization while keeping Nostr-native trust and revocation | ✓ Good; static fallback still pending removal |
| Public reading independent of auth | Published newsletter discussion must remain visible when signers sleep or sessions expire | ✓ Good |
| Trusted native worker for canonical stitching | Browser media assembly is memory-heavy and not a trustworthy release authority | ✓ Good |
| Remote signer first for Compass writes | Keeps production private keys out of the service and browser configuration | ✓ Good |
| Revision- and digest-bound release ledger | Prevents stale cuts and duplicate external publication after restart | ✓ Good |
| External static-host acknowledgement before terminal stages | A local file write does not prove a public feed exists | ✓ Good; concrete deployer still active work |
| Browser transcription removed from the production bundle | Former dependency path failed security/size gates and was not required for the core voice loop | ✓ Good |
| Flat `responding_to` replies remain canonical | Avoids migration complexity until additive NIP-22 tags have a concrete interoperability benefit | — Pending review |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Review every section against live code and operational evidence
2. Recheck the Core Value and active production priority
3. Audit Out of Scope reasons
4. Update Context with current deployment and release evidence

---
*Last updated: 2026-07-27 after GSD brownfield import*

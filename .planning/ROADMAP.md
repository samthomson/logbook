# Roadmap: Logbook Production Operations

## Overview

The implemented PWA and trusted-worker code are imported as the brownfield baseline. This roadmap closes the gap between code-complete and operationally proven: install the canonical worker, prove its signer and restart behavior, integrate digest-verified public hosting, run a complete staging release with real-device contributor QA, then publish and independently consume one terminal production episode.

## Milestones

- ✅ **Brownfield baseline** — PWA, curation, trusted stitch/release code, and Compass-owned nsite release imported on 2026-07-27; not phase-tracked in GSD
- 🚧 **Production Operations** — Phases 1-5; active milestone
- 📋 **Post-operations hardening** — static whitelist retirement, signer-helper removal, schema parity, and selected product enhancements; deferred requirements

## Phases

- [ ] **Phase 1: Canonical Worker Installation** - Install the tracked worker under the dedicated account and prove healthy service execution
- [ ] **Phase 2: Signer and Restart Recovery** - Prove canonical Compass identity and durable, non-duplicating restart behavior
- [ ] **Phase 3: Public Feed and Media Hosting** - Close the digest-bound static-host handoff and verify public bytes/ranges
- [ ] **Phase 4: Staging Release and Device QA** - Exercise every release stage plus the primary real-device contributor path
- [ ] **Phase 5: Terminal Production Episode** - Publish one evidence-backed episode and verify podcast-client consumption

## Phase Details

### Phase 1: Canonical Worker Installation
**Goal**: The tracked trusted worker runs under the dedicated `logbook` account on the canonical host with the repository's hardened systemd policy.
**Depends on**: Brownfield baseline
**Requirements**: OPS-01
**Success Criteria** (what must be TRUE):
  1. Operator can install the exact reviewed repository revision and dependencies under the dedicated account without placing signer secrets in tracked files or the public env file
  2. `logbook-worker.service` starts successfully with the tracked unit and reports healthy active state
  3. Worker logs and filesystem permissions prove it can read its code/config and write only the configured state/cache/static paths
**Plans**: TBD

Plans:
- [ ] 01-01: Plan canonical-host installation, least-privilege verification, and service health evidence

### Phase 2: Signer and Restart Recovery
**Goal**: The live worker proves the canonical Compass signer before side effects and resumes safely after interruption.
**Depends on**: Phase 1
**Requirements**: OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. A local-only signer preflight under the service account returns the canonical Compass pubkey and a valid signed event without publishing it
  2. A staged run can be interrupted and restarted while remaining bound to the same verified manifest revision
  3. Restarted execution skips acknowledged stages, retries only incomplete stages, and does not publish duplicate terminal events
  4. Revoking or mismatching the signer stops before Blossom, relay, or static-host side effects
**Plans**: TBD

Plans:
- [ ] 02-01: Plan signer preflight, service-account recovery, and interruption evidence

### Phase 3: Public Feed and Media Hosting
**Goal**: The release pipeline owns an executable, digest-verified handoff to the public feed/media origin.
**Depends on**: Phase 2
**Requirements**: HOST-01, HOST-02
**Success Criteria** (what must be TRUE):
  1. Operator can invoke one documented deploy/read-back path for the configured static root and `LOGBOOK_FEED_READBACK_URL`
  2. The deployer returns acknowledgement only when the hosted feed SHA-256 equals the exact local feed digest
  3. Public feed and episode media use HTTPS, return the expected bytes, and support byte-range requests
  4. A wrong digest, stale hosted file, failed upload, or missing range support blocks later release stages with a resumable error
**Plans**: TBD

Plans:
- [ ] 03-01: Plan the trusted static-host adapter, digest acknowledgement, and external verification matrix

### Phase 4: Staging Release and Device QA
**Goal**: A controlled staging issue proves the complete release ledger and the physical-device contributor path before production.
**Depends on**: Phase 3
**Requirements**: REL-01, QA-01
**Success Criteria** (what must be TRUE):
  1. A staging issue reaches verified cutting manifest, trusted stitch, hosted-feed acknowledgement, Podstr, announcement, and terminal manifest stages in order
  2. Every stage has preserved manifest revision, artifact hash, event ID, URL, and acknowledgement/fetch-back evidence appropriate to that stage
  3. An authorized contributor can use Amber on a supported physical device to sign in or restore, record microphone audio, publish, reload, and play the note
  4. Interrupted or rejected recording publication leaves an owner-bound resumable draft and never exposes it to another identity
**Plans**: TBD

Plans:
- [ ] 04-01: Plan staging cut selection, controlled side effects, evidence capture, and real-device QA

### Phase 5: Terminal Production Episode
**Goal**: One real Compass issue becomes a publicly hosted, relay-observable, podcast-client-playable terminal Logbook episode.
**Depends on**: Phase 4
**Requirements**: REL-02, DIST-01
**Success Criteria** (what must be TRUE):
  1. The selected production issue publishes a terminal Compass manifest bound to the exact cutting revision and stitched artifact hashes
  2. Public feed/media bytes, HTTPS, range responses, Podstr event, announcement, and terminal manifest are independently fetched after publication
  3. At least one podcast client subscribes to the feed, discovers the intended episode metadata, and plays the published media
  4. Release evidence records commit, manifest/event IDs, hashes, URLs, relay acknowledgements, client verification, and any remaining propagation gaps without equating local tests with live proof
**Plans**: TBD

Plans:
- [ ] 05-01: Plan production release authorization, execution, independent verification, and evidence archive

## Progress

**Execution Order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Canonical Worker Installation | Production Operations | 0/1 | Not started | - |
| 2. Signer and Restart Recovery | Production Operations | 0/1 | Not started | - |
| 3. Public Feed and Media Hosting | Production Operations | 0/1 | Not started | - |
| 4. Staging Release and Device QA | Production Operations | 0/1 | Not started | - |
| 5. Terminal Production Episode | Production Operations | 0/1 | Not started | - |

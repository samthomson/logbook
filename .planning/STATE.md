# Project State: Logbook

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-20)

**Core value:** Contributors can leave and discover voice reactions to Compass newsletter sections, and those recordings assemble automatically into a listenable podcast episode.
**Current milestone:** Milestone 1 — v0 spike + v1 MVP
**Current phase:** Phase 0 — Event Spec & Repo Bootstrap (COMPLETE)

## Status

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Event Spec & Repo Bootstrap | ✓ Complete | SPEC.md written; all open questions resolved; build passing |
| 1 | Issue Ingestion + Auth + Whitelist | ○ Pending | Next: scaffold lib/compass.ts, lib/auth, whitelist |
| 2 | Record → Upload → Publish | ○ Pending | Depends on Phase 1 |
| 3 | Playback Timeline | ○ Pending | Depends on Phase 2 |
| 4 | Admin EDL + VPS Stitcher + RSS | ○ Pending | Depends on Phase 3 |
| 5 | PWA Polish + nsite Deploy | ○ Pending | Can parallel Phase 4 |
| 6 | v2 — Voice Changer | ○ Pending | Milestone 2 |
| 7 | v2 — TTS Intro + Enhanced Search | ○ Pending | Milestone 2 |

## Phase 0 Deliverables (complete)

- `SPEC.md` — canonical event spec (kinds 4200, 34200, transcript, reaction)
- All open questions from `research/open-questions.md` resolved (seed order, intro pinning, late notes, transcript home)
- `logbook-pwa/` scaffolded: Vite + React + TypeScript + vite-plugin-pwa
- `logbook-pwa/src/config.ts` — COMPASS_PUBKEY, relays, Blossom servers, KINDS constants
- `logbook-pwa/src/types/nostr.ts` — full TypeScript types for all event kinds
- `logbook-pwa/vite.config.ts` — PWA plugin, static build, service worker
- Build passes: `npm run build` ✓

## Pre-conditions Still Pending

1. **BRAND**: Confirm "Logbook" npub, NIP-05 handle, subdomain under Compass brand — must be done before any public-facing string is published
2. **KIND CHECK**: Re-verify kinds 4200 and 34200 against live NIPs registry before first relay publish

## Next Step

Start Phase 1: Issue Ingestion + Auth + Whitelist.

Key files to create:
- `src/lib/compass.ts` — `fetchLatestIssue()`, `parseIssue()` (H2/H3 parsing)
- `src/lib/auth.ts` — NIP-46 bunker, NIP-55/Amber, nsec/ncryptsec paste
- `src/lib/whitelist.ts` — fetch per-issue JSON + merge standing roster
- `src/components/AuthGate.tsx` — login screen with all three auth flows
- `src/components/IssueView.tsx` — renders sections from parsed issue

---
*State updated: 2026-07-20 — Phase 0 complete*

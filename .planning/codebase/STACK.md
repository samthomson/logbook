---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# Technology Stack

**Analysis Date:** 2026-07-27

## Languages

**Primary:**
- TypeScript 6.0 in `logbook-pwa/` — React client, Nostr protocol handling, recording, and browser tests.
- TypeScript 5.5 in `scripts/` — trusted watcher, media stitcher, release ledger, RSS publication, and tests.

**Secondary:**
- CSS — all PWA presentation under `logbook-pwa/src/`.
- JavaScript/ES modules — browser QA runners in `logbook-pwa/scripts/` and Vite configuration.
- Markdown — canonical protocol, architecture, operations, and GSD planning documents.
- systemd unit/env syntax — trusted-worker deployment in `deploy/systemd/`.

## Runtime

**Environment:**
- Node.js 22.12 or newer for local development and production scripts (`logbook-pwa/package.json`).
- Modern browsers with MediaRecorder/Web Audio/IndexedDB; recording support targets iOS 18.4+ and current Chromium-family browsers.
- Native `ffmpeg` and `ffprobe` for trusted-worker media validation and stitching.
- `nak` plus an operator-authorized Compass NIP-46 session for Compass-authored production events.

**Package Manager:**
- npm with separate lockfiles in `logbook-pwa/package-lock.json` and `scripts/package-lock.json`.
- The repository is a two-workspace monorepo without a root package manifest.

## Frameworks

**Core:**
- React 19.2 — static PWA UI.
- Vite 8.1 — bundling and local development.
- vite-plugin-pwa 1.3 / Workbox 7.4 — service worker, install manifest, and runtime caching.
- nostr-tools — relay pool, event hashes, signatures, and NIP-19 utilities.
- applesauce-signers/core 6.2 — Amber/NIP-46, NIP-07, nsec, and ncryptsec signer adapters.
- RxJS 7.8 — NIP-46 relay transport bridge.

**Testing:**
- Vitest 4.1 — PWA unit and source-behavior tests.
- Node built-in `node:test` through `tsx --test` — trusted-worker tests.
- Puppeteer 25.3 — responsive public-shell and admin-layout browser checks.
- Native ffmpeg integration test in `scripts/test/stitch-media.integration.test.ts`.

**Build/Dev:**
- TypeScript project build for the PWA (`tsc -b`) and no-emit typecheck for scripts (`tsc --noEmit`).
- oxlint 1.71 for PWA linting via `logbook-pwa/.oxlintrc.json`.
- tsx/ts-node for direct TypeScript script execution.

## Key Dependencies

**Critical:**
- `nostr-tools` — relay queries/publication and Nostr event verification.
- `applesauce-signers` — revocable remote and local signer implementations.
- `@noble/curves` and `@noble/hashes` — explicit Schnorr/hash verification in trusted client paths.
- `@dnd-kit/*` — keyboard-capable episode ordering in the admin workspace.
- `fake-indexeddb` — deterministic owner-bound draft tests.
- `node-fetch` — trusted-worker HTTP requests.

**Infrastructure:**
- Node built-ins (`fs`, `crypto`, `child_process`, `path`) for durable state, hashing, and native media execution.
- No database, server framework, container runtime, or application backend.

## Configuration

**Environment:**
- PWA relay, event-kind, Compass pubkey, and Blossom defaults are compiled from `logbook-pwa/src/config.ts`.
- Worker public settings use `LOGBOOK_BASE_URL`, `LOGBOOK_STATIC_DIR`, `LOGBOOK_AUDIO_DIR`, and optional `NAK_BIN` from `deploy/systemd/logbook.env.example`.
- A digest-bound `LOGBOOK_STATIC_SYNC_ACK` is required after external feed hosting before terminal release stages continue.
- Production signing reads the authorized session from the service account's `~/.config/compass-publish/`; raw signing keys are not production configuration.

**Build:**
- `logbook-pwa/vite.config.ts` uses a relative base for nsite gateways and a network-first HTML cache.
- `logbook-pwa/tsconfig*.json` and `scripts/tsconfig.json` define independent TypeScript projects.

## Platform Requirements

**Development:**
- Linux/macOS/Windows with Node 22.12+ for client work; Linux is required for parity with the trusted worker and systemd deployment.
- Chromium/Puppeteer for browser QA; `ffmpeg`/`ffprobe` for worker integration tests.

**Production:**
- Static PWA published through nsyte/nsite under the Compass identity.
- Dedicated Linux worker account managed by `deploy/systemd/logbook-worker.service`.
- Trusted HTTPS feed/media origin with byte-range support and digest read-back.

---

*Stack analysis: 2026-07-27*
*Update after major dependency or runtime changes*

---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# Testing Patterns

**Analysis Date:** 2026-07-27

## Test Framework

**PWA runner:**
- Vitest 4.1 through `logbook-pwa/package.json`.
- Built-in `describe`, `it`, `expect`, and `vi` APIs.
- Browser environment is selected per test as needed; `fake-indexeddb` covers draft persistence.

**Worker runner:**
- Node built-in `node:test` and `node:assert/strict` executed by `tsx --test`.
- Tests run directly against TypeScript ESM modules.

**Browser QA:**
- Puppeteer scripts `logbook-pwa/scripts/public-shell-qa.mjs` and `admin-layout-qa.mjs`.
- These verify mounted production surfaces at 320, 360, and 390 px, including anonymous access and horizontal overflow.

**Run Commands:**
```bash
cd /home/vibe/logbook/logbook-pwa
npm test                 # Vitest plus both browser QA scripts
npm run test:unit       # Vitest only
npm run test:browser    # Public/admin Puppeteer checks
npm run lint
npm run build
npm audit --omit=dev --audit-level=high

cd /home/vibe/logbook/scripts
npm run typecheck
npm test                 # node:test suites, including native media integration
npm audit --omit=dev --audit-level=high

git -C /home/vibe/logbook diff --check
```

## Test File Organization

**PWA:**
- Collocated `*.test.ts` / `*.test.tsx` beside the source under `logbook-pwa/src/`.
- Examples: `lib/segment.test.ts`, `lib/admin-write-revocation.test.ts`, `App.public.test.tsx`, `components/AdminNoteRow.test.tsx`.

**Worker:**
- Separate `scripts/test/` tree mirroring worker module names.
- Examples: `release-state.test.ts`, `watch-runner.test.ts`, `segment-security.test.ts`, `stitch-media.integration.test.ts`.

**Structure:**
```text
logbook-pwa/src/
├── App.tsx
├── App.public.test.tsx
├── components/
│   ├── AdminNoteRow.tsx
│   └── AdminNoteRow.test.tsx
└── lib/
    ├── auth.ts
    └── auth.test.ts

scripts/
├── release-state.ts
├── stitch-media.ts
└── test/
    ├── release-state.test.ts
    └── stitch-media.integration.test.ts
```

## Test Structure

**Vitest pattern:**
```typescript
import { describe, expect, it } from 'vitest'

describe('restoreSession', () => {
  it('restores read state without waiting for Amber', async () => {
    const result = await restoreSession(session, 'amber')
    expect(result.pubkey).toBe(remote)
  })
})
```

**Worker pattern:**
```typescript
import assert from 'node:assert/strict'
import test from 'node:test'

test('release stages resume without duplicating acknowledgements', async () => {
  await assert.rejects(() => runReleaseStages(input), /announcement/)
  assert.deepEqual(calls, expected)
})
```

**Patterns:**
- Test names describe the security or operational contract, not implementation trivia.
- Pure functions/state machines receive injected network/process/filesystem boundaries.
- Regression tests cover both the valid path and stale/forged/revoked/mismatched paths.
- Tests use deterministic event IDs, timestamps, pubkeys, and local relay URLs; no production secret is required.

## Mocking

**Framework:**
- Vitest `vi` for PWA module/function mocks.
- Worker tests prefer hand-built dependency objects, in-memory ledgers, temporary directories, and Node assertions instead of a mocking library.

**What to Mock/Inject:**
- Relay fetch/publication, signer calls, browser storage, fetch, timers, child-process exits, and external static-host acknowledgement.
- Browser APIs not available in jsdom/headless environments (IndexedDB, media devices, playback).

**What NOT to Mock:**
- Cryptographic validation, revision ordering, hash binding, draft owner checks, and pure state transitions.
- Native ffmpeg behavior in the dedicated integration test.

## Fixtures and Factories

**Test Data:**
- Small event/config factory functions are usually local to the test file.
- Long-lived deterministic test pubkeys and repeated hex strings stand in for identities and event IDs.
- Temporary filesystem roots use PID/time suffixes and are created during worker state tests.
- `logbook-pwa/public/data/whitelist-test.json` is a static development fixture, not production authority.

**Live probes:**
- `e2e-smoke.mts` exercises relay/Blossom publication but does not replace browser WebM/React wiring tests.
- Real-device Amber/microphone and production release tests require explicit authorization and documented evidence.

## Coverage

**Requirements:**
- No numeric coverage threshold is configured.
- Quality gates emphasize critical trust paths, mounted UI behavior, native media execution, and deterministic operational state.
- Current handoff records 20 PWA test files / 95 tests and 46 worker tests at release commit `93cb11b`.

**Configuration:**
- No tracked coverage command or CI enforcement was found.
- Treat historical counts as release evidence for that commit only; rerun tests after changes.

## Test Types

**Unit tests:**
- Parsers, revision selectors, request guards, auth/session storage, drafts, signer identity, blob descriptors, release ledgers, and state machines.

**Integration tests:**
- Native `ffmpeg`/`ffprobe` media path.
- Production App rendering with storage/network substitutes.
- Cross-module trusted worker flow with injected external boundaries.

**Browser checks:**
- Real Chromium rendering for public shell and admin layout at supported mobile widths.
- Browser screenshots/manual capture are a separate gate when visual QA is requested.

**Operational tests:**
- Worker service health, remote signer availability, hosted feed/media read-back, byte ranges, podcast-client ingestion, and terminal relay events.
- These are not proven by repository tests and must remain explicit roadmap requirements.

## Common Patterns

**Async and stale-work testing:**
- Resolve promises out of order and assert old generations cannot write replacement state.
- Re-fetch the current manifest before every simulated external stage and assert stale runs stop.

**Error testing:**
- Use `expect(...).rejects.toThrow(...)` in Vitest and `assert.rejects`/`assert.throws` in worker tests.
- Assert side-effect call order and durable ledger contents, not only thrown messages.

**Security testing:**
- Include forged signatures, wrong authors, wrong d-tags, mismatched hashes, untrusted origins, signer switches, and owner changes.
- Verify failures occur before network publication where the contract requires fail-closed behavior.

**Snapshot testing:**
- No snapshot suite is used; explicit behavior and DOM assertions are preferred.

---

*Testing analysis: 2026-07-27*
*Update when test patterns change*

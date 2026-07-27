---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# Coding Conventions

**Analysis Date:** 2026-07-27

## Naming Patterns

**Files:**
- React components use PascalCase (`VoiceBubble.tsx`, `AdminPanel.tsx`).
- Library and worker modules use kebab-case (`latest-request.ts`, `release-state.ts`).
- PWA tests are collocated as `*.test.ts` or `*.test.tsx`; worker tests are `scripts/test/*.test.ts`.
- Canonical root documents use uppercase names (`SPEC.md`, `PLAN.md`, `AGENTS.md`).

**Functions:**
- camelCase for exported and local functions (`fetchAccessLists`, `runReleaseStages`).
- React event callbacks use `handle*`; state loaders often use `load*` or `fetch*`.
- Assertion functions use `assert*` and throw on trust/invariant violations.
- Predicate functions use `is*`, `has*`, or `can*`.

**Variables:**
- camelCase for mutable/local values.
- UPPER_SNAKE_CASE for protocol/runtime constants (`COMPASS_PUBKEY`, `DEFAULT_RELAYS`).
- React state follows `[value, setValue]`; request guards are plural nouns (`authRequests`, `issueRequests`).

**Types:**
- PascalCase interfaces and type aliases without `I` prefixes (`AuthState`, `ManifestRevision`).
- Interface names describe domain values or injected dependency sets.
- Literal unions represent bounded states (`WatcherCycleOutcome`, `AppView`).

## Code Style

**Formatting:**
- Two-space indentation, single quotes, and omitted semicolons throughout TypeScript.
- Trailing commas are common in multiline calls/objects.
- Long calls may stay inline when the semantic chain is clearer than mechanical wrapping.
- No repository-wide formatter is configured; match nearby files and rely on `diff --check` plus oxlint.

**Linting:**
- PWA uses oxlint configured by `logbook-pwa/.oxlintrc.json`.
- Run `npm run lint` from `logbook-pwa/`.
- Current baseline permits two known React Fast Refresh warnings and zero errors; do not call warnings a clean run.
- Worker has no separate linter; TypeScript typecheck and tests are the gates.

## Import Organization

**Order:**
- Existing files mix external, Node built-in, and relative imports; there is no enforced global sorter.
- Keep type-only imports explicit with `import type` where practical.
- Use concrete module paths instead of barrel exports.
- Worker relative imports include `.ts`; Vite client imports usually omit extensions.

**Grouping:**
- Use blank lines to separate conceptual sections in large modules, especially worker scripts.
- Do not introduce path aliases; none are configured.

## Error Handling

**Patterns:**
- Throw descriptive errors for malformed input, failed trust checks, stale revisions, and missing prerequisites.
- Catch at UI/process boundaries rather than suppressing errors in pure helpers.
- Expected remote failures are surfaced with operation context (relay/server/issue) and preserve resumable local state.
- Guard every async publish continuation before/after awaited signer and network boundaries.
- Use bounded retry only for transient network/5xx failures; signer identity errors and normal 4xx responses fail or move to the next provider.

**Error Types:**
- Domain-specific classes exist where policy differs (`SignerTimeoutError`, `SignerIdentityError`, `HttpError`).
- Pure selectors return `null`/empty sets for normal absence, but throw for invariant violations that would make publication unsafe.
- Top-level worker commands log fatal context and exit non-zero.

## Logging

**Framework:**
- Browser: `console.warn`/`console.error` at external boundaries plus visible React notices.
- Worker: `console.log`, `console.warn`, and `console.error` with command prefixes.
- Production collection is systemd/journald; no external logging SDK is present.

**Patterns:**
- Log event IDs, issue d-tags, server/relay origins, and state transitions when they enable verification.
- Never log signer capabilities, private keys, bunker URIs, client keys, passphrases, or authorization headers.
- A success message is not release proof unless the external result is independently fetched/read back.

## Comments

**When to Comment:**
- Explain threat models, retry policy, historical provider quirks, and why a guard must occur at a specific await boundary.
- Document protocol invariants and rejected simplifications near the code they protect.
- Avoid comments that merely restate ordinary React/TypeScript syntax.

**JSDoc/TSDoc:**
- Used selectively for exported helpers and security-sensitive behavior.
- Include behavior and invariants more often than exhaustive `@param` tags.

**TODO Comments:**
- Few TODO markers are used; backlog belongs in `.planning/REQUIREMENTS.md` and roadmap/docs rather than untracked comments.
- If a TODO is necessary, include the concrete missing behavior and affected boundary.

## Function Design

**Size:**
- Pure trust/state helpers are focused and small.
- Orchestration entry points such as `App.tsx`, `IssueTimeline.tsx`, `stitch.ts`, and `publish-rss.ts` are intentionally larger; extract policy into testable helpers instead of hiding control flow.

**Parameters:**
- Use explicit expected identities and `assertActive` callbacks on remote write helpers.
- Use dependency objects for testable state machines (`WatcherCycleDependencies`, release stage maps).
- Prefer options objects when multiple policy inputs travel together.

**Return Values:**
- Return typed result objects for partial external success (`UploadResult`, watcher outcomes).
- Use early guards for invalid or stale operations.
- Preserve committed remote outcomes even if a later UI capability is revoked; do not falsely report that an acknowledged side effect failed.

## Module Design

**Exports:**
- Named exports dominate reusable libraries and worker helpers.
- Default exports are used for top-level React components.
- Keep security-sensitive helpers centralized; do not duplicate NIP-19 normalization, signature verification, or revision ordering.

**Boundaries:**
- UI components call `lib/` helpers; trust rules do not live only in JSX.
- Worker pure selection/state modules are injected into CLI orchestration and tested without network/process side effects.
- Producer and consumer schema changes must update `SPEC.md`, both runtime surfaces, and tests together.

---

*Convention analysis: 2026-07-27*
*Update when patterns change*

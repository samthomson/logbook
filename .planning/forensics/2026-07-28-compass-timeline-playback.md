# Forensic Investigation: Compass Timeline Visibility and Note Playback

**Date:** 2026-07-28
**Code baseline:** `cbef051406a24037c9ef83c4829d6cb8b421b864`
**Scope:** Diagnosis only; no application, signer, relay, Blossom, or deployment changes.

## Outcome

Two separate behaviors reproduce and have distinct causes:

1. **Compass login is not filtering the section timeline.** The app stays on the explicitly selected issue across login/reload. Compass #31 currently contains only 9 verified recordings from one non-Compass author (the account shown to the user as Evolve); Compass #32 contains 3 verified recordings authored by Compass. A saved selection of #31 therefore continues to show Evolve recordings after Compass signs in.
2. **The "other contributors" strip is identity-relative.** `collectCommunityNotes` removes the active signer's own notes from that summary only. Complete section lists still render every valid recording for the selected issue.
3. **Per-note playback intentionally auto-advances through the whole issue.** `PlaybackProvider` owns one `Audio` element but constructs an issue-wide queue. Every `ended` or `error` event calls `advance()`, which starts the next segment. One click therefore drains the queue sequentially; it is not multiple concurrent media elements.

## GSD decisions

- Keep valid relay-backed recordings readable regardless of signer; authentication gates writes, not timeline reads.
- Keep timelines issue-scoped and preserve explicit saved issue selection; do not silently switch issues when identity changes.
- Clarify that "other contributors" is a signer-relative summary, not the complete timeline.
- A per-note play control should stop after the selected segment. Any future episode/playlist playback must be an explicit separate action.
- Preserve one shared `Audio` element so a second click replaces the current track.

## Live relay inventory

Queries used the application's configured relays, verified Compass issue path, and verified kind-4200 parser.

| Issue | Verified recordings | Authors | "Other contributors" signed in as Compass |
|------:|--------------------:|---------|------------------------------------------:|
| 31 | 9 | one non-Compass pubkey (`3c457108…`) | 9 |
| 32 | 3 | Compass (`775954f7…`) | 0 |

Issue #31's recordings include roots and replies; one root has multiple direct replies. Issue #32 has one Compass root and two replies. Authentication does not move or merge recordings across those issue IDs.

## Visibility trace

- `logbook-pwa/src/App.tsx:29-51` reads the saved issue number from local storage.
- `logbook-pwa/src/App.tsx:84-105` loads that saved issue first; latest-populated discovery is only the fallback when no saved issue is fetchable.
- `logbook-pwa/src/App.tsx:140-151` updates signer/pubkey state after login and does not replace the selected issue.
- `logbook-pwa/src/lib/community-notes.ts:9-18` excludes active-signer events only from the other-contributor summary.
- `logbook-pwa/src/components/IssueTimeline.tsx:361-378` renders that summary separately from the full target/section lists.

On a clean browser the app selected Compass #32, the newest populated issue. Selecting #31 persisted `logbook_selected_issue=31`. The reported "only Evolve" view is therefore explained by #31's live contents plus persistent issue selection, not by a Compass authorization filter suppressing its own events.

## Playback trace

- `logbook-pwa/src/lib/playback.tsx:4-6` describes an episode-wide queue with automatic advance.
- `logbook-pwa/src/lib/playback.tsx:59-69` creates one shared `Audio` instance.
- `logbook-pwa/src/lib/playback.tsx:104-116` finds the active ID in the full queue and starts the next item.
- `logbook-pwa/src/lib/playback.tsx:160-163` invokes `advance()` on both `ended` and `error`.
- `logbook-pwa/src/components/IssueTimeline.tsx:197-209` builds the queue from every recording target in the selected issue.

A controlled Chromium reproduction loaded Compass #31 with 9 rendered notes, replaced `Audio` with a deterministic test double, clicked the first note once, and emitted one `ended` event per start. Within 500 ms the app made **9 `play()` calls against 9 unique sources**. This directly proves one note click drains the issue-wide queue.

## Baseline validation

- `npm run test:unit`: **20 files, 95 tests passed** before any application change.
- Live browser: clean profile loaded Compass #32; episode picker listed #32 as current and #31 immediately below it.
- No application source, signer state, relays, media objects, or production deployment changed.

## Smallest fix plan

1. In `PlaybackProvider`, make `ended` and `error` clear the active track instead of calling `advance()`. Keep the shared `Audio` element and click-to-replace behavior.
2. Add regression coverage proving one click starts one source even after `ended`; an explicit second click may start another source.
3. Preserve issue-scoped reads and saved issue selection. Clarify current episode / other-contributor semantics in the UI instead of changing auth filters.
4. Validate unit tests, build, controlled browser reproduction, then real-device Compass login before deployment.

## Rejected explanations

- **Compass login hides valid section notes:** rejected; signer identity is not consulted by verified segment fetch or full section rendering.
- **Duplicate React keys or multiple audio elements cause concurrent sound:** rejected; segment IDs identify queue tracks and one shared `Audio` instance owns playback.
- **Reply threads intentionally scope playback:** rejected; reply metadata affects presentation/order while auto-advance traverses the complete issue queue.

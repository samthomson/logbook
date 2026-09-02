---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# Codebase Concerns

**Analysis Date:** 2026-07-27

## Tech Debt

**Static-host release handoff:**
- Issue: `scripts/publish-rss.ts` writes local feed/media state and verifies `LOGBOOK_FEED_READBACK_URL`, but the repository has no concrete deployer that uploads the static root.
- Files: `scripts/publish-rss.ts`, `scripts/static-sync.ts`, `deploy/systemd/logbook.env.example`.
- Impact: the release ledger correctly stops before Podstr/announcement/terminal manifest unless the configured hosted feed serves matching bytes; production upload is not autonomous or fully evidenced.
- Fix approach: implement a trusted host adapter that uploads and verifies HTTPS/ranges before the worker's digest read-back.

**Terminal manifest schema mismatch:**
- Issue: worker writes `publishedRss.feedUrl/mp3Url/publishedAt`, while `logbook-pwa/src/types/nostr.ts` retains an older `guid/chapters` shape.
- Files: `scripts/publish-rss.ts`, `logbook-pwa/src/types/nostr.ts`, `SPEC.md`.
- Impact: current PWA does not consume the field, but future release metadata UI could misparse terminal manifests.
- Fix approach: make the worker shape canonical in shared documentation/types and add producer/consumer regression fixtures before exposing it.

**Legacy static access-list fallback:**
- Issue: JSON/YAML contributor grants coexist with Compass-signed kind `34201` access lists.
- Files: `logbook-pwa/src/lib/whitelist.ts`, `logbook-pwa/public/data/`, `data/npubs.yml`.
- Impact: revocation requires removal from every source, and stale static grants can continue enabling recording.
- Fix approach: measure fallback use for the documented migration window, seed all required signed lists through the authorized Compass signer, then remove static grant logic and files.

**Legacy hot-key compatibility:**
- Issue: `scripts/config.ts::loadPrivateKey()` and `scripts/seed-whitelist.mts` can use `COMPASS_NSEC` outside the production worker path.
- Files: `scripts/config.ts`, `scripts/seed-whitelist.mts`.
- Impact: accidental operator use would weaken the remote-signer-only production boundary.
- Fix approach: migrate seeding to `scripts/amber-signer.ts`, remove `loadPrivateKey`, and keep secret-like environment names out of production examples.

**Duplicate cross-surface constants and schemas:**
- Issue: event kinds, relays, Blossom servers, and manifest types are defined separately in client and worker workspaces.
- Files: `logbook-pwa/src/config.ts`, `scripts/config.ts`, `logbook-pwa/src/types/nostr.ts`, worker-local interfaces.
- Impact: drift has already produced different Blossom ordering and the publishedRss mismatch; producers and consumers can disagree while each typechecks independently.
- Fix approach: add explicit parity tests or a build-time generated/shared protocol package without coupling browser and worker runtime concerns.

## Known Operational Gaps

**Canonical worker is not proven live:**
- Symptoms: repository artifacts and tests pass, but no current service status, signer preflight, restart recovery, or live journal evidence exists.
- Files: `deploy/systemd/logbook-worker.service`, `deploy/README.md`, `docs/operations-and-testing.md`.
- Trigger: attempting to treat local worker tests as production readiness.
- Workaround: none; install and verify on the trusted host before production release.

**Feed/media distribution is not proven:**
- Symptoms: local `feed.xml` can exist while public URL, byte ranges, read-back hashes, and podcast-client ingestion remain absent.
- Files: `scripts/publish-rss.ts`, `scripts/static-sync.ts`, `.planning/ROADMAP.md`.
- Root cause: external host adapter and production evidence are unfinished.

**nsite gateway propagation is inconsistent:**
- Symptoms: one gateway can serve current HTML while another serves stale or cross-cached HTML/assets.
- Files: `logbook-pwa/vite.config.ts`, `docs/operations-and-testing.md`.
- Workaround: verify all candidate gateways and share only one whose HTML and same-origin bundles match local bytes plus a release marker.

## Security Considerations

**Remote signer capability handling:**
- Risk: saved nbunksec/client-key material is a bearer signing capability even though it is not a raw nsec.
- Files: `logbook-pwa/src/lib/auth.ts`, `logbook-pwa/src/lib/session.ts`, `scripts/amber-signer.ts`.
- Current mitigation: browser session scoping, legacy-secret cleanup, external service-account files, expected-pubkey and signed-event verification.
- Recommendations: preserve tab-scoped storage, never print session material, and run signer preflight before any live side effect.

**Async principal revocation:**
- Risk: upload/sign/publish continuations can complete after logout, issue change, access revocation, or signer account switch.
- Files: `logbook-pwa/src/App.tsx`, `components/IssueTimeline.tsx`, `lib/latest-request.ts`, `lib/signer-identity.ts`, `lib/blossom.ts`.
- Current mitigation: parent and operation generations plus expected-pubkey checks around awaits.
- Recommendations: any new awaited boundary must thread `assertActive` and use the already captured identity; add stale-completion tests before refactors.

**Untrusted relay/blob input:**
- Risk: malicious relays can return forged events and event URLs can target arbitrary hosts/bytes.
- Files: `logbook-pwa/src/lib/relay.ts`, `lib/segment.ts`, `lib/blob-trust.ts`, `scripts/segment-security.ts`, `scripts/stitch-download.ts`.
- Current mitigation: local Schnorr/ID verification, pinned authors/tags, configured HTTPS origins, SHA-256 checks, and ffprobe validation.
- Recommendations: never replace these with relay filter trust or descriptor trust alone.

**Client-side whitelist is not privacy:**
- Risk: contributors or users may infer that access gating protects published media.
- Files: `SPEC.md`, `README.md`, `logbook-pwa/src/lib/whitelist.ts`.
- Current mitigation: documentation states Nostr events and Blossom blobs are public.
- Recommendations: keep authorization language distinct from confidentiality claims.

## Performance Bottlenecks

**Large mounted orchestration modules:**
- Problem: `App.tsx`, `IssueTimeline.tsx`, `AdminPanel.tsx`, `stitch.ts`, and `publish-rss.ts` carry broad control flow.
- Measurement: `App.tsx` is over 600 lines and `publish-rss.ts` over 500 lines in the mapped tree.
- Cause: many user/operational states meet at a few real entry points.
- Improvement path: continue extracting pure state machines and validation helpers while preserving explicit mounted/CLI control flow and regression tests.

**Relay/gateway latency and availability:**
- Problem: multiple relays and gateways can be stale or unavailable; a newest issue may have no segments.
- Files: `logbook-pwa/src/lib/compass.ts`, `lib/manifest-revision.ts`, `scripts/watch-state.ts`.
- Current mitigation: bounded batch queries, newest-populated issue selection, deterministic local ordering, caching, and multi-provider checks.
- Improvement path: add operator/user diagnostics without multiplying per-section relay subscriptions.

## Fragile Areas

**Recording publication lifecycle:**
- Why fragile: MediaRecorder events, IndexedDB draft writes, signer prompts, Blossom fallback, relay acknowledgement, logout, and issue navigation interleave.
- Files: `logbook-pwa/src/components/IssueTimeline.tsx`, `Recorder.tsx`, `InlineRecorder.tsx`, `lib/drafts.ts`, `lib/blossom.ts`.
- Common failures: silent early returns, lost pending UI, reused descriptors across principals, or stale callbacks mutating a replacement session.
- Safe modification: preserve an in-place pending bubble, owner-bound drafts, compound generations, expected-pubkey checks, and visible failure/resume actions.
- Test coverage: focused draft, signer, admin-revocation, and public-shell tests exist; real-device microphone/Amber still needs operational QA.

**Manifest and target derivation:**
- Why fragile: legacy section IDs and addressable event revisions outlive client releases.
- Files: `logbook-pwa/src/lib/admin-workspace.ts`, `scripts/issue-targets.ts`, manifest modules, `SPEC.md`.
- Common failures: omitted required chapters, wrong d-tag/issue-number conversions, trusting relay order, or editing a stale baseline.
- Safe modification: update both target implementations, keep deterministic tie-breaks, reconcile against the full newsletter, and test legacy fixtures.

**Release ledger semantics:**
- Why fragile: a local file write, child-process exit, completed relay attempts, relay acceptance, and independent fetch-back are different evidence strengths.
- Files: `scripts/release-state.ts`, `watch-runner.ts`, `publish-rss.ts`, `docs/operations-and-testing.md`.
- Common failures: marking terminal too early or duplicating already acknowledged external stages after restart.
- Safe modification: preserve exact revision/content-digest binding and stage-specific acknowledgement semantics.

## Scaling Limits

**Static client relay inventory:**
- Current pattern: one batched segment query per issue, grouped client-side.
- Limit: episode histories and profile/transcript enrichment will grow with contributor volume; no measured capacity threshold is documented.
- Symptoms at limit: slower initial timeline/admin loads and more relay variability.
- Scaling path: retain bounded batch queries, add pagination/caching based on measurement, and never regress to per-section subscriptions.

**Worker polling:**
- Current pattern: ten-minute polling and bounded child processes.
- Limit: one dedicated worker processes eligible manifests serially; no queue or multi-worker lease exists.
- Symptoms at limit: delayed releases or duplicate work if multiple uncoordinated workers run.
- Scaling path: keep single canonical worker until measured demand requires a durable lease/queue keyed by manifest revision.

## Dependencies at Risk

**Public relays/Blossom/nsite gateways:**
- Risk: independently operated services have inconsistent availability, caching, MIME policy, and retention.
- Impact: reads, uploads, and release proof can partially fail despite valid local code.
- Migration plan: multi-provider fallback, exact hash verification, bounded retries, and a trusted canonical feed/media host.

**Browser media support:**
- Risk: MediaRecorder/WebM/Opus and installed-PWA behavior differ by browser/OS release.
- Impact: automated desktop checks cannot prove Android Amber handoff or iOS microphone behavior.
- Migration plan: preserve feature detection and perform release-specific real-device QA; consider native clients only if measured PWA gaps remain material.

## Missing Critical Features

**Concrete static-host deployer:**
- Problem: no in-repo component uploads the feed to the configured hosted endpoint.
- Current workaround: an external/operator deployment followed by the worker's HTTP digest read-back.
- Blocks: autonomous terminal production release.
- Implementation complexity: medium; requires privileged host integration, read-back hashing, range checks, retries, and secret handling.

**Production operations evidence:**
- Problem: no complete staging and production episode has traversed every ledger stage on the canonical host with preserved evidence.
- Current workaround: local tests and dry runs only.
- Blocks: claiming the podcast pipeline is operational.
- Implementation complexity: operationally high because it spans signer, relays, Blossom, ffmpeg, static hosting, RSS validation, and clients.

## Test Coverage Gaps

**Real-device Amber/microphone/PWA update flow:**
- What's not tested: current release on physical Android/iOS devices, including return from Amber, mic permission, interrupted upload, wake lock, and installed update.
- Risk: the primary contributor path can regress despite desktop automation.
- Priority: high before terminal production release.
- Difficulty: requires devices, operator approval, and controlled identities.

**Canonical host and external distribution:**
- What's not tested: systemd health/restart, signer availability under the service account, hosted feed/media bytes/ranges, feed validator, and podcast-client ingestion.
- Risk: code-complete worker may not deliver a usable public episode.
- Priority: release blocker.
- Difficulty: requires production-like infrastructure and explicit side-effect authorization.

**No tracked CI workflow or coverage threshold:**
- What's not tested: automatic enforcement on every push/PR.
- Risk: required local checks can be skipped and trust regressions can merge.
- Priority: medium after production operations are closed.
- Difficulty: straightforward mechanically, but live tests and signer/media boundaries must remain separated from unprivileged CI.

---

*Concerns audit: 2026-07-27*
*Update as issues are fixed or new ones discovered*

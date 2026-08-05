# Logbook engineering backlog

This is the prioritized operating backlog for moving Logbook from a tested PWA and locally tested worker to a continuously maintained, evidence-backed production service. Checkboxes record verified outcomes, not intentions. Live signing, relay publication, Blossom upload, feed promotion, and production deployment require the authorization and evidence gates in `operations-and-testing.md`.

## P0 — establish the delivery system

- [x] Keep nGit as the single source of truth and run automation locally on Hermes/StartOS.
- [ ] Add a durable local maintenance schedule with failure reporting and overlap prevention.
- [ ] Protect local release operations with explicit approval and no self-triggered production publication.
- [ ] Add an ownership file for PWA, worker, protocol, deployment, and release-sensitive paths.
- [ ] Define severity, response-time, rollback, and incident-owner expectations.
- [ ] Reconcile the documented release commit with the bytes currently served by `nsite.lol`.
- [x] Make every PWA build include a non-secret commit-bound release identifier and consistency test.
- [ ] Archive build hashes, nsite manifest event, gateway read-back hashes, and smoke results per release.

## P0 — canonical worker and signer safety

- [ ] Provision the dedicated `logbook` account on the canonical trusted Linux host.
- [ ] Install the reviewed checkout at `/opt/logbook`.
- [ ] Install exact lockfile dependencies with Node 24 LTS or the documented supported Node release.
- [ ] Install and verify ffmpeg, ffprobe, and the configured `nak` diagnostic binary.
- [ ] Install the hardened systemd unit and public-only environment file.
- [ ] Confirm signer files are owned by `logbook:logbook` and mode `0600`.
- [ ] Add a local-only signer preflight that proves the expected Compass pubkey without publishing.
- [ ] Make signer mismatch fail before network, filesystem publication, or Blossom side effects.
- [ ] Confirm systemd writable paths are limited to state, cache, and public artifacts.
- [ ] Confirm service restart limits, startup timeouts, stop behavior, and log retention.
- [ ] Capture `systemd-analyze security` output and remediate material findings.
- [ ] Prove the service starts, polls, and exits/restarts predictably without publishing.
- [ ] Add a watchdog or external health check for stalled polling.
- [ ] Alert on repeated signer failures, release failures, or crash loops.

## P0 — public hosting and release integrity

- [ ] Choose the canonical HTTPS feed and media host.
- [ ] Implement a static-host adapter instead of manually fabricating `LOGBOOK_STATIC_SYNC_ACK`.
- [ ] Bind every hosting acknowledgement to local path, URL, SHA-256, size, and timestamp.
- [ ] Fetch hosted bytes independently before acknowledging a deployment.
- [ ] Verify `Content-Type`, `Content-Length`, caching, and HTTPS policy.
- [ ] Verify byte-range requests for every published audio file.
- [ ] Fail closed on stale, missing, truncated, redirected-to-untrusted, or hash-mismatched artifacts.
- [ ] Preserve deployment receipts alongside the release ledger.
- [ ] Ensure a failed host synchronization resumes without regenerating or republishing prior stages.
- [ ] Test rollback to the preceding feed and static release.
- [ ] Document recovery when the feed host, relays, Blossom, or signer is unavailable.

## P0 — staging and first terminal release

- [ ] Create an unmistakably non-production staging issue and fixture recordings.
- [ ] Run verified manifest selection and Compass curation against staging.
- [ ] Interrupt stitch and verify restart remains bound to the same cutting revision.
- [ ] Interrupt each release stage and verify only incomplete stages retry.
- [ ] Confirm MP3 duration, chapters, transcript, and metadata.
- [ ] Deploy staging feed/media and verify exact public bytes and ranges.
- [ ] Publish and fetch back staging Podstr and announcement events.
- [ ] Publish and fetch back the staging terminal manifest.
- [ ] Test Amber login/restore, microphone recording, retry, reload, and playback on physical Android.
- [ ] Verify another identity cannot resume the first identity's local draft.
- [ ] Subscribe from at least one real podcast client and play the staged episode.
- [ ] Preserve all event IDs, hashes, URLs, acknowledgements, screenshots, and device/client versions.
- [ ] Obtain explicit release approval for the first production episode.
- [ ] Repeat the evidenced flow for production and record propagation gaps honestly.

## P1 — local quality and supply-chain security

- [x] Make `tools/verify-all.sh` the canonical local validation entry point.
- [ ] Run the local validation gate before every commit, push, and deployment.
- [ ] Schedule weekly local verification to detect ecosystem drift.
- [ ] Retain local maintenance and dependency-drift reports.
- [ ] Add lockfile-diff dependency review to the local update process.
- [ ] Add Software Bill of Materials generation for PWA and worker releases.
- [ ] Add local artifact provenance and signed receipts where the deployment host supports verification.
- [ ] Verify release deployment consumes the exact locally approved artifact.
- [ ] Add license-policy checks for production dependencies.
- [ ] Add malicious-package and install-script review guidance.
- [ ] Keep production dependency audits at zero high/critical findings.
- [ ] Define a documented exception process with owner and expiration date.
- [ ] Add reproducibility checks for consecutive clean PWA builds.

## P1 — automated testing depth

- [ ] Add shared fixtures for valid, malformed, forged, stale, and conflicting Nostr events.
- [ ] Fuzz event/tag/manifest parsers with bounded inputs.
- [ ] Property-test deterministic event revision selection.
- [ ] Test relay duplication, reordering, timeouts, partial failure, and malicious data.
- [ ] Test Blossom redirects, oversized bodies, wrong MIME types, and slow streams.
- [ ] Test stitch cancellation and subprocess timeout cleanup.
- [ ] Test corrupted, zero-length, extreme-duration, and unsupported audio.
- [ ] Test RSS/XML escaping with adversarial contributor metadata.
- [ ] Validate feeds with an independent Podcasting 2.0 validator.
- [ ] Test release-ledger crash recovery at every write boundary.
- [ ] Test concurrent watcher instances cannot publish duplicate stages.
- [ ] Add browser tests for storage quota exhaustion and IndexedDB failures.
- [ ] Add browser tests for revoked access during recording and upload.
- [ ] Add browser tests for signer disconnect and delayed relay acknowledgement.
- [ ] Add accessibility automation and keyboard-only flows.
- [ ] Add supported-browser/device matrix tests.
- [ ] Add visual regression checks for narrow mobile layouts.
- [ ] Track flaky tests and prohibit blind retries that conceal failures.

## P1 — observability and operations

- [ ] Emit structured JSON logs with stable event names and no sensitive payloads.
- [ ] Add correlation IDs for issue, manifest revision, stitch run, and release stage.
- [ ] Record poll duration, selected issues, stage duration, and failure class.
- [ ] Export health, last-successful-poll, queue depth, and release-stage metrics.
- [ ] Alert on worker absence, stale polling, error-rate spikes, and disk exhaustion.
- [ ] Monitor public PWA, feed, latest media, and range responses externally.
- [ ] Add synthetic read-only relay and Blossom checks.
- [ ] Define service-level objectives for availability and release completion.
- [ ] Set log and artifact retention policies.
- [ ] Back up release ledgers and receipts; perform a restore drill.
- [ ] Create concise runbooks for signer, host, relay, Blossom, disk, and corrupt-state incidents.
- [ ] Maintain an incident timeline template and blameless review process.

## P1 — deployment engineering

- [x] Separate the immutable release-candidate build from future protected deployment and verification jobs.
- [ ] Ensure deployments are serialized per environment.
- [ ] Prevent unreviewed repository code from accessing production credentials.
- [ ] Keep Compass signing isolated to the authorized local NIP-46 session.
- [ ] Produce immutable, content-addressed deployment bundles.
- [ ] Run a post-deploy browser smoke test against the public URL.
- [x] Add a deploy verifier that compares public HTML, referenced JS/CSS, manifest, service worker, and release metadata to the release bundle.
- [ ] Verify a release-specific marker before calling deployment successful.
- [ ] Automate rollback when verification fails before propagation is accepted.
- [ ] Preserve the last known-good PWA bundle and manifest receipt.
- [ ] Exercise rollback in staging at least quarterly.

## P2 — codebase maintainability

- [ ] Reconcile `publishedRss` types between PWA and worker.
- [ ] Generate or share canonical event schemas across both packages.
- [ ] Add runtime schema validation at every network and disk boundary.
- [ ] Remove the legacy static whitelist after the documented observation window.
- [ ] Remove the legacy hot-key seeder after NIP-46 operational proof.
- [ ] Decide and document the NIP-22 reply-tag migration.
- [ ] Split oversized modules along trust and side-effect boundaries.
- [ ] Inject clocks, network clients, filesystems, and command runners for deterministic tests.
- [ ] Standardize error classes and operator-facing remediation text.
- [ ] Add architecture decision records for signer, hosting, identity, and protocol changes.
- [ ] Set a supported Node/npm/browser policy and upgrade cadence.
- [ ] Add dead-code and unused-dependency checks.
- [ ] Keep generated outputs out of version control unless they are deliberate release evidence.

## P2 — product quality and privacy

- [ ] Publish a clear explanation that contributor authorization is not blob confidentiality.
- [ ] Review consent and permanence language before recording/upload.
- [ ] Provide accessible recovery guidance for failed or pending publication.
- [ ] Make public/private/staging identity and issue state visually unmistakable.
- [ ] Verify screen-reader labels and focus order for recording and curation.
- [ ] Test reduced motion, high contrast, zoom, and large text.
- [ ] Define retention and deletion expectations for local drafts and caches.
- [ ] Add user-controlled local-data cleanup.
- [ ] Measure Core Web Vitals and recording-start latency on target devices.
- [ ] Establish performance budgets for JS, CSS, precache, startup, and memory.
- [ ] Defer transcription until security, privacy, size, memory, and latency gates pass.
- [ ] Conduct a threat-model review before voice anonymization or payment splits.

## Recurring cadence

- [ ] On every change: run secret scan, tests, lint, build, audits, and diff checks.
- [ ] Weekly: inspect local maintenance results, dependency drift, vulnerabilities, uptime, and open P0/P1 items.
- [ ] Monthly: update dependencies, review permissions/actions, restore a backup, and review operational alerts.
- [ ] Quarterly: run staging release, restart/recovery drill, rollback drill, physical-device QA, and threat-model review.
- [ ] Per release: approve immutable inputs, deploy once, verify public bytes/events independently, and archive evidence.
- [ ] After incidents: remediate root causes, add regression tests, update runbooks, and review alert coverage.

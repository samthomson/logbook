---
last_mapped_commit: 93cb11b31fd03332a9a9854fa102c9c5e211b685
---

# External Integrations

**Analysis Date:** 2026-07-27

## APIs & External Services

**Nostr relays:**
- Relays come from `RELAYS` / `DISCOVERY_RELAYS` in `.env`. Discovery example: `wss://nos.lol`, `wss://relay.ditto.pub`, `wss://relay.primal.net`.
- Used for Compass kind `30023` newsletters, kind `4200` voice segments, kind `1111` transcripts, kind `34200` manifests, kind `34201` access lists, and release events.
- Client/worker pin trusted authors, verify signatures locally, validate d-tags, and select replaceable revisions deterministically.
- Writes require relay acknowledgement for trusted terminal paths; `scripts/publish-rss.ts` currently treats the kind `1` announcement more weakly via completed relay attempts.

**Blossom servers:**
- Defaults: `blossom.ditto.pub`, `blossom.band`, and `blossom.oxtr.dev`.
- Browser upload path in `logbook-pwa/src/lib/blossom.ts` signs fresh kind `24242` authorization per attempt, verifies returned descriptors, and mirrors after primary success.
- Worker reconstructs only configured HTTPS origins and verifies content bytes and audio streams before stitching.
- Per-server behavior differs: ditto is the normal browser primary; oxtr is mirror-only in the client; MIME-sniffing failures are handled by fallback.

**Compass newsletter source:**
- Nostr kind `30023`, authored by `COMPASS_PUBKEY` and fetched through relay filters in `logbook-pwa/src/lib/compass.ts` and worker code.
- H2/H3 content is projected into stable recording targets independently by client and worker implementations.

**Podcast ecosystem:**
- `scripts/publish-rss.ts` emits Podcasting 2.0 RSS, chapters, transcript metadata, a kind `30054` Podstr episode, a kind `1` announcement, and a terminal kind `34200` manifest revision.
- Public feed/media origin defaults to `https://podcast.nostrcompass.org` but remains an operational integration gate until deployment and read-back are proven.

**nsyte/nsite:**
- Static PWA deployment under the Compass signing identity.
- Public gateways are untrusted caches; release evidence requires same-gateway HTML and exact referenced asset hashes plus a change marker.

## Data Storage

**Nostr state:**
- Relays hold signed immutable and addressable events; there is no proprietary application database.
- Trust comes from event ID/signature, pinned authorship, tag/content validation, and deterministic revision ordering rather than relay order.

**Blossom files:**
- Content-addressed contributor audio, stitched media, chapters, and optional transcripts.
- Every accepted URL is rebuilt or validated against configured HTTPS origins and expected SHA-256.

**Browser storage:**
- IndexedDB stores owner- and issue-bound audio drafts via `logbook-pwa/src/lib/drafts.ts`.
- localStorage stores non-secret selected-issue and extension markers.
- sessionStorage may hold revocable nbunksec session material for reload restoration; nsec/ncryptsec inputs remain memory-only.

**Worker filesystem:**
- `LOGBOOK_STATIC_DIR` stores feed state, release ledgers, and hosted artifacts.
- `LOGBOOK_AUDIO_DIR` stores stitched media, chapters, and exact manifest-bound run metadata.
- systemd grants writes only to `/var/www/logbook`, `/var/lib/logbook`, and `/var/cache/logbook`.

## Authentication & Identity

**Contributor identity:**
- Amber one-tap and bunker sessions use NIP-46 through applesauce-signers in `logbook-pwa/src/lib/auth.ts`.
- NIP-07 extension and advanced nsec/ncryptsec compatibility paths are also implemented.
- Every async write binds an expected pubkey and revocable capability generation before signer/network side effects.

**Compass production identity:**
- `scripts/amber-signer.ts` invokes `nak event --connect-as` against the authorized session under `~/.config/compass-publish/`.
- Returned pubkey, event ID, and Schnorr signature are verified before publication.
- `scripts/config.ts::loadPrivateKey()` is legacy/manual compatibility only and must not be used by the production service.

## Monitoring & Observability

**Logs:**
- PWA uses user-visible notices plus targeted `console.warn`/`console.error` at network boundaries.
- Worker uses prefixed stdout/stderr messages such as `[watch-compass]`, `[stitch]`, and `[publish-rss]`; systemd/journald is the production log sink.
- No hosted error tracking, metrics, or analytics service is integrated.

**Release evidence:**
- Durable JSON run metadata and release ledger files bind stages to the exact manifest revision and artifact hashes.
- External success must be independently fetched/read back; a child-process exit or local feed write is not terminal proof.

## CI/CD & Deployment

**Hosting:**
- PWA: manual/operator-authorized nsyte deployment and multi-gateway byte verification.
- Worker: hardened systemd unit at `deploy/systemd/logbook-worker.service`.
- Feed/media: external static host integration is not yet concrete; `LOGBOOK_STATIC_SYNC_ACK` is the current handoff contract.

**CI Pipeline:**
- No tracked GitHub Actions workflow was found.
- Required checks are documented in `AGENTS.md` and `docs/operations-and-testing.md` and run locally before merge/deploy.

## Environment Configuration

**Development:**
- No credentials are required for pure unit tests.
- Browser QA uses disposable Chromium profiles; live write tests require explicit authorization.
- Native worker integration requires `ffmpeg` and `ffprobe`.

**Production:**
- Public variables are listed in `deploy/systemd/logbook.env.example`.
- Authorized NIP-46 files live outside the repository under the service account home.
- Feed/media hosting must return an exact digest acknowledgement before later release stages resume.

## Webhooks & Callbacks

**Incoming:**
- None; the PWA is static and the worker polls relays every ten minutes.

**Outgoing:**
- WebSocket relay queries/publications and HTTPS Blossom upload/mirror/download requests.
- Static-host upload is an external operator/deployer boundary, not implemented as a webhook or in-repo adapter.

---

*Integration audit: 2026-07-27*
*Update when adding or removing external services*

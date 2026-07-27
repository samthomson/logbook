# Requirements: Logbook Production Operations

**Defined:** 2026-07-27
**Core Value:** A contributor can leave a durable voice reaction under the correct Compass newsletter item without joining a live call, while the editor retains deterministic control over the final episode.

## v1 Requirements

Requirements for the production-operations milestone. The implemented PWA and worker are the validated brownfield baseline; these requirements cover the unproven live path.

### Trusted Worker

- [ ] **OPS-01**: Operator can install and run the tracked Logbook worker under the dedicated `logbook` account on the canonical host, with the hardened systemd unit reporting healthy service state
- [ ] **OPS-02**: Operator can verify before side effects that the worker's authorized NIP-46 signer resolves to the canonical Compass pubkey from the service account
- [ ] **OPS-03**: Operator can restart the worker during a staged release and observe it resume from the durable ledger without duplicating already acknowledged stages

### Public Hosting

- [ ] **HOST-01**: Operator can deploy the generated feed/media artifacts to the configured public HTTPS origin and receive an acknowledgement bound to the exact local feed SHA-256
- [ ] **HOST-02**: Listener can fetch the public feed and episode media over HTTPS, with exact read-back hashes and working byte-range responses

### Staging Validation

- [ ] **REL-01**: Operator can run one staging issue through verified manifest selection, stitch, hosted-feed acknowledgement, Podstr, announcement, and terminal manifest publication with preserved evidence
- [ ] **QA-01**: Authorized contributor can use Amber on a supported physical device to restore/sign in, record microphone audio, publish it, reload, and play the resulting note without losing the draft or identity

### Production Release

- [ ] **REL-02**: Operator can run one production issue through terminal publication and preserve the manifest revision, artifact hashes, public URLs, event IDs, and relay acknowledgements
- [ ] **DIST-01**: Listener can subscribe to the public feed in at least one podcast client and play the production episode from the published media URL

## v2 Requirements

Deferred until the production-operations milestone is complete.

### Access Migration

- **WL-06**: Operator can prove 30 days without required legacy fallback grants and remove the static whitelist JSON/YAML authorization path
- **WL-07**: Operator can seed or repair Compass access lists only through the authorized NIP-46 signer; the legacy `COMPASS_NSEC` helper is removed

### Schema and Protocol

- **SCHEMA-01**: PWA and worker share the canonical terminal `publishedRss` shape before release metadata is exposed in the client
- **THREAD-01**: Product owner can decide whether additive NIP-22-style reply tags provide enough interoperability value to justify migration

### Product Enhancements

- **TRANS-01**: Contributor can use browser or approved server transcription only after zero-high security, privacy, memory, latency, and precache gates pass
- **SEARCH-01**: Listener can search trusted transcripts and view section summaries
- **ANON-01**: Contributor can apply a reviewed strong voice-anonymization mode before publication
- **VALUE-01**: Released episodes can use Lightning splits derived from explicit validated payment destinations
- **NATIVE-01**: Contributor can use a native client only if measured PWA capability gaps justify its maintenance cost

## Out of Scope

| Feature | Reason |
|---------|--------|
| Centralized app backend for the discussion loop | Signed Nostr state and Blossom blobs are the product architecture |
| In-browser ffmpeg stitching | Canonical media assembly belongs on the trusted native worker |
| Private voice blobs enforced by the whitelist | Client-side authorization cannot provide confidentiality for public Nostr/Blossom data |
| Hot production nsec in service configuration | Compass writes must use the revocable authorized NIP-46 session |
| Live rooms or synchronous calls | Logbook is an asynchronous contribution workflow |
| Browser transcription in this milestone | Production operations and terminal release evidence are higher priority; previous browser stack was removed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 2 | Pending |
| OPS-03 | Phase 2 | Pending |
| HOST-01 | Phase 3 | Pending |
| HOST-02 | Phase 3 | Pending |
| REL-01 | Phase 4 | Pending |
| QA-01 | Phase 4 | Pending |
| REL-02 | Phase 5 | Pending |
| DIST-01 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-27*
*Last updated: 2026-07-27 after GSD brownfield import*

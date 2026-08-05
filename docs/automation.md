# Local automation and continuous improvement

## Operating model

Logbook automation runs on the Hermes/StartOS workspace, not GitHub. There is no GitHub mirror, Dependabot configuration, CodeQL workflow, or hosted deployment workflow.

The canonical validation contract is:

```sh
cd /opt/data/logbook
./tools/verify-all.sh
```

It scans tracked and commit-eligible files for concrete signer material, runs tool-level deployment-verifier tests, PWA unit and browser tests, lint, production build and performance checks, worker typecheck and tests, production dependency audits, and Git whitespace validation.

The local improvement loop is:

1. Inspect dependency drift and repository/runtime health.
2. Select the highest-priority unblocked backlog item.
3. Reproduce defects with a regression test where possible.
4. Implement the narrowest complete fix.
5. Run the canonical validation contract.
6. Commit only reviewed task-owned files and push through the authorized Compass signer.
7. Build a commit-bound PWA candidate and SHA-256 inventory.
8. Deploy only through the canonical Compass identity.
9. Independently verify gateway bytes and preserve the receipt.

This keeps the useful Towards Liberty pattern—one mandatory secret/type/test gate—while adding Logbook's browser QA, native media integration, dependency auditing, release identity, and byte-verification requirements.

## Local maintenance cadence

The durable Hermes goal and local scheduler own recurring work. A maintenance run should:

- run `./tools/verify-all.sh`;
- record `npm outdated --json` for `logbook-pwa/` and `scripts/`;
- inspect production audit results and the known warning inventory;
- verify the public PWA endpoint and compare its release marker with the expected release;
- select and advance one P0/P1 item from `engineering-backlog.md`;
- start its report with `✅` when no user action is needed or `⚠️` followed by the exact required action;
- never publish, deploy, or sign merely because a schedule fired.

## Release candidate and deployment

Build from a reviewed commit with an explicit identifier:

```sh
cd /opt/data/logbook/logbook-pwa
LOGBOOK_RELEASE_ID="$(git rev-parse HEAD)" npm run build
```

Archive the exact `dist/` directory, `git rev-parse HEAD`, and a sorted SHA-256 inventory. Do not rebuild between approval and deployment.

After an authorized nsite deployment, verify the public gateway against that exact candidate:

```sh
cd /opt/data/logbook
node tools/verify-pwa-deployment.mjs <gateway-url> <candidate-dist>
```

Preserve the JSON receipt with the commit, nsite manifest event, relay acknowledgements, deployment inventory, and rollback bundle. A successful command exit without public read-back is not deployment evidence.

## Deployment safety boundary

Production deployment requires:

- explicit release approval;
- the canonical Compass NIP-46 identity, never a substitute signer;
- no raw nsec, ncryptsec, bunker URI, client key, or passphrase in arguments, logs, artifacts, or repository files;
- deployment of the exact approved candidate without rebuilding;
- reviewed nsyte validation and scan results bound to the artifact inventory;
- independent read-back of HTML, release metadata, every referenced JS/CSS file, web manifest, registration script, and service worker;
- exact SHA-256 agreement and a commit-specific release marker;
- preserved manifest event, relay acknowledgements, gateway evidence, and rollback bundle.

The worker/feed release has an additional boundary because it publishes media and Compass-authored Nostr events. It must remain resumable and digest-bound. Generic watcher success logs are never terminal publication evidence.

## Cadence

- Every change: full local validation.
- Weekly: dependency drift, vulnerabilities, public endpoint, runtime health, and P0/P1 triage.
- Monthly: dependency upgrades, backup restore, permission review, and alert review.
- Quarterly: staging release, worker restart/resume drill, PWA rollback drill, physical-device QA, and threat-model review.
- Every release: immutable build, approval, deploy exact artifact, independent verification, and evidence archive.

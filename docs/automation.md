# Automation and continuous improvement

## Operating model

Logbook uses one validation contract everywhere: `./tools/verify-all.sh`. It scans tracked files for concrete signer material, runs PWA unit and browser tests, lint, production build and performance checks, worker typecheck and tests, production dependency audits, and Git whitespace validation.

The automated loop is:

1. Dependabot proposes grouped dependency and GitHub Actions updates.
2. Push and pull-request validation reject regressions.
3. CodeQL performs semantic JavaScript/TypeScript analysis.
4. Weekly maintenance reruns the complete suite and archives dependency-drift reports.
5. A tag or manual dispatch builds an immutable PWA release candidate with a public commit marker and SHA-256 inventory.
6. Production deployment remains protected until the canonical Compass signer and exact gateway-byte verification are available.
7. Observed failures become prioritized work in `engineering-backlog.md`; fixes must add regression evidence where applicable.

This follows the useful part of the Towards Liberty pattern—one mandatory secret/type/test gate—while adding browser QA, native media integration, dependency auditing, scheduled drift checks, release inventories, and explicit deployment boundaries needed by Logbook.

## Activation blocker

The canonical Git remote is currently an nGit URL on `relay.ngit.dev`. GitHub does not execute `.github/workflows` from that remote. To activate hosted automation, establish either:

- a one-way GitHub mirror whose protected `master` is synchronized from the canonical repository; or
- another trusted runner that implements the same workflow contract.

Do not create two writable sources of truth. Document mirror ownership, synchronization direction, failure alerting, and recovery. Until then, the same validation is executable locally and by Hermes, but scheduled GitHub jobs and Dependabot are configuration-ready rather than active.

## Deployment safety boundary

`release-candidate.yml` automatically produces the deployable bytes and their hashes. It does not publish them. After an authorized deployment, run `node tools/verify-pwa-deployment.mjs <gateway-url> <candidate-dist>` and preserve its JSON receipt. Production deployment needs all of the following:

- a protected production environment and explicit approval;
- the canonical Compass NIP-46 identity, never a substitute signer;
- no raw nsec, ncryptsec, bunker URI, client key, or passphrase in CI variables, logs, arguments, or artifacts;
- deployment of the exact candidate artifact, without rebuilding;
- nsyte validation and reviewed scan results bound to the artifact inventory;
- independent read-back of HTML and every referenced JS/CSS/service-worker asset;
- exact SHA-256 agreement and a release-specific commit marker;
- preserved manifest event, relay acknowledgements, gateway evidence, and rollback bundle.

The worker/feed release has an additional approval boundary because it publishes media and Compass-authored Nostr events. It must remain resumable and digest-bound; a generic successful process exit is not release evidence.

## Repository-host settings

Once a GitHub mirror exists:

1. Enable dependency graph, Dependabot alerts, security updates, secret scanning, and push protection.
2. Protect `master` and require validation plus CodeQL.
3. Disallow force pushes and branch deletion.
4. Create a protected `production` environment with required review and no self-review.
5. Restrict deployment to reviewed tags or the protected branch.
6. Review workflow permissions and pin third-party actions to full commit SHAs.
7. Add dependency review and artifact attestations if supported by the repository plan.

GitHub documents grouped automated dependency updates, semantic code scanning, push protection, and deployment environments with reviewer/branch gates. These controls complement rather than replace Logbook's own signer and public-byte verification.

## Cadence

- Every change: full validation.
- Weekly: scheduled validation, dependency drift, vulnerabilities, uptime, and P0/P1 backlog triage.
- Monthly: dependency upgrades, CI permission/action review, backup restore, and alert review.
- Quarterly: staging release, worker restart/resume drill, PWA rollback drill, device QA, and threat-model review.
- Every release: immutable build, approval, deploy exact artifact, independent verification, evidence archive.

## References

- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub Dependabot version updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)
- [GitHub Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)
- [GitHub CodeQL documentation](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql)

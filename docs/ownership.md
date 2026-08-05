# Logbook ownership and approval boundaries

This file assigns responsibilities to roles rather than particular people. The operator must map each role to a current human before production use. Being able to edit a path does not grant authority to sign, deploy, or publish.

| Surface | Owned paths | Responsible role | Required review or approval |
|---|---|---|---|
| PWA product and browser behavior | `logbook-pwa/src/`, `logbook-pwa/public/`, `logbook-pwa/scripts/`, `logbook-pwa/vite.config.ts` | PWA owner | PWA owner review; protocol/security owner review when event parsing, auth, storage, upload, or trust behavior changes |
| Nostr protocol and trust rules | `SPEC.md`, shared event types, parsers, signature verification, revision selection | Protocol/security owner | Protocol/security owner review plus executable tests; Compass authority approval before changing production wire formats |
| Trusted worker and media pipeline | `scripts/` except package-only maintenance | Worker owner | Worker owner review; protocol/security owner review for signer, relay, Blossom, manifest, or publication changes |
| Deployment and service hardening | `deploy/`, `.nsite/`, deployment tooling, release-verification tooling | Deployment owner | Deployment owner and protocol/security owner review |
| Operations and release evidence | `docs/operations-and-testing.md`, release ledgers, inventories, receipts, rollback bundles | Release operator | Release operator records evidence; deployment owner verifies artifact identity and public read-back |
| Product scope and roadmap | `README.md`, `PLAN.md`, `.planning/`, `docs/engineering-backlog.md` | Product owner | Product owner review; affected technical owner review when status or guarantees change |
| Dependency and build policy | package manifests, lockfiles, build configuration, local validation tooling | Maintenance owner | Affected technical owner review and the complete local validation gate |

## Release-sensitive changes

The following always require two-role review: the responsible technical owner and either the protocol/security owner or deployment owner, as applicable.

- signer construction, signer storage, or requested NIP-46 permissions;
- `COMPASS_PUBKEY`, relay, Blossom, feed, media, or nsite identity configuration;
- event signature verification, author pinning, deterministic revision selection, or media hash/origin checks;
- manifest locking, stitch inputs, release-ledger transitions, RSS promotion, or terminal publication;
- service sandboxing, writable paths, deployment commands, scan overrides, or gateway verification;
- any exception to a security, dependency, or release gate.

No reviewer may approve an exception they authored alone. Exceptions must identify an owner, scope, compensating control, and expiration date.

## Production authority

Repository ownership is separate from production authority:

- only the operator-authorized Compass NIP-46 identity may create Compass-authored events or the canonical nsite manifest;
- only the release operator may authorize a production deployment or episode publication;
- scheduled maintenance may validate and report, but must not sign, deploy, upload, or publish automatically;
- a failed or incomplete external acknowledgement is a blocked release, never implied approval to use another identity or bypass a gate.

## Handoff requirements

Before a role changes hands, record the new human owner through the team’s private operator channel and review open incidents, exceptions, release candidates, rollback artifacts, and signer/session availability. Do not record private signer material in the handoff.

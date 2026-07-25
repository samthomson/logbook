# Logbook Operations and Test Runbook

## Security posture and local transcription

Browser-side transcription is **disabled by default**. Enable it only in a controlled test build:

```bash
VITE_ENABLE_LOCAL_TRANSCRIPTION=true npm run dev -- --host 127.0.0.1
```

Reason: `@huggingface/transformers` removed the earlier critical dependency path, but its current npm package still has four no-fix high audit findings through Node-oriented `onnxruntime-node`/`adm-zip` and `sharp`. The PWA uses Web/WASM inference, but the package manager still installs and audits those dependencies. Do not reintroduce `@xenova/transformers`: its previous dependency chain had a critical vulnerability.

Before enabling transcription for production, require all of:

1. A zero-high browser-only dependency path, or an approved server-side transcription alternative.
2. Android and desktop measurements for first download, memory pressure, transcription latency, and offline failure behavior.
3. A bundle audit confirming large model/WASM assets are runtime-loaded, not part of the service-worker precache.
4. A reviewed threat-model update for audio sent to any external transcription service, if one is selected.

## Contributor test using the public test identity

Test nsec:

```text
[Use the test nsec supplied in the secure team chat; do not copy it into this repository.]
```

1. Start the PWA locally:
   ```bash
   cd /home/vibe/logbook/logbook-pwa
   npm run dev -- --host 127.0.0.1
   ```
2. Open the localhost URL in a browser. Use localhost for microphone permissions.
3. Use **Advanced → nsec** and enter the test nsec. Never put it in shell history, `.env`, a commit, or screenshots.
4. Hard-refresh. The login must clear: raw nsec/bunker/passphrase values are intentionally memory-only.
5. Add this identity only to a dedicated test issue's signed whitelist. Do not relax whitelist code or modify a production issue to test it.
6. Record a 3–10 second non-sensitive sample. Verify upload, kind-4200 publication, reload persistence, section/reply placement, and playback.
7. Disable networking after recording a second sample, stop it, restore networking, then retry. Confirm the already uploaded descriptor is reused and only one segment is published.
8. With `VITE_ENABLE_LOCAL_TRANSCRIPTION=true`, repeat once and verify transcript publication separately.

The test nsec is **not** a Compass signer. Do not run `watch`, `stitch`, `publish-rss`, or `transcribe-missing` with it. The scripts reject a key that does not derive the configured Compass pubkey.

## Privileged staging release test

Run only from the secure Compass service environment with the real Compass signing key already provisioned there.

1. Create a dedicated staging issue and static output root; do not point first tests at the production RSS feed.
2. Start `npm run watch`. Verify startup recognizes valid Compass issues and backfills exactly one missing manifest per issue.
3. Review the manifest in the admin UI, lock a staging episode, then run `npm run stitch -- --issue <staging-issue>`.
4. Confirm every input clip was fetched only from configured HTTPS Blossom origins and hash validated. Probe the output MP3 with `ffprobe`.
5. Run `npm run rss -- --issue <staging-issue>` and validate XML in a feed validator plus a podcast client.
6. Confirm the feed, audio, chapters, transcript URL, kind-30054 record, and publication note all point to the staging origin.
7. Preserve command output, event IDs, checksums, and feed URL as release evidence. Promote to production only after a separate review.

## Release stage recovery and status semantics

`stitch.ts` binds `<issue>-run.json` to the exact verified cutting manifest:
its event ID, `created_at`, `d` tag, and SHA-256 of the manifest content. `publish-rss.ts`
rejects a run if any of those values differ from the latest verified revision. Do **not**
edit a run file to bypass this check; re-stitch the current locked revision instead.

Publication is durable in `<STATIC_DIR>/<issue>-release-ledger.json`. Its stages are:

1. `artifacts` — the hash-bound stitch artifact is present;
2. `feed` — the static host has explicitly acknowledged the exact feed SHA-256;
3. `podstr` — kind `30054` was acknowledged;
4. `announcement` — required NIP-73 kind `1111` announcement was acknowledged; and
5. `manifest` — and only then the manifest is republished as terminal `published`.

Retries resume at the first incomplete stage; acknowledged stages are not repeated. Before
every stage the script refetches and signature-verifies the latest manifest and stops if it
is not the exact cut bound to the run. A ledger with `terminal: false` is a failed or
incomplete release, even if `feed.xml` exists locally. `terminal: true` means the terminal
manifest acknowledgement completed, not merely that an RSS file was written.

Writing to `STATIC_DIR` is deliberately **not** hosting. After the deployment mechanism has
uploaded the feed, provide a post-upload acknowledgement (for the current CLI seam,
`LOGBOOK_STATIC_SYNC_ACK='{"hosted":true,"feedDigest":"<sha256-of-feed.xml>"}'`) and rerun
`publish-rss`. A missing, non-hosted, or mismatched acknowledgement leaves `feed` incomplete
and prevents Podstr, NIP-73, and terminal manifest publication. The value is an acknowledgement
from the deployer, never a claim inferred from a local filesystem write.

## Required checks before every merge or deployment

```bash
cd /home/vibe/logbook/scripts
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high

after_that() { cd /home/vibe/logbook/logbook-pwa; npm test && npm run lint && npm run build; }
after_that

git -C /home/vibe/logbook diff --check
```

PWA audit must be recorded separately while the no-fix upstream findings remain. A successful `--audit-level=critical` does not mean the four high findings are resolved.

#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node "$repo_dir/tools/secret-scan.mjs"
node --test "$repo_dir"/tools/test/*.test.mjs

(
  cd "$repo_dir/logbook-pwa"
  npm run test:unit
  npm run test:browser
  npm run lint
  npm run build
  npm audit --omit=dev --audit-level=high
)

(
  cd "$repo_dir/scripts"
  npm run typecheck
  npm test
  npm audit --omit=dev --audit-level=high
)

git -C "$repo_dir" diff --check

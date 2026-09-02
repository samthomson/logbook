#!/usr/bin/env bash
# Build the PWA and publish it as an nsite under the Compass identity.
#
# Requires nsyte on PATH (https://nsyte.run/docs/installation).
#
# Requires (from repo-root .env or the environment):
#   COMPASS_PUBKEY, RELAYS, DISCOVERY_RELAYS, BLOSSOM_SERVERS
#
# nsyte must already have an authorized NIP-46 bunker in its OS keychain or
# encrypted credential store, and `.nsite/config.json` must select that bunker.
#
# nsite publish targets: NSYTE_RELAYS + NSYTE_BLOSSOM_SERVERS only.
#
# Usage (from repo root):
#   ./scripts/deploy-nsite.sh
#   ./scripts/deploy-nsite.sh --dry-run

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PWA="$ROOT/logbook-pwa"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

# Load KEY=value lines without shell-evaluating values (bunker URIs contain &).
load_env_file() {
  local file="$1" line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$val"
  done < "$file"
}

if [[ -f "$ROOT/.env" ]]; then
  load_env_file "$ROOT/.env"
fi

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: $name is required" >&2
    exit 1
  fi
}

require COMPASS_PUBKEY
require RELAYS
require DISCOVERY_RELAYS
require BLOSSOM_SERVERS
require NSYTE_RELAYS
require NSYTE_BLOSSOM_SERVERS

if ! command -v nsyte >/dev/null 2>&1; then
  echo "error: nsyte not on PATH — install from https://nsyte.run/docs/installation" >&2
  exit 1
fi

# `nsyte bunker use <pubkey>` records only the public identity here; signer
# credentials stay in nsyte's secure store and are never passed in argv.
CONFIGURED_BUNKER_PUBKEY="$(
  node --input-type=module - "$PWA/.nsite/config.json" <<'JS'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const pubkey = typeof config.bunkerPubkey === 'string'
  ? config.bunkerPubkey.trim().toLowerCase()
  : ''
if (!/^[0-9a-f]{64}$/.test(pubkey)) {
  console.error('error: logbook-pwa/.nsite/config.json must select a bunkerPubkey; run nsyte bunker use <COMPASS_PUBKEY> from logbook-pwa')
  process.exit(1)
}
process.stdout.write(pubkey)
JS
)"
if [[ "$CONFIGURED_BUNKER_PUBKEY" != "$COMPASS_PUBKEY" ]]; then
  echo "error: nsyte bunkerPubkey does not match COMPASS_PUBKEY" >&2
  exit 1
fi

echo "Building PWA for Compass ${COMPASS_PUBKEY:0:12}…"
cd "$PWA"
npm run build

# The bundle and signer must target the same identity before any upload starts.
node --input-type=module - "$PWA/dist/.well-known/nostr.json" "$COMPASS_PUBKEY" <<'JS'
import { readFileSync } from 'node:fs'

const document = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const expected = process.argv[3]
if (document?.names?._ !== expected) {
  console.error('error: built NIP-05 identity does not match COMPASS_PUBKEY')
  process.exit(1)
}
JS

DEPLOY=(
  nsyte deploy dist --sync -i
  --relays "$NSYTE_RELAYS"
  --servers "$NSYTE_BLOSSOM_SERVERS"
)
if [[ "$DRY_RUN" -eq 1 ]]; then
  DEPLOY+=(--dry-run)
  echo "Dry run (build yes; no Blossom upload / no relay publish)"
fi

echo "nsite relays:  $NSYTE_RELAYS"
echo "nsite blossom: $NSYTE_BLOSSOM_SERVERS"
echo "Publishing nsite as configured Compass identity ${CONFIGURED_BUNKER_PUBKEY:0:12}…"
"${DEPLOY[@]}"

echo
echo "Done. Open via your nsite gateway using this Compass npub/hex."
echo "Verify the served HTML/JS hashes match logbook-pwa/dist before sharing."

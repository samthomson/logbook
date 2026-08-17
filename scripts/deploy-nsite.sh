#!/usr/bin/env bash
# Build the PWA and publish it as an nsite under the Compass identity.
#
# Requires nsyte on PATH (https://nsyte.run/docs/installation).
#
# Requires (from repo-root .env or the environment):
#   COMPASS_PUBKEY, RELAYS, DISCOVERY_RELAYS, BLOSSOM_SERVERS
#   ADMIN_PUBKEYS          — may be empty
#   COMPASS_BUNKER_URI + COMPASS_BUNKER_CLIENT_KEY — same NIP-46 session as the worker
#   or COMPASS_NSYTE_SEC — nbunksec (optional; otherwise built from URI + client key)
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

# nsyte needs the authorized client key. A bare bunker:// URI alone opens a new
# client and the bunker returns "unauthorized". Build nbunksec like the worker.
if [[ -n "${COMPASS_NSYTE_SEC:-}" ]]; then
  SEC="$COMPASS_NSYTE_SEC"
else
  require COMPASS_BUNKER_URI
  require COMPASS_BUNKER_CLIENT_KEY
  SEC="$(
    cd "$PWA"
    node --input-type=module <<'JS'
import { NostrConnectSigner } from 'applesauce-signers'

const uri = process.env.COMPASS_BUNKER_URI?.trim()
const clientKey = process.env.COMPASS_BUNKER_CLIENT_KEY?.trim().toLowerCase()
if (!uri?.startsWith('bunker://')) {
  console.error('error: COMPASS_BUNKER_URI must be a bunker:// URI')
  process.exit(1)
}
if (!clientKey || !/^[0-9a-f]{64}$/.test(clientKey)) {
  console.error('error: COMPASS_BUNKER_CLIENT_KEY must be a 64-character hex key')
  process.exit(1)
}
const { remote, relays, bunkerSecret, secret } = NostrConnectSigner.parseBunkerURI(uri)
process.stdout.write(
  NostrConnectSigner.createNbunksec({
    remote,
    clientKey,
    relays,
    bunkerSecret: bunkerSecret ?? secret,
  }),
)
JS
  )"
fi

if ! command -v nsyte >/dev/null 2>&1; then
  echo "error: nsyte not on PATH — install from https://nsyte.run/docs/installation" >&2
  exit 1
fi

echo "Building PWA for Compass ${COMPASS_PUBKEY:0:12}…"
cd "$PWA"
npm run build

DEPLOY=(
  nsyte deploy dist --sync -i --skip-secrets-scan
  --sec "$SEC"
  --relays "$NSYTE_RELAYS"
  --servers "$NSYTE_BLOSSOM_SERVERS"
)
if [[ "$DRY_RUN" -eq 1 ]]; then
  DEPLOY+=(--dry-run)
  echo "Dry run (build yes; no Blossom upload / no relay publish)"
fi

echo "nsite relays:  $NSYTE_RELAYS"
echo "nsite blossom: $NSYTE_BLOSSOM_SERVERS"
echo "Publishing nsite as Compass (must match COMPASS_PUBKEY)…"
"${DEPLOY[@]}"

echo
echo "Done. Open via your nsite gateway using this Compass npub/hex."
echo "Verify the served HTML/JS hashes match logbook-pwa/dist before sharing."

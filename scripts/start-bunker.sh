#!/usr/bin/env bash
# Run the Compass NIP-46 signer in a terminal you keep open (dev only).
# The worker and deploy-nsite.sh sign through this bunker.
# Requires: nak on PATH, .env, .secrets/compass-publish/sec (the Compass hex sec).
set -euo pipefail
cd "$(dirname "$0")/.."
SEC_FILE=.secrets/compass-publish/sec
[ -f "$SEC_FILE" ] || { echo "missing $SEC_FILE — put the Compass hex sec in it (chmod 600)" >&2; exit 1; }
CLIENT_PUB="$(nak key public "$(sed -n 's/^COMPASS_BUNKER_CLIENT_KEY=//p' .env)")"
SECRET="$(sed -n 's/^COMPASS_BUNKER_URI=.*secret=\([^&]*\).*/\1/p' .env)"
exec nak bunker --sec "$(cat "$SEC_FILE")" -k "$CLIENT_PUB" -s "$SECRET" compass-relay.samt.st

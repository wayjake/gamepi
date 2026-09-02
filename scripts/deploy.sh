#!/usr/bin/env bash
# Sync this repo to the Pi and optionally run something there.
#
#   scripts/deploy.sh                          # sync only
#   scripts/deploy.sh "GAME PI"                # sync, then draw that message
#   PI=jake@otherpi.local scripts/deploy.sh    # different host
set -euo pipefail

PI="${PI:-jake@gamepi.local}"
DEST="${DEST:-gamePi}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  "$HERE/" "$PI:$DEST/"
echo "synced $HERE -> $PI:$DEST/"

if [ $# -gt 0 ]; then
  exec "$HERE/scripts/pi-run.sh" src/message.js "$@"
fi

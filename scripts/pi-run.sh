#!/usr/bin/env bash
# Run a node script on the Pi. nvm lives in ~/.nvm and .bashrc bails out of
# non-interactive shells, so we source nvm ourselves rather than relying on PATH.
set -euo pipefail

PI="${PI:-jake@gamepi.local}"
DEST="${DEST:-gamePi}"

remote=$(printf ' %q' "$@")
ssh "$PI" "export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\" >/dev/null; cd $DEST && node$remote"

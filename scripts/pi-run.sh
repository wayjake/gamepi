#!/usr/bin/env bash
# Run a node script on the Pi. nvm lives in ~/.nvm and .bashrc bails out of
# non-interactive shells, so we source nvm ourselves rather than relying on PATH.
set -euo pipefail

PI="${PI:-jake@gamepi.local}"
DEST="${DEST:-gamePi}"

# Allocate a pty when we have one, so Ctrl-C reaches the process on the Pi.
# Without it, killing the local ssh leaves node and aplay orphaned and playing.
tty=""
[ -t 0 ] && tty="-t"

remote=$(printf ' %q' "$@")
ssh $tty "$PI" "export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\" >/dev/null; cd $DEST && node$remote"

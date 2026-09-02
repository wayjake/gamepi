#!/usr/bin/env bash
# Run this ON THE PI (it needs sudo):  sudo bash ~/gamePi/scripts/pi-setup.sh
#
# Turns on the composite (RCA) output and makes the console framebuffer usable
# for drawing. Idempotent -- safe to run twice. Reboot afterwards.
set -euo pipefail

CONFIG=/boot/firmware/config.txt
CMDLINE=/boot/firmware/cmdline.txt
STAMP=$(date +%Y%m%d-%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "run me with sudo" >&2; exit 1; }

cp "$CONFIG" "$CONFIG.bak-$STAMP"
cp "$CMDLINE" "$CMDLINE.bak-$STAMP"
echo "backed up config.txt and cmdline.txt (.bak-$STAMP)"

# On a Pi 4 the composite output is a parameter of the KMS driver overlay.
# N.B. it disables HDMI -- composite becomes the only display output.
if grep -q '^dtoverlay=vc4-kms-v3d,composite' "$CONFIG"; then
  echo "config.txt: composite already enabled"
elif grep -q '^dtoverlay=vc4-kms-v3d$' "$CONFIG"; then
  sed -i 's/^dtoverlay=vc4-kms-v3d$/dtoverlay=vc4-kms-v3d,composite/' "$CONFIG"
  echo "config.txt: enabled composite on the vc4-kms-v3d overlay"
else
  printf '\n# gamePi: composite (RCA) output\ndtoverlay=vc4-kms-v3d,composite\n' >> "$CONFIG"
  echo "config.txt: appended vc4-kms-v3d,composite"
fi

# cmdline.txt is a single line; append params to it, never add a newline.
add_param() {
  grep -qw -- "$1" "$CMDLINE" && { echo "cmdline.txt: $1 already set"; return; }
  sed -i "1s|\$| $1|" "$CMDLINE"
  echo "cmdline.txt: added $1"
}
add_param consoleblank=0            # stop the console blanking after 10 minutes
add_param vt.global_cursor_default=0 # no blinking cursor over our pixels

echo
echo "done. reboot for this to take effect:  sudo reboot"

#!/usr/bin/env bash
# Run this ON THE PI (it needs sudo):  sudo bash ~/gamePi/scripts/pi-setup.sh
#
# Turns on the composite (RCA) output and makes the console framebuffer usable
# for drawing. Idempotent -- safe to run twice. Reboot afterwards.
set -euo pipefail

CONFIG="${CONFIG:-/boot/firmware/config.txt}"
CMDLINE="${CMDLINE:-/boot/firmware/cmdline.txt}"
STAMP=$(date +%Y%m%d-%H%M%S)

[ "$(id -u)" -eq 0 ] || [ -n "${DRY_RUN:-}" ] || { echo "run me with sudo" >&2; exit 1; }

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

# The Pi 4 gates composite in the firmware as well as in the device tree.
if grep -q '^enable_tvout=1' "$CONFIG"; then
  echo "config.txt: enable_tvout already set"
else
  printf '\nenable_tvout=1\n' >> "$CONFIG"
  echo "config.txt: added enable_tvout=1"
fi

# cmdline.txt is a single line; append params to it, never add a newline.
add_param() {
  grep -qw -- "$1" "$CMDLINE" && { echo "cmdline.txt: $1 already set"; return; }
  sed -i "1s|\$| $1|" "$CMDLINE"
  echo "cmdline.txt: added $1"
}
add_param consoleblank=0            # stop the console blanking after 10 minutes
add_param vt.global_cursor_default=0 # no blinking cursor over our pixels

# Pin the CPU governor. The default `ondemand` governor decides a 30 fps render
# loop using a third of one core is an idle machine and drops from 1800 MHz to
# 1100, at which point every frame costs 1.5x more. Nothing else on this box
# wants the power saving.
cat > /etc/systemd/system/gamepi-performance.service <<'UNIT'
[Unit]
Description=Pin the CPU governor to performance for gamePi
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > "$g"; done'
ExecStop=/bin/sh -c 'for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo ondemand > "$g"; done'

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now gamepi-performance.service >/dev/null 2>&1
echo "cpu: governor pinned to $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor) (systemctl disable gamepi-performance to undo)"

# The gamepad. Two kernel modules stand between a paired 8BitDo and
# /dev/input/js0, and RPi OS loads neither on its own:
#
#   hidp    the Bluetooth HID protocol. Without it bluetoothd can pair, trust
#           and hold a link -- the pad lights up and `bluetoothctl info` says
#           `Connected: yes` -- but it can never turn that link into an input
#           device. Connecting fails with `br-connection-create-socket` and
#           /proc/bus/input/devices stays empty. It reads as a dead pad rather
#           than as a missing module, which is why it is worth a paragraph.
#   joydev  what creates /dev/input/js*, the only thing src/joystick.js opens.
#           Without it an attached pad is an event node and nothing else.
#
# Loaded now, and again at every boot.
cat > /etc/modules-load.d/gamepi-gamepad.conf <<'MODS'
# gamePi: a Bluetooth pad needs both of these to reach /dev/input/js0
hidp
joydev
MODS
modprobe hidp joydev 2>/dev/null || echo "modules: modprobe failed (harmless if this is a dry run)"
echo "modules: hidp and joydev loaded, and set to load at boot"

# Some images come up with the Bluetooth radio soft-blocked, and the block
# outlives a reboot -- so unblocking it by hand once is not enough. A unit,
# rather than a line here, because this has to happen on every boot and before
# bluetoothd goes looking for an adapter.
cat > /etc/systemd/system/gamepi-bluetooth.service <<'UNIT'
[Unit]
Description=Unblock the Bluetooth radio for gamePi's pad
Before=bluetooth.service
Wants=bluetooth.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/rfkill unblock bluetooth

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now gamepi-bluetooth.service >/dev/null 2>&1
echo "bluetooth: radio unblocked (systemctl disable gamepi-bluetooth to undo)"

# `sudo nano` runs with HOME=/root, so a terminfo entry installed into the
# user's ~/.terminfo isn't visible to it. Install this terminal system-wide.
if [ -n "${SUDO_USER:-}" ] && [ -d "/home/$SUDO_USER/.terminfo" ]; then
  for term in "/home/$SUDO_USER/.terminfo"/*/*; do
    [ -f "$term" ] || continue
    name=$(basename "$term")
    if TERMINFO="/home/$SUDO_USER/.terminfo" infocmp -x "$name" 2>/dev/null | tic -x -o /etc/terminfo - 2>/dev/null; then
      echo "terminfo: installed $name into /etc/terminfo (so sudo nano works)"
    fi
  done
fi

echo
echo "done. reboot for this to take effect:  sudo reboot"

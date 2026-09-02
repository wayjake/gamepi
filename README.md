# gamePi

Draws text on a Raspberry Pi 4B's **composite (RCA) video output** from Node.js.
No native modules, no npm dependencies -- it writes pixels straight to
`/dev/fb0` and renders text from a vendored PSF console font.

Developed on a Mac, rsynced to the Pi.

## Layout

    assets/     PSF console fonts (copied from the Pi's /usr/share/consolefonts)
    src/psf.js          PSF1/PSF2 font reader
    src/canvas.js       RGB canvas + text drawing
    src/framebuffer.js  packs a canvas into /dev/fb0's pixel layout
    src/message.js      CLI
    scripts/pi-setup.sh enables the composite output (run once, on the Pi)
    scripts/deploy.sh   rsync to the Pi
    scripts/pi-run.sh   run a node script on the Pi

## One-time Pi setup

The Pi 4's composite output is off by default. `scripts/pi-setup.sh` turns it on
by setting `enable_tvout=1` (the firmware gate) and adding the `composite`
parameter to the `vc4-kms-v3d` overlay (the kernel gate) in
`/boot/firmware/config.txt`, and disables console blanking and the blinking
cursor in `cmdline.txt`. It also copies any terminfo entries from
`~/.terminfo` into `/etc/terminfo`, so `sudo nano` works from a terminal the
Pi doesn't ship a description for (Ghostty, say).

    scripts/deploy.sh
    ssh -t jake@gamepi.local 'sudo bash ~/gamePi/scripts/pi-setup.sh && sudo reboot'

**This disables HDMI.** On a Pi 4 composite and HDMI are mutually exclusive;
composite becomes the only video output. To undo it, restore the `.bak-*` files
the setup script leaves next to `config.txt` and `cmdline.txt`.

Cabling: the Pi's 3.5&nbsp;mm TRRS jack carries composite video on the **sleeve**
(the pinout is tip = left audio, ring 1 = right audio, ring 2 = ground, sleeve =
video). Camcorder cables often use the other common pinout and will give you a
black screen with audio -- you want a cable sold for the Raspberry Pi or Zune.

If `/dev/fb0` still doesn't exist after the reboot, composite has no hotplug
detect and the connector may have come up disabled -- force a mode by adding
`video=Composite-1:720x480@60i` to `cmdline.txt` (same line, space separated)
and rebooting again.

## Usage

Render locally in the terminal, no Pi needed:

    node src/message.js --preview --size 720x480 "GAME PI\nREADY"

Deploy and draw on the TV:

    scripts/deploy.sh "GAME PI\nREADY"

Options: `--scale N` (default: largest that fits), `--fg #rrggbb`, `--bg #rrggbb`,
`--safe 0.9` (fraction of the screen kept inside CRT overscan), `--info` (dump
the framebuffer geometry the Pi reports).

## Notes

* Node on the Pi is installed via nvm, and `.bashrc` returns early for
  non-interactive shells, so `ssh pi node ...` finds nothing. `scripts/pi-run.sh`
  sources `~/.nvm/nvm.sh` explicitly.
* The getty login prompt on tty1 shares the framebuffer and will paint over
  anything drawn here. To stop that:
  `sudo systemctl disable --now getty@tty1`.
* NTSC (720x480i) is the firmware default. For PAL, add `sdtv_mode=2` to
  `config.txt`.

## Music

`src/play.js` renders a chiptune score to PCM in pure JavaScript and pipes it
to `aplay`, which lands on the `bcm2835 Headphones` card -- the analogue half
of the same 3.5 mm jack that carries the video.

    scripts/deploy.sh && scripts/pi-run.sh src/play.js --loops 0   # loop on the Pi
    node src/play.js                                               # play on the Mac
    node src/play.js --wav emberfall.wav                           # write a file
    node src/play.js --bpm 160                                     # try a tempo

The synth (`src/audio/synth.js`) is NES-shaped: two pulse channels, a 16-step
quantised triangle for bass, and a 15-bit LFSR for noise. Everything renders at
4x oversample and averages down -- raw squares at 44.1 kHz alias audibly on the
high notes, which the real hardware's analogue output stage never did.

Scores live in `src/music/` and are written in sixteenth notes: each bar is a
list of `[note, ticks]` pairs summing to 16. `npm test` asserts that, then
renders each lead line and measures its pitch back out of the mix to confirm
the synth plays what the score wrote.

Included: **Emberfall**, an overworld theme in D dorian built on a 6-6-4
tresillo hook that recurs at different pitches and registers.

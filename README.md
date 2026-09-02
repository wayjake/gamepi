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
by adding the `composite` parameter to the `vc4-kms-v3d` overlay in
`/boot/firmware/config.txt`, and disables console blanking and the blinking
cursor in `cmdline.txt`.

    scripts/deploy.sh
    ssh -t jake@gamepi.local 'sudo bash ~/gamePi/scripts/pi-setup.sh && sudo reboot'

**This disables HDMI.** On a Pi 4 composite and HDMI are mutually exclusive;
composite becomes the only video output. To undo it, restore the `.bak-*` files
the setup script leaves next to `config.txt` and `cmdline.txt`.

Cabling: the Pi's 3.5&nbsp;mm TRRS jack carries composite video on the **sleeve**
(the pinout is tip = left audio, ring 1 = right audio, ring 2 = ground, sleeve =
video). Camcorder cables often use the other common pinout and will give you a
black screen with audio -- you want a cable sold for the Raspberry Pi or Zune.

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

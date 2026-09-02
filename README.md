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

## Scenes

`src/render.js` draws a 2D scene to the framebuffer, or to a PNG so you can
look at it without a Pi and a CRT in the loop.

    node src/render.js --png out.png            # render at 720x480, on the Mac
    scripts/deploy.sh && scripts/pi-run.sh src/render.js   # draw it on the CRT

The look -- bold ink outlines, flat vibrant fills -- comes from one rule in
`src/gfx/scene.js`: within a layer, every shape is drawn twice, all of them in
ink at `radius + weight` first, then all of them in their own colour at true
radius. Overlapping shapes weld into a single coloured mass; shapes that come
close without touching keep a black channel between them. Outlines are never
traced -- they fall out of the ordering.

Bodies are chains of discs stepped along a polyline with the radius lerped
between control points (`src/gfx/raster.js`), which is what gives limbs their
flow and round caps, and what makes the ink pass free.

Two constraints are baked in rather than remembered:

* `src/gfx/palette.js` runs every colour through `ntscSafe`, which clamps luma
  into broadcast range and desaturates until the decoded RGB stays there.
  Oversaturated colour makes the chroma subcarrier overshoot, and edges bleed.
* `npm test` fails on any horizontal ink run one pixel tall and eight or more
  long -- those land in a single field of a 480i signal and strobe at 30 Hz.
  It also asserts scenes render deterministically (textures use a seeded PRNG)
  and paint only palette colours.

Nothing is anti-aliased, on purpose: composite video on a CRT is the filter,
and hard edges are the style.

## Motion

    scripts/pi-run.sh src/render.js --animate      # 30 fps on the CRT, Ctrl-C to stop
    node src/render.js --at 1.5 --png frame.png    # one frame from partway in

Scenes are `build(width, height, t)` where `t` is seconds, and animation is
applied to the scene *description* -- control points, radii, ray angles -- never
to pixels. A limb sways because its control points move, tapered by how far
along the limb each one sits, so it bends from the shoulder instead of sliding
sideways. `src/gfx/motion.js` has the four functions that cover it: `sway`,
`hop`, `pulse`, `cycle`.

`src/gfx/stage.js` derives time from the frame counter (`t = n / fps`) rather
than the wall clock. Frame n therefore always draws the same picture, which is
what lets `npm test` render a frame and compare it; the cost is that if the
renderer falls behind it runs slow rather than dropping frames, so the loop
reports lateness instead of hiding it.

### Making it fast enough

The first working version ran at 19 fps. Measured on the Pi 4, per frame at
720x480:

| stage | before | after |
| --- | --- | --- |
| build scene description | 0.7 ms | 0.7 ms |
| rasterise | 34.6 ms | 6.5 ms |
| pack to RGB565 | 15.9 ms | 7.0 ms |
| write to /dev/fb0 | 0.3 ms | 0.3 ms |
| **total** | **51.5 ms (19 fps)** | **14.4 ms (69 fps)** |

Two changes did it. Limbs were drawn by stepping discs along the skeleton at
half-pixel spacing, which is obviously correct and enormously wasteful -- the
overdraw is O(rows x area). A limb segment is the convex hull of its two end
discs, so its boundary is two arcs joined by the pair of external tangents, and
each scanline's span is just the widest of disc A's chord, disc B's chord, and
where those tangents cross. That is O(rows), and a pixel diff against the
disc-stepped version across 40 random shapes differs by 6 pixels in 534,799.
The old routine is kept as `chainByDiscs` so the test can keep proving it.

Packing was allocating and zeroing a 691 KB buffer every frame and calling
`writeUInt16LE` per pixel. It now writes through a `Uint16Array` view into a
buffer held open across frames, with a small direct-mapped cache for the colour
conversion -- flat art uses a handful of distinct colours, so nearly every
pixel is a cache hit.

Known limit: there is no vsync. `FBIO_WAITFORVSYNC` needs an ioctl, which pure
Node can't issue, so a frame can in principle tear. The write is 0.3 ms against
a 16.7 ms field, so the window is about 2% -- visible tearing would need a
native shim.

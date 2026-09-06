# gamePi

A homemade games console for a Raspberry Pi 4B and a CRT, written in Node with
**no dependencies at all** -- no npm packages, no native modules, nothing to
install. Pixels go straight to `/dev/fb0` over the Pi's **composite (RCA)
output**, and every note you hear is synthesised in JavaScript and piped to
`aplay`. The only outside tools are `lame` and `ffmpeg`, and only for writing an
mp3.

Nine games and a shell to pick between them; a 2D renderer that inks a scene
like a printed poster; a software 3D rasteriser; an isometric painter; a text
renderer over a vendored PSF console font; and thirty-four chiptune scores.
Some 24,000 lines of it, held up by another 6,500 of tests -- 373 of them, in
about seven seconds.

It is written on a Mac and rsynced to the Pi, but the hardware is not needed to
work on it: everything except the framebuffer and the joystick runs in a
browser.

    npm test
    node src/game.js --serve     # the whole console, in a browser, with sound
    node src/game.js --list      # what is on the shelf

## The short version

* **[Games](#games)** -- Border Patrol, City of Angels, Kingpin, Rimward,
  Meadowlark, Tomo, Tough Knuckles, Golf and Pong. A game is found by its
  filename and needs no registering; `src/shell.js` boots the machine, shows the
  shelf, and is also the way back out of anything.
* **[Scenes](#scenes)** -- the 2D half. A scene is a pure function of time
  returning shapes, rasterised into a poster with a black channel between the
  colours. Outlines are never traced.
* **[The 3D side](#the-3d-side)** and **[an endless road](#an-endless-road)** --
  flat-shaded triangles over a 1/z depth buffer, handed to an ordinary scene as
  an underlay so nothing downstream knows 3D exists. Golf's hole and Border
  Patrol's desert are drawn with it.
* **[Music](#music)** and **[sound](#sound)** -- a score is data, expanded into
  note events and rendered to PCM at 4x oversample. Games get a real-time mixer
  that emits one block per video frame.
* **[Watching it without a Pi](#watching-it-without-a-pi)** -- a browser preview
  that models what the CRT does and a PNG cannot show: 4:3 pixels, both
  interlaced fields, chroma bleed and overscan.
* **[One-time Pi setup](#one-time-pi-setup)** -- switching the composite output
  on, and the cable that looks right and will not work.

Every colour on screen is NTSC-safe, every render is deterministic, and no
horizontal ink run is a single pixel tall. Those are not style notes but
[constraints the tests enforce](#scenes), on games exactly as on scenes: a CRT
punishes all three, so `npm test` fails on them.

## Layout

    assets/     PSF console fonts (copied from the Pi's /usr/share/consolefonts)
    src/psf.js          PSF1/PSF2 font reader
    src/canvas.js       RGB canvas + text drawing
    src/framebuffer.js  packs a canvas into /dev/fb0's pixel layout
    src/preview.js      the same, to a browser on this machine
    src/joystick.js     /dev/input/js0 -> a pad
    src/input.js        one gamepad's worth of state, source-agnostic
    src/scores.js       the high score table (kept in ~/.gamepi)
    src/shell.js        boot, the game selector, and the way back out
    src/manifest.js     what a game tells the shelf about itself
    src/gfx/            scene description -> pixels, the 3D rasteriser, frame loop
    src/audio/          synthesiser, score expander, real-time mixer
    src/scenes/         one file per scene
    src/games/          one file per game (src/games/border/ holds Refugio)
    src/music/          one file per score
    src/message.js      CLI: text
    src/render.js       CLI: scenes
    src/play.js         CLI: music
    src/game.js         CLI: games
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
    node src/render.js --serve                       # scenes, live, in a browser
    node src/game.js --serve                         # play pong, with sound

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
    node src/play.js --loops 4 --wav emberfall.wav                 # write a file
    node src/play.js --loops 4 --mp3 emberfall.mp3                 # ...or an mp3
    node src/play.js --bpm 160                                     # try a tempo

The synth (`src/audio/synth.js`) is NES-shaped: two pulse channels, a 16-step
quantised triangle for bass, and a 15-bit LFSR for noise. Everything renders at
4x oversample and averages down -- raw squares at 44.1 kHz alias audibly on the
high notes, which the real hardware's analogue output stage never did.

Scores live in `src/music/` and are written in sixteenth notes: each bar is a
list of `[note, ticks]` pairs summing to 16. `npm test` asserts that, then
renders each lead line and measures its pitch back out of the mix to confirm
the synth plays what the score wrote.

`--mp3` shells out to `lame`, or `ffmpeg` if that's what you have -- macOS
ships an MP3 decoder but no encoder, and writing one here would dwarf the
synthesiser. Everything else in the audio path is dependency-free.

Included: **Emberfall**, an overworld theme in D dorian built on a 6-6-4
tresillo hook that recurs at different pitches and registers; **Attract** and
**Links**, the menu loops for pong and golf; **Patrol** and **Chase**, which
are Border Patrol's title card and its car chase respectively -- deliberately a
different key, a different tempo and a different job, because a game whose menu
music is its driving music has only one piece of music; and five for City of
Angels -- **Angels** over the title, then **Skid Row**, **Venice** and
**Hollywood**, one per region, with **Showdown** under all three boss fights.
Venice is the only major-key track in the game, which is most of what makes it
read as daylight. Meadowlark has five more: **Meadow** over its title, then
**Sprout**, **Haze**, **Gleaning** and **Hearth** for spring, summer, autumn
and winter -- the same synth all year, but the hats go from a skip to every
eighth to a lope to almost nothing, which is how the seasons sound before you
have looked at the screen. Tomo has eight: **Tomo** over its menu, **Hatch** for
naming and hatching, **Nook** for the room, **Pantry** for feeding and care,
**Study** under the pastimes, and **Juggle**, **Orchard** and **Echo**, one per
minigame. Nook is deliberately the least of them -- it loops under an hour of
tending a pet, so it moves in halves and wholes and leaves most of the bar
empty. Timmy Tough Knuckles has six: **Recess** over its menus, then
**Homeroom**, **Gym Class**, **Field Day** (the soccer field and the courts
share it) and **Assembly** for the stages, and **Detention** under every boss.

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

There is no alpha in a flat poster, so a layer that needs to fade carries an
`alpha` and the renderer dithers it: the layer is painted on its own, then
copied across through a Bayer threshold laid over 2x2 pixel cells. A cell
spans both fields of the interlaced frame, so a half-faded shape shimmers
rather than strobing, and the CRT blurs the stipple into a mid-tone -- the
same trick the consoles this look comes from used. The banana tree in
`overlook.js` lives on a 25-second loop (stand, fall, fade, sprout, grow) and
exports `moments`, the instants `npm test` checks its invariants at.

`src/gfx/stage.js` derives time from the frame counter (`t = n / fps`) rather
than the wall clock. Frame n therefore always draws the same picture, which is
what lets `npm test` render a frame and compare it; the cost is that if the
renderer falls behind it runs slow rather than dropping frames, so the loop
reports lateness instead of hiding it.

### Watching it without a Pi

    node src/render.js --serve                  # opens a browser on the Mac

The stage doesn't care where its frames go: it takes a *writer* -- anything with
`fb`, `present(canvas)` and `close()` -- and `src/preview.js` is one that streams
them to a page on `localhost` instead of to `/dev/fb0`. It is the same loop, the
same clock and the same packer, so what shows up in the browser is the RGB565 the
display controller would have been reading.

The page can pause, step a frame at a time, scrub `t`, jump straight to the
instants a scene exports in `moments`, and switch scenes without dropping the
clock. That last part is the point: a bug that only happens at t = 19.75 used to
mean deploying, watching, and hoping to catch it.

Four things a PNG on a Mac quietly gets wrong, each a toggle on the page:

* **4:3 pixels.** 720x480 is stretched across a 4:3 tube, so a pixel is 8/9 as
  wide as it is tall. Every PNG in this repo is 12.5% too wide.
* **480i fields.** The two fields are a 60th of a second apart, so a one-pixel
  ink run lights for one field and decays through the next. This is the 30 Hz
  strobe `npm test` forbids, made visible rather than merely asserted -- and it
  is also how to see the 2x2 alpha dither shimmering instead of strobing.
* **Chroma bleed.** Composite carries roughly a seventh the bandwidth for colour
  that it does for brightness, which is why colour smears sideways across an
  edge that itself stays sharp.
* **Overscan.** The tube never shows the matte. Crop to the picture rectangle to
  see what a viewer sees, or leave it off and get the safe area outlined.

None of this replaces looking at the CRT -- it is a model of one, and the insets
in `src/gfx/safearea.js` still have to be measured with `--scene calibrate` and a
camera. It replaces the round trip for everything short of that.

### Making it fast enough

The first working version ran at 19 fps. Measured on the Pi 4, per frame at
720x480:

| stage | before | after |
| --- | --- | --- |
| build scene description | 0.7 ms | 0.7 ms |
| rasterise | 34.6 ms | 6.5 ms |
| pack to RGB565 | 15.9 ms | 2.2 ms |
| write to /dev/fb0 | 0.3 ms | 0.3 ms |
| **total** | **51.5 ms (19 fps)** | **9.7 ms (103 fps)** |

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

### The frame-time step

The loop prints a breakdown every second -- `draw`, `pack`, `write` -- because
the total on its own hides where a problem is. It earned that early: frame time
was stepping by 50% mid-run with nothing in the scene changing. Ruled out in
order: thermal throttling (63-66 C, clock pinned at 1800 MHz, `get_throttled`
0x0), GC (184 scavenges in 30 s at under 2 ms each, no major collections),
animation content (rendering cost measured against t is flat -- re-running the
"most expensive" frame makes it the cheapest), and CPU governor (`ondemand`,
but never left 1800 MHz).

The breakdown found it: all of it was in `pack`. `node --trace-deopt` named it
outright -- the function was bailing out of optimised code with "insufficient
type feedback for generic keyed access", because the hot 16bpp path shared a
function with 24- and 32-bit branches that never ran. Splitting the hot path
into `packRGB565` and running it a few times at startup took packing from
6.1 ms/frame to 2.2 ms, and removed most of the step. What is left is about
0.6 ms of ordinary tier-up in the first fifteen seconds.

Known limit: there is no vsync. `FBIO_WAITFORVSYNC` needs an ioctl, which pure
Node can't issue, so a frame can in principle tear. The write is 0.3 ms against
a 16.7 ms field, so the window is about 2% -- visible tearing would need a
native shim.

## Games

    node src/game.js --serve                 # boot it in a browser here
    scripts/pi-run.sh src/game.js            # boot it on the TV
    node src/game.js --serve --game border   # skip the selector, while developing
    node src/game.js --pad-test              # print what your gamepad actually sends
    node src/game.js --list                  # the shelf, with each game's manifest

What boots is `src/shell.js`: a power-on check, then a selector listing whatever
is in `src/games/`. Each game draws its own emblem for its row, so the selector
looks like a shelf rather than a list.

* **BORDER PATROL** -- a run for the line, north through the desert, in 3D.
  Pick one of three cars, outrun the cruisers or lean on them until they are
  in the sand, keep finding fuel and spares, and never let them stop you. Two
  sectors with a checkpoint between them, and short of the line something
  other than what the billboards promised: a pickup across the road, a dirt
  track into the hills, and a town called Refugio where the rest of the game
  is on foot. See [An endless road](#an-endless-road).
* **CITY OF ANGELS** -- an overhead adventure across fifteen rooms of Los
  Angeles. A bat, a can of spray paint, a boombox, three regions with their own
  soundtrack, people who talk to you, and three of them holding the city.
  About twenty minutes. See [Fifteen rooms](#fifteen-rooms).
* **KINGPIN** -- the only game here with a camera: a town of forty-eight tiles
  by thirty-seven, seen twenty by eleven at a time. You owe Vito a thousand
  dollars and you have twenty-one days. Buy on the quay, sell behind whichever
  of fourteen doors wants it today, put a crew on a corner, and keep the heat
  off. Prices come from the date, not from you. See [The town](#the-town).
* **PONG** -- first to 11, one player against the CPU or two on separate pads.
* **RIMWARD** -- the Oregon Trail, three hundred light years long. A family,
  a ship, a purse that depends on who you were, and a route to the galactic rim
  with two forks in it. Buy what fits in the hold, refit the ship at a dockyard,
  set the pace, and deal with whatever the trail sends -- including the things
  that shoot back. See [The crossing](#the-crossing).
* **GOLF** -- one hole, par 4, in 3D. Three-click swing, four clubs, a bunker, a
  pond, and a level green that putts true. See [The 3D side](#the-3d-side).
* **MEADOWLARK** -- a farm, four seasons, and no end to it. Fourteen tiles by
  fourteen, isometric, all on one screen: till, sow, water, ship, eat some of
  it, dig channels from the pond so the soil waters itself, keep hens and cows,
  and sleep through winter if you can afford to. A theme per season. See
  [The farm](#the-farm).
* **TOMO** -- a pet that lives on the wall clock. Name it, pick its temper,
  hatch it as one of seven bodies, and then keep it: fed, flushed, rested and
  played with, or it will not be there when you get back. Three minigames,
  twenty-four pastimes unlocked by level, a shop, and an almanac of 171 things
  to meet. See [The pet](#the-pet).
* **TOUGH KNUCKLES** -- Timmy's first day at Bramble Hollow Middle, as a
  side-scrolling brawler. Three kids to pick from, two pads, three lives, and
  five stages -- the hallways, the gym, the soccer field, the basketball
  courts and the auditorium -- each with a new kind of kid in it and a bully,
  a coach, the twins, the vice principal or the principal at the end. Pencils,
  rulers and squishies wear out; lunch boxes heal. About ten minutes.

Each game owns its own menu, pause menu, high score table and game over screen.
The shell owns the machine: boot, the selector, and the way back.

Each also carries a manifest -- `meta` in the module, checked against
`src/manifest.js` when the shell finds the file. It says how many can play, who
it is for (`pg`, `13`, `nsfw`, with a line saying what earns anything above
`pg`), where the sound comes from and what the picture is made of, which is the
sort of thing a shelf needs and a filename cannot carry. `--list` prints it:

    angels      CITY OF ANGELS  1 PLAYER  13+  8-BIT  2D
                SAVE LA  --  street violence, drug references
    kingpin     KINGPIN         1 PLAYER  NSFW  8-BIT  2D
                RUN THE TOWN  --  drug dealing, gun violence, civilian deaths
    knuckles    TOUGH KNUCKLES  1-2 PLAYERS  PG  8-BIT  2D
                TIMMY VS MIDDLE SCHOOL  --  cartoon fighting

### Fifteen rooms

City of Angels is `src/games/angels.js`. It is the one game here with a map, and
the map is the interesting part.

**A room is eleven strings of twenty characters.** Each of the fifteen describes
only its inside; the wall around it, the two-tile doorways and any padlock
across one are stamped over the top at load from the room's exit table. That
sounds like a detail and is the whole design: an exit and the hole it needs can
never disagree, because only one of them is written down. Rooms name each other
rather than sitting on a coordinate grid -- three regions that each want to be
a corridor do not lay out on one without either holes in the middle or geography
that lies about where Venice is.

Doorways are always the same two columns and the same two rows, which turns into
a rule for drawing rooms: whatever else is in one, that lane stays clear. The
canal in Venice was drawn one tile off and the north door opened onto ten feet
of water. A test walks every doorway now and checks there are two walkable tiles
behind it.

**The other thing a test walks is the lock order.** Two gates need something a
boss is holding, and both of those bosses have to be reachable *without* the
thing they hold. Get that backwards and the game is unfinishable in a way that
playing the first region would never show you -- so the test opens the gates in
order from the start room and asserts every room comes out reachable.

**Rooms are static; entities are not.** Two hundred tiles with outlines would be
a mess and slow with it, so the tiles are built once when you walk in, with runs
of one ground colour merged into single rectangles, and only the things that
move are rebuilt per frame. A busy room rasterises in about 0.6 ms on the
development machine against a 33 ms budget, which is what leaves room for the Pi
to be twenty times slower.

**Talking.** Dialogue is written as sentences, not as pre-broken lines -- the box
wraps at 34 columns and pages two at a time, typed out. Everyone's lines are a
function of the run, so somebody who has already told you a thing tells you the
next thing instead; a character who repeats himself is a signpost, not a person.
A conversation stops the world but not the wind: the litter blowing across the
street keeps blowing, so a page of dialogue reads as a pause rather than a
freeze.

**Two things were wrong and are worth writing down.** The first: the Cart King
re-aimed his charge every frame of his wind-up, which makes a telegraph into a
delay before an unavoidable hit. He takes his aim once now, when the wind-up
starts, and never touches it again -- and so does the enemy that charges. The
second: getting hit near a doorway shoves you a tile and a half, the doorway is
a tile and a half behind you, and something waiting by that door will bounce you
in and out of the room until you are dead. There is half a second of grace after
walking into a room now, during which no exit will fire.

A boss shuts the way out behind you. Walk into the underpass, the pier or the
forecourt and the doorway fills in the way a padlocked gate does, and it stays
filled until the thing in the room with you is on the floor. The alternative is
fighting a boss two hits at a time from the doorway and backing into the last
room whenever it turns around, which is not the fight any of the three were
written as. It is filled in rather than refused for the same reason a padlock
is: a door you can walk into and not through is a bug, and a shutter is not.

Beating a boss quiets every room of its region you walked through to reach it,
and dying offers you a continue at the mouth of the region for 500 off the
score. Both are the same decision: every route out of a boss is the route in
walked backwards, and re-fighting three rooms you already cleared is not
difficulty, it is a toll. A room you never set foot in keeps its crowd, though;
Cold Storage is off the route to the Cart King and it should not be empty the
first time you see it.

Two people will not let you walk out on them. Sarge has the bat and Gloria has
the story, and a player who heads for the door without either would find the
next room unwinnable or the padlock after it meaningless. Step into a doorway
before talking to them and the street freezes while they run over -- around the
benches, not through them -- and say their piece anyway.

The whole game is driven to its ending by `test/game.test.js`, with a pad, over
four seeds, and three of them have to finish. The player it drives is
deliberately mediocre -- it fights at arm's length, gives up on anything it has
failed to walk to for a second and a half, and takes the continue every time.
If that can finish the game, the game finishes.

### The crossing

Rimward is `src/games/rimward.js`, and it is the game in this repo that is
mostly text: a calendar, a ledger and a stream of things going wrong.

**Leaving Sol.** You choose who you were before -- a merchant leaves with 7000
credits and scores at face value, a mechanic with 4200 and double, a prospector
with 2600 and triple. Then you provision at the docks. Fuel fills the tank;
rations, spares and medkits share the hold, and the hold is small. One ration
feeds one person one day at normal meals; five people over ninety days is more
than a mark-one hold carries, so you will be buying again further out, where
everything costs more. The dockyard refits five systems in three marks each:
the drive (light years a day), the tank, the plating (hull), the cannon, and
the hold itself. Every mark is a trade against the purse.

**The route.** Sol to Barnard's Buoy to Tau Ceti is the easy part. At Tau Ceti
the chart puts a choice: the Reef, short and full of rocks, or the Long Arc,
long and patrolled. Both come out at Anchor Station. The Narrows is a nebula
and pirates like the cover. From Kepler's Rest, the last stop, the Dark is
short and has no stars to steer by; Pilgrim Road is long and has other families
on it. New Haven is the end. The chart is where you look to know which region
you are in and to set course at a fork; under way it shows the ship as a dot
along the line.

**The calendar.** A day passes every half second of screen time while the
travel screen is up. Nothing else runs the clock: menus, the chart, an event
card and a fight all stop it. Each day burns fuel (more at BURN, less at COAST,
none with a dry tank -- you drift at a fraction of the speed on momentum) and
eats rations (half at MEAGRE, one and a half at FULL, and health follows).
Nobody starves on a full plate; everybody does on an empty one.

**What the trail sends.** Micrometeor swarms and hull breaches take hull.
Solar flares and void fever take people -- a medkit cures anything, and a sick
person on full meals sometimes shakes it off. A drive misfire wants a spare or
costs four days and some hull improvising; a mechanic can sometimes bodge it.
Coolant leaks take fuel, a failed freezer takes rations, a bad star fix takes
three days, a dead star's gravity gives eight light years back. Derelicts can be
boarded for spares, fuel, or a strongbox -- or they can be bait. Passing
haulers sell fuel at a price. Pirates ask for the strongbox and take FIGHT,
PAY or RUN for an answer; raiders don't ask. Old mining drones defend claims
nobody wants.

**The fight** is turn-based: FIRE (the cannon's mark sets the damage), BRACE
(take forty percent this turn), PATCH (a spare for twenty-five hull, while they
shoot), or RUN (better odds with a better drive than theirs). They shoot back
between your turns, and a hit sometimes hurts someone. A beaten-up enemy may
break off; a beaten one drops salvage. A ship at zero hull is lost with all
hands.

**Endings.** Arriving is worth 1500 plus 400 a survivor, on top of five a
light year and a fifth of what is left in the purse, all times the profession's
multiplier. Dying scores the same way without the arrival bonus, so a
prospector who gets three-quarters of the way still lands on the board. There
is an ALMANAC on the menu that says all of this in fewer words.

### The farm

    node src/game.js --serve --game meadowlark

Meadowlark is the one game here that is meant to be *kept*: it saves at every
sleep to `~/.gamepi/meadowlark.json` (beside the high score table, outside the
tree, for the same reason) and CONTINUE picks it up. There is no ending. The
board on the shell's shelf records each year's lifetime shipping total under
`YR1`, `YR2` and so on, so a second year has something to beat.

The holding is fourteen tiles square, drawn as an isometric diorama that fits
on the screen with the HUD, so the whole farm is always in view: a pond in the
north-east corner, a creek down the west side, the house at the top, a road
along the near edge with Wren's stall on it, and a fenced pasture by the barn
site. Rocks, stumps and weeds are scattered from the seed. Diamonds are not a
shape the renderer has, so `src/gfx/iso.js` paints the ground into a canvas
the game owns, only when something about the ground has changed, and hands it
to the renderer as an underlay -- the same seam the 3D games use. Everything
with height is ordinary shapes on top, sorted into diagonal bands so the
farmer walks behind the house and in front of the pond.

A day runs six in the morning to midnight in four and a half real minutes.
Everything you do costs energy, the food meter drains all day, and the two
meet at bedtime: sleep hungry and you wake at sixty, collapse at midnight and
you wake at fifty. Eating is what gives energy back, and the only food is what
you grew or what the animals gave, so the first real decision in the game is
how many turnips to keep. Money arrives overnight, from whatever you put in
the shipping bin.

One function, `intent()`, decides what A does from what is in your hand and
what is in front of you, and its label is the hint line at the bottom of the
screen -- so the button and the hint cannot disagree, and the tests play the
game by reading it. B cycles through the tools you own, then the seeds you are
holding, then a sprinkler if you have one to place.

Wren sells the season's seeds, an axe and a hammer for the stumps and rocks,
a ditch spade, a copper can that waters three tiles, sprinklers, the coop and
the barn (which want wood as well as gold), and the animals. Twelve crops
across three seasons: the quick ones teach the loop, the slow ones pay for
patience, and the ones that fruit again reward getting seed in the ground in
the first week. A crop left in the ground when its season ends withers.

**Water.** The can holds eight, refills at the pond or the creek, and that is
the whole early game. A channel dug with the spade -- one stone each, and the
stones come out of the rocks -- carries water from any tile that touches the
pond or creek, through any channel that touches that, and so on: irrigation is
a flood fill from the water sources, and every morning the soil beside a live
channel is wet without you. A sprinkler beside a live channel does the eight
tiles around it. Laying out channels that reach the field without eating it
is the puzzle the game is really about.

**Animals** graze free while there is grass and eat a hay a day in winter (the
sickle cuts hay from any grass tile). A fed, happy animal produces -- eggs and
milk daily, wool every fourth day -- and you collect from it; petting it
raises its mood. Nothing dies. Rain, decided per calendar day from the seed
so yesterday's work cannot change today's weather, waters everything.

**Winter** grows nothing, so the bed offers to sleep until spring. The skip is
an ordinary run of days done in a millisecond and shown as a montage: the
animals eat your hay, you eat what is in the bag and then buy bread from Wren,
and the produce goes straight to the bin. Arrive with nothing and you arrive
thin. Stocking up in autumn is the other puzzle.

`test/meadowlark.test.js` drives it with a farmhand that only reads the hint
line, and asserts among other things that a plain player who plants turnips,
waters them, eats one and ships the rest comes out of the first spring in
profit.

### The pet

    node src/game.js --serve --game tomo

Tomo is the one game here that runs on the wall clock. Every other game is a
pure function of its inputs and a fixed timestep; a pet that only got hungry
while you were looking at it would be a toy, so Tomo also has to know how long
you were gone. The rule that keeps it testable is that the clock is read in
exactly three places -- hatching, loading and saving -- and is injectable, so
between those, time is `dt` like everywhere else. A session replays from its
inputs, and `test/tomo.test.js` runs a week in a loop with a stopwatch it
winds by hand.

The save is the pet: `~/.gamepi/tomo.json`, beside the high score table,
written every fifteen seconds of play and at every screen change, because the
way out of a game here is an OS-level combo the game never sees. CONTINUE
loads it, works out how long it was, and runs the clockwork over the gap in
five-minute steps, so bedtime lands on the right hour and a pet left on a
Friday has slept three nights by Monday. Then it tells you what happened. A
pet that starved while you were away is found dead on CONTINUE, goes on the
menu's memorial line, and posts its age in days to the shelf.

The clockwork is five bars. Food empties nine hours after a meal; joy in
twelve; rest in eighteen awake and refills in eight asleep; the floor is
clean until a meal comes out four hours later, three messes at most. Health
only moves when something is wrong -- starving, a dirty floor, an illness, a
long sulk -- and slowly, thirty hours from full to gone on starvation alone,
so a missed day is a scare rather than a funeral. Below a fifth of rest or a
tenth of food it will not play, which is the first thing neglect costs you.
It puts itself to bed at ten and gets up at seven; SELECT turns the lights
off early, and a pet woken at night stays grumpy for two hours before it will
go back down. There are four ailments, each with its own cause and its own
drawing, and MEDICINE fixes all of them.

A new pet gets a name rolled from two or three syllables, a temper, a palate
and a coat you can set, and a body you cannot: one of seven archetypes, with
the eyes, ears, spots and cheeks rolled with it, so no two blobs are the same
blob. It grows through five stages by real days alive. There is no last one.

Games and pastimes are how it earns: beans for the shop, XP for levels, and
joy. JUGGLE is keepy-uppy -- A kicks when the ball is low, a kick near the
ground is PERFECT and worth two, and the ball comes down faster every kick.
ORCHARD is forty seconds of catching what falls off a tree, minus the rotten
ones. ECHO is watch-and-repeat, to twenty rounds. Pastimes unlock by level,
from DOODLING at one through COMPUTER PROGRAMMING at eleven to RESEARCHING
THE CURE FOR SCIENCE at twenty, each a few seconds of animation and a line
about what happened; the good line comes out once it has done one enough
times. The shop sells eighteen foods (RICE is free and endless, so a broke
player can always keep a pet alive), eight toys and ten pieces of furniture
that appear in the room.

The BOOK is the point of playing. Everything with a name -- bodies, tempers,
foods, care, games, toys, decor, pastimes, moods, ailments, weather,
holidays, visitors, dreams and badges, 171 in all -- is an entry, shown as
`????` until it has been met. Weather comes from the calendar date, holidays
from the real one, visitors knock while you are on the home screen, dreams
happen while it sleeps, and twenty-eight badges are earned once and kept.

### The town

    node src/game.js --serve --game kingpin

Kingpin is the only game here with a camera. Everything else fits on one
screen; this is a small town of forty-eight tiles by thirty-seven seen twenty
by eleven at a time, with a minimap in the corner because a corner you cannot
see is a corner you have forgotten you are paying for. Four districts -- the
docks, downtown, the flats and the heights -- and fourteen doors: a warehouse,
a pawnbroker, a motel, a general store, a gun shop, a garage, a clinic, a
church, a police station, a bar, the Towers, a villa, your room, and the bus
depot you are trying to reach.

You owe Vito a thousand dollars and you have twenty-one days. Buy on the quay
and sell where the thing is wanted, which is a different door most mornings:
prices are drawn from the date, so what the warehouse charges on day nine is a
fact about day nine rather than something the game is doing to you, and the
day's swing is deliberately wider than the map's gradient. There is no market,
only people with safes -- sell Mrs Lowry thirty units and she is paying two
thirds by the end of it, and the counter comes back a few units a minute. That
is the whole reason to own more than one route.

Money that scales is a crew. Take somebody on at the Towers, walk them to a
painted corner, give them something to sell, and they work it a unit at a time
while you are elsewhere; you have to come back for the money, and they cost a
wage every night. A corner is a fixed address, which the police also have.

Heat is the other currency. It goes up with everything conspicuous -- guns
more than drugs, a pavement more than a counter, a gunshot more than either,
and a body most of all -- and it comes off in exactly three ways: an envelope
at the station, the collection box at St Brigid's, and going to bed. Left
alone it barely moves. Get hot enough and there are cars, and being caught
costs you the bag.

Fists, a bat, a pistol, an uzi and a rifle, and the town keeps the score.
Every civilian who dies is one fewer person to sell to and one fewer person
willing to work for you, so the prices you get fall and the queue at the
Towers dries up -- clearing the street of witnesses is the one strategy in
here that cannot be made to work. Get the bicycle out of Benny early: it is
faster, it carries more, and nobody looks twice at a man on a bicycle.

Everybody you can talk to comes with a close-up of their face and a list of
things you can say, which is the difference between a conversation and a
caption.

### Getting out

**Hold START and SELECT together for about a second, from anywhere.** A bar
fills at the bottom of the screen while you hold; let go and it stops. It works
identically in every game, including from inside a menu, because the shell
handles it before the game sees anything -- while the combo is down the game is
fed no input at all, so it can't act on the buttons being used to leave it.

Each game also has QUIT in its own menu, which does the same thing. The combo
exists because a game you have got stuck in is exactly the game whose menu you
cannot reach.

### High scores

The table lives in `~/.gamepi/scores.json`, deliberately outside the repo --
`scripts/deploy.sh` rsyncs with `--delete`, so a table kept in the working tree
would be wiped by the next deploy.

Pong ranks on points *and* rallies, so the board is not eleven rows of "11".
Golf ranks the other way up, on strokes, which is why every function in
`src/scores.js` takes `{ lower }` and an empty row carries `null` rather than a
zero -- a zero would be the best score on the board the moment the ordering
flipped. Border Patrol ranks on the run: distance, cruisers wrecked, sectors
cleared and a bonus for still being on the road when the truck comes. Only a
run that ends in the sand posts a score; a run that reaches Refugio is not
over, and the board is not where it is going.

### A game is not a scene

A scene is `build(width, height, t)`: a pure function of time that can be
rendered at any instant and compared. A game has to be *driven*. It gets its own
contract in `src/games/`:

    create(width, height, opts) -> { update(dt, pads), scene(), drain(), music(), state() }

`src/game.js` wraps that as a `build()` and hands it to the same `stage.js` that
draws scenes, so the frame loop never learns what it is driving. Two properties
survive the change:

* **Fixed timestep.** `dt` is always `1 / fps`, from the frame counter rather
  than the wall clock. Given the same sequence of inputs a whole match replays
  identically, which is what `test/game.test.js` uses to check that the same
  inputs draw the same frames.
* **Drawing has no side effects.** `scene()` can be called twice on the same
  state and draw the same picture, and the tests assert it.

Every screen a game draws is held to the same rules a scene is -- palette,
overscan, no one-pixel-tall ink runs -- via the shared checks in
`test/invariants.js`.

### The 3D side

`src/games/golf.js` and `src/games/border.js` are drawn by a software
rasteriser: `src/gfx/mesh.js` builds meshes, `src/gfx/scene3d.js` turns them
into pixels, and the result is handed to the ordinary 2D pipeline as
`scene.underlay`, so the HUD, the menus, the matte, the framebuffer, the preview
and every invariant check carry on seeing a normal scene and know nothing about
any of it.

**Why software.** The obvious answer for a Pi 4 is DRM/KMS with EGL and GLES
3.1 on the VideoCore VI. That means native code, and the constraint at the top
of this README is that there isn't any. So the question was whether a rasteriser
in plain JS can carry a golf hole at 30 fps, and it was measured rather than
guessed. Full-screen triangles with a depth buffer, extrapolated to the Pi from
the 7x calibration between this machine and it:

| overdraw | Pi frame time | of a 30 fps budget |
| --- | --- | --- |
| 1x | 3.3 ms | 10% |
| 2x | 6.4 ms | 19% |
| 3x | 9.7 ms | 29% |
| 4x | 18.4 ms | 56% |

About 107 Mpx/s. The finished golf frame -- physics, 3D, the 2D compose over it
and the RGB565 pack -- comes to roughly 11 ms, a third of the budget.

The lesson in the research this came from holds exactly, and harder: **fill rate
and memory bandwidth, not triangle count**. Which is why there is backface
culling, a near-plane clip, and no texturing at all, and why the terrain can
afford several thousand triangles without anyone noticing.

**Primitives.** The 2D renderer gets by on rect, disc and chain. The 3D side
takes the same bargain: `grid`, `box`, `cylinder`, `cone`, `sphere`, `disc` and
`blade`, all producing the one thing the rasteriser understands -- flat-shaded
triangles with a normal each. Normals are per *triangle*, not per vertex,
because the shading is meant to be flat.

**Colour.** The rule that every painted pixel is a palette entry does not bend
for 3D. Instead the shades *are* palette entries: `src/gfx/palette.js` builds a
three-step ramp for each surface colour, each step run through `ntscSafe` like
everything else, and the renderer picks a step by index. No colour arithmetic in
the inner loop, and nothing to check at render time. Three steps, because more
starts to read as a gradient and a gradient is the opposite of the house style.

Three steps also means gentle ground is one flat colour, so a model may carry a
`bias` -- a per-triangle nudge along the ramp, worked out when the mesh was
built. That is where the fairway's mowing stripes come from, and they are what
makes the contours readable at all.

**Wind faces outwards.** Backface culling goes on screen-space winding, which
means an inside-out convex shape keeps exactly the right silhouette and quietly
shows you its far surface instead -- lit by an inverted normal, at the wrong
depth. The sphere, cylinder and cone were all wound inwards to begin with, and
what gave it away was a golf ball that would not shade like a ball.

**Depth is 1/z, not z.** Interpolating view-space z linearly across a screen
span is wrong -- it isn't affine under perspective -- and on a ground plane
running to the horizon the error is large enough to see. 1/z is affine, so it
steps along a scanline with an add.

**One surface, sampled twice.** The hole's terrain is a coarse rough mesh with
finer discs for the green and the bunker laid over it, and two earlier versions
of this both failed the same way: a fine mesh built from the analytic height
sank underneath the coarse one, because a coarse grid interpolates straight
across anything it has no vertex on. So nothing is defined against the analytic
surface. `roughAt()` is the height the coarse mesh actually produces, and the
fairway, the green, the bunker and the ball physics are all defined relative to
that. The ball rolls on exactly the ground that is drawn.

The green is where that earns its keep. It is *level* -- one fixed height, not a
surface that follows the ground -- so a putt rolls dead straight. The rough
underneath it rolls through about two units, so the shelf is however tall it
needs to be at each point to reach that height, and the height itself is
measured at load time as the highest rough anywhere under the disc plus a little
clearance. Under it, the green would sink into the coarse mesh; without the
measurement, that would be a number to keep guessing at. The outer quarter of
the disc banks back down to meet the rough at the rim, so there is no step to
either look at or roll off.

### An endless road

Golf has a course: a fixed rectangle of ground, built once, that the ball moves
around inside. `src/games/border.js` has a road, and a road has to go on for
ever. It does that by repeating.

Every function that describes the world is a pure function of world z, and every
one of them repeats on `ROAD_PERIOD` (or on a factor of it). So the tarmac, the
paint, the marker posts and the scenery are each built **once**, as a single
mesh a road-period long, and the frame just decides where to put the copies:

    for (const z of tiles(camera.z, ROAD_PERIOD)) {
      models.push({ mesh: WORLD.road, position: [0, 0, z], ... });
    }

Nothing is generated while you drive. A tile three miles ahead is the tile you
passed three miles back, and the frame loop allocates no geometry at all --
which is the same rule `framebuffer.open()` and `scene3d.target()` follow, for
the same reason.

**Where the world ends.** A finite ground plane shows you its own edges: past
about 460 units the strip runs out inside the view cone and you get wedges of
sky at the sides of the horizon. Rather than widen the mesh until that stops
being true, the desert is dead flat out to `FLAT_HALF` -- comfortably past
`VERGE`, where the marker posts already stop you -- and banks up into dunes past
it. The dunes are tall enough that you cannot see over them, so there is nothing
to see the edge of. Straight ahead the far edge sits at least 900 units out,
which at a camera height of twelve is within a pixel of the horizon: the sand
simply ends in sky, which is what a horizon is.

**Flat means exactly flat.** This is golf's lesson in a different shape. A
coarse grid interpolates straight across anything it has no vertex on, so a
surface that is *nearly* flat where the cars drive is a surface the cars sink
into. `FLAT_HALF` is 300 and the ground grid is 18 columns over 1800 units, so a
vertex lands on exactly 300 -- and `test/game.test.js` walks the whole drivable
band asserting `desertY` is precisely zero there, and that the band never
reaches past the flat in the first place.

**Tarmac is darker by decree.** Under this sun a surface facing straight up
lands on the top step of its ramp whatever its ambient is, so road and sand came
out the same brightness in different hues. The road carries a `bias` of -1 --
the same per-triangle nudge that draws golf's mowing stripes -- and one step
down the grey ramp is exactly the difference between bleached sand and asphalt.

**Ramming.** A door-to-door hit resolves along the smaller overlap and shoves
both cars apart in proportion to their mass, and the moment of contact gives
the cruiser a lateral kick. After that the two are a pair: while you keep
leaning they move sideways together at the speed their momentum adds up to,
and a cruiser being pushed has a quarter of its steering. Nothing decides that
a cruiser has been "wrecked" as a special case -- a cruiser whose own steering
can no longer keep it on the tarmac is in the sand, and being in the sand at
speed is what ends it. Your car takes the sand at a crawl; theirs was never
built for it. The heavy car kicks hardest, which is why it is worth picking.

**What it costs you.** Every hit takes body off the car, scaled by how hard
the two came together and divided by your mass, and a hit is the *start* of a
contact: a shove held for two seconds is one hit, not sixty. Cruisers hold a
lane beside you and come across one at a time, with a whoop first and their
aim fixed when they set off, so a lunge is a thing you can brake out of.
Checkpoints patch the car up and a stack of spares on the road puts some
back. There is no "heat": the first version filled a meter whenever a cruiser
was near, which punished the one thing the game is about. Being caught now
means being *stopped* -- slower than twenty with a cruiser on you for three
seconds and you are pulled over, and the bar under PULL OVER is how long you
have to get moving.

**The road tells a story.** Billboards sell you the north for a sector --
LAND OF PLENTY, JOBS AHEAD -- and warn you off it for the next. A wall goes up
beside the road in the second sector, and the sun you set off towards sinks
the whole way. Half a sector from the line a wall rises across the entire
horizon and the sun goes down behind it; the gantry stands in a gap in it, and
through the gap you can already see the cruisers parked across the road on
the other side. You never get there. A thousand units short, the chase theme
stops with the car, the cruisers behind you brake off and the ones ahead go
on to the line to wait, and a pickup comes across the sand from the right and
stops on a dirt track in front of you. Its driver, Rosa, tells you what is at
the line and offers you somewhere else, in captions that play themselves (A
hurries them). You get out, walk round the back of the truck to the far door,
and she drives off left through a gap in the wall and over the dunes. Then a
cut: a straight dirt road in scrub green, driven for you, with Refugio at the
end of it -- adobe with its windows lit, a church, a water tower -- and the
town is where the game goes on (below). Everything that carries this -- the
walls, the signs, the pen, the gap and the track -- is a one-off placed by z
like the checkpoint gantry, or a tile of straight wall keyed to the sector it
stands in. The periodic road underneath is untouched, the wall tile divides
the sector length so no tile is ever half in one sector and half in the next,
and the tile the track crosses has to be in the last sector, which is checked
at load. The words on the signs are 2D text projected onto the middle of a 3D
board (`scene3d.project`), switched on at scale 1 from 240 units and doubled
inside 120, which is as close to perspective as a bitmap font gets.

**Refugio** (`src/games/border/town.js`) is a tile town seen from above, on
foot, in the same shape as Kingpin's: a map checked at require time, doors
named in a table, an `intent()` that is the only place the A button is
decided, modal cards, and a talk box with a face in it. What it is for is
different. Every door is a way of being useful to somebody -- a shift washing
dishes at the diner, patching tyres at the garage, shaking pecans in the
grove, a service at the church -- and TRUST is the town's memory of it. Each
pays once a day; sleeping at Rosa's starts the next one, and nightfall does if
you do not. Seven people live here so far, and every one of them knows you the
second time. It is the first pass: the walking, the doors, the jobs and the
day, built so a story can be hung on it.

### Input

`src/input.js` is one gamepad's worth of state and nothing about where it came
from. Three things fill it in and a game can't tell them apart:

* a real gamepad in the browser, through the Gamepad API;
* the keyboard, standing in for one (player 1 on the arrows, `Z`, `X` and
  `Enter`; player 2 on `WASD`, `Q` and `E`);
* `/dev/input/js0` on the Pi, via `src/joystick.js`.

Held buttons are held; `pressed` is the edge, cleared each read, so a menu moves
one line per press however long the stick is leaned on.

Eight of the nine buttons are a game's. The ninth, `home`, is the shell's: the
star beside START on an 8BitDo SN30 Pro, the guide on an X-input pad, `Esc` on
the keyboard. One press of it puts a game back on the shelf, which is why it can
be a single press where START+SELECT has to be a hold -- nothing else in the
machine is allowed to want it, so there is nothing to mistake it for.

Button numbering is not standardised, and there is no one numbering that is
right for every pad. A driver either sorts a pad into a layout it knows or
passes on the order the pad's own firmware reports:

    xpad    a pad in X-input mode: SELECT and START are 6 and 7.
    dinput  a generic HID pad, and most cheap USB ones: 8 and 9.
    8bitdo  an 8BitDo in D-input or Switch mode, which is how one arrives out
            of the box. It reports B A _ X Y _ L1 R1 L2 R2 SELECT START HOME
            L3 R3, so 8 and 9 are the *triggers* and SELECT and START are 10
            and 11.

`src/joystick.js` keeps one map per family and picks between them from the pad's
name, which the driver publishes at `/sys/class/input/js0/device/name`. Exactly
one is live at a time, and that is the point: the first version of the map
claimed several of those pairs at once so that any pad would work, which put
SELECT and START on an 8BitDo's L2 and R2 -- and since the shell leaves a game
on START+SELECT held, squeezing both triggers dropped you out of whatever you
were playing. A test now asserts that no profile puts either button on a
trigger.

If a pad still comes up wrong, `--pad-test` prints its name, the profile chosen
for it and the numbers it actually sends. Force another profile, or move
individual buttons, rather than editing the source:

    GAMEPI_PAD_PROFILE=xpad scripts/pi-run.sh src/game.js
    GAMEPI_PAD_MAP='{"buttons":{"4":"start"}}' scripts/pi-run.sh src/game.js

The browser has the same problem and is more forthcoming about it: a pad arrives
either as `standard`, already sorted into the layout every diagram draws, or raw
in the pad's own order, and `gp.mapping` says which. The preview reads the two
differently, and the line under the canvas is that page's `--pad-test` -- the
pad's name, the layout it is being read as, the buttons and axes moving right
now, and what gamePi is making of them.

### Sound

`src/audio/sfx.js` is the sound effects -- each one a handful of note events
through the same synthesiser that renders the music, so there are no sample
files. They are rendered once at startup; `src/audio/mixer.js` adds them into a
stream, one block per video frame, which is how audio and picture end up sharing
a clock without anything having to be synchronised afterwards.

The blocks go to `aplay` on the Pi (`src/audio/speaker.js`) or to the browser
over `/audio` in the preview. Both drop blocks rather than queue them when they
fall behind, for the reason `stage.js` reports lateness instead of catching up.

The sum is soft-limited with `tanh` rather than clamped. The worst case the game
can reach -- the theme, a bounce, a point, a menu confirm and the high-score
fanfare in one block -- sums to about 3.3, and hard clipping that is audible as
a buzz at exactly the moment the player did something good.

`src/music/pong.js` is the attract theme, and it drops out during a rally: the
blips are the point, and music buries them. Border Patrol keeps its theme
playing throughout, because a car chase without music is a car chase in a car
park, and its own noises are mixed low enough to sit under one -- until the
truck pulls across the road, where it stops: the chase is over, and the
silence under the rescue is the point. The dirt road and the town have a
theme of their own, `refugio`, in F major at a walking pace, which is the
first thing in the game that resolves.

**The engine.** `music()` owns the only looping voice the mixer has, and it is
busy. So the engine is not a loop: it is one short pulse fired over and over,
the interval shortening from 0.25 s at a standstill to 0.085 s flat out, in two
alternating flavours so a held throttle grains instead of buzzing. The rate *is*
the tachometer, which is how a real one reads to the ear anyway.

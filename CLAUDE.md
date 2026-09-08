# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pure-Node graphics and chiptune audio for a Raspberry Pi 4B's composite (RCA) output, written on a Mac and rsynced to the Pi. **Zero dependencies is a design constraint**: no npm packages, no native modules. Pixels go straight to `/dev/fb0`; audio is rendered to PCM in JS and piped to `aplay`. The only external tools are `lame`/`ffmpeg` for `--mp3`. README.md covers hardware setup, cabling, and the performance history; don't duplicate it here.

## Commands

There is no install, build, or lint step.

    npm test                                        # node --test over test/
    node --test test/scene.test.js                  # one file
    node --test --test-name-pattern 'palette'       # tests matching a name
    node src/render.js --png out.png                # render the default scene (overlook) at 720x480
    node src/render.js --scene calibrate --at 1.5 --png out.png
    node src/render.js --serve                      # live preview in a browser, no Pi
    node src/play.js --info                         # validate + render a score without playing it
    node src/play.js --loops 4 --wav emberfall.wav
    node src/message.js --preview --size 720x480 "HI"   # ASCII preview of the text renderer
    node src/game.js --serve                        # boot the shell in a browser, with sound
    node src/game.js --serve --game golf            # skip the selector while developing
    node src/game.js --serve --game meadowlark      # the farm; it saves to ~/.gamepi/meadowlark.json
    node src/game.js --serve --game kingpin        # the town with a camera (border's Refugio is the other)
    node src/game.js --serve --game halcyon       # the music machine: three ten-minute pieces
    node src/perform.js --info                    # a piece's arrangement, on paper
    node src/perform.js --from 3:20 --for 40      # audition one section of it
    node src/perform.js --piece harvest --wav out.wav   # ...or write the lot, or --stems dir/
    node src/perform.js --bench                   # what one frame of it costs
    node src/game.js --pad-test                     # print what a gamepad sends (Pi only)
    node src/game.js --list                         # the shelf: every game and its manifest
    scripts/deploy.sh                               # rsync to the Pi (PI=user@host to override)
    scripts/pi-run.sh src/render.js --animate       # run on the Pi; prints fps/draw/pack/write once a second

Anything touching `framebuffer.info()`, `framebuffer.open()` or `/dev/input/js0` needs real hardware, so it only runs on the Pi. Locally, use `--serve` or `--png` (scenes) or `--preview` (text). `stage.run()` runs anywhere as long as it is given a `writer`. `scripts/pi-run.sh` exists because nvm on the Pi isn't on a non-interactive PATH.

## Architecture

Two independent pipelines share nothing but the CLI style.

**Graphics:** `scenes/*.js` build a scene *description* → `gfx/scene.js` rasterises it into a `Canvas` (a `Uint32Array` of 0xRRGGBB) using `gfx/raster.js` → either `framebuffer.js` packs it to the fb's pixel layout, or `gfx/png.js` encodes it. `gfx/stage.js` is the frame loop for `--animate`.

**Games:** `shell.js` owns boot, the game selector and the OS-level quit; it presents the same interface a game does. `games/*.js` is a state machine -> `game.js` wraps the shell as a `build()` and gives it to the same `gfx/stage.js`, feeding it pads from `input.js` (filled by `joystick.js` on the Pi or the browser's Gamepad API through `preview.js`) and draining its sounds into `audio/mixer.js`.

**3D:** `gfx/mesh.js` builds flat-shaded triangle meshes -> `gfx/scene3d.js` rasterises them into a reusable target with a 1/z depth buffer -> the result goes into an ordinary scene as `scene.underlay`, and the 2D layers, text and matte draw on top. Nothing downstream knows 3D exists.

**Isometric:** `gfx/iso.js` paints 2:1 diamond tiles straight into a canvas (`grid()` for the projection, `fill()` for a tile) which a game hands to the renderer as `scene.underlay`, exactly as the 3D side does. Tiles partition the plane exactly, so a field of one colour has no seams.

**Long-form audio:** `music/pieces/*.js` is a *piece* (an arrangement, not a loop) -> `audio/piece.js` validates it, builds a bar timeline and expands one bar of notes at a time -> `audio/rack.js` renders those notes live through eight stems of analogue-style voices built on `audio/tone.js`, one block per video frame -> `audio/mixer.js` takes it as a live bed, or `perform.js` writes it to a file. Only `games/halcyon.js` uses this side.

**Audio:** `music/*.js` is a score → `audio/song.js` validates it and expands it into note events (lead from the score, bass and arpeggio derived from the chord list, drums from the pattern strings) → `audio/synth.js` renders each event at 4x oversample and downsamples → `play.js` streams the PCM to aplay/afplay or writes WAV/MP3.

Scenes, tracks and games are discovered by filename: `--scene foo` requires `src/scenes/foo.js`, `--track foo` requires `src/music/foo.js`, `--game foo` requires `src/games/foo.js`, and the tests loop over all three directories. A new file needs no registration -- a game dropped in `src/games/` appears in the shell's selector on its own -- but it must pass every per-scene / per-track / per-game test.

### The scene contract

A scene module exports `build(width, height, t)` (t in seconds) returning
`{ title, width, height, ink, background, matte, matteColour, layers, text, font, still }`.

- **Layers** render in order. Three modes: `flat` (each shape in its own fill, no ink), `inkOnly` (every shape in ink, or `layer.fill`), and the default two-pass poster look: all shapes in ink grown by `ink` weight, then all shapes in their fill. Overlapping shapes in one layer weld into one silhouette; near-misses keep a black channel. Outlines are never traced. A layer may carry `alpha` (0..1): there is no real alpha, so the renderer paints the layer to a scratch canvas and copies it through an ordered dither on 2x2 cells. That is the only way to fade anything.
- **Shapes** are `rect`, `disc`, or `chain` (a polyline of `{x, y, r}` points, radius lerped between them). Everything else reduces to these. `scene.marks()` turns point arrays into ink-only chains.
- **Design space vs picture.** Scenes compose in a virtual 720x480 and map uniformly into `picture()` from `gfx/safearea.js` (see `view()`/`place()` in `overlook.js`). The insets there were measured on the actual CRT with `--scene calibrate`; override with `GAMEPI_INSET_X` / `GAMEPI_INSET_Y`. Everything outside the picture rectangle is painted `matte`.
- **Motion** is applied to control points, radii, and angles in the description, never to pixels, and only through pure functions of `t` (`gfx/motion.js`: `sway`, `hop`, `pulse`, `cycle`). The stage uses `t = frame / fps`, not the wall clock, so frame n is always the same picture. A scene that must not move sets `still: true`. A scene with a long cycle (the banana tree in `overlook.js` lives on a 25 s loop) exports `build.moments = [t, ...]` so the tests check its invariants at the interesting instants, not just `t = 0`.

### The writer seam

`stage.run(build, { writer })` sends frames to any object with `fb: {width, height}`, `present(canvas) -> {pack, write}` and `close()`. There are two:

- `framebuffer.js` (`open()`) -- the Pi. Holds the fd and the packing buffer across frames; see the hot-path rules below.
- `preview.js` (`open()`) -- the dev machine. Packs with the *real* `packRGB565` and streams the result to a browser (`preview.html`) over plain `http`, so a scene can be watched moving without a Pi. Its `close()` is deliberately a no-op: the server outlives any one stage, because switching scenes stops one loop and starts another against it. `shutdown()` is the real teardown. `--lan` (both CLIs) binds every interface rather than loopback and prints where else it can be reached, because a phone on the same wifi is a real client: a frame is 675 KB and 166 Mbit/s at 30 fps, so anything that isn't on this machine gets `/stream` gzipped (about 30x, half a millisecond, on the threadpool) while loopback stays raw. `?gzip` forces it on for a phone arriving down a tunnel, `?raw` forces it off. Audio is never compressed -- PCM barely deflates and a codec in the path is latency -- but a remote page takes a 300 ms lead instead of 140.

The stage also exposes `pause()`, `resume()`, `seek(frame)` and `state()` so the preview can scrub. Seeking moves the frame counter and nothing else -- time is still `frame / fps`, so a scrubbed frame is exactly the frame playback would have shown.

`preview.html` models what the CRT does that a PNG can't show (4:3 pixel aspect, the two 480i fields, chroma bleed, overscan). Those are display-side only: nothing there may change what a scene builds or how it rasterises.

`preview.html` is also the phone: one page in four shapes, picked by the pointer being a finger and forced with `?play` (picture plus a touchscreen pad), `?tv` (picture alone, filling the screen -- what you mirror to a television, or open on the television itself), `?pad` (the pad alone, no frame stream at all, so a phone can be the controller for a screen showing the game elsewhere) and `?page` (the instrument panel anyway). The touch pad reads its d-pad as eight sectors off where the thumb is and feeds the same held-button set the keyboard does, so `input.js` still can't tell what is pressing it; a tap that begins and ends between two 16 ms polls is held for one poll rather than lost, and pointer capture is asked for but never relied on. Sound is on by default and opens on the first touch, because no browser will start audio before one.

### The score contract

`{ title, bpm, bassOctave, arpOctave, lead, chords, drums }`. `lead` is one array per bar of `[note, ticks]` pairs summing to 16 (`null` = rest); `chords` is one name per bar from `song.CHORDS`; `drums` is one 16-character string per bar over `K S h -`. `song.validate()` throws on any of these at load time.

### The piece contract

A *piece* (`src/music/pieces/*.js`) is what a score is not: ten minutes, three
movements, an arrangement that changes, and eight parts the player can switch
in and out while it plays. `audio/song.js` cannot express any of that, so
`audio/piece.js` is the second format rather than an extension of the first.

`{ title, subtitle, seed, key, mode, drift, colour, taster, motifs, movements }`
-> movements `{ name, bpm, swing, sections }` -> sections
`{ name, bars, chords, parts }` -> parts, one per stem, `{ pattern | motif, octave, vel, open, ... }`.

- **A bar is a fact.** `barEvents(piece, n)` seeds its own generator from the
  piece seed and `n` and from nothing else, exactly as `priceAt()` does in
  kingpin and `weatherFor()` does in meadowlark. Nothing that happened earlier
  in the playthrough can change what bar 91 contains, so muting a part for two
  minutes cannot send the melody somewhere else, the renderer and the meters
  agree without talking to each other, and a test can ask what bar 91 holds
  without playing the first ninety.
- **The tunes are written, the variations are code.** `motifs` are
  `[degree, ticks]` pairs per bar, in scale degrees; a section's `transform`
  applies `steps`, `octave`, `retro`, `thin`, `stretch` and `ornament`. That is
  where structure comes from -- the same six notes open Sundial plainly, return
  a fourth lower with a fifth of them gone, and close it at half speed. A
  generator that invented melodies would make ten minutes of noodling.
- **A part may sweep across its section.** Any of `vel`, `open`, `density`,
  `drop` and `ghost` may be `[from, to]` instead of a number, interpolated over
  the section's bars. That is how a section builds without a new section.
- **Everything is checked at load**, like `ROOMS` and `PLACES`: bars that do not
  add up to sixteen ticks, chords nobody can spell, a part naming a pattern that
  does not exist, a motif that is referenced and not written. `push()` also
  folds any note outside `LOWEST..HIGHEST` by octaves rather than clamping it --
  clamping changes the pitch class, and the only out-of-key notes in a piece
  should not be the ones the safety rail put there.
- Pieces are discovered by filename like everything else: drop a file in
  `src/music/pieces/` and it is on halcyon's menu and in `test/halcyon.test.js`.

### The rack

`audio/rack.js` is the instrument a piece is played on, and `audio/tone.js` is
what it is built from. It is deliberately not `audio/synth.js`: band-limited
oscillators through a resonant SVF, a two-operator electric piano, a drum kit
through a sample-rate crusher, noise weather, a shared echo and room, and a
modulated delay line on the master so the whole thing wanders like tape.

- **Two clocks, one timeline, and they never have to agree.** `advance(dt)`
  walks the bars at video rate: it queues this frame's notes and moves the
  meters the *picture* is drawn from. `pull(left, right, frames)` renders the
  audio for that frame, placing each queued note at its own offset in the block.
  The split is why the game can be tested and played silently -- nothing is
  pulled when there is no sink, and the meters and the visual still move.
- **The meters are musical, not measured.** They come from what is sounding and
  how hard it was struck, not from the RMS of the rendered block, so the picture
  is identical whether or not anybody is listening and `--mute` costs nothing.
- **Nothing allocates in a block.** Voices are pooled at construction and stem
  buses are owned, the same rule `framebuffer.open()` and `scene3d.target()`
  work to. Coefficients move at `CONTROL` (32 samples), samples move at sample
  rate: a filter sweep recomputed per sample spends more time in `Math.tan` than
  in the filter.
- **The master fader is a slew, not a switch** (`output` is where it is asked to
  go, `level` is where it has got to). Stopping the tape lets the room ring out;
  faded fully out, `pull()` returns immediately and a paused piece is free.
- The stems' faders ramp across the block for the same reason: a part switched
  off between two blocks is a click, and parts coming and going is the point.
- Measured at 0.8 ms a block here, 3 ms with the picture, against 33 ms.
  `node src/perform.js --bench` is the check.

### The game contract

A game module exports `title` and `create(width, height, { scores, seed })`, returning `{ update(dt, pads), scene(), drain(), music(), state() }`.

- **A game is not a scene.** A scene is a pure function of `t`; a game is state that has to be driven. `update(dt, { p1, p2 })` advances it one fixed step, `scene()` draws whatever it currently is. `game.js` composes the two into a `build(width, height, t)` so `stage.run()` never learns the difference.
- **Fixed timestep.** `dt` is always `1 / fps`. Given the same inputs a match replays identically, and `test/game.test.js` asserts it. Anything random uses a seeded PRNG, same rule as scenes.
- **`scene()` has no side effects.** Called twice on one state it draws the same picture; the tests assert that too.
- **Sounds are drained, not pushed.** `drain()` returns the effect names produced since the last call, so the game never has to know whether anything is listening. `music()` names the track that should be playing, or null.
- **A game may bring its own instrument.** The optional `stream()` returns a live source -- anything with `pull(left, right, frames)` that adds a block into the mixer's accumulators. `game.js` hands it to `mixer.live()` and stops asking `music()`. Only `games/halcyon.js` does this; every other game names a track and never learns the seam exists.
- **Every screen obeys the scene rules.** Palette, overscan, no 1px-tall ink runs -- `test/invariants.js` holds both directories to the same checks.
- **A game carries a manifest.** `meta` is the shelf card -- `players` (the
  counts it supports, `[1]` or `[1, 2]`), `rating` (`pg` / `13` / `nsfw`),
  `audio` (`8-bit` / `wav`), `graphics` (`2d` / `3d-low` / `3d-high`) and
  `content`, a few words saying what earns a rating above PG. `src/manifest.js`
  is the only place the allowed values live; it validates at load, so a game
  with a manifest that doesn't add up throws when the shell finds it rather
  than when somebody picks it. `node src/game.js --list` prints the lot.
- Games are discovered by filename like scenes and tracks: `--game foo` requires `src/games/foo.js`, and the tests loop over the directory.

### Rooms, script and continues (City of Angels)

`games/angels.js` is the only game with a *map*, and everything that makes it
one is data rather than code -- worth knowing before editing it.

- **A room is eleven strings of twenty characters.** `ROOMS` holds the inside of
  each room; the perimeter wall, the doorways and any padlock across one are
  stamped over the top at load from the `exits` table, so an exit and the hole it
  needs cannot disagree. Rooms name each other rather than sitting on a
  coordinate grid: three regions that each want to be a corridor do not lay out
  on one. Map dimensions and unknown tile glyphs throw at require time.
- **Doorways are always columns 9-10 and rows 5-6.** Anything a player has to
  walk through a room to reach has to leave that lane clear -- the canal channel
  in `canals` is drawn where it is for exactly that reason. `test/game.test.js`
  checks every doorway opens onto two walkable tiles.
- **A gate's key is dropped by a boss reachable without it.** `exit.need` is an
  inventory flag and `BOSSES[x].gives` sets it. Get the order wrong and the game
  is unfinishable in a way playing the first region would never show you, so a
  test walks the gates open from the start room and asserts every room is
  reachable.
- **Rooms are static, entities are not.** Tile shapes are built once in
  `enterRoom()` and cached, with runs of one ground colour merged into single
  rectangles; the frame loop only rebuilds what moves. A busy room rasterises in
  about 0.6 ms here, against a 33 ms budget.
- **Dialogue is prose, not lines.** `paginate()` wraps at 34 characters and pages
  two lines at a time, typed out at `TYPE_RATE`. Speakers are functions of the
  run, so somebody who has already told you a thing says the next thing. A
  conversation stops the world but not the wind: motes keep drifting, which is
  also what makes a seeded frame differ between seeds during the opening.
- **A telegraph commits to its aim.** The Cart King and `pcp` both take their
  direction when the wind-up *starts* and never touch it again. Re-aiming
  through the wind-up makes the charge undodgeable, which was the first version.
- **A boss shuts the way out behind you.** `shutIn()` fills a boss room's
  doorway with fence while `run.done[boss]` is false, the same mechanism as an
  `exit.need` padlock, and `defeatBoss()` re-lays the tiles to open it again.
  `layTiles()` exists because a boss dying is the one time a room changes shape
  without the player having left it. `state().shut` reports it so a test can see
  it. A boss you can back out of is fought two hits at a time from the doorway.
- **Beating a boss quiets every room of its region you have walked through**
  (`run.seen`), and dying offers a continue at the mouth of the region for
  `CONTINUE_COST` off the score. Both exist because every route out of a boss
  is the route in walked backwards, and a twenty minute run should not be lost
  to a bad thirty seconds. A room you never entered keeps its crowd: Cold
  Storage is off the route to the Cart King, and finding it empty on a first
  visit read as a bug.
- **Some people will not let you leave.** `PEOPLE[x].insists(run)` holds while
  that person still has something you cannot go without (Sarge until you hold
  the bat, Gloria until you have heard about the cutters). Step into a doorway
  while it holds and the world freezes, they run over (`route()` is a
  breadth-first search over the room's tiles, so benches are walked around) and
  the conversation starts by itself. Each person does it once per room visit;
  if the talk does not settle it, they let you go.
- `test/game.test.js` drives the whole game to its ending with a pad over four
  seeds and requires three of them to finish. It is a deliberately mediocre
  player -- if it can finish, the game finishes.

### The run (Border Patrol)

`games/border.js` is the chase. Rules that are easy to break from the outside:

- **A hit is the start of a contact, never a frame of it.** `cop.touching` holds across frames (with a `TOUCH` margin, because resolving an overlap leaves the cars exactly apart), and body comes off only when it flips false to true and `IMPACT_GAP` has passed. Charging per frame, or per 0.4 s, made a held lean a whole life.
- **A held lean is a coupled pair.** While touching door to door and still closing, both lateral velocities are set to the momentum-weighted mean each frame, and the cruiser keeps `SHOVED_GRIP` of its steering. The one-off kick at contact is `RAM_PUSH * mass`; there is no per-frame impulse any more, so a light car's lean is slow and a heavy car's is short.
- **Nose to tail shares speed by mass and never drains it.** A cruiser that is being pushed from behind eases off (`cop.shunted`); braking into you fed a spiral that stopped both cars in the road. The ease-off applies to shunts only -- applied to door-to-door contact it walked the cruiser out of your lean.
- **Cruisers hold a lane on the tarmac, not an offset from you.** `post` is clamped to `centre ± (ROAD_HALF - 4)`; clamping it to the posts let a cruiser flee a lean into the sand and take you with it. A cruiser in the sand at speed (`ROAD_HALF + SAND_WRECK`) is wrecked; the player's cars only slow there.
- **A lunge commits to its aim** (`cop.lungeAt`), comes only from square alongside, one cruiser at a time (`game.lungeIn`), with a whoop. Same rule as the Cart King.
- **Caught means stopped.** `pressure()` runs `pinned` only while `speed < PIN_SPEED` with a live cruiser inside `NEAR`; nothing else fills it. Cruisers spawn ahead only when you are moving and all but stop when far ahead, or a parked player is never approached and the do-nothing test runs dry instead of busted.
- **The run's shape is one-offs by z.** The fence and wall tiles are straight, keyed to `Math.floor(z / LEG) + 1`, and `SIDE_TILE` must divide `LEG`; the line wall, the pen, the signs and the parked cruisers are placed like the gantry. The periodic road is untouched. Sign text is `signLabels()`: 2D labels at `scene3d.project()` of the board's centre, <= 14 characters, cream or sun on the board and ink only at scale 2 (a scale-1 ink stroke is a flicker-rule violation).
- **The rescue is a cut, not a level.** At `RESCUE_Z` (a thousand short of the line) `rescue()` scores the run, brakes off the cruisers behind (`top = 0`) and sends the ones ahead on to the pen (`cop.leaving`), and the screen goes `rescue` -> phases `brake`, `arrive`, `talk`, `board`, `depart` -> `dirt` -> `town`. The pad is ignored except A (hurries a caption) and START (pauses). Captions (`RESCUE_SCRIPT`, `DIRT_SCRIPT`) type out and go on their own after `CAPTION_HOLD`, so a player who has put the pad down still gets to town; `narrate()` wraps at `CAPTION_WRAP` and splits into pages. `music()` is null under the rescue and `refugio` from the dirt road on.
- **The truck faces -X** (`yaw = -PI/2`) both arriving from the right and leaving to the left: model +Z is the front (the lamps at `-l/2` are tail lamps), so `+yaw` turns towards +X. The walker goes round the *back* of the truck to the far door because the near door is the driver's. The wall tile the track crosses (`CROSSING_TILE`) is `WORLD.wallGap` and has to be in the last sector -- it throws at load otherwise.
- **The dirt road is its own world** (`dirtWorld()`, `DIRT`): the same ground mesh in `rough`, a straight track (`ribbon` with a constant centre), posts, scrub from a second seed, and the town meshes placed at `DIRT_LENGTH`. It has its own z (`game.dz`), camera (`dirtCamera()`) and labels (`dirtLabels()`).
- **The town is `border/town.js`**, driven the way game.js drives a game: `update(dt, frame)`, `parts()` for layers and text, `state()`, `busy()` (a card, talk, shift or service has the pad, so START does not pause). border.js keeps it in `game.town`, draws it with no underlay, and fades it under the pause plate as one flat layer. `state().town` is its state and `game.town()` hands the test its `centreOf`. See the section below.
- **`stage()` is where the world is**, looking through the pause menu (`pausedFrom`); `world()`, `music()` and the labels all switch on it, not on `screen`.
- The chase helper in `test/game.test.js` goes for fuel first, leans past a cruiser rather than at it (aiming *at* its x centres the stick on contact), passes a blocker, steps away from a lunge, and stays on the tarmac. Every one of those was a way the first helper lost a run the game did not. From the rescue on it lets go of everything and lets the captions play.

### The town (Refugio, `games/border/town.js`)

Border Patrol's second half, on foot from above, in Kingpin's shape. Rules that are easy to break from the outside:

- **The map is checked at require time**: every `+` is named in `PLACES`, every place's door is a `+`, every person in `LOCALS` starts on a walkable tile, and every door and person can be walked to from the truck (`START`). Doorways open onto the tile below them (the grove's gate onto the tile above as well). `x` is the road out: drawn as road, solid, so the town has one way in and it is closed.
- **`intent()` is the only place A is decided**, as in Meadowlark and Kingpin: the HUD prints its label, `interact()` performs its kind, and `state().intent`/`state().who` report it. A person within 1.35 tiles beats a door.
- **Everything you can do is a way of being useful, and TRUST remembers it**: a shift (`kind: 'job'`, `wage`, `offer`, `task`) pays once a day (`run.worked[id] === run.day`), a service once a day (`run.prayed`), meeting somebody once ever (`run.met`). Add a job by adding a place; the option list is built when you knock, so a shift already worked is not offered twice.
- **A shift and a service are modal and take real time** (`SHIFT_TIME`, `SERVICE_TIME`), then jump the clock (`SHIFT_CLOCK`, `SERVICE_CLOCK`). Nothing is a minigame yet.
- **The day ends at Rosa's**: sleeping there or the clock passing `DAY_LENGTH` both go through `endDay()`, which resets `worked`, puts you outside her door and queues the `DAY n` card. Cards are modal and take the pad until A.
- **People hold still beside you** (`wander()` skips anybody within 1.3 tiles), the Meadowlark rule, or the test that says hello to everybody is flaky. Rosa is `still` and stands by the truck.
- **Talk is prose**: `paginate()` wraps at `WRAP` (26, because a face takes the left of the box) and pages three lines; `first` is said once, `again(run)` after. The talk box's face is drawn from the speaker's `look`.
- `test/refugio.test.js` walks every door, works every job, sits through a service, meets everybody, and sleeps; the walker there is Kingpin's.

### The farm (Meadowlark)

`games/meadowlark.js` is the one game with a save file and no ending. Rules that are easy to break from the outside:

- **The ground is an underlay, everything with height is a sprite.** `paintGround()` runs only when `groundDirty` is set -- set it whenever a tile's ground, wetness or object changes, or the ground will not redraw. Sprites go into diagonal bands (`c + r`), one inked layer per band, so nearer things draw over further ones and keep an outline; a multi-tile building goes in the band of its front corner.
- **`intent()` is the only place A is decided.** It returns `{ kind, label }`; the HUD prints the label and `play()` performs the kind. Add a new action there, not in the button handler, or the hint and the button disagree. Notes for the hint line must fit 38 characters; list subtitles 30.
- **A press mid-step waits.** `game.pressA` holds an A that arrived while a step was in progress and acts once the farmer has arrived, from the tile they arrived on. Acting from the tile being left was the first bug.
- **Persistence is injectable.** `options.save` is `{ load(), write(data) }`; the default writes `~/.gamepi/meadowlark.json` (`scores.DIR`) and tests pass `memoryStore()`. Saves happen at each sleep. The generic tests' CONTINUE entry will read a real save if one exists on the machine, which is harmless but worth knowing. Bump `SAVE_VERSION` if the shape of `farm` changes; an old save is then ignored rather than half-loaded.
- **Weather comes from the calendar, not the running generator.** `weatherFor(day, season, year)` seeds its own rng from the date so a day's work cannot change tomorrow's rain; `test/meadowlark.test.js` asserts it.
- **Irrigation is a flood fill** from every water tile through 4-adjacent channels (`irrigation()`), recomputed at dawn and cached per frame for the hint. Soil beside a live channel and the eight tiles around a sprinkler beside one are wet in the morning.
- **Animals hold still beside the farmer.** `wander()` skips an animal when the player is 4-adjacent; without that a hen steps away as you reach for her, and the test that pets one is flaky.
- **A turn is only a turn.** A lean that changes `player.dir` spends itself
  doing that (`game.turned`); the stick has to come back to neutral before it
  can walk, and a lean in the direction already faced steps on that frame. The
  first version told the two apart by how long the stick was held, so the same
  flick sometimes aimed at a tile and sometimes stepped onto it -- and the tile
  you are aiming at is usually the one you mean to plant in.
- The farmhand helper in `test/meadowlark.test.js` moves one tile in two gestures: `face()` turns, then a one-frame lean starts the step. Hold longer and the stick chains a second step, which is the overshoot that broke the first version of every pathing test.
- Music: `meadow` for the menu, then `SEASONS[i].track` (`sprout`, `haze`, `gleaning`, `hearth`) while playing; `null` during the sleep fade and the morning card so the season's theme arrives fresh.

### The pet (Tomo)

`games/tomo.js` is the one game on the wall clock. Rules that are easy to break from the outside:

- **The clock is read in three places only**: `hatch()`, `load()` and `save()`, through `options.clock` (default `Date.now`). Everything else is `dt`. Do not read the clock in `update()`, `tick()` or `scene()`: the replay test compares two games frame for frame, and `test/tomo.test.js` drives a week with a `stopwatch()` it winds by hand. The generic tests never hatch, so they never touch the clock at all.
- **`tick(dt, log)` is the whole clockwork**, and `catchUp()` is just `tick()` in five-minute steps over the time away. Anything that should also happen while nobody is watching (hunger, messes, illness, sleep) goes in `tick()`; anything that is about *the player turning up* (streaks, holidays, the away card, visitors, dreams) goes in `arrive()` or `live()`. Pass `log` when catching up: with a log the tick records instead of saying things, so a week away does not queue a week of notes.
- **Cards are modal.** `card(title, lines)` queues; the top card takes the pad until A, on every live screen except `working`. Anything that changes the pet from outside the frame loop (a level, a badge, a visitor) should be a card, not a note -- notes expire.
- **`fit()` is the only place "will it play" is decided** (asleep, `HUNGRY`, `TIRED`). Games, toys and pastimes all ask it.
- **The pet's look is data**: `makeLook()` rolls it once at hatching and `petShapes()` draws every screen from it. Add a feature to the drawing, not a new archetype-specific branch elsewhere. Ink shapes on the face are discs of radius >= 3 or rects >= 4 tall; the closed eye is a rect for that reason.
- **The almanac is `FACETS`**, built from `KINDS`; a new thing gets a `line` (<= 40 characters) and a `see('kind:id')` where it is met. The test asserts >= 100 and that every entry has something to say.
- Music: `tomo` (menu), `hatch` (create), `nook` (room, shop, book, result), `pantry` (care), `study` (pastimes), and one per minigame. `music()` in tomo.js, `TRACKS` in game.js.

### The school (Timmy Tough Knuckles)

`games/knuckles.js` is the side-scrolling brawler: five stages, five bosses,
three lives, two players. Rules that are easy to break from the outside:

- **x runs along the strip, y is depth, and a hit needs both.** A swing lands
  only on somebody within `LANE` of your feet. Every enemy decision (swing,
  charge, throw) checks the lane first, so stepping off one is the dodge.
- **The camera never scrolls back**, and it locks at each `wave.at` until
  everyone that wave let in is on the floor. The boss wave is always at
  `length - court.w`. Anything the camera leaves behind is culled: an item
  dropped behind the left edge is unreachable, and the test bot walked into
  the edge for ever trying.
- **Once a kid has entered the room, nobody leaves it.** Entered enemies are
  clamped to the screen; a thrower that kept its distance by standing just
  past the edge could neither be hit nor throw, and the first version did.
- **A telegraph commits to its aim.** `e.facing` is taken when the wind-up
  starts and the strike or charge goes where it was looking. Same rule as the
  Cart King; `test/knuckles.test.js` crosses behind Biff mid-charge to check.
- **Weapons are hits, not time.** `WEAPONS[x].hits` is the number of *landed*
  blows before it snaps (`null` for fists); a squishy spends one per throw and
  lands with what it has left. Only `resolveAttack()` and `throwSquishy()`
  spend them.
- **Poise.** `tough` kinds (jocks, every boss) stagger on every third hit
  instead of every hit, and a kick that floors a goon only staggers them --
  unless `stunned`, which is the window after a charge, when they take double
  and go down. Without it a boss is punched to death from a corner. Only
  `AGGRO[stage]` non-boss enemies hold a `slot` at once; the rest hang back.
- **One inked layer per sprite**, sorted by feet. That is what stops two
  sprites leaving a one-pixel sliver of ink between their fills; inside a
  figure every part overlaps its neighbour for the same reason. The pause
  screen merges them into one faded layer, because the dither breaks runs up
  anyway and a scratch copy per sprite is slow.
- **Two players share nothing but the screen.** Each kid has its own lives,
  weapon and health; one who runs out is `out`, the day carries on without
  them, and it is over only when everybody is. A boss gets half again as much
  hp with two on the pads, while ordinary kids get `level().tough` extra
  instead -- which is a different `tough` from the `cfg.tough` above, in the
  same file: one is a hit-point bump per stage, the other is poise.
- `state()` reports foes, items, shots and both kids' positions because the
  bot in `test/knuckles.test.js` plays the whole day over four seeds and
  three of them have to survive. It is a mediocre player on purpose.
- Music: `recess` (menus, cards, a win), `homeroom` / `gymclass` / `fieldday`
  (twice) / `assembly` per stage, `detention` under every boss, nothing over a
  loss. `TRACKS` in `game.js`.

### The music machine (Halcyon)

`games/halcyon.js` is the only thing on this shelf that is not a game, and the
rules that make it one are worth knowing before editing it.

- **The arrangement and the desk are different things.** A section *scores*
  certain parts; the listener's switches then mute or unmute them. A part
  switched on but not scored plays nothing and says so with an unlit signal
  light. That way the structure survives being played with -- you are mixing the
  piece, not composing it -- and putting everything back on gets you what it
  meant. `state().scored` is the arrangement, `state().levels` is the desk.
- **Solo is a view of the desk, not a change to it.** `game.desk` holds what the
  listener actually set and `applySolo()` projects it onto the rack, so coming
  out of a solo puts every switch back. Soloing the drums for eight bars used to
  wipe a mix somebody had spent five minutes making.
- **There is no ink in the picture at all** (`games/halcyon/view.js`), and it is
  the second game here to go that way for a different reason than tallow did: a
  poster outline has to be the last thing drawn over a shape, and this picture
  is full of things passing behind other things. The disc setting into a ridge
  cut a one-pixel-tall band out of its own outline, which is exactly the run an
  interlaced field strobes on. Value does the work instead -- every mark is a
  dark shape with a bright one inside it, and the five-step wash is wide enough
  for that to read against any part of the sky.
- **Whole-pixel edges, computed before the bands are cut from them.** The sky's
  boundaries are rounded and each band runs edge to edge; rounding a band's top
  and its height separately left a row unpainted wherever the two rounded
  opposite ways, and the background here is ink. Kingpin's camera is rounded for
  the same reason. The ridges' slabs start *above* their nominal line for the
  same reason again.
- **Each part owns one thing on screen**, so switching it off takes that thing
  away: pad the sky, bass the ground and the size of the disc, beat the rings
  and the sparks, keys the blooms, arp the pillars, lead the light with a tail,
  choir the aurora, haze the grain. The grain is the only thing always there,
  which is also what makes a seeded frame differ between seeds.
- **The disc is the clock.** It crosses the sky once per piece, so where you are
  in ten minutes is answerable without reading the numbers.
- The menu is a listening post: moving the cursor mounts that piece at its
  `taster` and plays it quietly. `mount()` is the only place a rack is opened.
- Music: none of `TRACKS`. `music()` returns null and `stream()` returns the
  rack.

### The town (Kingpin)

`games/kingpin.js` is the only game with a *camera*: a forty-eight by
thirty-seven tile town seen twenty by eleven at a time, which is why it is
also the only one with a minimap. Rules that are easy to break from outside:

- **The town is a picture and `PLACES` names the doors cut into it.** Both are
  checked at require time and both directions are enforced -- a `+` no place
  claims throws, and a place whose door is not a `+` throws. So does a door or
  a corner that cannot be walked to from the start, which is the one thing
  about a map this size you cannot see by reading it.
- **The camera owns the tile cache.** `buildGround()` runs from `follow()` and
  only when the visible tile window actually moves, which at walking pace is
  about four times a second rather than thirty; the frame loop only re-offsets
  the shapes it already has. The camera is rounded to whole pixels because
  tiles are an integer wide: half a pixel of camera is a one pixel seam of
  background between two tiles, and a one pixel horizontal line of ink is the
  one thing an interlaced field cannot draw.
- **A price is a fact about the day.** `priceAt(place, good, day)` seeds its
  own generator from those three numbers, so nothing you do can move a price
  you have not walked to and a test can look up what Tuesday costs.
  Meadowlark's weather is the same trick. The *only* thing that moves a price
  is `run.moved`, the depth of what has crossed that counter lately -- it
  makes a shop a person with a safe rather than a market, and it recovers a
  few units a minute, which is what stops the game being one pair of doors.
- **The day's swing is wider than the map's gradient**, deliberately: about
  three to one against about one and a half. A geographic slope big enough to
  be the answer means there is one route and the game is a walk.
- **Everything you do to the town, the town does back.** `killed()` is the
  single door every death goes through, and civilian deaths cut `demand()`
  (every price anybody pays you) and `recruitsLeft()` (who will stand on a
  corner). Add a new way to kill somebody and it goes through there or the
  consequence is optional, which is the same as not existing.
- **A crew is money that scales and an address the police also have.** You hire
  at the Towers, up to `recruitsLeft()`. A hand takes `CREW_STOCK` units to a
  corner and sells one every `SELL_EVERY` seconds into `hand.held`, and you have
  to walk back and take it off them. Above 45 heat every sale risks a raid that
  takes the hand and the stock with it. Wages come out at dawn; if you cannot
  pay them nobody stays, and you keep what they were holding but lose the
  corner.
- **`intent()` is the only place A is decided**, exactly as in Meadowlark: it
  returns what the button would do and the HUD prints it, so the hint and the
  button cannot disagree. It is also what `state().intent` reports, which is
  how the tests walk the town.
- **Heat is a budget, not a timer.** It bleeds off about five points a day, so
  the ways down are the envelope at the station, the box at the church, and
  going to bed. Selling across a counter is half the heat of selling on a
  pavement; guns are three times the heat of drugs.
- **Four endings, and the quiet one pays.** `bus` (a $200 ticket at the depot,
  from day three), `taken` (the morning of the twenty-second arrives), `dead`
  and `prison` keep 100, 50, 25 and 20 per cent of net worth, and leaving on the
  bus having killed nobody adds a flat 2500 -- deliberately more than a
  fortnight of shooting people can earn, because otherwise the high score would
  argue against the whole game. A fourth bust, or one dead policeman, ends the
  run in a cell whatever the money says.
- **Cards are modal and the talk box grows.** Anything that happens *to* you
  is a card that takes the pad until A; the conversation box sizes itself to
  its content, because a six-item list in a box built for three lines of prose
  loses its last item, and in the gun shop that item is the way out.
- The minimap ground is built once at construction -- the town never changes
  shape -- and only the dots on top of it are rebuilt.
- Music: `vice` (menu and daylight), `neon` after dark, `dragnet` once the
  heat is up or a uniform is on screen. `TRACKS` in `game.js`.

### The 3D contract

`scene3d.render(scene, target)` where a scene is `{ camera, background, light, ambient, models }` and a model is `{ mesh, position, yaw, scale, ramp, bias, twoSided }`.

- **Targets are made once.** `scene3d.target(w, h)` owns the canvas and the depth buffer; the frame loop allocates nothing. Same rule as `framebuffer.open()`.
- **Primitives only.** `mesh.js` exports `grid`, `box`, `cylinder`, `cone`, `sphere`, `disc`, `blade` and the `builder()` behind them. Normals are per triangle. Degenerate triangles are dropped at build time, not skipped per frame.
- **Wind faces outwards.** Culling goes on screen-space winding, so an inside-out convex shape keeps its silhouette and shows you its far surface instead -- wrong normal, wrong depth, and it looks nearly right. `test/render3d.test.js` asserts every closed primitive faces outwards; add new ones to that list.
- **Ambient is per model if it needs to be.** Terrain wants a high ambient so a shaded hill isn't black; a small object wants a low one, or with three steps it can only reach the top two -- and for a near-white ramp those are the same colour, so it renders as a flat silhouette. That is what `model.ambient` is for.
- **Colour comes from a ramp, never from arithmetic.** `PALETTE` holds a three-step ramp per surface (`RAMP.turf` etc., all `ntscSafe`); the renderer indexes it with `step(lambert)`. A model may carry `bias`, an `Int8Array` of per-triangle nudges along the ramp -- that is what the fairway's mowing stripes are. Adding a 3D colour means adding a ramp, not painting a new hex.
- **Depth is 1/z**, because z is not affine in screen space and a ground plane makes that obvious. Backface cull is on signed screen area (front faces are positive), and triangles straddling the near plane are clipped in view space.
- **Camera:** yaw 0 looks down +Z, which is the direction `mesh.grid()` runs and the direction a golf hole goes. `scene3d.project()` is the inverse, for putting 2D over 3D.
- If a game's terrain is drawn by more than one mesh, define every one of them -- and the physics -- against what the *coarsest* mesh produces (`roughAt()` in golf.js). A fine mesh built from the analytic surface sinks under a coarse one. The same rule in border.js is that the desert is *exactly* zero everywhere a car can reach and the ground grid has a vertex on the boundary, so no interpolated slope creeps in under the road; `test/game.test.js` walks the drivable band asserting it.
- A world that goes on for ever goes on by repeating, not by generating. In border.js every function of world z is periodic on `ROAD_PERIOD` (or a factor of it), so the tarmac, the paint, the posts and the scenery are each one mesh built at load and placed again per tile. Nothing allocates geometry in the frame loop, and anything new added to that world has to be periodic too or it steps at every tile join -- or be a one-off placed by z like the gantry, the signs and the wall at the line, drawn only while in view.
- Golf's green is deliberately **level**, not ground-following: `GREEN_LEVEL` is measured at load as the highest `roughAt` under the disc plus clearance, `shelf()` makes up the difference at every point, and the outer quarter banks down to meet the rough at the rim. Putts roll straight, and `test/game.test.js` asserts the surface is flat, clears the rough everywhere, and joins without a step.

### The shell

`shell.js` is the OS: boot check, selector, and the quit gesture. It has a game's interface, so `game.js` drives it with the same code either way.

- A game exports selector metadata alongside `create`: `title`, `blurb`, `accent` (a palette name), `emblem(rect)` (shapes for its row) and optionally `lowerIsBetter`.
- **The selected row opens to show its manifest** (`manifest.tags()`: players, rating in `RATING_INK`, sound, picture) and the rows beside it stay shut. Three rows fit only because one open and two shut add up to what three of the old height did; there is no readable scale at which every row could carry a third line.
- **Every game's main menu has a QUIT entry** that sets `state().exit`, and `test/shell.test.js` walks all of them. The star and the START+SELECT hold are the shell's, but the entry in front of the player has to work too.
- **Quitting is the shell's, not the game's**, and there are two ways to do it. One press of `home` -- the star beside START on an 8BitDo, the guide on an X-input pad -- goes straight back to the selector; it can be an edge rather than a hold because no game is allowed to want that button, so there is nothing to disambiguate it from. A pad without one still has START+SELECT held for `QUIT_HOLD`, and while that combo is down the game is fed `input.idle()`, so it cannot act on the buttons being used to leave it. A game may also set `state().exit` (its own QUIT menu entry does).
- Boot lives here, not in a game. A game starts at its own menu and never learns how it was reached.

### Input

`input.js` is a `Pad`: `held` plus `pressed` edges that clear on `read()`. `joystick.js` decodes the 8-byte `/dev/input/js0` record format; its `decoder()` is split from the device so the protocol is testable without hardware.

Button numbering is the part that isn't portable, and no numbering is right for every pad. `PROFILES` in `joystick.js` holds one map per family -- `xpad` (X-input: SELECT and START at 6/7), `dinput` (a generic HID pad: 8/9) and `8bitdo` (D-input or Switch mode, which is how an 8BitDo arrives: it reports `B A _ X Y _ L1 R1 L2 R2 SELECT START HOME L3 R3`, so 8 and 9 are the *triggers*, SELECT and START are 10 and 11, and the star is 12) -- and `open()` picks one from the pad's name in `/sys/class/input/*/device/name`, defaulting to `8bitdo`, which is the pad this console has. Exactly one profile is live at a time: claiming several pairs at once, which is what the map used to do, put SELECT and START on an 8BitDo's L2 and R2, and since the shell leaves a game on START+SELECT held, squeezing both triggers dropped you out of the game. A test asserts no profile puts either button on a trigger. Force one with `GAMEPI_PAD_PROFILE`, move individual buttons with `GAMEPI_PAD_MAP` (JSON), and don't edit the maps; `--pad-test` prints the name, the profile and the numbers a pad actually sends.

`input.js`'s `home` is the shell's, not a game's: `joystick.js` puts it on the star (8bitdo 12) or the guide (xpad 8), the preview on standard button 16, raw button 12 and `Esc`. The browser has the same problem and says which case it is in: `gp.mapping === 'standard'` means it has already sorted the pad into the layout with SELECT and START at 8/9 and the d-pad at 12-15, and anything else is raw HID in the pad's own order -- `PAD_STANDARD` and `PAD_RAW` in `preview.html`, where a raw pad's d-pad is a hat on axis 9 rather than buttons. The `#padinfo` line under the canvas is that page's `--pad-test`: the pad's name, which layout it is being read as, the buttons and axes moving right now, and what gamePi is making of them.

### Audio at runtime

Tracks are named by what a game's `music()` returns (`attract` -> `music/pong.js`, `links` -> `music/links.js`, `patrol`/`chase` -> border's menu and driving themes, nothing at all under its rescue, and `refugio` from its dirt road on, `voyage` -> `music/rimward.js`, `angels` plus one per region and `showdown` under all three bosses -> City of Angels, `meadow` plus one per season -> Meadowlark, `tomo`/`hatch`/`nook`/`pantry`/`study` plus `juggle`/`orchard`/`echo` -> Tomo, `recess` plus one per stage and `detention` under every boss -> Timmy Tough Knuckles); the map is `TRACKS` in `game.js`. Halcyon is the exception to all of it: it returns null from `music()` and hands `game.js` a live source from `stream()` instead, which the mixer takes with `live()` in place of a bed. There is no second looping voice: the mixer's one bed is whatever `music()` asked for, so border's engine is a stream of short one-shots fired at a rate that follows the throttle rather than a loop. `song.js` renders a whole score and normalises it, which is right for a file and wrong for a stream. `audio/mixer.js` is the streaming half: pre-rendered buffers in, one S16_LE block per *video* frame out, fixed master gain, soft-limited with `tanh` (the worst case sums to ~3.3 and hard clipping is audible). Sinks are `audio/speaker.js` (aplay) and `preview.js`'s `/audio`; both drop blocks rather than queue them.

## Invariants the tests enforce

`npm test` fails if any of these break, so treat them as rules, not suggestions:

- Every colour painted must be a `PALETTE` entry, and palette entries are run through `ntscSafe` (luma 16..235, desaturated until RGB stays in range). Don't invent ad-hoc hex colours in a scene.
- Renders are deterministic: seeded PRNG (`rng()` in `overlook.js`), never `Math.random`.
- No horizontal ink run one pixel tall and 8+ pixels long (it strobes on an interlaced field). Keep ink-only strokes at radius >= ~2px after scaling (`MARK` in overlook.js).
- Nothing painted outside `matte`; the picture area isn't empty. Both this and the flicker check run at every `t` in `build.moments`.
- Non-`still` scenes must visibly change with `t`; `still` scenes must not.
- Every screen a game or the shell draws passes the same palette / overscan / flicker checks a scene does, at every screen reachable from its menu. `test/invariants.js` is the single definition; scenes, games and the shell all go through it.
- Every game has a manifest whose values are all on the lists in `src/manifest.js`, whose summary fits across the picture, and whose `graphics` agrees with whether the game requires `gfx/scene3d.js`.
- 3D shading only ever emits palette colours, at any lighting value and any `bias`, including out-of-range ones.
- A golf shot always comes to rest, and a resting ball sits on the ground that is drawn.
- A game replays identically from the same inputs and seed, and `scene()` never mutates state.
- The audio mix never runs out of headroom, and a single sound is not squashed by the limiter.
- Every doorway in City of Angels opens onto somewhere you can stand, no gate is locked behind the key it holds, and the whole game can be played to its ending with a pad.
- Score bars sum to 16; the pitch measured back out of the rendered mix matches the written lead; the mix peaks high but never clips.
- Every piece is three movements of about ten minutes at three different tempos; every note in one is in its key and inside a playable register; a bar expands the same however you arrived at it; every part makes a sound on its own; two renders of the same seconds are identical to the sample. `test/halcyon.test.js`.

## Hot-path rules (framebuffer.js, raster.js, stage.js)

These were each worth 2-5x in measured frame time on the Pi; don't undo them casually.

- `packRGB565` stays its own monomorphic function with typed-array args. Sharing a body with the 24/32bpp branches caused a V8 deopt that tripled pack time.
- The packing buffer and its `Uint16Array` view are created once in `framebuffer.open()`, not per frame, and the packer is warmed up before the first frame.
- `raster.chain` fills each segment as the convex hull of two discs by scanline (`coneSpans`). `chainByDiscs` is the slow, obviously-correct oracle kept for the test; don't delete it and don't use it in a scene.
- The loop reports lateness rather than dropping frames. If the per-second `draw/pack/write` breakdown shows a step change, suspect deopts or the CPU governor before the scene content.

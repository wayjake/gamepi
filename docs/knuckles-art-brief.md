# Timmy Tough Knuckles — pixel art brief

Hello — thanks for taking a look.

This is a side-scrolling beat-'em-up (Streets of Rage with pencils) running on a
Raspberry Pi wired to the composite input of a real CRT television. It is not a
web game and it is not an emulator; it is a small console I built, and the
picture is a 720×480 framebuffer going out as an interlaced NTSC signal at
30 fps.

That target is unusual enough that it changes what art works, so this brief is
mostly about constraints. **Please read the "Hard rules" section before you draw
anything** — three of those rules will silently break the build if broken, and
one of them (the flicker rule) is the sort of thing that looks fine in Aseprite
and buzzes on a tube.

What exists today is placeholder: every character is drawn at runtime out of
rectangles and circles. You are replacing all of it. Do not treat the current
figures as a style reference — treat them as a *layout* reference.

---

## 1. The screen

| | |
|---|---|
| Framebuffer | 720 × 480, square pixels as you author them |
| Displayed | squeezed to 4:3, i.e. **8/9 horizontal** — a circle you draw round reads very slightly tall on the TV |
| Safe area | 640 × 440, offset 40 px in from left/right and 20 px from top/bottom. Everything outside is black. |
| Frame rate | 30 fps, fixed timestep |
| Colour | fixed 51-colour palette, no alpha, no blending (see §2) |

Inside the safe area the brawler splits into three horizontal bands:

```
 y=20   ┌──────────────────────────────────────┐
        │ HUD — text only, no art needed       │ 56 px
 y=76   ├──────────────────────────────────────┤
        │ BACKDROP WALL (lockers, bleachers…)  │ 150 px
 y=226  ├──────────────────────────────────────┤
        │ FLOOR — the playfield                │ 234 px
 y=460  └──────────────────────────────────────┘
```

Characters stand on the floor band. Their feet can be anywhere from y=252 to
y=450, and that vertical position **is** depth — the strip runs left/right, and
walking up or down the floor band moves you nearer or further. Sprites are drawn
back-to-front by their feet, so a character lower on the screen overlaps one
higher up. There is no perspective scaling: a kid is the same size at the top of
the floor as at the bottom.

**Characters only ever face left or right.** The engine mirrors horizontally for
free, so **draw everything facing right only**. No up/down/three-quarter facings.
That halves the work compared with a normal brawler, and it is deliberate.

---

## 2. The palette — the single most important constraint

Every pixel that reaches the screen must be one of 51 specific colours. This is
enforced by an automated test: a frame containing one colour that is not in the
palette fails the build. There is no "close enough".

The reason is composite video. A CRT fed composite gets luma plus a chroma
subcarrier, and oversaturated colour makes the subcarrier overshoot — edges
bleed and buzz. Every one of these 51 colours has been pushed through a filter
that clamps luma into broadcast range and desaturates until the decoded RGB
stays legal.

`gamepi-palette.gpl` is attached. Load it in Aseprite via
**Palette ▸ Load Palette**, and work in **Indexed** colour mode so you cannot
leave it by accident. `art/palette.png` is the whole set as labelled swatches if
you'd rather look at it than read it.

The palette is built as **three-step ramps**: each hue has a `Dim`, a base and a
`Lit`. Three values per surface is the house style — more steps start reading as
a gradient, which is the opposite of the flat poster look this project has.

```
ink   #101010        (outlines — never recoloured)
cream #ebe8e0   creamDim #9b9994   creamLit #ebebeb
sun   #ebc12d   sunDim   #9b7f1e   sunLit   #ebe9b4
ember #e8412f   emberDim #992b1f   emberLit #eb5b47
rose  #ea61a6   roseDim  #9a406e   roseLit  #eb88cb
violet#9a6fd4   violetDim#66498c   violetLit#bf95eb
sky   #6fb3de   skyDim   #497693   skyLit   #a8dceb
moss  #3fb56b   mossDim  #2a7747   mossLit  #51e889
bark  #8f5a2c   barkDim  #5e3b1d   barkLit  #b77338
stone #9aa0a6   stoneDim #666a6e   stoneLit #c5cdd4
turf  #46b26b   sand     #d8b46d   water    #3f7fc4   leaf #4f9c4a   (+ their ramps)
```

**No anti-aliasing and no dithering.** AA between two palette colours produces a
third colour, which fails the test. If you want a soft edge, you get it from the
ramp — Dim next to base — not from blending.

### Colour roles: draw once, recolour thirteen times

This is where the format earns its keep. The engine already treats every
character as the same four colour roles in different paint:

- **body** — shirt / torso
- **trim** — trousers, sleeves, secondary
- **skin**
- **hair**

If you build each sheet so those roles live at **fixed palette indices**, the
engine can swap the ramps at load time and get a different character out of the
same pixels — and can also do the runtime effects it already relies on:

- a white flash on every hit,
- a yellow glow during an enemy's wind-up telegraph,
- a grey wash while an enemy is stunned,
- a blink while a player is invulnerable after respawning,
- a recolour of player 2 when both players pick the same kid.

All of those are "set indices 2–13 to X" if the indices are laid out predictably,
and all of them are impossible if they are not.

**Please order each sheet's palette exactly like this:**

| index | role |
|---|---|
| 0 | transparent — reserved, never paint it |
| 1 | `ink` — outline, never swapped |
| 2, 3, 4 | skin: Dim, base, Lit |
| 5, 6, 7 | body: Dim, base, Lit |
| 8, 9, 10 | trim: Dim, base, Lit |
| 11, 12, 13 | hair: Dim, base, Lit |
| 14+ | anything else from the palette — eye whites, a whistle, a tie, a cap badge |

Use whichever ramps look right while you draw; the *slots* are what matter, not
the specific hues you happen to pick.

---

## 3. Hard rules

Four rules. The first three fail the build.

1. **Palette only.** No colour outside the 51. No AA, no dither, no alpha
   blending. Fully transparent or fully opaque.


2. **Stay inside the safe area.** Anything a sprite draws outside the 640×440
   rectangle is an error, but the engine clips for you — this mostly means
   sprites should not rely on bleeding off-screen.
2
3. *(Guideline, not enforced)* Avoid 1-px-tall **high-contrast** horizontal
   detail in any colour, for the same interlace reason. Two pixels is the
   minimum unit of vertical detail on this display. Vertical detail can be 1 px
3  wide all day — it is only the horizontal lines that flicker.


---

## 4. Cell sizes and anchors

Three sheet sizes, by build. Cells are per-sheet, not global — if a pose needs
more room, widen that sheet and tell me.

| build | cell (w × h) | figure height | feet anchor |
|---|---|---|---|
| **A — light** | 96 × 64 | 43–50 px | (48, 60) |
| **B — heavy** | 112 × 80 | 55–62 px | (56, 76) |
| **C — boss** | 144 × 96 | 67–75 px | (72, 92) |

The cells are much wider than the figure on purpose: a kick or a swing reaches
30–55 px forward from the body centre, and that has to stay inside the cell.

The **feet anchor** is the point the engine positions the sprite by — the ground
contact, centred between the feet. It must be identical across every frame of
every animation for one character, or the character will bob when it changes
pose. Please mark it as an Aseprite **slice named `feet`**.

The figure heights above are the current placeholder heights and are what the
combat ranges were tuned against, so please stay within ±3 px of them. Relative
scale matters more than absolute: Moose reads as heavy because he is a head
taller than Rosa, and Principal Stern is the biggest thing in the game.

---

## 5. The cast

Thirteen characters. Sizes below are figure height in pixels.

### Players (3) — full move set

| name | build | height | colours today | reads as |
|---|---|---|---|---|
| **TIMMY** | A | 48 | sky body / skyDim trim / bark hair | the balanced one. New kid, ordinary. |
| **ROSA** | A | 46 | rose / roseDim / ink hair | fast hands, hits light, moves quick |
| **MOOSE** | B | 55 | moss / mossDim / sun hair | held back twice. Slow, heavy, wide. |

Each also needs one **alt body ramp** noted (a second colour for player 2 when
both players pick the same kid) — just tell me which ramp, no extra art.

### Enemies (5) — one new kind per stage

| name | build | height | colours today | behaviour that must read at a glance |
|---|---|---|---|---|
| **GOON** | A | 48 | ember / emberDim | the baseline. Walks up, swings. |
| **RUNNER** | A | 43 | sun / sunDim | darts in, hits once, runs away |
| **THROWER** | A | 48 | violet / violetDim | hangs back, throws paper wads |
| **JOCK** | B | 60 | stone / stoneDim | does not flinch. Shoulder-charges. |
| **MONITOR** | A | 48 | moss body / sun trim | carries a ruler — long reach, drops it |

The Monitor's ruler is a separate sprite (see §7), so draw him empty-handed with
a hand anchor.

### Bosses (5) — one per stage, all "tough" (they take three hits to stagger)

| name | title | build | height | distinguishing features |
|---|---|---|---|---|
| **BIFF** | Hall Bully | C | 67 | charges. *"HEY NEW KID. NICE LUNCH MONEY."* |
| **COACH GRUNT** | P.E. | C | 62 | cap, whistle. Throws dodgeballs, summons runners. |
| **DEX AND REX** | The Twins | B | 55 (×2) | one design, two on screen at once, both charge |
| **V.P. HATCH** | Vice Principal | C | 62 | glasses, clipboard. Throws clipboards, summons monitors. |
| **PRINCIPAL STERN** | The Principal | C | 74 | necktie. Ground slam, fans out detention slips. |

The Twins are one sheet used twice — the engine can recolour the second one, or
you can suggest a small tell (one of them has his collar up) if you'd rather
they were distinguishable.

---

## 6. Animations

Frame counts below are what I'd like; the engine timings are given so you can
see how long each pose is actually on screen. The engine holds and loops for
you, so a 3-frame punch does not need to be padded out to nine.

### Every character

| tag | frames | loop | engine timing | notes |
|---|---|---|---|---|
| `idle` | 2 | yes | ~6 fps | a breath. Not a fidget. |
| `walk` | 6 | yes | full cycle in 0.57 s (≈17 engine frames) | the only locomotion |
| `wind` | 2 | hold | held 0.24–0.65 s | the telegraph. **This is the most important pose in the game** — it is the window in which the player decides to dodge, and it is tinted yellow at runtime. Make it unmistakable, and make it read at 40 px. |
| `punch` | 3 | no | 0.16–0.30 s | wind-in, contact, recover |
| `hurt` | 2 | no | 0.32 s | recoil, no knockdown |
| `down` | 4 | no | 0.9 s (1.8 s on a lost life) | fall → land → lie → begin to rise |

### Players also

| tag | frames | engine timing | notes |
|---|---|---|---|
| `kick` | 4 | 0.36 s | knocks enemies down — should look like it |
| `swing` | 3 | 0.16–0.30 s | swinging a held item. Same arm arc for all three weapons; the item is composited on. |
| `throw` | 3 | ~0.30 s | overhand, for lobbing the squishy |
| `cheer` | 2 | loop | end-of-stage card, and the character-select screen |

### Some enemies also

| tag | frames | who |
|---|---|---|
| `throw` | 3 | Thrower, Coach Grunt, V.P. Hatch |
| `charge` | 4 (loop) | Jock, Biff, the Twins — a committed shoulder-first run |
| `slam` | 4 | Principal Stern only |
| `fan` | 3 | Principal Stern only (flings a spread of detention slips) |

### Character select portraits

One per player character: the same figure at **2× scale** (≈ 96–110 px tall),
2 frames, on its own sheet. This is a showcase pose on a card, so it can be
posed rather than a scaled `idle`.

**Rough total: ~340 frames across 16 sheets.** Happy to cut `cheer`, or drop
`walk` to 4 frames, if that helps the quote.

---

## 7. Items, weapons and effects

### Weapons are separate sprites

Rather than baking a pencil into every frame of every swing, the engine draws
the held item from a **hand anchor point on each character frame**. That means
four weapons don't multiply into the character sheets, and it means the Monitor
dropping his ruler is free.

So: on each character frame, please mark a second Aseprite slice named `hand`
at the grip point, and note in the frame comment whether the hand should draw
**in front of** or **behind** the body.

Each weapon then needs two sprites — one lying on the floor, one held — plus a
slice named `grip` on the held version.

| item | held? | ground? | cell | notes |
|---|---|---|---|---|
| **pencil** | yes | yes | 48 × 16 | the starter weapon. Breaks after 8 hits. |
| **ruler** | yes | yes | 64 × 16 | long reach. 6 hits. |
| **squishy** | yes | yes | 24 × 24 | a stress toy with a face. Thrown; 3 throws. |
| **clipboard** | yes (V.P. Hatch) | no | 24 × 32 | |
| **lunch box** | no | yes | 32 × 24 | heals. Should read as *food*, immediately. |

### Projectiles

| item | frames | cell | notes |
|---|---|---|---|
| paper wad | 2 (spin) | 16 × 16 | the Thrower's ammo |
| dodgeball | 2 (spin) | 24 × 24 | Coach Grunt |
| thrown clipboard | 4 (tumble) | 24 × 32 | V.P. Hatch |
| detention slip | 4 (flutter) | 20 × 16 | Principal Stern's fan attack |

### Effects

| effect | frames | cell | notes |
|---|---|---|---|
| hit spark | 3 | 32 × 32 | on a landed blow |
| knockdown puff | 3 | 40 × 24 | when a body hits the floor |
| pickup sparkle | 3 | 24 × 24 | walking over an item |
| shadow | 1 each build | 32/40/56 × 12 | flat ellipse under each character; optional, the engine draws a plain one today |

---

## 8. File format and delivery

The console has **no dependencies** — no npm packages, no image libraries. I
will be writing the sprite loader by hand against Node's built-in zlib, so I
need the export to be narrow and predictable. Please stick to exactly this:

**PNG, 8-bit indexed (colour type 3), non-interlaced, with a `tRNS` chunk making
index 0 transparent.** No 16-bit depth, no RGBA, no APNG, no interlacing. In
Aseprite that is Indexed colour mode with the attached palette loaded, exported
as PNG with "Transparent color: index 0".

### Per character / item, three files

1. `<name>.aseprite` — the source, layers intact. I'd like these so future
   animations can be added in the same hand.
2. `<name>.png` — the sheet. **One animation per row**, frames left to right,
   uniform cell size, no packing/trimming. A predictable grid is much easier for
   a hand-rolled loader than an atlas.
3. `<name>.json` — Aseprite's own JSON export. Please export with:

   ```
   --sheet-type rows --data <name>.json --format json-array
   --list-tags --list-slices
   ```

   The tag names should be exactly the tags in §6 (`idle`, `walk`, `wind`,
   `punch`, `kick`, `swing`, `throw`, `charge`, `hurt`, `down`, `slam`, `fan`,
   `cheer`), and the slices exactly `feet` and `hand` (`grip` on weapons).

That JSON is all I need — I read the frame rects from `frames`, the animation
ranges from `meta.frameTags`, and the anchors from `meta.slices`. Nothing has to
be hand-written and nothing has to be kept in sync twice.

### Naming

```
knuckles/
  timmy.aseprite  timmy.png  timmy.json
  timmy-card.aseprite  …          ← the 2× select portrait
  rosa.*  moose.*
  goon.*  runner.*  thrower.*  jock.*  monitor.*
  biff.*  grunt.*  twin.*  hatch.*  stern.*
  items.*                          ← all weapons + lunch box on one sheet
  shots.*                          ← all projectiles on one sheet
  fx.*                             ← sparks, puffs, sparkles
```

Lower case, hyphens, no spaces.

---

## 9. Suggested order of work

I'd like to pay for a small first piece before either of us commits to the whole
thing, because the constraints here are odd enough that it is worth proving the
pipeline end to end.

- **Phase 0 — one character.** The **GOON**: `idle`, `walk`, `wind`, `punch`,
  `hurt`, `down` (19 frames), plus the pencil (held + ground). I wire up the
  loader, run it on the actual television, and we both find out whether the
  flicker rule and the index layout survive contact. Paid regardless of what
  happens next.
- **Phase 1** — the three players and the remaining four enemy kinds, plus the
  select portraits.
- **Phase 2** — the five bosses, the items, the projectiles and the effects.
- **Phase 3, optional** — the five stage backdrops. Each is a 640×150 wall band
  and a 640×234 floor band that tile horizontally as the camera scrolls
  (hallway lockers, gym, soccer field, basketball courts, auditorium). Different
  enough in scope that I'd rather scope it separately once the characters land.

---

## 10. Tone

Middle school, seen from the height of a twelve-year-old who is losing. Bright,
flat, a bit mean, funny rather than grim — the villain is the vice principal,
the ultimate weapon is a stress toy, and the thing you are trying to get back is
the class hamster. Nobody bleeds. The palette is loud on purpose and it is a
poster palette, not a naturalistic one; lean into that rather than fighting it.

The three reference frames are for staging and scale only.

Questions very welcome, especially about §2 and §3 — those are the parts where I
would rather answer three emails than have you draw a week of art against a
constraint I explained badly.

# TALLOW — a collecting RPG where the grind is the story

A design concept. Nothing here is built yet.

---

## Part 1 — What Pokémon actually did

Worth being precise about, because the useful parts are not the famous parts.

**The grind's output is a proper noun.** Experience points are invisible. What
surfaces from the grind is a creature with a nickname, a level, four moves it
will carry for forty hours, and a memory of the patch of grass it came from.
Every other RPG's grind outputs a bigger number. Pokémon's outputs *a character*.
That is why people can still name the starter they picked in 1998 and cannot
name a single stat on it.

**Two axes, and the famous one is the one you don't spend time on.** Vertical
progress (levels) is private, repetitive, and boring to describe. Horizontal
progress (the Pokédex) is social, finite, and the only one anybody ever talked
about at school. 151 is the number that matters: small enough to be a promise
you could keep, large enough to be a thing you had to trade for. An infinite
collection is a job; a completable one is a pact.

**Power is a passport, not a statistic.** The map gates on level, so grinding
reads as *travel*. Nobody grinds to be strong — they grind because Misty is
next. Every wall is a person with a name and a face, so the reward for the
grind is narrative permission to go somewhere.

**The unit is thirty seconds.** A wild battle is a complete story with an
ending. Hundreds of them stack into an evening. That is the whole difference
between a grind and a chore: a chore is one long tail, a grind is a stack of
small closed things with a joint between every pair, and you can stop at any
joint. Which means quitting always feels arbitrary, which is why nobody quits.

**The story is thin on purpose and moral anyway.** The plot is: leave home,
beat eight adults, beat your rival. Underneath, the mechanics are making an
argument — you are a child who makes animals fight for your advancement. The
game says nothing about this for thirty hours except in exactly one town.
Lavender is where the mechanics are put on trial: a tower of the ones that
lost, a mother's ghost, and a man who kills them for the material. It works
*because* it is one town. Every hour and it is a lecture; never and it is
hollow.

**The rival is the grind with a face.** He turns up precisely when you would
have stopped to breathe, on your schedule with worse manners, so his level is a
report card on your evening. That is what gives the vertical grind stakes: you
never need to be strong, you need to be stronger than him.

**The gap is the point.** Because the plot is underwritten, it leaves a hole
shaped like a story, and the player fills it — the Zubat you kept out of spite,
the run where the starter fainted on the Elite Four. The grind manufactures raw
material (specific creatures with specific histories) and the plot declines to
spend it, so the player spends it. Underwriting is the trick.

**And here is the seam.** For all that moral weight, *the grind and the story
never touch.* Nothing you grind costs anything. You cannot lose a Pokémon. The
box holds four hundred creatures you have not looked at in a year and they are
all completely fine. The game accuses you and then never sends the bill.

That seam is the opportunity.

## Part 2 — UG: a grind with no story at all

UG is free-to-play on Quest: tame, feed, raise and ride dinosaurs; walk open
maps, waterfalls and dark caves; join a tribe, trade, play co-op; buy outfits
and gear with in-game currency or bundles. The thing to notice is what is not
in that list.

**There is no story.** Pokémon has a thin one that the grind is quietly about.
UG has a *setting* — prehistory as a mood and a licence to have creatures — and
no authored narrative at all. So "how does the grind contrast with the story"
has a sharper answer here than in Pokémon: the story is other people, entirely.
Pokémon underwrote its plot and left a story-shaped hole for the player to
fill; UG does not write one, and the hole is filled a hundred percent by
whoever you played with. What a UG player remembers in a year is a tribe and a
trade, not a beat.

**The grind is care, not combat.** Taming, feeding, raising — the loop is
nurture, and it is time-gated rather than skill-gated. It is warmer and far
stickier than repeating a fight, because a thing you maintain starts to feel
like it depends on you. This repo already knows that; it is `tomo.js`.

**Riding is the important verb.** The moment a creature becomes transport it
stops being a possession and becomes the way you experience the world. That is
a much bigger deal than a stat line: the collectible should change how you
*move and what you can reach*, not only what you bring to a fight.

**The grind's product is status, not permission.** Pokémon: power is a
passport, and it gates travel. UG: power is display — an outfit, gear, a big
rideable thing — and it is worth grinding only because other people can see it.
That is the witness principle in its purest form. Strip the audience out and
the cosmetics grind evaporates overnight.

**One thing not to copy.** The collection is deliberately not completable and
the grind is deliberately endless, because completion ends monetisation.
Pokémon's 151 is a pact; a free-to-play roster is a subscription. Tallow keeps
the pact.

## Part 3 — TALLOW

> A shadow-puppet troupe walks the road around a reservoir, performing the
> story of the valley underneath it, with a rack of fifty shadows cut from the
> people who lived there. Shadows you don't perform go dim. You cannot keep
> them all.

### The thesis

Pokémon's grind is **accumulation**: the number only rises, the box is
infinite, and the moral weight is ambient. Tallow's grind is **upkeep against
decay**: the number falls when you look away, attention is the scarce resource,
and the story is exactly the shape of what you chose to look at.

Same thirty-second loop. Opposite moral valence. The grind stops being what the
story is quietly *about* and becomes the thing the story *is*: levelling
somebody up is an act of love with an opportunity cost measured in other
people, and the ending is a list of who you kept.

### The world

Ashcombe valley was flooded to fill a reservoir. The people were moved out;
not all of them got out. A shadow-cutter can still take a shadow from anything
that remembers a person — a coat on a peg, a name cut into a lintel, a chair, a
photograph, a stone. You have your teacher's rack, her lamp, and her Book.

**The Works** built the dam, issues performance licences, and is quietly buying
up every copy of the Book. **The Gilt** is the rival troupe: a carbide lamp,
forty puppets whose names they've never learned, and the licensed version of
what happened at Ashcombe, playing one town ahead of you the whole way round.

### The core loop

1. **Walk the road** to the next town (the reservoir is a ring; the road goes
   round it once).
2. **Find what remembers somebody** and cut the shadow. This is the catching
   loop and it is exploration, not random encounters — objects are placed, and
   the ones you miss stay missed.
3. **Perform** in the evening: the grind unit, ~90 seconds, described below.
4. **Tend, by lamplight, before you sleep.** You get a few hours. Mend a joint,
   re-dye a patch, oil a rod, sit with one and go over its lines — each is a
   small hand action on *one* shadow, and there are never enough hours for the
   rack. This is where the scarcity is actually spent, and it is where
   affection forms: you bond with what you maintain by hand.
5. **Fade** overnight — whatever you did not tend.
6. Repeat. Somewhere in there, decide who gets a **last performance**.

### The performance — the battle system

The lamp is behind a linen screen and the audience is on the other side. You
hold **two rods**: two shadows on the screen at once (shoulder buttons hold
left and right hand; d-pad swaps from the rack).

A scene from the Book is ~24 **beats**, one every 1.5–2 seconds — casting under
time pressure, not a rhythm chart. Each beat calls for a **register**:

    GRIEF   DEFIANCE   COMEDY   TENDERNESS   DREAD   WONDER

Six is a type chart you can hold in your head. On a beat you need the right
shadow *up*, and you press A to play one of its **bits** — a line it has
learned, which has its own register, so a character can reach outside its
nature once it has been taught to.

Three things make it a system rather than a matching game:

- **Where you hold it is a dial** (up and down). Pressed against the sheet:
  small, hard-edged, detailed. Carried back towards the lamp: huge and soft.
  (That is the actual physics, and it is worth getting the right way round —
  the first draft of this document had it backwards.) Three zones, so every
  shadow reads three ways off one drawing, and the skill lives in the
  transitions between them.
- **Two rods means duets.** Two shadows in one beat combine registers. Pairs
  develop **rapport** by being played together — an actual relationship stat
  *between* members of the collection, which is the thing Pokémon never had.
  A pair with rapport turns a mismatched beat into a hit.
- **Eclipse.** Bring two shadows until they merge and you get one silhouette —
  transformations, monsters, an embrace. A merge is how you reach a register
  neither one owns.

**Crowd warmth** is the health bar and it runs both ways. Warm: money, and
every shadow you used gains sharpness. Cold: they walk out, and the shadows you
used *dim*. A performance that goes badly costs you the roster, not a game
over. There is no death in this game and nothing is ever deleted.

### Progression — three axes, none of them an XP bar

- **Sharpness** (0–100, decays daily). At 0 a shadow goes **blank**: a
  featureless cutout, still carried, unable to hold a register. Recoverable at
  a shrine, but a night at a shrine is a day the rest of the rack keeps fading.
- **Bits.** New lines unlock by playing a shadow in a register it barely
  reaches — you level someone by asking them to do something hard.
- **Rapport.** Per pair, earned by duetting.

All three are *records of what you did with them*. None is a number that only
goes up.

### The maths that makes it a decision

Fade is ~4/day; a warm performance restores 20–40 across the shadows used; a
show uses 4–6 shadows. Out of fifty, the rack you can hold bright is about
eight to twelve — and this should be **asserted in a test**, not hoped for. The
game tells the player this honestly in the register rather than hiding it.

Fade is gentle in the first act and never destroys anything. What you lose is
what somebody *could do*, not the person; the Book keeps their line for ever.

### What a bright shadow opens

A shadow is not only a card in a show. Carry someone bright and **the road
treats you differently**: the lock gates open for a troupe carrying Hob Marrow
sharp enough to be recognised, a chapel unbars for a shadow they buried, a farm
shuts its door on a man they never forgave. Recognition is checked against
sharpness — so *the person you chose to keep is also the map you get*.

That is Pokémon's passport fused with UG's riding: the collectible has to
change how you move through the world, not just what you do in a fight. It also
makes the nightly tending choice bite twice, because you are picking a cast and
a route with the same decision.

And **the town reads your rack in public.** Some of these fifty were not liked.
Walking into a town holding a bright shadow of somebody they were glad to see
drowned is a statement, and they will make one back. That is UG's
cosmetics-as-status with something at stake: what you display is who you
decided to remember.

### The drawdown

Twice in a run the Works draws the reservoir down and Ashcombe comes back up
out of the mud — rooftops, the lane, the church, the lock, everything soft and
black and lit sideways. It is dark, it is timed, and it is where the shadows
worth having are. Miss what is down there and it goes back under.

That is UG's caves: a bounded, spatial, faintly frightening space the rest of
the loop does not provide. It also gives the ring road a shape, because the
drawdown is the act break.

### Retirement — the mercy valve, and the real question

A **last performance** plays a shadow's own story. If the crowd is warm at the
end they are **sealed**: permanently at full brightness, moved into the Book,
and taken out of the rack for good. It is the only permanent act in the game
and you get roughly twelve, one per town.

So the game's actual question is: *which twelve of these fifty people get
finished?* Everything else is in service of that.

Sealed shadows return in the finale as the chorus. The endgame cast is exactly
the people you chose to complete — which means the last scene of the game is
different in a way you authored, without a single branch in the script.

### Easy in, long to master

The performance as specified — two rods, six registers, a distance dial,
duets, eclipse, bits with their own registers — is far too much for minute one.
It has to arrive in a ladder, and the fade economy has to stay switched off
until the player knows what it is for.

**The way in.**

| when | what is added | what the player is doing |
| --- | --- | --- |
| show 1 | one rod, one shadow, three beats, one register | press A on the beat. The crowd warms whatever happens |
| show 2 | two registers, swapping on the d-pad | casting |
| show 3 | the distance dial | one line from your teacher, then it is yours |
| show 5 | the second rod | two hands |
| show 8 | duets — and the first rapport, *noticed rather than taught* | reading pairs |
| act 2 | eclipse, the last three registers, the first seal offered | the whole instrument |

**Three things the first act must not do.**

- **No fade.** A new player who has not understood tending would lose the rack
  in week one and read it as the game being unfair. Fade switches on with the
  first drawdown, at the act break, and it is announced.
- **The first blank is scripted.** Somebody you cannot save goes blank as a
  story beat — so the lesson is taught by the story at no cost to a choice the
  player made, and afterwards they know exactly what is at stake.
- **No seal until act two.** The one irreversible act in the game is not
  offered to somebody who does not yet understand what it costs.

**Where the ceiling is.** Five axes, and the last one is the reason this can
stay interesting for a very long time.

1. **Casting ahead.** You see three or four beats coming. To land beat N+2 your
   off hand must already be reaching while beat N is playing. Novices play
   reactively and lose the transitions; a good player's hands are permanently
   two beats in front of the lamp. It is also legible to anyone watching, which
   is the witness principle doing work.
2. **The dial is analogue.** A GRIEF beat can be met safely with a
   grief-natured shadow at its comfortable zone, or met by dragging one
   *through* the transition at the right instant — harder, and worth far more,
   because the crowd sees the shift. Novices park at one distance. Masters are
   never still.
3. **Rapport is knowledge, not a stat.** Fifty shadows is 1,225 pairs; a
   minority have rapport and none of it is listed. The long tail of mastery is
   simply knowing your rack — the type-chart pleasure, about people.
4. **The meta.** Which twelve to seal, knowing a seal takes them out of the
   rack. Sealing your best GRIEF shadow in act two is a genuine loss.
5. **Levelling *is* the risky play.** A shadow only learns a new bit when it is
   played in a register it barely reaches. There is no safe grind: the only way
   to progress anyone is to ask them for something they are not good at yet, in
   front of a crowd, with the rack's brightness on the line. Mastery and
   progression are the same action, which is what stops the long game from
   turning into a treadmill.

### Where the Pokémon parts landed

| Pokémon | Tallow |
| --- | --- |
| 151 creatures | 50 shadows, each a person with one line of who they were |
| Pokédex | **the register** — every shadow, where it was cut, how bright it is now |
| Levels | sharpness + bits + rapport |
| Type chart | six registers, plus near/far reading the same puppet two ways |
| Gym leaders | towns that only want certain registers, and won't book you otherwise |
| The rival | **the Gilt**, playing the licensed version one town ahead |
| Team Rocket | **the Works**, which also collects shadows, and files them |
| Lavender Town | the shrine of blanks, and the water |
| The box (free, infinite, guiltless) | **the rack (finite attention, and it costs)** |

### Where the UG parts landed

| UG | Tallow |
| --- | --- |
| taming, feeding, raising | tending by lamplight, nightly and rationed |
| riding | a bright shadow opens the road and is recognised on it |
| cosmetics as status | the town reads your rack, and has opinions about it |
| caves and open maps | the drawdown, when Ashcombe surfaces |
| tribes, trade, co-op | not available — single player, no network. NPC troupes on the same road are an honest but lesser substitute |
| endless by design | **not borrowed.** The seal is final and the run ends |

### Art style — deliberately not this repo's

Every other game here is the poster look: ink outline grown under a flat fill.
Tallow's separating rule is one line:

> **No ink outlines anywhere. Fill only. Value does all the work.**

- **Everything animate is a silhouette** in a new palette entry `shade` (near
  black, *not* `PALETTE.ink`), drawn as `inkOnly` layers with `layer.fill`.
  Cheap, and it is why fifty characters is affordable: a character is a
  silhouette recipe plus a posture, not a sprite sheet.
- **Everything behind is the lit sheet**: four to six horizontal bands of a
  lamp ramp with the joins dithered through the existing `alpha` Bayer path, so
  the backdrop reads as glowing linen rather than a flat poster sky. Time of
  day is the gradient.
- **Colour arrives only as dyed paper.** Each character owns exactly one accent
  shape — a sash, a tool, an eye. That is the only saturated colour on screen,
  and it is how you tell two silhouettes apart at a glance.
- **The matte is warm** (`soot`, not ink) with a soft vignette, so the frame
  reads as the edge of a lamp rather than a letterbox.
- **One plane.** No perspective, no iso, no 3D. Cutouts on a sheet.

Implementation notes:

- New palette group in `gfx/palette.js` (`shade`, `linen`, `tallowLit`,
  `tallowDim`, `soot`, the dye accents), all through `ntscSafe`, like every
  other colour here. No ad-hoc hex in the game file.
- `test/invariants.js`'s `noFlicker` only checks `PALETTE.ink` exactly. A
  CRT does not care what we named the colour, so **the game's own test runs the
  flicker check against `shade` too.** Big silhouettes pass it trivially; the
  point is that a thin rod or a hair could not sneak in.
- `pictureNotEmpty` counts non-`ink` pixels, and silhouettes here are `shade`,
  so it passes without gaming it.

### Audio

Chiptune, own register: **no kit**. `K` is a frame drum, `S` a rim, `h` a
shaker. Modal rather than the minor-key idiom `vice` and `dragnet` use. The
mixer has one bed, so warmth changes the *track*, the way border switches
`patrol` → `chase`; it cannot layer.

| track | when |
| --- | --- |
| `tallow` | title, the register, the road |
| `ashcombe` | the water, and anything about the valley |
| `lamplight` | a performance with a cold crowd |
| `warmth` | the same tune, warm arrangement — a separate score file |
| `gilt` | the rival troupe: brass, march, slightly wrong |
| `wake` | a last performance |
| `blank` | the shrine |

### Saves — three slots

`~/.gamepi/tallow.json` (`scores.DIR`), `{ version, slots: [a, b, c] }`,
persistence injectable as `options.save` with `memoryStore()` for tests —
meadowlark's pattern exactly, so there is one way saving works in this repo.

- Title menu: **NEW ADVENTURE / CONTINUE / HOW TO / QUIT** (the shell requires
  the QUIT entry; `test/shell.test.js` walks it).
- Both entries land on the same three-slot card. A slot shows troupe name, day,
  town, bright / blank / sealed counts, and playtime; an empty slot says so.
- NEW ADVENTURE onto an occupied slot needs a confirm card. Saves are written
  at each dawn and at each seal.
- `SAVE_VERSION` gets bumped whenever the run shape changes; an old save is
  ignored, never half-loaded.

### Shape in the repo

    src/games/tallow.js          menus, road, town, performance, the run
    src/games/tallow/cast.js     the fifty, validated at require time
    src/games/tallow/book.js     scenes as beat sheets, with their registers
    src/games/tallow/towns.js    the ring road: towns, bookings, what is cut where
    src/games/tallow/shadow.js   silhouette recipes -> scene shapes
    src/music/tallow.js …        seven scores
    test/tallow.test.js

`meta`: `{ players: [1], rating: '13', audio: '8-bit', graphics: '2d',
content: ['a drowned town', 'the dead remembered'] }`.

A cast entry:

    {
      id: 'marrow',
      name: 'HOB MARROW',
      was: 'lock-keeper; last man off the valley floor',
      near: 'grief', far: 'dread',      // the same puppet, two ways to hold it
      accent: 'ember',                   // the one dyed patch
      cut: { town: 'weir', from: 'a keeper\'s coat still on its peg' },
      build: [ /* silhouette recipe */ ],
      bits: [{ line: 'THE GATES HELD.', register: 'defiance', at: 2 }],
      fade: 4,
    }

**What throws at require time** (the house rule — angels' `ROOMS`, kingpin's
`PLACES`, `song.validate`, `manifest.validate`):

- every id unique; every register on the list of six; every accent a real
  palette name; every `cut.town` a real town on the road.
- every Book scene is **castable** from the shadows reachable by the time it
  can be booked. This is angels' "no gate is locked behind the key it holds",
  transposed: a scene demanding WONDER in a town you reach before any WONDER
  shadow exists is unfinishable in a way playing the first act would never
  show you.
- no line over the width the box wraps at.

### Tests

- cast + book validation, and the castability walk above.
- **the fade budget**: simulate a full run and assert the bright rack settles
  between 8 and 12. That number is the game; it should fail the build if it
  drifts.
- deterministic replay from seed + inputs, `scene()` free of side effects —
  the two the repo already demands of every game.
- `test/invariants.js` at every reachable screen, plus the extra flicker pass
  against `shade`.
- save round-trip, version rejection, three slots independent, overwrite.
- a mediocre-player bot that plays a whole run to the finale over four seeds,
  three of which have to finish — the angels/knuckles standard.

### Build order

1. Palette group, `shadow.js`, one silhouette on a lit sheet, `--serve`.
   **Prove the look before anything else**, because the whole art direction is
   one bet.
2. The performance, standalone: one scene, six registers, three shadows, the
   distance dial. This is the game. If it isn't good after twenty minutes of
   play, everything below is decoration on a bad loop — stop and re-cut it here.
3. Rack, sharpness, bits, rapport, and the lamplight tending screen —
   the fade number is worthless until the hours spent against it are a choice.
4. Road, three towns, cutting shadows from objects, recognition at the gates.
5. Save slots.
6. Fill: fifty cast entries, ~12 Book scenes, the ring road.
7. The drawdown.
8. The Gilt, the last performance, the finale chorus.

### Roads not taken

- *The grind as debt* (every recruit costs something recurring) — same maths,
  meaner, and it makes the collection feel like a liability rather than a
  responsibility.
- *The grind as teaching* (you train apprentices who then leave and live badly
  or well) — a strong idea, but the payoff is all epilogue, and the moment-to-
  moment loop is much harder to make good.
- *Straight monster-collecting with a dark second act* — the honest version of
  Pokémon-with-a-twist, and the reason not to do it is that the twist arrives
  after the twenty hours it is supposed to recontextualise.

## Part 4 — What exists

Built and passing (`npm test`: 403 tests, 15 of them Tallow's):

    src/gfx/palette.js          + shade, soot, and a five-step lamp ramp
    src/games/tallow.js         menu, rack, how-to, the performance, pause, result
    src/games/tallow/registers  the six, and the three zones of the dial
    src/games/tallow/shadow.js  the silhouette builder, and six of the fifty
    src/games/tallow/book.js    two pages, validated at require time
    src/music/{tallow,lamplight,warmth}.js
    test/tallow.test.js

It is the performance screen and nothing else: no road, no towns, no save
slots, no fade. Those were always steps 4–6, and they are worth writing only
now that the two bets underneath them have been settled.

**Bet one — do silhouettes read?** Yes. Six characters built from one
parametric recipe plus one patch of dyed paper are distinguishable at 720×480,
at both ends of the dial, and the game looks nothing like anything else in this
repo. The test that holds it is a column-profile comparison, so the fiftieth
shadow cannot quietly become the ninth again.

**Bet two — does casting under time pressure work on a d-pad?** The shape is
right and it needs playing. Up and down carry the active rod between the sheet
and the lamp, left and right walk the rack, B changes hands, A plays the beat.
`BEAT_TIME` is 1.7s, the window ±0.30s. Those three numbers are the game and
they are the first thing to re-tune with a pad in hand.

**Four things the first render was wrong about**, all now fixed, all of them
invisible until it was on screen: the sharp end of the dial was small enough
to stop being a person (`SIZE_MIN` 92 → 124); the crowd thinned off the
left-hand end of the room instead of out of it; the lamp's glow was one
dithered disc and so had a hard circular rim; and the rack page printed cream
prose on a lit sheet. The one that mattered most was the last — it was
literally unreadable, and it took looking at a PNG to see.

**Known, not yet addressed.** A frame costs ~2.1 ms on this Mac, and the three
alpha layers (gradient joins, glow, penumbra) are most of it. Each is a scratch
canvas plus a full-frame dither copy, so this is the number to watch first on
the Pi against the 33 ms budget; `scripts/pi-run.sh` prints it.

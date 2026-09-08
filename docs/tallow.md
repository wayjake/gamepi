# Tallow — creatures of the drowned valley

Tallow is now a playable creature-collecting adventure. The old performance
prototype is preserved in `src/games/tallow/theatre.js`; its original design
notes live in [tallow-theatre-concept.md](tallow-theatre-concept.md). It is no
longer the main game.

## The journey

Explore four regions around and beneath Ashcombe reservoir: Lantern Bank,
Sunken Marsh, Cold Kiln and Ashcombe Below. Each contains a free healing camp,
three repeatable creature habitats and a keeper. Defeating a keeper opens the
next region. Camps let you return to any unlocked region. Defeat the final
keeper to wake the valley; you can keep exploring to complete the collection.

You start with Wicklet. The twelve creatures have names, lore, elemental
identities and cut-paper bodies. Battle with a chosen companion, switch to
another, and automatically bring in a healthy friend when one falls. Losing
returns everyone safely to camp. No collection decay or permanent losses.

## Controls

- D-pad: walk or choose a menu action.
- A: inspect a nearby habitat, rest, travel, or confirm a battle action.
- B: open your creatures while exploring; switch during battle; back in menus.
- Collection: left/right browse, A set your lead, SELECT kindle with wax.
- Camp: left/right choose an unlocked destination, A travel, SELECT collection.
- START: pause. SELECT on the pause screen saves and returns to the menu.

## Battles and growth

Battles wait for your input. STRIKE costs nothing and leaves unfamiliar wild
creatures at least one HP, so an overleveled friend cannot prevent collection.
BEFRIEND succeeds at half health or below, without consumables or a random
failure roll. Keepers cannot be befriended; previously collected creatures
remain repeatable training encounters.

WILD ART spends one of three sparks. Ember beats moss, moss beats tide, tide
beats ember. SHELTER restores a spark and some health while reducing incoming
damage. Enemies announce their third-turn surge; shelter or switch accordingly.
Swapping to another creature costs a turn. Retreat is free.

Wins and new friendships award experience to participants and wax. Levels
raise health and power (cap 12). Wax buys three permanent kindling upgrades per
creature, increasing stats, body size and visible lights. Repeatable habitats
support deliberate training before a keeper. Camps restore the entire roster.

## Saves and implementation

Progress saves after battles, kindling, camp visits, travel, companion changes
and pause-menu exits to `~/.gamepi/tallow.json` (or under `GAMEPI_HOME`). Writes
use a temporary file and rename. Loading restores companions to full health
at the current region's camp. An unreadable save starts a fresh session; write
failures are shown in-game. Explicit seeded instances use memory unless a save
store is supplied, so tests and previews cannot overwrite a real journey.

- `src/games/tallow.js`: input, adventure state, battle resolution, persistence.
- `src/games/tallow/world.js`: bestiary, region data and progression rules.
- `src/games/tallow/view.js`: silhouettes, maps and all adventure screens.
- `test/tallow-adventure.test.js`: full fresh campaign, collection, growth,
  travel, save reload, battle costs and recovery checks.
- `test/tallow.test.js`: preserved theatre prototype and art regression checks.

The art keeps the old lamp palette, filled silhouettes, glowing accents and
low-resolution typography. No image assets or dependencies are required.

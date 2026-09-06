'use strict';
// City of Angels -- an overhead adventure across three parts of Los Angeles.
//
// The other three games in here fit in a screenful of state. This one does not:
// it has a map, an inventory, a script, three bosses and an ending, and the
// only reason it still obeys the game contract is that all of that is *data*
// and the state machine over it stays small. update() advances one fixed step,
// scene() draws whatever the state currently is, and neither knows there is a
// story going on.
//
// The two rules worth knowing before changing anything here:
//
//   Rooms are static, entities are not. A room's tiles never change once it has
//   been entered, so the shapes for them are built once in enter() and cached;
//   the frame loop only ever rebuilds the handful of shapes that move. On the
//   Pi that is the difference between this drawing in 3 ms and in 30.
//
//   Nothing is a pixel measurement. Everything is in tiles, and TILE is derived
//   from the picture rectangle at construction, so the whole game rescales with
//   whatever safe area gfx/safearea.js reports rather than assuming 720x480.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));    // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'angels';

// --- the shape of a screen ---------------------------------------------------
//
// 20 by 11 tiles, which is the original overhead-adventure grid and not a
// coincidence: it is the widest a room can be before a player standing in one
// corner stops being able to read what is in the other.
const COLS = 20;
const ROWS = 11;

// Where a room joins the next one. Two tiles wide is enough to walk through
// without aiming and narrow enough to read as a doorway.
const DOOR_COLS = [9, 10];
const DOOR_ROWS = [5, 6];

// --- tiles -------------------------------------------------------------------
//
// A map is eleven strings of twenty characters. The perimeter is overwritten at
// load time with the region's wall and then carved wherever the room has an
// exit, so a map only has to describe its inside and no room can be authored
// with a door that leads into a wall.
const GLYPH = {
  '.': 'ground',
  ',': 'kerb',
  '#': 'wall',
  x: 'fence',
  t: 'tent',
  c: 'cart',
  '=': 'bench',
  T: 'tree',
  o: 'bin',
  '~': 'water',
  _: 'plank',
  '*': 'star',
};
const SOLID = new Set(['wall', 'fence', 'tent', 'cart', 'bench', 'tree', 'bin', 'water']);

// --- regions -----------------------------------------------------------------
//
// A region is a palette and a soundtrack. Nothing else about a room changes
// between them, which is deliberate -- the player should be able to tell where
// they are from one glance at the ground colour and one bar of the music.
const REGIONS = {
  skid: {
    name: 'SKID ROW',
    track: 'skidrow',
    accent: PALETTE.ember,
    ground: PALETTE.stoneDim,
    kerb: PALETTE.stone,
    wall: PALETTE.bark,
    wallTrim: PALETTE.barkDim,
    mote: PALETTE.creamDim,   // paper, going past at ankle height
  },
  venice: {
    name: 'VENICE',
    track: 'venice',
    accent: PALETTE.sky,
    ground: PALETTE.sand,
    kerb: PALETTE.sandLit,
    wall: PALETTE.creamDim,
    wallTrim: PALETTE.bark,
    mote: PALETTE.sandLit,    // blown sand
  },
  hollywood: {
    name: 'HOLLYWOOD',
    track: 'hollywood',
    accent: PALETTE.sun,
    ground: PALETTE.stone,
    kerb: PALETTE.stoneLit,
    wall: PALETTE.violetDim,
    wallTrim: PALETTE.violet,
    mote: PALETTE.roseDim,    // handbills
  },
};

// --- the map -----------------------------------------------------------------
//
// Rooms name each other rather than sitting on a coordinate grid. The grid came
// first and was thrown away: three regions that each want to be a corridor do
// not lay out on one without either holes in the middle or geography that lies
// about where Venice is.
//
// `need` on an exit is an inventory flag. A locked exit has its doorway filled
// with fence rather than being left open and refused, because a door you can
// walk into and not through is a bug the player has to be told about, and a
// padlock is not.
const ROOMS = {
  // --- Skid Row -------------------------------------------------------------
  bridge: {
    region: 'skid',
    name: 'SIXTH ST BRIDGE',
    map: [
      '####################',
      '#..t............t..#',
      '#..................#',
      '#..##........##....#',
      '#..##........##....#',
      '#..................#',
      '#..................#',
      '#..##........##....#',
      '#..##........##....#',
      '#....c........c....#',
      '####################',
    ],
    exits: { north: { to: 'lane' } },
    npcs: [
      { id: 'sarge', col: 6, row: 5 },
      { id: 'nico', col: 14, row: 5 },
    ],
    spawns: [],
  },

  lane: {
    region: 'skid',
    name: 'TOWNE LANE',
    map: [
      '####################',
      '#tt..............tt#',
      '#tt..............tt#',
      '#..................#',
      '#....===....===....#',
      '#..................#',
      '#..................#',
      '#..c..........c....#',
      '#tt..............tt#',
      '#tt..............tt#',
      '####################',
    ],
    exits: { south: { to: 'bridge' }, north: { to: 'crossing' }, west: { to: 'alley' } },
    npcs: [
      { id: 'gloria', col: 6, row: 5 },
      { id: 'dee', col: 15, row: 5 },
    ],
    spawns: [['drifter', 4, 3], ['drifter', 15, 3], ['drifter', 15, 7]],
  },

  alley: {
    region: 'skid',
    name: 'COLD STORAGE',
    map: [
      '####################',
      '#...o........o.....#',
      '#..................#',
      '#.####......####...#',
      '#.####......####...#',
      '#..................#',
      '#..................#',
      '#.####......####...#',
      '#.####......####...#',
      '#....o........o....#',
      '####################',
    ],
    exits: {
      east: { to: 'lane' },
      west: { to: 'canals', need: 'cutters', locked: 'A chain and a padlock as thick as your wrist. Somebody took the cutters.' },
    },
    npcs: [],
    spawns: [['crack', 5, 2], ['drifter', 14, 2], ['drifter', 7, 6], ['crack', 12, 6]],
    pickups: [{ kind: 'heart', col: 10, row: 5 }],
  },

  crossing: {
    region: 'skid',
    name: 'THE CROSSING',
    map: [
      '####################',
      '#..................#',
      '#..xx........xx....#',
      '#..................#',
      '#....==......==....#',
      '#..................#',
      '#..................#',
      '#....==......==....#',
      '#..................#',
      '#..xx........xx....#',
      '####################',
    ],
    exits: { south: { to: 'lane' }, north: { to: 'cartking' } },
    npcs: [],
    pickups: [{ kind: 'heart', col: 10, row: 8 }],
    spawns: [['drifter', 4, 5], ['drifter', 15, 5], ['drifter', 10, 6], ['crack', 6, 3], ['crack', 13, 3]],
  },

  cartking: {
    region: 'skid',
    name: 'FOURTH ST UNDERPASS',
    map: [
      '####################',
      '#..................#',
      '#.##............##.#',
      '#.##............##.#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#.##............##.#',
      '#.##............##.#',
      '#..................#',
      '####################',
    ],
    exits: { south: { to: 'crossing' } },
    npcs: [],
    spawns: [],
    boss: 'cartking',
  },

  // --- Venice ---------------------------------------------------------------
  canals: {
    region: 'venice',
    name: 'THE CANALS',
    map: [
      '####################',
      '#,,,,,,,,,,,,,,,,,,#',
      '#..................#',
      '#.~~~~~~~..~~~~~~~.#',
      '#.~~~~~~~..~~~~~~~.#',
      '#..................#',
      '#..................#',
      '#.~~~~~~~..~~~~~~~.#',
      '#.~~~~~~~..~~~~~~~.#',
      '#..................#',
      '####################',
    ],
    exits: { east: { to: 'alley' }, north: { to: 'oceanfront' } },
    npcs: [{ id: 'pete', col: 16, row: 6 }],
    spawns: [['drifter', 5, 5], ['drifter', 14, 5], ['thrower', 10, 2]],
  },

  oceanfront: {
    region: 'venice',
    name: 'OCEAN FRONT WALK',
    map: [
      '####################',
      '#,,,,,,,,,,,,,,,,,,#',
      '#..T....T....T...T.#',
      '#..................#',
      '#.____________.....#',
      '#.____________.....#',
      '#..................#',
      '#..T....T....T...T.#',
      '#..................#',
      '#,,,,,,,,,,,,,,,,,,#',
      '####################',
    ],
    exits: {
      south: { to: 'canals' },
      west: { to: 'muscle' },
      north: { to: 'station', need: 'pass', locked: 'The stairs down to the platform are gated. RED LINE PASS HOLDERS ONLY, and it means it.' },
    },
    npcs: [{ id: 'sunny', col: 16, row: 6 }],
    spawns: [['crack', 4, 3], ['drifter', 15, 3], ['thrower', 4, 8], ['thrower', 15, 8]],
    pickups: [{ kind: 'spray', col: 10, row: 5 }, { kind: 'heart', col: 10, row: 8 }],
  },

  muscle: {
    region: 'venice',
    name: 'MUSCLE BEACH',
    map: [
      '####################',
      '#,,,,,,,,,,,,,,,,,,#',
      '#....==......==....#',
      '#..................#',
      '#..o..o......o..o..#',
      '#..................#',
      '#..................#',
      '#..o..o......o..o..#',
      '#....==......==....#',
      '#,,,,,,,,,,,,,,,,,,#',
      '####################',
    ],
    exits: { east: { to: 'oceanfront' }, north: { to: 'boardwalk' } },
    npcs: [],
    spawns: [['bruiser', 5, 3], ['crack', 5, 6], ['crack', 14, 6], ['pcp', 10, 5]],
    pickups: [{ kind: 'paint', col: 10, row: 3 }],
  },

  boardwalk: {
    region: 'venice',
    name: 'THE BOARDWALK',
    map: [
      '####################',
      '#..................#',
      '#.##..##....##..##.#',
      '#.##..##....##..##.#',
      '#..................#',
      '#.________________.#',
      '#.________________.#',
      '#..................#',
      '#.##..##....##..##.#',
      '#.##..##....##..##.#',
      '####################',
    ],
    exits: { south: { to: 'muscle' }, north: { to: 'pier' } },
    npcs: [{ id: 'rue', col: 16, row: 1 }],
    spawns: [['thrower', 4, 4], ['thrower', 15, 4], ['crack', 7, 7], ['crack', 12, 7], ['bruiser', 10, 1]],
    pickups: [{ kind: 'heart', col: 10, row: 4 }, { kind: 'paint', col: 10, row: 7 }],
  },

  pier: {
    region: 'venice',
    name: 'THE PIER',
    map: [
      '####################',
      '#..................#',
      '#.~~~..........~~~.#',
      '#.~~~..........~~~.#',
      '#..................#',
      '#........__........#',
      '#........__........#',
      '#..................#',
      '#.~~~..........~~~.#',
      '#.~~~..........~~~.#',
      '####################',
    ],
    exits: { south: { to: 'boardwalk' } },
    npcs: [],
    spawns: [],
    boss: 'prophet',
  },

  // --- Hollywood ------------------------------------------------------------
  station: {
    region: 'hollywood',
    name: 'RED LINE PLATFORM',
    map: [
      '####################',
      '#..................#',
      '#.#######..#######.#',
      '#.................,#',
      '#,,,,,,,,,,,,,,,,,,#',
      '#..................#',
      '#..................#',
      '#,,,,,,,,,,,,,,,,,,#',
      '#.#######..#######.#',
      '#..................#',
      '####################',
    ],
    exits: { south: { to: 'oceanfront' }, north: { to: 'blvd' } },
    npcs: [{ id: 'stan', col: 16, row: 6 }],
    spawns: [['drifter', 5, 5], ['drifter', 14, 5], ['crack', 10, 3]],
    pickups: [{ kind: 'boombox', col: 10, row: 6 }],
  },

  blvd: {
    region: 'hollywood',
    name: 'HOLLYWOOD BLVD',
    map: [
      '####################',
      '#.####.......####..#',
      '#.####.......####..#',
      '#..................#',
      '#..*..*..*..*..*...#',
      '#..................#',
      '#..................#',
      '#..*..*..*..*..*...#',
      '#..................#',
      '#.####.......####..#',
      '####################',
    ],
    exits: { south: { to: 'station' }, east: { to: 'fame' }, north: { to: 'capitan' } },
    npcs: [],
    spawns: [['crack', 5, 5], ['crack', 14, 5], ['bruiser', 8, 3], ['pcp', 10, 8]],
    pickups: [{ kind: 'juice', col: 10, row: 6 }],
  },

  fame: {
    region: 'hollywood',
    name: 'WALK OF FAME',
    map: [
      '####################',
      '#..................#',
      '#.*.*.*.*.*.*.*.*..#',
      '#..................#',
      '#..==..==..==..==..#',
      '#..................#',
      '#..................#',
      '#..==..==..==..==..#',
      '#..................#',
      '#.*.*.*.*.*.*.*.*..#',
      '####################',
    ],
    exits: { west: { to: 'blvd' } },
    npcs: [],
    spawns: [['pcp', 5, 5], ['pcp', 14, 5], ['thrower', 10, 1]],
    // The only heart container that is not behind a boss. This room is a
    // dead end off the main line, so it exists to reward looking.
    pickups: [{ kind: 'container', col: 10, row: 6 }, { kind: 'paint', col: 3, row: 1 }],
  },

  capitan: {
    region: 'hollywood',
    name: 'EL CAPITAN ALLEY',
    map: [
      '####################',
      '#..................#',
      '#.##..........##...#',
      '#.##..........##...#',
      '#....o......o......#',
      '#..................#',
      '#..................#',
      '#....o......o......#',
      '#.##..........##...#',
      '#.##..........##...#',
      '####################',
    ],
    exits: { south: { to: 'blvd' }, north: { to: 'theatre' } },
    npcs: [{ id: 'usher', col: 3, row: 1 }],
    spawns: [['bruiser', 5, 5], ['crack', 7, 1], ['crack', 12, 1], ['pcp', 10, 6]],
    pickups: [{ kind: 'heart', col: 10, row: 5 }, { kind: 'juice', col: 16, row: 5 }],
  },

  theatre: {
    region: 'hollywood',
    name: 'THE FORECOURT',
    map: [
      '####################',
      '#..................#',
      '#..*............*..#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..*............*..#',
      '#..................#',
      '####################',
    ],
    exits: { south: { to: 'capitan' } },
    npcs: [],
    spawns: [],
    boss: 'director',
  },
};

const START = { room: 'bridge', col: 10, row: 7 };

// Authoring a map wrong is the easiest mistake to make in this file and the
// hardest to see, so it is checked once, here, at load.
for (const [id, room] of Object.entries(ROOMS)) {
  if (room.map.length !== ROWS) throw new Error(`room ${id}: ${room.map.length} rows, expected ${ROWS}`);
  room.map.forEach((line, r) => {
    if (line.length !== COLS) throw new Error(`room ${id} row ${r}: ${line.length} columns, expected ${COLS}`);
    for (const ch of line) if (!GLYPH[ch]) throw new Error(`room ${id} row ${r}: unknown tile "${ch}"`);
  });
  if (!REGIONS[room.region]) throw new Error(`room ${id}: unknown region ${room.region}`);
  for (const [side, exit] of Object.entries(room.exits)) {
    if (!ROOMS[exit.to]) throw new Error(`room ${id}: ${side} exit leads to unknown room ${exit.to}`);
  }
}

// --- who is in the street ----------------------------------------------------
//
// Five kinds, and the difference between them is meant to be legible from
// across a room before it is legible from the health bar: colour, size, and how
// they move. `tough` ignores knockback, which is the single biggest change to
// how a fight feels -- everything else can be shoved off you and one thing
// cannot.
const KINDS = {
  drifter: {
    label: 'DRIFTER', hp: 3, speed: 34, damage: 1, points: 20, size: 1,
    body: PALETTE.moss, head: PALETTE.cream, trim: PALETTE.barkDim,
  },
  bruiser: {
    label: 'BRUISER', hp: 6, speed: 48, damage: 1, points: 40, size: 1.15,
    body: PALETTE.ember, head: PALETTE.cream, trim: PALETTE.bark,
  },
  // Fast, erratic, and made of nothing: it will be on you before you have
  // finished a swing and it dies to that swing.
  crack: {
    label: 'WIRED', hp: 3, speed: 112, damage: 1, points: 60, size: 0.9,
    body: PALETTE.sun, head: PALETTE.cream, trim: PALETTE.emberDim, jitter: true,
  },
  // The hard one. Slower than the wired but it does not stop, does not flinch,
  // and takes two hearts a touch. Fighting one with the bat alone is a mistake
  // you make once.
  pcp: {
    label: 'GONE', hp: 12, speed: 54, damage: 2, points: 110, size: 1.3,
    body: PALETTE.violet, head: PALETTE.creamDim, trim: PALETTE.violetDim,
    tough: true, charge: true,
  },
  thrower: {
    label: 'BOTTLER', hp: 4, speed: 26, damage: 1, points: 70, size: 1,
    body: PALETTE.rose, head: PALETTE.cream, trim: PALETTE.roseDim, ranged: true,
  },
};

// --- what you can hit them with ----------------------------------------------
//
// The bat is always there and costs nothing. The other two cost something and
// are worth more than they cost, which is the only interesting thing a
// secondary weapon can be.
const WEAPONS = {
  bat: { name: 'BAT', damage: 2 },
  spray: { name: 'SPRAY', damage: 2, ammo: 'paint', cost: 1, sound: 'spray' },
  boombox: { name: 'BOOMBOX', damage: 5, ammo: 'juice', cost: 1, sound: 'boom' },
};
const SUBS = ['spray', 'boombox'];

const MAX_HEARTS = 14;
const START_HEARTS = 8;
const MAX_PAINT = 24;
const MAX_JUICE = 4;

// --- people ------------------------------------------------------------------
//
// The friendly half of the street. `lines` is a function of the run so that a
// person who has already told you something says the next thing instead of the
// same thing -- an NPC who repeats himself is a sign, not a character.
//
// `insists` is also a function of the run: while it holds, this person will not
// let you leave the room without having talked to them. Sarge has the bat, and
// a run without the bat cannot be won; Gloria has the plot, and the padlock
// west of Cold Storage makes no sense to somebody who has not heard it.
const PEOPLE = {
  sarge: {
    name: 'SARGE',
    body: PALETTE.mossDim, head: PALETTE.cream, trim: PALETTE.bark,
    lines: (run) => {
      if (!run.has.bat) {
        return [
          'You slept through the whole thing, kid. Nine days now, everything east of Alameda dark as a pocket.',
          'Take the bat. It was my brother\'s and he is past needing it.',
          'Gloria is up the lane. She knows more than I do, and she will feed you, which I cannot.',
        ];
      }
      if (!run.done.cartking) return ['Up the lane and then north. Keep the bat where they can see it and you will not have to use it as often.'];
      return ['You did that quiet. Down here that is the only way anything gets done at all.'];
    },
    gives: (run) => (run.has.bat ? null : 'bat'),
    insists: (run) => !run.has.bat,
  },

  nico: {
    name: 'NICO',
    body: PALETTE.skyDim, head: PALETTE.creamDim, trim: PALETTE.barkDim,
    lines: () => [
      'I am not in your way and you are not in mine. That is the entire arrangement and it has held for six years.',
      'Mind the crossing. Half of them will nod at you. The other half have not slept since Tuesday.',
    ],
  },

  gloria: {
    name: 'MAMA GLORIA',
    body: PALETTE.rose, head: PALETTE.cream, trim: PALETTE.roseDim,
    lines: (run) => {
      if (!run.met.gloria) {
        return [
          'Sit down. Eat first, hero second.',
          'Nine days without power and the only thing anybody has organised is who gets to take from who.',
          'The Cart King came through my gate and took the bolt cutters off it. Now nobody east of here can reach the water.',
          'He is under the Fourth Street bridge. Do not go polite.',
        ];
      }
      if (!run.done.cartking) return ['North twice, then under the bridge. He is bigger than he looks and slower than he thinks he is.'];
      return ['You brought the cutters back to this street. That gate west of the storage is yours whenever you want it.'];
    },
    meets: 'gloria',
    insists: (run) => !run.met.gloria,
  },

  dee: {
    name: 'DEE',
    body: PALETTE.sunDim, head: PALETTE.cream, trim: PALETTE.bark,
    lines: () => [
      'I sell shade in the summer and I sell nothing at all in the winter.',
      'Anybody comes at you sideways, they are not really seeing you. Do not take it personally. Do not take it standing still either.',
    ],
  },

  pete: {
    name: 'PELICAN PETE',
    body: PALETTE.sky, head: PALETTE.cream, trim: PALETTE.skyDim,
    lines: (run) => {
      if (!run.done.prophet) {
        return [
          'You cut Gloria\'s gate open. Word walks faster than you do.',
          'Nobody rides north without a Red Line pass and there is exactly one of them left in this city.',
          'The Prophet has it. End of the pier. He has not stopped talking since April.',
        ];
      }
      return ['The trains are not running but the gate is open, and open is most of running.'];
    },
  },

  sunny: {
    name: 'SUNNY',
    body: PALETTE.sunLit, head: PALETTE.cream, trim: PALETTE.sandDim,
    lines: () => [
      'There is a can of paint out on the boards. It reaches further than a bat and it runs out, which is life.',
      'Watch the ones throwing bottles. They lead you, so stop leading.',
    ],
  },

  rue: {
    name: 'MADAME RUE',
    body: PALETTE.violet, head: PALETTE.cream, trim: PALETTE.violetDim,
    lines: (run) => {
      if (!run.done.prophet) {
        return [
          'Twenty years of reading palms and I never saw a line like yours. It does not end. It just goes off the side of the hand.',
          'He believes every word he says. That is exactly what makes him hard to put down.',
          'Go on, then. He is waiting, and he thinks he is waiting for somebody else.',
        ];
      }
      return ['The pier is quiet tonight. I had not heard it quiet in a very long time.'];
    },
  },

  stan: {
    name: 'STAN',
    body: PALETTE.emberDim, head: PALETTE.creamDim, trim: PALETTE.stone,
    lines: () => [
      'Six years I have been an extra in the same scene and nobody has ever once called cut.',
      'That boombox on the pavement -- take it. It works once a fight. Once is usually plenty.',
    ],
  },

  usher: {
    name: 'THE USHER',
    body: PALETTE.emberLit, head: PALETTE.cream, trim: PALETTE.sunDim,
    lines: (run) => {
      if (!run.done.director) {
        return [
          'He shoots the same scene every night of his life. The forecourt. Always the forecourt.',
          'You will know when you are in it, because he will tell you what your line is.',
        ];
      }
      return ['House lights. First time in six years I have seen the house lights.'];
    },
  },
};

// --- the bosses --------------------------------------------------------------
//
// One theme, three fights, and the same contract for each: a telegraph you can
// read, a window where it cannot hurt you, and a second half that changes one
// thing rather than everything. `arena` is where it starts, in tiles.
const BOSSES = {
  cartking: {
    name: 'THE CART KING',
    room: 'cartking',
    hp: 20,
    points: 500,
    damage: 2,
    size: 2.1,
    body: PALETTE.barkLit, head: PALETTE.cream, trim: PALETTE.stone,
    gives: 'cutters',
    item: 'THE BOLT CUTTERS',
    intro: [
      'You came all the way down here for a pair of bolt cutters.',
      'Everybody comes down here for something. Nobody has ever left with it.',
    ],
    outro: [
      'He goes down the way anything built out of other things goes down: in parts, and slowly.',
      'The cutters are on the ground where the cart was. West of Cold Storage there is a gate that has been shut for nine days.',
    ],
  },

  prophet: {
    name: 'THE PROPHET',
    room: 'pier',
    hp: 28,
    points: 800,
    damage: 2,
    size: 1.8,
    body: PALETTE.creamDim, head: PALETTE.cream, trim: PALETTE.violet,
    gives: 'pass',
    item: 'THE RED LINE PASS',
    intro: [
      'The city ends tonight. I am the only man on this pier honest enough to say it out loud.',
      'Stand still. It is easier for both of us if you are standing still.',
    ],
    outro: [
      'He stops talking. The surf comes back in underneath where his voice was.',
      'The pass is in his coat, laminated, six years out of date, and the gate north will take it anyway.',
    ],
  },

  director: {
    name: 'THE DIRECTOR',
    room: 'theatre',
    hp: 36,
    points: 1200,
    damage: 2,
    size: 2,
    body: PALETTE.violetLit, head: PALETTE.cream, trim: PALETTE.sun,
    gives: null,
    item: null,
    intro: [
      'Nine days of dark and not one of you thought to look for the switch.',
      'You are all extras. Every one of you. Say your line.',
    ],
    outro: [
      'He does not have a last line. That turns out to have been the whole problem.',
      'Behind him, bolted to the wall of the forecourt, is a breaker the size of a door. It has been thrown since the ninth.',
    ],
  },
};

// --- narration ---------------------------------------------------------------
const OPENING = [
  'Four in the morning and the power has been out east of Alameda for nine days.',
  'Nobody downtown has said the word blackout yet, which is how you know how long it is going to last.',
  'You are Vee. You carry things across this city for money, and lately for nothing.',
  'Three people have carved up what is left of it. Go and take it back.',
];

const ENDING = [
  'You put your shoulder into the breaker and the forecourt goes white.',
  'It comes back street by street, east out of Hollywood, down through the flats, all the way to the river.',
  'By six the lights are on over Towne Lane and Gloria has the kitchen going and nobody is being charged for it.',
  'Nine days. It took one night and a bat that belonged to somebody else.',
  'CITY OF ANGELS',
];

const HOW_TO = [
  'MOVE      D-PAD',
  'HIT       A',
  'ITEM      B',
  'SWAP ITEM SELECT',
  'TALK      A, NEXT TO SOMEBODY',
  'PAUSE     START',
  '',
  'NOT EVERYBODY OUT HERE WANTS A FIGHT.',
  'THE ONES WHO DO WILL COME TO YOU.',
];

// Where a region picks you up again after it has put you down. Always the
// room you first walked into it by, so a continue is a walk back rather than a
// puzzle about where you are.
const REGION_START = { skid: 'bridge', venice: 'canals', hollywood: 'station' };
const CONTINUE_COST = 500;
const DEAD_MENU = [
  { id: 'continue', label: 'GET UP' },
  { id: 'quit', label: 'GIVE UP' },
];

const MENU = [
  { id: 'new', label: 'NEW GAME' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'RESTART' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

// --- small tools -------------------------------------------------------------

// mulberry32, same as the other games: a scene that used Math.random would draw
// something different every time and nothing could be compared against anything.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rect = (x, y, w, h, fill) =>
  ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r, fill });

const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const facing = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));

// Prose in, pages of two lines out. Dialogue is written as sentences in the
// script above rather than as pre-broken lines, because pre-broken lines are
// wrong the moment anyone edits a word in the middle of one.
const WRAP = 34;
function paginate(paragraphs) {
  const pages = [];
  for (const para of paragraphs) {
    const lines = [];
    let line = '';
    for (const word of String(para).split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= WRAP) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
    for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
  }
  return pages;
}

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);

  // Everything scales off one number. The HUD gets whatever is left over after
  // eleven rows of tiles, and eighty pixels is the least that can hold two
  // lines of the body font.
  const TILE = Math.max(8, Math.floor(Math.min(court.w / COLS, (court.h - 80) / ROWS)));
  const field = {
    x: court.x + Math.floor((court.w - COLS * TILE) / 2),
    y: court.y + (court.h - ROWS * TILE),
    w: COLS * TILE,
    h: ROWS * TILE,
  };
  const hud = { x: court.x, y: court.y, w: court.w, h: field.y - court.y };
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };

  const random = rng(options.seed ?? 0x414e47);
  const table = options.scores ?? scores;
  const sounds = [];
  const say = (name) => sounds.push(name);

  const cx = (col) => field.x + (col + 0.5) * TILE;
  const cy = (row) => field.y + (row + 0.5) * TILE;

  // What a run of the game is: what you have, what you have done, and who you
  // have met. Everything else in here is scenery over the top of it.
  const run = {
    has: { bat: false, spray: false, boombox: false, cutters: false, pass: false },
    done: { cartking: false, prophet: false, director: false },
    met: {},
    taken: {},
    seen: {},
    cleared: {},
    hearts: START_HEARTS,
    maxHearts: START_HEARTS,
    paint: 0,
    juice: 0,
    sub: 0,
    score: 0,
    continues: 0,
  };

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    cursor: 0,
    board: table.table(GAME),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,
    won: false,
    room: null,
    region: null,
    card: 0,
    lockedIn: 0,
    entered: 0,
    playTime: 0,
  };

  let tiles = [];
  let tileShapes = [];
  let enemies = [];
  let people = [];
  let items = [];
  let shots = [];
  let motes = [];
  let boss = null;
  let talk = null;
  let summons = null;

  const player = {
    x: cx(START.col), y: cy(START.row), dir: 'down', walk: 0,
    swing: 0, hit: new Set(), invuln: 0, kx: 0, ky: 0,
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };
  const owned = () => SUBS.filter((id) => run.has[id]);
  const currentSub = () => owned()[run.sub] ?? null;

  // --- the map at runtime ---------------------------------------------------

  // The perimeter is the room's own business right up until it isn't: a map
  // describes its inside, and the wall, the doorways and any padlock on them
  // are stamped over the top from the exit table. That way an exit and the hole
  // it needs cannot disagree.
  // A boss shuts the way out behind you and it stays shut until it is on the
  // floor. Same reasoning as the padlock, and the same mechanism: the doorway
  // is filled in rather than left open and refused. A boss you can back out of
  // is a boss you fight two hits at a time from the doorway, which is not the
  // fight anybody wrote.
  const shutIn = (room) => Boolean(room.boss) && !run.done[room.boss];

  function buildTiles(room) {
    const grid = room.map.map((line) => [...line].map((ch) => GLYPH[ch]));
    for (let c = 0; c < COLS; c++) { grid[0][c] = 'wall'; grid[ROWS - 1][c] = 'wall'; }
    for (let r = 0; r < ROWS; r++) { grid[r][0] = 'wall'; grid[r][COLS - 1] = 'wall'; }

    const shut = shutIn(room);
    for (const [side, exit] of Object.entries(room.exits)) {
      const fill = shut || (exit.need && !run.has[exit.need]) ? 'fence' : 'ground';
      if (side === 'north') for (const c of DOOR_COLS) grid[0][c] = fill;
      if (side === 'south') for (const c of DOOR_COLS) grid[ROWS - 1][c] = fill;
      if (side === 'west') for (const r of DOOR_ROWS) grid[r][0] = fill;
      if (side === 'east') for (const r of DOOR_ROWS) grid[r][COLS - 1] = fill;
    }
    return grid;
  }

  // Rooms are static and their shapes are built once -- with one exception, a
  // boss dying, which is why this is a function rather than two lines inside
  // enterRoom.
  function layTiles(room) {
    tiles = buildTiles(room);
    tileShapes = paintRoom(room, tiles);
  }

  const solidAt = (x, y) => {
    const c = Math.floor((x - field.x) / TILE);
    const r = Math.floor((y - field.y) / TILE);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    return SOLID.has(tiles[r][c]);
  };

  const boxed = (x, y, half) =>
    solidAt(x - half, y - half) || solidAt(x + half, y - half)
    || solidAt(x - half, y + half) || solidAt(x + half, y + half);

  // Axes resolved separately, so walking into a corner slides along it instead
  // of stopping dead. It is the difference between a wall and flypaper.
  function moveBox(ent, dx, dy, half) {
    if (dx && !boxed(ent.x + dx, ent.y, half)) ent.x += dx;
    if (dy && !boxed(ent.x, ent.y + dy, half)) ent.y += dy;
  }

  const halfOf = (size) => Math.min(TILE * 0.45, TILE * 0.3 * size);

  function doorCentre(side) {
    if (side === 'north') return [field.x + DOOR_COLS[1] * TILE, field.y];
    if (side === 'south') return [field.x + DOOR_COLS[1] * TILE, field.y + field.h];
    if (side === 'west') return [field.x, field.y + DOOR_ROWS[1] * TILE];
    return [field.x + field.w, field.y + DOOR_ROWS[1] * TILE];
  }

  // --- filling a room -------------------------------------------------------

  function makeEnemy(kind, col, row) {
    const cfg = KINDS[kind];
    return {
      kind, x: cx(col) + (random() - 0.5) * TILE * 0.6, y: cy(row) + (random() - 0.5) * TILE * 0.6,
      hp: cfg.hp, dir: 'down', phase: random() * 6.28, seed: random() * 6.28,
      cool: 0.6 + random() * 1.6, mode: 'stalk', modeT: 0,
      kx: 0, ky: 0, hurt: 0, stun: 0, lock: [0, 1],
    };
  }

  function makeMotes(region) {
    const out = [];
    for (let i = 0; i < 10; i++) {
      out.push({
        x: field.x + random() * field.w,
        y: field.y + random() * field.h,
        vx: 16 + random() * 34,
        vy: (random() - 0.5) * 16,
        r: 2 + Math.floor(random() * 2),
        fill: REGIONS[region].mote,
      });
    }
    return out;
  }

  const ENTRY = {
    north: () => [field.x + DOOR_COLS[1] * TILE, field.y + TILE * 2],
    south: () => [field.x + DOOR_COLS[1] * TILE, field.y + field.h - TILE * 2],
    west: () => [field.x + TILE * 2, field.y + DOOR_ROWS[1] * TILE],
    east: () => [field.x + field.w - TILE * 2, field.y + DOOR_ROWS[1] * TILE],
  };

  function enterRoom(id, from) {
    const room = ROOMS[id];
    const fresh = room.region !== game.region;
    game.room = id;
    game.region = room.region;
    game.lockedIn = 0;
    run.seen[id] = true;
    summons = null;
    // Knockback is enough to shove you a tile and a half, and the doorway you
    // just came through is a tile and a half behind you. Without this, one hit
    // taken on arrival throws you straight back out of the room -- and if
    // something is waiting by that door, back and forth for ever.
    game.entered = 0.5;

    layTiles(room);
    enemies = [];
    shots = [];
    items = [];
    boss = null;

    people = (room.npcs ?? []).map((n) => ({
      ...PEOPLE[n.id], id: n.id, x: cx(n.col), y: cy(n.row), phase: random() * 6.28,
    }));

    if (!run.cleared[id]) {
      for (const [kind, col, row] of room.spawns ?? []) enemies.push(makeEnemy(kind, col, row));
      if (!enemies.length && !room.boss) run.cleared[id] = true;
    }

    (room.pickups ?? []).forEach((p, i) => {
      if (!run.taken[`${id}:${i}`]) items.push({ ...p, index: i, x: cx(p.col), y: cy(p.row) });
    });

    motes = makeMotes(room.region);

    if (from) { const [x, y] = ENTRY[from](); player.x = x; player.y = y; }
    player.dir = from === 'south' ? 'up' : from === 'north' ? 'down' : from === 'east' ? 'left' : 'right';
    player.kx = 0; player.ky = 0;

    if (room.boss && !run.done[room.boss]) startBoss(room.boss);
    else if (fresh) { game.card = 2.2; say('door'); }
    else say('door');
  }

  // --- talking --------------------------------------------------------------
  //
  // A page at a time, typed out. `then` is what happens when the last page is
  // dismissed, which is how an item ends up in your hands at the end of a
  // sentence rather than the moment a boss stops moving.
  const TYPE_RATE = 46; // characters a second

  function beginTalk(speaker, paragraphs, then = null) {
    talk = { speaker, pages: paginate(paragraphs), page: 0, reveal: 0, then };
    say('talk');
  }

  function advanceTalk(dt, frame) {
    const page = talk.pages[talk.page];
    const full = page.join(' ').length;
    talk.reveal = Math.min(full, talk.reveal + TYPE_RATE * dt);

    if (!(frame.pressed.a || frame.pressed.b || frame.pressed.start)) return;
    if (talk.reveal < full) { talk.reveal = full; return; }

    talk.page++;
    if (talk.page < talk.pages.length) { talk.reveal = 0; say('talk'); return; }
    const then = talk.then;
    talk = null;
    if (then) then();
  }

  function talkTo(person) {
    const lines = person.lines(run);
    const gift = person.gives ? person.gives(run) : null;
    beginTalk(person.name, lines, () => {
      if (person.meets) run.met[person.meets] = true;
      if (gift) { grant(gift); beginTalk('', [ITEM_WORDS[gift]]); }
    });
  }

  // --- being fetched --------------------------------------------------------
  //
  // Somebody with something you cannot leave without does not wait to be asked.
  // Walk out on them and the world stops where it is while they run over, and
  // then they say it anyway. The freeze is the point: a conversation you can
  // walk out of is one you never had, and a bat you never picked up is a run
  // that cannot be won. Motes keep drifting, as they do through a conversation.
  const FETCH_SPEED = 6; // tiles a second; the player walks at 4.2

  // The shortest walk between two points as a list of tile centres, or null if
  // there is none. Rooms are twenty by eleven, so this is cheap enough to do at
  // the moment it is needed and throw away.
  function route(fromX, fromY, toX, toY) {
    const tileOf = (x, y) => [
      Math.max(0, Math.min(COLS - 1, Math.floor((x - field.x) / TILE))),
      Math.max(0, Math.min(ROWS - 1, Math.floor((y - field.y) / TILE))),
    ];
    const [sc, sr] = tileOf(fromX, fromY);
    const [tc, tr] = tileOf(toX, toY);
    const key = (c, r) => r * COLS + c;
    const prev = new Map([[key(sc, sr), -1]]);
    const queue = [[sc, sr]];
    while (queue.length) {
      const [c, r] = queue.shift();
      if (c === tc && r === tr) {
        const path = [];
        for (let k = key(c, r); k !== -1; k = prev.get(k)) path.unshift([cx(k % COLS), cy(Math.floor(k / COLS))]);
        return path.slice(1);
      }
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        if (SOLID.has(tiles[nr][nc]) || prev.has(key(nc, nr))) continue;
        prev.set(key(nc, nr), key(c, r));
        queue.push([nc, nr]);
      }
    }
    return null;
  }

  function fetchBy(person) {
    person.fetched = true; // once. If what they have to say does not settle it, they let you go.
    summons = { person, path: route(person.x, person.y, player.x, player.y) ?? [] };
    say('talk');
  }

  function advanceSummons(dt) {
    const p = summons.person;
    p.run = (p.run ?? 0) + dt;
    let budget = TILE * FETCH_SPEED * dt;
    while (budget > 0) {
      const toX = player.x - p.x;
      const toY = player.y - p.y;
      if (Math.hypot(toX, toY) <= TILE * 1.2) {
        p.dir = facing(toX, toY);
        summons = null;
        talkTo(p);
        return;
      }
      const [gx, gy] = summons.path[0] ?? [player.x, player.y];
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        if (!summons.path.length) break;
        summons.path.shift();
        continue;
      }
      const m = Math.min(budget, d);
      p.x += (dx / d) * m;
      p.y += (dy / d) * m;
      p.dir = facing(dx, dy);
      budget -= m;
    }
  }

  // --- pickups and rewards --------------------------------------------------

  function grant(kind) {
    switch (kind) {
      case 'bat': run.has.bat = true; say('pickup'); break;
      case 'spray': run.has.spray = true; run.paint = Math.min(MAX_PAINT, run.paint + 12); say('pickup'); break;
      case 'boombox': run.has.boombox = true; run.juice = MAX_JUICE; say('pickup'); break;
      case 'cutters': run.has.cutters = true; say('unlock'); break;
      case 'pass': run.has.pass = true; say('unlock'); break;
      case 'paint': run.paint = Math.min(MAX_PAINT, run.paint + 8); say('pickup'); break;
      case 'juice': run.juice = Math.min(MAX_JUICE, run.juice + 1); say('pickup'); break;
      case 'heart': run.hearts = Math.min(run.maxHearts, run.hearts + 2); say('heal'); break;
      case 'container':
        run.maxHearts = Math.min(MAX_HEARTS, run.maxHearts + 2);
        run.hearts = run.maxHearts;
        say('pickup');
        break;
      default: throw new Error(`unknown pickup: ${kind}`);
    }
    // Picking up a weapon selects it, because nobody has ever picked one up and
    // then wanted to carry on using the last one.
    if (kind === 'spray' || kind === 'boombox') run.sub = Math.max(0, owned().indexOf(kind));
  }

  const ITEM_WORDS = {
    bat: 'A LOUISVILLE SLUGGER, TAPED AT THE GRIP',
    spray: 'A CAN OF SPRAY PAINT. PRESS B',
    boombox: 'A BOOMBOX, D CELLS AND ALL. PRESS B',
    paint: 'PAINT',
    heart: 'SOMETHING HOT IN A PAPER CUP',
    container: 'A FULL NIGHT OF SLEEP. YOU FEEL IT',
  };

  function takeItem(item) {
    run.taken[`${game.room}:${item.index}`] = true;
    items = items.filter((i) => i !== item);
    grant(item.kind);
    if (ITEM_WORDS[item.kind] && item.kind !== 'paint' && item.kind !== 'heart') {
      beginTalk('', [ITEM_WORDS[item.kind]]);
    }
  }

  // --- combat ---------------------------------------------------------------

  const SWING = 0.28;
  const SWING_FROM = 0.24;
  const SWING_TO = 0.08;
  const REACH = 1.25;
  const INVULN = 1.2;

  function hurtPlayer(damage, fromX, fromY) {
    if (player.invuln > 0 || game.screen !== 'play') return;
    run.hearts -= damage;
    player.invuln = INVULN;
    const dx = player.x - fromX;
    const dy = player.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    player.kx = (dx / d) * 320;
    player.ky = (dy / d) * 320;
    say('hurt');
    if (run.hearts <= 0) {
      run.hearts = 0;
      say('over');
      game.cursor = 0;
      talk = null;
      go('died');
    }
  }

  function hurtEnemy(e, damage, fromX, fromY, knock = 260) {
    const cfg = KINDS[e.kind];
    e.hp -= damage;
    e.hurt = 0.18;
    if (!cfg.tough) {
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const d = Math.hypot(dx, dy) || 1;
      e.kx = (dx / d) * knock;
      e.ky = (dy / d) * knock;
    }
    if (e.hp > 0) { say('whack'); return; }

    say('whack');
    run.score += cfg.points;
    enemies = enemies.filter((other) => other !== e);
    dropSomething(e);
    if (!enemies.length && !boss) run.cleared[game.room] = true;
  }

  // A quarter of them leave something behind, and what it is depends on what
  // you are short of -- a paint can from a body when you have no can to put it
  // in is a joke the player is not in on.
  function dropSomething(e) {
    const roll = random();
    if (roll < 0.32) items.push({ kind: 'heart', index: `d${Math.round(e.x)}${Math.round(e.y)}`, x: e.x, y: e.y, dropped: true });
    else if (roll < 0.48 && run.has.spray) items.push({ kind: 'paint', index: `d${Math.round(e.x)}${Math.round(e.y)}`, x: e.x, y: e.y, dropped: true });
    else if (roll < 0.54 && run.has.boombox) items.push({ kind: 'juice', index: `d${Math.round(e.x)}${Math.round(e.y)}`, x: e.x, y: e.y, dropped: true });
  }

  function hurtBoss(damage, fromX, fromY) {
    if (!boss || boss.dying > 0) return;
    // The one window the Cart King gives you is worth taking.
    const scale = boss.mode === 'stun' ? 2 : 1;
    boss.hp -= damage * scale;
    boss.hurt = 0.16;
    say('bossHit');
    if (boss.hp > 0) return;
    boss.hp = 0;
    boss.dying = 1.4;
    shots = shots.filter((s) => s.from === 'player');
    say('bossDown');
  }

  function swingHits() {
    const [dx, dy] = DIRV[player.dir];
    const hx = player.x + dx * TILE * 0.7;
    const hy = player.y + dy * TILE * 0.7;
    const reach = TILE * REACH;

    for (const e of [...enemies]) {
      if (player.hit.has(e)) continue;
      if (Math.hypot(e.x - hx, e.y - hy) > reach) continue;
      player.hit.add(e);
      hurtEnemy(e, WEAPONS.bat.damage, player.x, player.y);
    }
    if (boss && !player.hit.has(boss) && Math.hypot(boss.x - hx, boss.y - hy) <= reach + TILE * boss.size * 0.4) {
      player.hit.add(boss);
      hurtBoss(WEAPONS.bat.damage, player.x, player.y);
    }
  }

  function useSub() {
    const id = currentSub();
    if (!id) return;
    const weapon = WEAPONS[id];
    if (run[weapon.ammo] < weapon.cost) return;
    run[weapon.ammo] -= weapon.cost;
    say(weapon.sound);

    if (id === 'spray') {
      const [dx, dy] = DIRV[player.dir];
      shots.push({
        from: 'player', x: player.x + dx * TILE * 0.5, y: player.y + dy * TILE * 0.5,
        vx: dx * TILE * 9, vy: dy * TILE * 9, life: 0.8, damage: weapon.damage,
        r: TILE * 0.2, fill: PALETTE.sunLit,
      });
      return;
    }
    // The boombox is the panic button: everything in the room takes it at once
    // and stops for a second and a bit. Four charges, and no way to buy a fifth.
    for (const e of [...enemies]) hurtEnemy(e, weapon.damage, player.x, player.y, 200);
    for (const e of enemies) e.stun = 1.8;
    if (boss) hurtBoss(weapon.damage, player.x, player.y);
    shots = shots.filter((s) => s.from === 'player');
  }

  // --- enemies --------------------------------------------------------------

  function throwBottle(e, dx, dy, speed = TILE * 6.2) {
    shots.push({
      from: 'them', x: e.x, y: e.y, vx: dx * speed, vy: dy * speed,
      life: 2.4, damage: 1, r: TILE * 0.2, fill: PALETTE.rose,
    });
  }

  function updateEnemy(e, dt) {
    const cfg = KINDS[e.kind];
    e.phase += dt;
    if (e.hurt > 0) e.hurt -= dt;
    if (e.stun > 0) {
      e.stun -= dt;
      moveBox(e, e.kx * dt, e.ky * dt, halfOf(cfg.size));
      e.kx *= 0.82; e.ky *= 0.82;
      return;
    }

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = 0;
    let vy = 0;

    if (cfg.ranged) {
      // Keeps its distance and throws. Standing off is the whole threat: it
      // makes you choose between the bottle in the air and the thing in front
      // of you.
      const want = TILE * 4;
      const drift = d < want ? -1 : d > want * 1.7 ? 1 : 0;
      vx = (dx / d) * cfg.speed * drift;
      vy = (dy / d) * cfg.speed * drift;
      e.cool -= dt;
      if (e.cool <= 0 && d < TILE * 9) { e.cool = 2.1; throwBottle(e, dx / d, dy / d); }
    } else if (cfg.charge) {
      // Winds up where you can see it, then commits. It cannot turn once it has
      // gone, and that is the only thing you have on it.
      e.modeT -= dt;
      if (e.mode === 'stalk') {
        vx = (dx / d) * cfg.speed;
        vy = (dy / d) * cfg.speed;
        if (e.modeT <= 0 && d < TILE * 6) { e.mode = 'wind'; e.modeT = 0.55; e.lock = [dx / d, dy / d]; }
      } else if (e.mode === 'wind') {
        if (e.modeT <= 0) { e.mode = 'charge'; e.modeT = 0.9; }
      } else {
        vx = e.lock[0] * cfg.speed * 2.9;
        vy = e.lock[1] * cfg.speed * 2.9;
        if (e.modeT <= 0) { e.mode = 'stalk'; e.modeT = 1.4 + random(); }
      }
    } else {
      let ax = dx / d;
      let ay = dy / d;
      if (d > TILE * 7) { ax = Math.cos(e.phase * 0.7 + e.seed); ay = Math.sin(e.phase * 0.9 + e.seed); }
      else if (cfg.jitter) {
        // Never a straight line at you, which is what makes it hard to swing at
        // and easy to be hit by.
        ax += Math.sin(e.phase * 9 + e.seed) * 0.95;
        ay += Math.cos(e.phase * 11 + e.seed) * 0.95;
        const m = Math.hypot(ax, ay) || 1;
        ax /= m; ay /= m;
      }
      vx = ax * cfg.speed;
      vy = ay * cfg.speed;
    }

    vx += e.kx;
    vy += e.ky;
    e.kx *= 0.84; e.ky *= 0.84;
    moveBox(e, vx * dt, vy * dt, halfOf(cfg.size));
    if (Math.abs(vx) + Math.abs(vy) > 4) e.dir = facing(vx, vy);

    if (Math.hypot(dx, dy) < TILE * 0.42 * (1 + cfg.size)) hurtPlayer(cfg.damage, e.x, e.y);
  }

  // --- bosses ---------------------------------------------------------------
  //
  // Where the adds come in. Hand-picked open tiles rather than anything
  // computed: a summon that lands inside a wall is stuck there for ever, and
  // the room it is stuck in is the one the player cannot leave until it dies.
  const ADD_TILES = {
    cartking: [[4, 5], [9, 5], [15, 5]],
    prophet: [[5, 5], [14, 5], [5, 6], [14, 6]],
    director: [[4, 3], [15, 3], [10, 8], [5, 8]],
  };

  function startBoss(id) {
    const cfg = BOSSES[id];
    boss = {
      id, x: cx(10), y: cy(3), size: cfg.size,
      hp: cfg.hp, maxHp: cfg.hp,
      mode: 'wait', modeT: 1.2, phase: 0, cool: 1.8,
      hurt: 0, dying: 0, adds: 0, lock: [0, 1], dir: 'down',
    };
    say('roar');
    // Only the first time. A boss you fled and came back to has already made
    // its speech, and hearing it twice makes it a menu rather than a threat.
    if (!run.met[id]) { run.met[id] = true; beginTalk(cfg.name, cfg.intro); }
  }

  const summon = (kind, slot) => {
    const [col, row] = ADD_TILES[boss.id][slot % ADD_TILES[boss.id].length];
    enemies.push(makeEnemy(kind, col, row));
  };

  function bossShots(count, spread, speed, aim) {
    for (let i = 0; i < count; i++) {
      const angle = spread === null
        ? aim + (i * Math.PI * 2) / count
        : aim + (i - (count - 1) / 2) * spread;
      throwBottle(boss, Math.cos(angle), Math.sin(angle), speed);
    }
    say('swing');
  }

  function updateBoss(dt) {
    const cfg = BOSSES[boss.id];
    boss.phase += dt;
    if (boss.hurt > 0) boss.hurt -= dt;

    if (boss.dying > 0) {
      boss.dying -= dt;
      if (boss.dying <= 0) defeatBoss();
      return;
    }

    const dx = player.x - boss.x;
    const dy = player.y - boss.y;
    const d = Math.hypot(dx, dy) || 1;
    const half = halfOf(boss.size);
    const low = boss.hp <= boss.maxHp * 0.5;

    // Drifts toward a point rather than at the player. Used by both of the
    // bosses that fight at range.
    const glideTo = (tx, ty, speed) => {
      const mx = tx - boss.x;
      const my = ty - boss.y;
      const md = Math.hypot(mx, my) || 1;
      const step = Math.min(speed * dt, md);
      moveBox(boss, (mx / md) * step, (my / md) * step, half);
    };

    if (boss.id === 'cartking') {
      // Four states and one idea: it can only hurt you while it is moving in a
      // straight line, and it cannot turn while it is. Everything you do to it
      // happens in the second and a bit after it hits something.
      boss.modeT -= dt;
      if (boss.mode === 'wait') {
        glideTo(player.x, player.y, TILE * 1.4);
        if (boss.modeT <= 0) { boss.mode = 'wind'; boss.modeT = 0.85; boss.lock = [dx / d, dy / d]; }
      } else if (boss.mode === 'wind') {
        // The aim is taken here and not touched again. A telegraph that keeps
        // tracking you is not a telegraph, it is just a delay before a hit.
        if (boss.modeT <= 0) { boss.mode = 'charge'; boss.modeT = 1.5; }
      } else if (boss.mode === 'charge') {
        const before = [boss.x, boss.y];
        moveBox(boss, boss.lock[0] * TILE * 9 * dt, boss.lock[1] * TILE * 9 * dt, half);
        const moved = Math.hypot(boss.x - before[0], boss.y - before[1]);
        if (moved < 0.5 || boss.modeT <= 0) { boss.mode = 'stun'; boss.modeT = 1.7; say('ram'); }
      } else if (boss.modeT <= 0) {
        boss.mode = 'wait';
        boss.modeT = 1.0;
        if (low && boss.adds < 3) summon('drifter', boss.adds++);
      }
      boss.dir = facing(boss.lock[0], boss.lock[1]);

    } else if (boss.id === 'prophet') {
      // Never comes to you. It paces a slow figure across the boards and throws
      // fans of glass; halfway down it stops aiming and starts filling the room.
      glideTo(cx(10) + Math.cos(boss.phase * 0.7) * TILE * 5.5, cy(5) + Math.sin(boss.phase * 1.1) * TILE * 2.2, TILE * 2.6);
      boss.cool -= dt;
      if (boss.cool <= 0) {
        boss.cool = low ? 1.5 : 2.0;
        const aim = Math.atan2(dy, dx);
        if (low) bossShots(8, null, TILE * 5.0, aim);
        else bossShots(5, 0.22, TILE * 5.6, aim);
      }
      if (boss.hp <= boss.maxHp * 0.66 && boss.adds < 2) { summon('thrower', 0); summon('thrower', 1); boss.adds = 2; }
      if (boss.hp <= boss.maxHp * 0.33 && boss.adds < 4) { summon('crack', 2); summon('crack', 3); boss.adds = 4; }
      boss.dir = facing(dx, dy);

    } else {
      // Three acts, because he would insist. The first is a fan you can walk out
      // of, the second is the same fan and company, and the third stops aiming
      // at you at all and simply fills the forecourt.
      const frac = boss.hp / boss.maxHp;
      const act = frac > 0.6 ? 1 : frac > 0.3 ? 2 : 3;
      glideTo(
        cx(10) + Math.cos(boss.phase * (0.6 + act * 0.2)) * TILE * 6,
        cy(5) + Math.sin(boss.phase * (0.9 + act * 0.2)) * TILE * 2.8,
        TILE * (2.6 + act * 0.9),
      );
      boss.cool -= dt;
      if (boss.cool <= 0) {
        const aim = Math.atan2(dy, dx);
        if (act === 1) { boss.cool = 1.4; bossShots(3, 0.24, TILE * 5.8, aim); }
        else if (act === 2) { boss.cool = 1.0; bossShots(5, 0.2, TILE * 6.0, aim); }
        else { boss.cool = 1.5; bossShots(10, null, TILE * 5.2, aim); }
      }
      if (act >= 2 && boss.adds < 2) { summon('crack', 0); summon('crack', 1); boss.adds = 2; }
      if (act >= 3 && boss.adds < 3) { summon('pcp', 2); boss.adds = 3; }
      boss.dir = facing(dx, dy);
    }

    if (Math.hypot(player.x - boss.x, player.y - boss.y) < TILE * 0.45 * (1 + boss.size)) {
      hurtPlayer(cfg.damage, boss.x, boss.y);
    }
  }

  function defeatBoss() {
    const id = boss.id;
    const cfg = BOSSES[id];
    run.done[id] = true;
    run.score += cfg.points;
    // A container from the last boss is a container you never spend, and it
    // would make the one hidden off the Boulevard worth nothing. The two that
    // hand you something to open a gate with hand you a heart as well.
    if (cfg.item) run.maxHearts = Math.min(MAX_HEARTS, run.maxHearts + 2);
    run.hearts = run.maxHearts;
    if (cfg.gives) grant(cfg.gives);
    boss = null;
    enemies = [];
    shots = [];

    // Every room you walked through to get here goes quiet, not just this one.
    // Every route out of a boss is the route in, walked backwards, and
    // re-fighting three rooms you already cleared is not difficulty -- it is a
    // toll. It also reads: the one they were all working for is on the floor.
    // A room in the region you have never set foot in keeps its crowd, though:
    // Cold Storage is off the route to the Cart King, and finding it empty on
    // the first visit read as a bug rather than a mercy.
    for (const [rid, room] of Object.entries(ROOMS)) {
      if (room.region === ROOMS[game.room].region && run.seen[rid]) run.cleared[rid] = true;
    }

    // And the way out opens, behind the outro rather than after it. `grant` has
    // already sounded the one for a key; the Director hands over nothing but
    // the door, so his gets the sound instead.
    layTiles(ROOMS[game.room]);
    if (!cfg.gives) say('unlock');

    const words = cfg.item ? [...cfg.outro, `YOU HAVE ${cfg.item}.`] : cfg.outro;
    beginTalk(cfg.name, words, id === 'director' ? () => beginTalk('', ENDING, () => finish(true)) : null);
  }

  // --- beginning and ending -------------------------------------------------

  function newRun() {
    run.has = { bat: false, spray: false, boombox: false, cutters: false, pass: false };
    run.done = { cartking: false, prophet: false, director: false };
    run.met = {};
    run.taken = {};
    run.seen = {};
    run.cleared = {};
    run.hearts = START_HEARTS;
    run.maxHearts = START_HEARTS;
    run.paint = 0;
    run.juice = 0;
    run.sub = 0;
    run.score = 0;
    run.continues = 0;

    game.won = false;
    game.playTime = 0;
    game.region = null;
    player.invuln = 0;
    player.swing = 0;
    player.hit.clear();
    player.kx = 0;
    player.ky = 0;

    enterRoom(START.room, null);
    player.x = cx(START.col);
    player.y = cy(START.row);
    player.dir = 'up';
    go('play');
    beginTalk('', OPENING);
  }

  // Back on your feet at the mouth of the region, everything you had cleared
  // still cleared, five hundred off the score. The alternative to this is that
  // a bad thirty seconds in the Forecourt costs a twenty minute run, which is
  // not difficulty, it is just the walk back.
  function continueRun() {
    run.continues++;
    run.score = Math.max(0, run.score - CONTINUE_COST);
    run.hearts = run.maxHearts;
    player.invuln = 0;
    player.swing = 0;
    player.hit.clear();
    player.kx = 0;
    player.ky = 0;
    boss = null;
    const home = REGION_START[game.region] ?? START.room;
    game.region = null;
    enterRoom(home, null);
    const [x, y] = [cx(START.col), cy(START.row)];
    if (home === START.room) { player.x = x; player.y = y; }
    else { const [ex, ey] = ENTRY.south(); player.x = ex; player.y = ey; }
    go('play');
  }

  function finish(won) {
    game.won = won;
    // Hearts left over are worth something: the difference between finishing
    // and finishing on your feet ought to show up on the board.
    if (won) run.score += 2000 + run.hearts * 100;
    say(won ? 'fanfare' : 'over');
    game.placing = run.score > 0 ? table.placing(GAME, run.score) : 0;
    game.initials = [0, 0, 0];
    game.slot = 0;
    talk = null;
    summons = null;
    boss = null;
    go('over');
  }

  // --- the step -------------------------------------------------------------

  function updateMotes(dt) {
    for (const m of motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x > field.x + field.w) { m.x = field.x; }
      if (m.y < field.y) m.y = field.y + field.h;
      if (m.y > field.y + field.h) m.y = field.y;
    }
  }

  function movePlayer(dt, frame) {
    if (player.invuln > 0) player.invuln -= dt;
    if (player.swing > 0) {
      player.swing -= dt;
      if (player.swing <= SWING_FROM && player.swing > SWING_TO) swingHits();
      if (player.swing <= 0) player.hit.clear();
    }

    let dx = 0;
    let dy = 0;
    if (frame.left) dx -= 1;
    if (frame.right) dx += 1;
    if (frame.up) dy -= 1;
    if (frame.down) dy += 1;
    if (dx || dy) {
      const m = Math.hypot(dx, dy);
      dx /= m; dy /= m;
      if (player.swing <= 0) player.dir = facing(dx, dy);
      player.walk += dt * 9;
    }

    const speed = TILE * 4.2;
    moveBox(player, (dx * speed + player.kx) * dt, (dy * speed + player.ky) * dt, halfOf(1));
    player.kx *= 0.8;
    player.ky *= 0.8;
  }

  function actions(frame) {
    if (frame.pressed.select && owned().length > 1) {
      run.sub = (run.sub + 1) % owned().length;
      say('move');
    }
    if (frame.pressed.b) useSub();
    if (!frame.pressed.a) return;

    // A is talk when there is somebody to talk to and a swing otherwise. It is
    // the same button because there is never both.
    const near = people.find((p) => Math.hypot(p.x - player.x, p.y - player.y) < TILE * 1.5);
    if (near) { talkTo(near); return; }
    if (run.has.bat && player.swing <= 0) {
      player.swing = SWING;
      player.hit.clear();
      say('swing');
    }
  }

  function updateShots(dt) {
    for (const s of [...shots]) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const drop = () => { shots = shots.filter((o) => o !== s); };

      if (s.life <= 0 || solidAt(s.x, s.y)) { drop(); continue; }

      if (s.from === 'player') {
        const struck = enemies.find((e) => Math.hypot(e.x - s.x, e.y - s.y) < TILE * 0.4 * (1 + KINDS[e.kind].size));
        if (struck) { hurtEnemy(struck, s.damage, s.x, s.y); drop(); continue; }
        if (boss && boss.dying <= 0 && Math.hypot(boss.x - s.x, boss.y - s.y) < TILE * 0.45 * (1 + boss.size)) {
          hurtBoss(s.damage, s.x, s.y);
          drop();
        }
        continue;
      }
      if (Math.hypot(player.x - s.x, player.y - s.y) < TILE * 0.5) { hurtPlayer(s.damage, s.x, s.y); drop(); }
    }
  }

  function collect() {
    for (const item of [...items]) {
      if (Math.hypot(item.x - player.x, item.y - player.y) > TILE * 0.95) continue;
      // A cup of coffee on the floor with full hearts stays on the floor.
      if (item.kind === 'heart' && run.hearts >= run.maxHearts) continue;
      if (item.dropped) { items = items.filter((i) => i !== item); grant(item.kind); }
      else takeItem(item);
      return;
    }
  }

  function checkDoors() {
    const room = ROOMS[game.room];

    if (game.lockedIn <= 0) {
      for (const [side, exit] of Object.entries(room.exits)) {
        if (!exit.need || run.has[exit.need]) continue;
        const [dx, dy] = doorCentre(side);
        if (Math.hypot(player.x - dx, player.y - dy) < TILE * 2) {
          game.lockedIn = 14;
          beginTalk('', [exit.locked]);
          return;
        }
      }
    }

    if (game.entered > 0) return;

    const edge = TILE * 0.45;
    let side = null;
    if (player.y <= field.y + edge) side = 'north';
    else if (player.y >= field.y + field.h - edge) side = 'south';
    else if (player.x <= field.x + edge) side = 'west';
    else if (player.x >= field.x + field.w - edge) side = 'east';

    const exit = side && room.exits[side];
    if (!exit) return;

    // Somebody here has something you cannot leave without.
    const holdout = people.find((p) => p.insists && !p.fetched && p.insists(run));
    if (holdout) { fetchBy(holdout); return; }

    enterRoom(exit.to, OPPOSITE[side]);
  }

  function play(dt, frame) {
    game.playTime += dt;
    updateMotes(dt);
    if (game.card > 0) game.card -= dt;
    if (game.lockedIn > 0) game.lockedIn -= dt;
    if (game.entered > 0) game.entered -= dt;

    // A conversation stops the world but not the wind. Everything that is not
    // a decision carries on, so a page of dialogue does not read as a freeze.
    if (talk) { advanceTalk(dt, frame); return; }
    if (summons) { advanceSummons(dt); return; }

    movePlayer(dt, frame);
    if (game.screen !== 'play') return;
    actions(frame);
    for (const e of [...enemies]) {
      updateEnemy(e, dt);
      if (game.screen !== 'play') return;
    }
    if (boss) updateBoss(dt);
    if (game.screen !== 'play') return;
    updateShots(dt);
    if (game.screen !== 'play') return;
    collect();
    if (game.screen !== 'play') return;
    checkDoors();
  }

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }

  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function editInitials(frame) {
    const size = scores.ALPHABET.length;
    if (frame.pressed.up) { game.initials[game.slot] = (game.initials[game.slot] + size - 1) % size; say('move'); }
    if (frame.pressed.down) { game.initials[game.slot] = (game.initials[game.slot] + 1) % size; say('move'); }
    if (frame.pressed.left && game.slot > 0) { game.slot--; say('move'); }
    if (frame.pressed.right && game.slot < 2) { game.slot++; say('move'); }

    if (!confirmed(frame)) return;
    if (game.slot < 2) { game.slot++; say('move'); return; }

    game.board = table.record(GAME, game.initials.map((i) => scores.ALPHABET[i]).join(''), run.score);
    game.placing = 0;
    say('select');
    go('scores');
  }

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    game.elapsed += dt;

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        say('select');
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') { game.exit = true; break; }
        if (choice === 'howto') { go('howto'); break; }
        if (choice === 'scores') { game.board = table.table(GAME); go('scores'); break; }
        newRun();
        break;
      }

      case 'howto':
      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); game.cursor = 0; go('menu'); }
        break;

      case 'play':
        if (!talk && any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        play(dt, any);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('play');
        else if (choice === 'restart') newRun();
        else { game.cursor = 0; go('menu'); }
        break;
      }

      case 'died': {
        if (game.elapsed < 0.8) break;
        moveCursor(any, DEAD_MENU.length);
        if (!confirmed(any)) break;
        say('select');
        if (DEAD_MENU[game.cursor].id === 'continue') continueRun();
        else finish(false);
        break;
      }

      case 'over':
        // A moment's grace, so the button that finished it does not skip the
        // screen it produced.
        if (game.elapsed < 0.8) break;
        if (game.placing > 0) { editInitials(any); break; }
        if (confirmed(any) || any.pressed.b) { say('select'); game.cursor = 0; go('menu'); }
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
    }
  }

  // --- drawing --------------------------------------------------------------
  //
  // The room is flat -- two hundred tiles with ink outlines would be a mess and
  // slow with it -- and everything that moves goes in one poster-mode layer, so
  // people and enemies come out with the black channel between them that the
  // rest of this project is drawn in.

  const BASE = {
    ground: (reg) => reg.ground,
    kerb: (reg) => reg.kerb,
    star: (reg) => reg.ground,
    fence: (reg) => reg.ground,
    tent: (reg) => reg.ground,
    cart: (reg) => reg.ground,
    bench: (reg) => reg.ground,
    tree: (reg) => reg.ground,
    bin: (reg) => reg.ground,
    wall: (reg) => reg.wall,
    plank: () => PALETTE.bark,
    water: () => PALETTE.waterDim,
  };

  function prop(kind, col, row, reg) {
    const x = field.x + col * TILE;
    const y = field.y + row * TILE;
    const t = TILE;
    switch (kind) {
      case 'wall':
        // A window every third tile. On every tile it reads as graph paper.
        return (col + row) % 3 === 0
          ? [rect(x + t * 0.24, y + t * 0.22, t * 0.5, t * 0.3, reg.wallTrim)]
          : [rect(x, y + t * 0.86, t, t * 0.14, reg.wallTrim)];
      case 'fence':
        return [
          rect(x, y + t * 0.1, t, t * 0.1, PALETTE.stone),
          rect(x + t * 0.16, y + t * 0.1, t * 0.1, t * 0.8, PALETTE.stone),
          rect(x + t * 0.46, y + t * 0.1, t * 0.1, t * 0.8, PALETTE.stone),
          rect(x + t * 0.76, y + t * 0.1, t * 0.1, t * 0.8, PALETTE.stone),
        ];
      case 'tent': {
        // A cone from a pinhead at the ridge to a wide disc near the ground,
        // then a rectangle across the bottom to square the skirt off. Without
        // the rectangle the disc wins and it reads as a balloon.
        const skin = (col + row) % 2 ? PALETTE.sky : PALETTE.emberDim;
        return [
          {
            type: 'chain',
            points: [
              { x: Math.round(x + t * 0.5), y: Math.round(y + t * 0.22), r: t * 0.04 },
              { x: Math.round(x + t * 0.5), y: Math.round(y + t * 0.64), r: t * 0.34 },
            ],
            fill: skin,
          },
          rect(x + t * 0.13, y + t * 0.6, t * 0.74, t * 0.32, skin),
          rect(x + t * 0.4, y + t * 0.66, t * 0.2, t * 0.26, PALETTE.barkDim),
        ];
      }
      case 'cart':
        return [
          rect(x + t * 0.14, y + t * 0.3, t * 0.72, t * 0.36, PALETTE.stoneLit),
          rect(x + t * 0.12, y + t * 0.2, t * 0.1, t * 0.5, PALETTE.stone),
          disc(x + t * 0.3, y + t * 0.78, t * 0.09, PALETTE.barkDim),
          disc(x + t * 0.72, y + t * 0.78, t * 0.09, PALETTE.barkDim),
        ];
      case 'bench':
        return [
          rect(x + t * 0.08, y + t * 0.34, t * 0.84, t * 0.2, PALETTE.bark),
          rect(x + t * 0.14, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
          rect(x + t * 0.76, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
        ];
      case 'tree':
        return [
          rect(x + t * 0.42, y + t * 0.34, t * 0.16, t * 0.62, PALETTE.bark),
          disc(x + t * 0.5, y + t * 0.28, t * 0.3, PALETTE.leaf),
          disc(x + t * 0.22, y + t * 0.38, t * 0.19, PALETTE.leafDim),
          disc(x + t * 0.78, y + t * 0.38, t * 0.19, PALETTE.leafLit),
        ];
      case 'bin':
        return [
          disc(x + t * 0.5, y + t * 0.58, t * 0.28, PALETTE.stoneDim),
          disc(x + t * 0.5, y + t * 0.42, t * 0.26, PALETTE.stone),
        ];
      case 'water':
        return [
          rect(x, y + t * 0.28, t, t * 0.1, PALETTE.water),
          rect(x + t * 0.3, y + t * 0.68, t * 0.5, t * 0.08, PALETTE.waterLit),
        ];
      case 'plank':
        return [rect(x, y + t * 0.46, t, t * 0.08, PALETTE.barkLit)];
      case 'star':
        return [
          disc(x + t * 0.5, y + t * 0.5, t * 0.26, PALETTE.sunDim),
          disc(x + t * 0.5, y + t * 0.5, t * 0.13, PALETTE.sun),
        ];
      default:
        return [];
    }
  }

  // Runs of the same ground colour become one rectangle. A room drops from ~220
  // rects to ~40, which is most of the reason this draws in single-figure
  // milliseconds on the Pi.
  function paintRoom(room, grid) {
    const reg = REGIONS[room.region];
    const shapes = [];

    for (let r = 0; r < ROWS; r++) {
      let start = 0;
      for (let c = 1; c <= COLS; c++) {
        if (c < COLS && BASE[grid[r][c]](reg) === BASE[grid[r][start]](reg)) continue;
        shapes.push(rect(field.x + start * TILE, field.y + r * TILE, (c - start) * TILE, TILE, BASE[grid[r][start]](reg)));
        start = c;
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) shapes.push(...prop(grid[r][c], c, r, reg));
    }
    return shapes;
  }

  // Two lobes and a point. There is no polygon primitive, so a heart is a chain
  // whose radius shrinks to nothing at the bottom.
  const heartShape = (x, y, r, fill) => ({
    type: 'chain',
    points: [
      { x: Math.round(x - r * 0.5), y: Math.round(y - r * 0.3), r: r * 0.6 },
      { x: Math.round(x), y: Math.round(y + r * 0.8), r: r * 0.14 },
      { x: Math.round(x + r * 0.5), y: Math.round(y - r * 0.3), r: r * 0.6 },
    ],
    fill,
  });

  // Everybody in this game is the same five shapes at a different size in a
  // different colour, which is exactly how the consoles this looks like did it.
  function figure(x, y, look, { size = 1, dir = 'down', bob = 0, tint = null } = {}) {
    const w = TILE * 0.54 * size;
    const h = TILE * 0.6 * size;
    const head = TILE * 0.24 * size;
    const [fx, fy] = DIRV[dir] ?? DIRV.down;
    const hy = y - h / 2 - head * 0.65 + bob;
    return [
      rect(x - w / 2, y - h / 2 + bob, w, h, tint ?? look.body),
      rect(x - w / 2, y + h / 2 - TILE * 0.04, w * 0.36, TILE * 0.16 + bob, look.trim),
      rect(x + w / 2 - w * 0.36, y + h / 2 - TILE * 0.04, w * 0.36, TILE * 0.16 - bob, look.trim),
      disc(x, hy, head, look.head),
      disc(x + fx * head * 0.75, hy + fy * head * 0.55, head * 0.42, look.trim),
    ];
  }

  const PLAYER_LOOK = { body: PALETTE.sky, head: PALETTE.cream, trim: PALETTE.emberDim };

  function playerShapes() {
    // Blinking while invulnerable is the oldest readout there is and still the
    // clearest: you can see it without looking away from what is chasing you.
    const blink = player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0;
    const bob = Math.sin(player.walk) * TILE * 0.05;
    const shapes = figure(player.x, player.y, PLAYER_LOOK, {
      dir: player.dir, bob, tint: blink ? PALETTE.creamDim : null,
    });

    if (player.swing > 0) {
      const through = 1 - player.swing / SWING;
      const [fx, fy] = DIRV[player.dir];
      const angle = Math.atan2(fy, fx) + (through - 0.5) * 2.3;
      const tipX = player.x + Math.cos(angle) * TILE * 1.15;
      const tipY = player.y + Math.sin(angle) * TILE * 1.15;
      shapes.push({
        type: 'chain',
        points: [
          { x: Math.round(player.x + Math.cos(angle) * TILE * 0.34), y: Math.round(player.y + Math.sin(angle) * TILE * 0.34), r: TILE * 0.07 },
          { x: Math.round(tipX), y: Math.round(tipY), r: TILE * 0.12 },
        ],
        fill: PALETTE.barkLit,
      });
    }
    return shapes;
  }

  function enemyShapes(e) {
    const cfg = KINDS[e.kind];
    const winding = cfg.charge && e.mode === 'wind';
    const bob = Math.sin(e.phase * (cfg.jitter ? 16 : 6)) * TILE * 0.05;
    return figure(e.x, e.y, cfg, {
      size: cfg.size,
      dir: e.dir,
      bob,
      // Hurt is white, about to charge is bright: the two things you need to
      // read across a room, and never both at once.
      tint: e.hurt > 0 ? PALETTE.cream : winding ? PALETTE.emberLit : e.stun > 0 ? PALETTE.stone : null,
    });
  }

  function bossShapes() {
    const cfg = BOSSES[boss.id];
    const dying = boss.dying > 0;
    const shake = dying ? Math.sin(boss.dying * 60) * TILE * 0.12 : 0;
    const tint = boss.hurt > 0 || dying ? PALETTE.cream : boss.mode === 'stun' ? PALETTE.stone : null;
    const shapes = figure(boss.x + shake, boss.y, cfg, { size: boss.size, dir: boss.dir, tint });

    // One prop each, so they are not three sizes of the same silhouette.
    const [fx, fy] = DIRV[boss.dir] ?? DIRV.down;
    if (boss.id === 'cartking') {
      shapes.push(rect(boss.x + fx * TILE * 0.9 - TILE * 0.5, boss.y + fy * TILE * 0.9 - TILE * 0.35, TILE, TILE * 0.7, PALETTE.stoneLit));
    } else if (boss.id === 'prophet') {
      shapes.push(rect(boss.x - TILE * 0.75, boss.y - TILE * 1.5, TILE * 1.5, TILE * 0.45, PALETTE.cream));
    } else {
      shapes.push(rect(boss.x + fx * TILE * 0.8 - TILE * 0.22, boss.y + fy * TILE * 0.8 - TILE * 0.22, TILE * 0.44, TILE * 0.44, PALETTE.ink));
      shapes.push(disc(boss.x + fx * TILE * 0.95, boss.y + fy * TILE * 0.95, TILE * 0.16, PALETTE.skyLit));
    }
    return shapes;
  }

  const ITEM_LOOK = {
    heart: (x, y) => [heartShape(x, y, TILE * 0.3, PALETTE.ember)],
    container: (x, y) => [disc(x, y, TILE * 0.4, PALETTE.rose), heartShape(x, y, TILE * 0.3, PALETTE.ember)],
    paint: (x, y) => [rect(x - TILE * 0.14, y - TILE * 0.26, TILE * 0.28, TILE * 0.52, PALETTE.sunLit), rect(x - TILE * 0.07, y - TILE * 0.36, TILE * 0.14, TILE * 0.12, PALETTE.stone)],
    juice: (x, y) => [rect(x - TILE * 0.2, y - TILE * 0.16, TILE * 0.4, TILE * 0.32, PALETTE.skyLit)],
    spray: (x, y) => [rect(x - TILE * 0.18, y - TILE * 0.32, TILE * 0.36, TILE * 0.64, PALETTE.sun), rect(x - TILE * 0.08, y - TILE * 0.44, TILE * 0.16, TILE * 0.14, PALETTE.stone)],
    boombox: (x, y) => [rect(x - TILE * 0.42, y - TILE * 0.24, TILE * 0.84, TILE * 0.48, PALETTE.stoneDim), disc(x - TILE * 0.2, y, TILE * 0.14, PALETTE.stoneLit), disc(x + TILE * 0.2, y, TILE * 0.14, PALETTE.stoneLit)],
    bat: (x, y) => [rect(x - TILE * 0.1, y - TILE * 0.4, TILE * 0.2, TILE * 0.8, PALETTE.barkLit)],
  };

  const itemShapes = (item) => {
    const draw = ITEM_LOOK[item.kind];
    const lift = Math.sin(game.playTime * 3 + item.x) * TILE * 0.06;
    return draw ? draw(item.x, item.y + lift) : [];
  };

  // --- text -----------------------------------------------------------------

  const text = (body, x, y, opts = {}) => ({
    text: body, x: Math.round(x), y: Math.round(y),
    scale: opts.scale ?? 2, anchor: opts.anchor ?? 'middle',
    fill: opts.fill ?? PALETTE.cream, font: opts.font ?? FONT,
  });

  const centred = (body, y, opts = {}) => {
    const font = opts.font ?? FONT;
    const scale = opts.scale ?? 2;
    return text(body, mid.x, y - (font.height * scale) / 2, { ...opts, font, scale });
  };

  function hudParts() {
    const reg = REGIONS[game.region] ?? REGIONS.skid;
    const shapes = [
      rect(court.x, court.y, court.w, hud.h, PALETTE.ink),
      rect(court.x + 10, court.y + hud.h - 5, court.w - 20, 3, PALETTE.barkDim),
    ];
    const heartY = court.y + hud.h - 24;
    for (let i = 0; i < run.maxHearts; i++) {
      shapes.push(heartShape(court.x + 20 + i * 20, heartY, 9, i < run.hearts ? PALETTE.ember : PALETTE.barkDim));
    }

    const sub = currentSub();
    const readout = sub ? `${WEAPONS[sub].name} ${run[WEAPONS[sub].ammo]}` : run.has.bat ? 'BAT' : 'EMPTY HANDED';

    return {
      shapes,
      labels: [
        text(reg.name, court.x + 12, court.y + 8, { anchor: 'start', fill: reg.accent }),
        text(String(run.score), court.x + court.w - 12, court.y + 8, { anchor: 'end', fill: PALETTE.sun }),
        text(readout, court.x + court.w - 12, court.y + hud.h - 42, { anchor: 'end', fill: PALETTE.cream }),
      ],
    };
  }

  function talkParts() {
    if (!talk) return { shapes: [], labels: [] };
    const boxH = TILE * 3.8;
    const x = field.x + 8;
    const y = field.y + field.h - boxH - 8;
    const w = field.w - 16;

    const page = talk.pages[talk.page];
    let budget = Math.floor(talk.reveal);
    const labels = [text(talk.speaker || '', x + 16, y + 10, { anchor: 'start', fill: PALETTE.sun })];

    page.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, budget));
      budget -= line.length + 1;
      labels.push(text(shown, x + 16, y + 44 + i * 34, { anchor: 'start', fill: PALETTE.cream }));
    });

    const done = Math.floor(talk.reveal) >= page.join(' ').length;
    if (done) labels.push(text('▶', x + w - 34, y + 78, { anchor: 'start', fill: PALETTE.sun }));

    return {
      shapes: [rect(x, y, w, boxH, PALETTE.cream), rect(x + 4, y + 4, w - 8, boxH - 8, PALETTE.ink)],
      labels,
    };
  }

  function cardParts() {
    if (game.card <= 0) return { shapes: [], labels: [] };
    const reg = REGIONS[game.region];
    const w = TILE * 11;
    const h = TILE * 2.2;
    const x = mid.x - w / 2;
    const y = field.y + field.h * 0.3;
    return {
      shapes: [
        rect(x, y, w, h, PALETTE.ink),
        rect(x, y, w, 4, reg.accent),
        rect(x, y + h - 4, w, 4, reg.accent),
      ],
      labels: [centred(reg.name, y + h / 2, { scale: 1, font: HEAVY, fill: reg.accent })],
    };
  }

  // --- screens --------------------------------------------------------------

  function playLayers() {
    const under = motes.map((m) => disc(m.x, m.y, m.r, m.fill));
    for (const item of items) under.push(...itemShapes(item));

    const moving = [];
    for (const p of people) {
      const running = summons && summons.person === p;
      const bob = running ? Math.sin(p.run * 22) * TILE * 0.07 : Math.sin(p.phase + game.playTime * 2) * TILE * 0.04;
      moving.push(...figure(p.x, p.y, p, { dir: p.dir ?? 'down', bob }));
    }
    for (const e of enemies) moving.push(...enemyShapes(e));
    if (boss) moving.push(...bossShapes());
    moving.push(...playerShapes());
    for (const s of shots) moving.push(disc(s.x, s.y, s.r, s.fill));

    return [
      { flat: true, shapes: tileShapes },
      { flat: true, shapes: under },
      { ink: 3, shapes: moving },
    ];
  }

  function playScreen() {
    const chrome = hudParts();
    const card = cardParts();
    const box = talkParts();

    // The boss bar goes over the top of the field rather than in the HUD: it
    // only exists for one room at a time, and it belongs to that room.
    const bar = [];
    if (boss) {
      const w = field.w * 0.6;
      const x = mid.x - w / 2;
      const y = field.y + 10;
      bar.push(rect(x - 3, y - 3, w + 6, 20, PALETTE.ink));
      bar.push(rect(x, y, w, 14, PALETTE.barkDim));
      bar.push(rect(x, y, Math.max(2, (w * boss.hp) / boss.maxHp), 14, PALETTE.ember));
    }

    return {
      layers: [
        ...playLayers(),
        { flat: true, shapes: [...bar, ...chrome.shapes, ...card.shapes, ...box.shapes] },
      ],
      text: [
        ...(boss ? [text(BOSSES[boss.id].name, mid.x, field.y + 30, { fill: PALETTE.cream })] : []),
        ...chrome.labels, ...card.labels, ...box.labels,
      ],
    };
  }

  function pausedScreen() {
    return {
      layers: [
        ...playLayers().map((layer) => ({ ...layer, alpha: 0.22 })),
        { flat: true, shapes: [rect(court.x, court.y, court.w, hud.h, PALETTE.ink)] },
      ],
      text: [
        centred('PAUSED', field.y + TILE * 1.6, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((item, i) => centred(
          `${i === game.cursor ? '▶ ' : '  '}${item.label}`,
          field.y + TILE * 3.4 + i * 44,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred(`SCORE ${run.score}`, field.y + field.h - 34, { fill: PALETTE.bark }),
      ],
    };
  }

  // A skyline and two palms. It is the only picture in the game that is not
  // made of tiles, and it exists so the title screen is a place and not a list.
  function skyline() {
    const base = court.y + court.h - 46;
    const shapes = [rect(court.x, base, court.w, 10, PALETTE.violetDim)];
    const towers = [[40, 72], [96, 48], [150, 96], [214, 60], [268, 80], [330, 42], [386, 88], [452, 54], [508, 70], [566, 44]];
    for (const [dx, h] of towers) {
      shapes.push(rect(court.x + dx, base - h, 44, h, PALETTE.violetDim));
      for (let wy = base - h + 14; wy < base - 16; wy += 22) {
        shapes.push(rect(court.x + dx + 10, wy, 10, 10, PALETTE.sunDim));
        shapes.push(rect(court.x + dx + 26, wy, 10, 10, PALETTE.violet));
      }
    }
    for (const px of [court.x + 22, court.x + court.w - 46]) {
      shapes.push(rect(px, base - 118, 12, 118, PALETTE.bark));
      shapes.push(disc(px + 6, base - 124, 24, PALETTE.leafDim));
      shapes.push(disc(px - 16, base - 115, 16, PALETTE.leaf));
      shapes.push(disc(px + 28, base - 115, 16, PALETTE.leafLit));
    }
    return shapes;
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: [
        ...skyline(),
        rect(court.x + 60, court.y + 116, court.w - 120, 4, PALETTE.ember),
      ] }],
      text: [
        centred('CITY OF', court.y + 54, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        centred('ANGELS', court.y + 94, { scale: 2, font: HEAVY, fill: PALETTE.ember }),
        ...MENU.map((item, i) => centred(
          `${i === game.cursor ? '▶ ' : '  '}${item.label}`,
          court.y + 162 + i * 40,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred('THREE OF THEM RUN THIS TOWN NOW', court.y + court.h - 18, { fill: PALETTE.bark }),
      ],
    };
  }

  function howtoScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 78, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('HOW TO PLAY', court.y + 44, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => text(line, court.x + 90, court.y + 100 + i * 30, {
          anchor: 'start', fill: i >= 7 ? PALETTE.moss : PALETTE.cream,
        })),
        centred('B TO GO BACK', court.y + court.h - 28, { fill: PALETTE.bark }),
      ],
    };
  }

  function scoresScreen() {
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 180, court.y + 122 + i * 32, { anchor: 'start', fill: PALETTE.bark }),
      text(row.name, mid.x - 60, court.y + 122 + i * 32, { anchor: 'start', fill: PALETTE.cream }),
      text(row.score === null ? '  --' : String(row.score).padStart(6, ' '), mid.x + 200, court.y + 122 + i * 32,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();

    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 108, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('HIGH SCORES', court.y + 62, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        centred('B TO GO BACK', court.y + court.h - 26, { fill: PALETTE.bark }),
      ],
    };
  }

  function overScreen() {
    const body = [
      centred(game.won ? 'THE LIGHTS CAME BACK' : 'GAME OVER', court.y + 76,
        { scale: 1, font: HEAVY, fill: game.won ? PALETTE.sun : PALETTE.ember }),
      centred(`SCORE ${run.score}`, court.y + 140, { scale: 1, font: HEAVY, fill: PALETTE.cream }),
      centred(game.won ? 'THREE DOWN. ONE CITY.' : `YOU GOT AS FAR AS ${(REGIONS[game.region] ?? REGIONS.skid).name}`,
        court.y + 186, { fill: PALETTE.moss }),
    ];

    const carets = [];
    if (game.placing > 0) {
      const letters = game.initials.map((i) => scores.ALPHABET[i]);
      body.push(centred(`NEW HIGH SCORE  RANK ${game.placing}`, court.y + 236, { fill: PALETTE.moss }));
      letters.forEach((letter, i) => {
        const x = mid.x + (i - 1) * 52;
        body.push(text(letter, x, court.y + 262, { scale: 1, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
        if (i === game.slot) carets.push(rect(x - 4, court.y + 300, 32, 6, PALETTE.sun));
      });
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 40, { fill: PALETTE.bark }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 40, { fill: PALETTE.bark }));
    }

    return { layers: [{ flat: true, shapes: carets }], text: body };
  }

  function diedScreen() {
    return {
      layers: [
        ...playLayers().map((layer) => ({ ...layer, alpha: 0.18 })),
        { flat: true, shapes: [rect(court.x, court.y, court.w, hud.h, PALETTE.ink)] },
      ],
      text: [
        centred('YOU WENT DOWN', field.y + TILE * 1.8, { scale: 1, font: HEAVY, fill: PALETTE.ember }),
        centred(`IN ${(REGIONS[game.region] ?? REGIONS.skid).name}`, field.y + TILE * 3, { fill: PALETTE.bark }),
        ...DEAD_MENU.map((item, i) => centred(
          `${i === game.cursor ? '▶ ' : '  '}${item.label}`,
          field.y + TILE * 4.6 + i * 44,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred(`GETTING UP COSTS ${CONTINUE_COST}`, field.y + field.h - 34, { fill: PALETTE.bark }),
      ],
    };
  }

  const SCREENS = {
    menu: menuScreen,
    died: diedScreen,
    howto: howtoScreen,
    scores: scoresScreen,
    play: playScreen,
    paused: pausedScreen,
    over: overScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `City of Angels (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      matte: court,
      matteColour: PALETTE.ink,
      ink: 3,
      font: FONT,
      layers,
      text: labels,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    music() {
      if (game.screen === 'play' || game.screen === 'paused') {
        if (boss && boss.dying <= 0) return 'showdown';
        return REGIONS[game.region]?.track ?? 'angels';
      }
      if (game.screen === 'died') return null;
      if (game.screen === 'over' && !game.won) return null;
      return 'angels';
    },
    state() {
      return {
        screen: game.screen,
        exit: game.exit,
        cursor: game.cursor,
        room: game.room,
        region: game.region,
        hearts: run.hearts,
        maxHearts: run.maxHearts,
        score: run.score,
        paint: run.paint,
        juice: run.juice,
        has: { ...run.has },
        done: { ...run.done },
        enemies: enemies.length,
        // Positions, the way golf reports its ball. A test can only play this
        // game if it can see what is in the room with it, and "the whole city
        // can be cleared" in test/game.test.js does exactly that.
        foes: enemies.map((e) => ({ kind: e.kind, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp })),
        loot: items.map((i) => ({ kind: i.kind, x: Math.round(i.x), y: Math.round(i.y) })),
        boss: boss ? { id: boss.id, hp: boss.hp, mode: boss.mode, x: Math.round(boss.x), y: Math.round(boss.y) } : null,
        talking: talk ? talk.pages.length - talk.page : 0,
        fetching: summons ? summons.person.id : null,
        shut: shutIn(ROOMS[game.room] ?? {}),
        placing: game.placing,
        won: game.won,
        continues: run.continues,
        elapsed: game.elapsed,
        at: [Math.round(player.x), Math.round(player.y)],
      };
    },
    field,
    court,
  };
}

// Box art for the shell's selector: a palm, a skyline and somebody with a bat.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const d = (dx, dy, dr, fill) => ({ type: 'disc', x: Math.round(dx), y: Math.round(dy), r: dr, fill });
  const base = y + h - 10;
  return [
    r(x, y, w, h * 0.55, PALETTE.violetDim),
    r(x, base, w, 10, PALETTE.stoneDim),
    r(x + 8, base - 26, 12, 26, PALETTE.violet),
    r(x + 24, base - 40, 12, 40, PALETTE.violet),
    r(x + w - 30, base - 32, 12, 32, PALETTE.violet),
    r(x + w - 16, base - 20, 10, 20, PALETTE.violet),
    d(x + w * 0.5, y + 16, 9, PALETTE.sun),
    r(x + w * 0.46, base - 22, 10, 14, PALETTE.sky),
    d(x + w * 0.5, base - 28, 5, PALETTE.cream),
    r(x + w * 0.56, base - 30, 3, 16, PALETTE.barkLit),
  ];
}

module.exports = {
  title: 'CITY OF ANGELS',
  blurb: 'SAVE LA',
  meta: {
    players: [1],
    rating: '13',
    audio: '8-bit',
    graphics: '2d',
    content: ['street violence', 'drug references'],
  },
  accent: 'ember',
  emblem,
  create,
  GAME, MENU, PAUSE_MENU, DEAD_MENU, ROOMS, REGIONS, KINDS, BOSSES, WEAPONS,
  PEOPLE, OPENING, ENDING, HOW_TO, paginate, WRAP,
  START, REGION_START, CONTINUE_COST, COLS, ROWS,
};

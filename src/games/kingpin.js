'use strict';
// Kingpin -- twenty-one days to make a name in a town that is watching you.
//
// Every other game here fits on one screen. This one has a town: forty-eight
// tiles by thirty-seven, four districts, fourteen doors and a camera that
// follows you around it. That is the whole reason it is the only game with a
// minimap -- you can see a fifth of this place at a time, and a corner you
// cannot see is a corner you have forgotten you are paying for.
//
// Three ideas hold it together, and each of them is data rather than code:
//
//   The town is a picture, not a coordinate system. TOWN below is what the
//   place looks like from above; PLACES names the doors cut into it, and the
//   check at the bottom of this section refuses to load if one of them has a
//   door the other does not. A map you can read is a map you can edit.
//
//   Prices come from the calendar. priceAt(place, good, day) seeds its own
//   generator from those three numbers, so what the warehouse charges on day
//   nine is the same whatever you did on day eight, nothing you do can move a
//   price you have not walked to, and a test can look one up without playing.
//   Meadowlark's weather is built the same way and for the same reason.
//
//   Everything you do to the town, the town does back. Every civilian you
//   kill is one fewer person on the street to sell to and one fewer person
//   willing to stand on a corner for you, so the prices you get fall and the
//   queue at the Towers dries up. Clearing the street of witnesses is the one
//   strategy in here that cannot be made to work.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));    // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'kingpin';

// --- the shape of the world --------------------------------------------------

// What fits on the television, in tiles. The town is five times that.
const VIEW_COLS = 20;
const VIEW_ROWS = 11;

const COLS = 48;
const ROWS = 37;

const GLYPH = {
  '.': 'road',
  ',': 'walk',
  g: 'grass',
  c: 'corner',
  '+': 'door',
  '#': 'block',
  '~': 'water',
  T: 'tree',
  '=': 'bench',
  o: 'bin',
  f: 'fence',
};
const SOLID = new Set(['block', 'water', 'tree', 'bench', 'bin', 'fence']);

// The town. Roads are three tiles wide because two is a corridor and you spend
// a lot of this game with somebody behind you. `+` is a door and every one of
// them is named in PLACES below; `c` is a corner somebody can work.
const TOWN = [
  '################################################',
  '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
  '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
  '#,,,,,,=,,,,,,,o,,,,,,,,,=,,,,,,,o,,,,,,,,,T,,,#',
  '#.............................o................#',
  '#..................c...........................#',
  '#...........o..................................#',
  '####+###...,,,,,,,...#######...#######...##+####',
  '########...,##,##,...#######...#######...#######',
  '########...,##,##,...#######...##,,,##...#######',
  '########...,,,,,,,...#######...##,,,##...#######',
  '########...,,o,,o,...###+###...###+###...#######',
  '#................................o.............#',
  '#........c...................c.........c.......#',
  '#.....................o........................#',
  '####+###...g#####g...###+###...#######...##+####',
  '########...g#####g...#######...#######...#######',
  '########...T#####T...#######...#######...#####,#',
  '########...g#####g...#####,,...#######...,,,,,,#',
  '########...gg,+,gg...#####,,...###+###...,,o,,,#',
  '#.......o......................................#',
  '#..................c...................c.......#',
  '#.........................o....................#',
  '####+###...###,###...###+###...##,,,##...#######',
  '####,###...###,###...#######...##,#,##...#######',
  '##,,,,,#...#,,,,,#...#######...#,,#,,#...#######',
  '##,###,#...###,###...##,,,##...##,#,##...#######',
  '##,,,,,#...###+###...##,,,##...##,,,##...##+####',
  '#..................................o...........#',
  '#........c...................c.................#',
  '#..............o...............................#',
  '#gTggTgg...##,,,##...g##+gTg...##,,,##...##,,###',
  '#gg=gg=g...##,,,##...g###ggg...##,#,##...##,,###',
  '#ggggggg...#######...g###ggg...##,#,##...#######',
  '#gT=g=Tg...#######...ggggggg...##,,,##...#######',
  '#gggTggg...#######...gTgggTg...#######...#######',
  '################################################',
];

// --- districts ---------------------------------------------------------------
//
// Four of them, and they tile the map exactly -- every tile is in one, which is
// what lets the ground colour be the answer to "where am I". `want` is how
// badly the street here wants each thing. It is deliberately a gentle slope --
// powder is worth about a quarter more up the hill than on the quay, and grass
// the other way -- because the day's own swing is three times wider than that.
// A fixed gradient large enough to be the answer means there is only ever one
// route, and a game with one route is a walk.
const DISTRICTS = [
  {
    id: 'docks', name: 'THE DOCKS', from: [0, 0], to: [47, 11],
    road: PALETTE.stoneDim, walk: PALETTE.stone, wall: PALETTE.bark, trim: PALETTE.barkDim,
    grass: PALETTE.rough, accent: PALETTE.sky,
    want: { grass: 0.95, pills: 0.9, powder: 0.92, irons: 1.12, chops: 1.18 },
  },
  {
    id: 'downtown', name: 'DOWNTOWN', from: [0, 12], to: [47, 21],
    road: PALETTE.stone, walk: PALETTE.stoneLit, wall: PALETTE.stoneLit, trim: PALETTE.stone,
    grass: PALETTE.leaf, accent: PALETTE.sun,
    want: { grass: 1.0, pills: 1.08, powder: 1.04, irons: 0.96, chops: 0.92 },
  },
  {
    id: 'flats', name: 'THE FLATS', from: [0, 22], to: [19, 36],
    road: PALETTE.stoneDim, walk: PALETTE.stone, wall: PALETTE.barkDim, trim: PALETTE.bark,
    grass: PALETTE.roughDim, accent: PALETTE.ember,
    want: { grass: 1.18, pills: 1.0, powder: 0.9, irons: 1.14, chops: 1.06 },
  },
  {
    id: 'heights', name: 'THE HEIGHTS', from: [20, 22], to: [47, 36],
    road: PALETTE.stone, walk: PALETTE.sandLit, wall: PALETTE.cream, trim: PALETTE.sand,
    grass: PALETTE.turf, accent: PALETTE.violet,
    want: { grass: 0.9, pills: 1.14, powder: 1.2, irons: 0.86, chops: 0.82 },
  },
];

function districtAt(col, row) {
  for (const d of DISTRICTS) {
    if (col >= d.from[0] && col <= d.to[0] && row >= d.from[1] && row <= d.to[1]) return d;
  }
  throw new Error(`no district covers ${col},${row}`);
}

// --- what you can carry ------------------------------------------------------
//
// Five things, and the two at the bottom are guns. They are worth more, they
// take up more of the bag, and they bring the police down about three times
// faster -- a town notices a crate of choppers going past in a way it does not
// notice a pocketful of grass.
const GOODS = [
  { id: 'grass', name: 'GRASS', tag: 'G', base: 60, bulk: 1, heat: 0.5 },
  { id: 'pills', name: 'PILLS', tag: 'P', base: 190, bulk: 1, heat: 0.8 },
  { id: 'powder', name: 'POWDER', tag: 'W', base: 540, bulk: 1, heat: 1.3 },
  { id: 'irons', name: 'IRONS', tag: 'I', base: 360, bulk: 2, heat: 2.4 },
  { id: 'chops', name: 'CHOPPERS', tag: 'C', base: 1020, bulk: 3, heat: 3.6 },
];
const GOOD = Object.fromEntries(GOODS.map((g) => [g.id, g]));
const BAG = 40;

// --- what you can hit them with ----------------------------------------------
//
// The order is the order you get them in and the order they escalate in, and
// the last three all use the same box of rounds, so the choice between them is
// what you are willing to be seen with rather than what you can afford to
// feed. `noise` is heat per shot: a rifle going off downtown is most of the way
// to a roadblock on its own.
const WEAPONS = [
  { id: 'fist', name: 'FISTS', damage: 1, rate: 0.34, melee: true, noise: 0, sound: 'swing' },
  { id: 'bat', name: 'BAT', damage: 3, rate: 0.42, melee: true, noise: 0.6, sound: 'swing' },
  { id: 'pistol', name: 'PISTOL', damage: 4, rate: 0.40, noise: 5, speed: 15, sound: 'shot', cost: 900 },
  { id: 'uzi', name: 'UZI', damage: 2, rate: 0.09, noise: 2.2, speed: 14, spread: 0.18, sound: 'rattle', cost: 2600 },
  { id: 'rifle', name: 'RIFLE', damage: 9, rate: 0.8, noise: 13, speed: 20, sound: 'rifle', cost: 6400 },
];
const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
const AMMO_MAX = 300;
const AMMO_PRICE = 4;

// --- the doors ---------------------------------------------------------------
//
// Every one of these is a `+` in the map above and the load check below pairs
// them off, so a door can never be somewhere the town does not have one. `sells`
// is what a shop will trade in and `bias` is the little that is fixed about
// what it charges: the warehouse is a wholesaler and Mrs Lowry has never once
// asked what something cost. Everything else about a price is the day.
const PLACES = {
  docks: {
    name: 'PIER 9 WAREHOUSE', at: [4, 7], kind: 'market', who: 'FRANNY', face: 'franny',
    sells: ['grass', 'pills', 'powder', 'irons', 'chops'], bias: 0.84,
  },
  depot: {
    name: 'THE BUS DEPOT', at: [43, 7], kind: 'depot', who: 'TICKET CLERK', face: 'clerk',
  },
  pawn: {
    name: 'MARLOW PAWN', at: [24, 11], kind: 'market', who: 'MARLOW', face: 'marlow',
    sells: ['irons', 'chops', 'pills'], bias: 0.94,
  },
  motel: {
    name: 'SEABIRD MOTEL', at: [34, 11], kind: 'market', who: 'ROOM SIX', face: 'roomsix',
    sells: ['pills', 'powder'], bias: 1.06,
  },
  cops: {
    name: 'CITY POLICE', at: [4, 15], kind: 'police', who: 'SGT REEVES', face: 'reeves',
  },
  store: {
    name: 'PARK AND SHOP', at: [24, 15], kind: 'market', who: 'MR OYELARAN', face: 'shop',
    sells: ['grass', 'pills'], bias: 1.0,
  },
  garage: {
    name: "BENNY'S GARAGE", at: [43, 15], kind: 'garage', who: 'BENNY', face: 'benny',
  },
  church: {
    name: "ST BRIGID'S", at: [14, 19], kind: 'church', who: 'FR MULCAHY', face: 'priest',
  },
  guns: {
    name: 'SUNSTATE ARMS', at: [34, 19], kind: 'armoury', who: 'DALE', face: 'dale',
    sells: ['irons', 'chops'], bias: 1.03,
  },
  towers: {
    name: 'THE TOWERS', at: [4, 23], kind: 'recruit', who: 'AUNT PEARL', face: 'pearl',
  },
  bar: {
    name: 'THE ANCHOR', at: [24, 23], kind: 'bar', who: 'VITO', face: 'vito',
  },
  room: {
    name: 'YOUR ROOM', at: [14, 27], kind: 'home', who: '', face: null,
  },
  clinic: {
    name: 'DOC ABADI', at: [43, 27], kind: 'clinic', who: 'DOC ABADI', face: 'doc',
  },
  villa: {
    name: 'THE VILLA', at: [24, 31], kind: 'market', who: 'MRS LOWRY', face: 'lowry',
    sells: ['powder', 'pills', 'chops'], bias: 1.12,
  },
};

const START = { col: 14, row: 28 };

// --- the load check ----------------------------------------------------------
//
// A map this size is the one thing in the project you cannot check by looking
// at it, so it gets checked here, once, at require time. Everything below
// throws rather than warns: a town with a door into a wall is not a town that
// should be allowed to boot.
const CORNERS = [];
{
  if (TOWN.length !== ROWS) throw new Error(`town is ${TOWN.length} rows, expected ${ROWS}`);
  const doors = [];
  TOWN.forEach((line, r) => {
    if (line.length !== COLS) throw new Error(`town row ${r} is ${line.length} columns, expected ${COLS}`);
    [...line].forEach((ch, c) => {
      if (!GLYPH[ch]) throw new Error(`town row ${r}: unknown tile "${ch}"`);
      if (ch === '+') doors.push(`${c},${r}`);
      if (ch === 'c') CORNERS.push({ col: c, row: r, district: districtAt(c, r).id });
    });
  });

  const claimed = new Set();
  for (const [id, place] of Object.entries(PLACES)) {
    const [c, r] = place.at;
    if (TOWN[r][c] !== '+') throw new Error(`place ${id}: no door in the town at ${c},${r}`);
    claimed.add(`${c},${r}`);
    place.id = id;
    place.district = districtAt(c, r).id;
  }
  for (const door of doors) {
    if (!claimed.has(door)) throw new Error(`the town has a door at ${door} that no place claims`);
  }
  if (!CORNERS.length) throw new Error('a town with no corners has nowhere to put a crew');

  // And every one of them has to be walkable to. A door you cannot reach is a
  // shop that does not exist, and there is no way to see that by reading a map.
  const walkable = (c, r) => !SOLID.has(GLYPH[TOWN[r][c]]);
  const seen = new Set([`${START.col},${START.row}`]);
  const queue = [[START.col, START.row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [nc, nr] = [c + dc, r + dr];
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      if (seen.has(`${nc},${nr}`) || !walkable(nc, nr)) continue;
      seen.add(`${nc},${nr}`);
      queue.push([nc, nr]);
    }
  }
  for (const [id, place] of Object.entries(PLACES)) {
    if (!seen.has(`${place.at[0]},${place.at[1]}`)) throw new Error(`place ${id} cannot be walked to`);
  }
  for (const corner of CORNERS) {
    if (!seen.has(`${corner.col},${corner.row}`)) throw new Error(`a corner at ${corner.col},${corner.row} cannot be walked to`);
  }
}

// --- faces -------------------------------------------------------------------
//
// Everybody you can talk to has one, and it is drawn big enough to read across
// a room -- the point of a conversation in a game like this is that you are
// looking at somebody rather than at a box of text. A face is six colours and
// four flags; petShapes() in tomo.js works the same way, and for the same
// reason: add a feature to the drawing, never a new special case per character.
const FACES = {
  vee: { skin: PALETTE.bark, hair: PALETTE.ink, shirt: PALETTE.sky, brow: 0.5, hat: null, shades: false, beard: false },
  vito: { skin: PALETTE.creamDim, hair: PALETTE.stoneDim, shirt: PALETTE.emberDim, brow: 0.7, hat: null, shades: false, beard: true },
  pearl: { skin: PALETTE.barkDim, hair: PALETTE.cream, shirt: PALETTE.rose, brow: 0.3, hat: 'scarf', shades: false, beard: false },
  reeves: { skin: PALETTE.sandLit, hair: PALETTE.barkDim, shirt: PALETTE.skyDim, brow: 0.8, hat: 'cap', shades: true, beard: false },
  priest: { skin: PALETTE.cream, hair: PALETTE.stone, shirt: PALETTE.ink, brow: 0.35, hat: null, shades: false, beard: false },
  franny: { skin: PALETTE.sand, hair: PALETTE.barkLit, shirt: PALETTE.moss, brow: 0.6, hat: 'cap', shades: false, beard: true },
  marlow: { skin: PALETTE.creamDim, hair: PALETTE.barkDim, shirt: PALETTE.violetDim, brow: 0.55, hat: null, shades: true, beard: false },
  roomsix: { skin: PALETTE.bark, hair: PALETTE.ink, shirt: PALETTE.sunDim, brow: 0.45, hat: null, shades: true, beard: false },
  shop: { skin: PALETTE.barkDim, hair: PALETTE.ink, shirt: PALETTE.creamDim, brow: 0.4, hat: null, shades: false, beard: false },
  dale: { skin: PALETTE.sandLit, hair: PALETTE.sunDim, shirt: PALETTE.roughDim, brow: 0.75, hat: 'cap', shades: true, beard: true },
  benny: { skin: PALETTE.sand, hair: PALETTE.stoneDim, shirt: PALETTE.ember, brow: 0.5, hat: 'cap', shades: false, beard: false },
  lowry: { skin: PALETTE.cream, hair: PALETTE.sunLit, shirt: PALETTE.violet, brow: 0.3, hat: null, shades: true, beard: false },
  doc: { skin: PALETTE.barkDim, hair: PALETTE.stone, shirt: PALETTE.cream, brow: 0.5, hat: null, shades: false, beard: false },
  clerk: { skin: PALETTE.creamDim, hair: PALETTE.bark, shirt: PALETTE.skyDim, brow: 0.45, hat: 'cap', shades: false, beard: false },
  kessler: { skin: PALETTE.sand, hair: PALETTE.emberDim, shirt: PALETTE.violetDim, brow: 0.85, hat: null, shades: true, beard: true },
  local: { skin: PALETTE.bark, hair: PALETTE.ink, shirt: PALETTE.moss, brow: 0.45, hat: null, shades: false, beard: false },
  cop: { skin: PALETTE.sandLit, hair: PALETTE.stoneDim, shirt: PALETTE.sky, brow: 0.8, hat: 'cap', shades: true, beard: false },
};

// The bodies in the street. `looks` is rolled per person from the seed, so a
// crowd is a crowd rather than a row of identical men.
const SKINS = [PALETTE.bark, PALETTE.barkDim, PALETTE.sand, PALETTE.sandLit, PALETTE.creamDim, PALETTE.cream];
const SHIRTS = [PALETTE.moss, PALETTE.sky, PALETTE.rose, PALETTE.sun, PALETTE.violet, PALETTE.ember,
  PALETTE.turf, PALETTE.creamDim, PALETTE.skyLit, PALETTE.roseDim];

const KINDS = {
  local: { label: 'LOCAL', hp: 3, speed: 26, damage: 0, size: 1 },
  crew: { label: 'CREW', hp: 6, speed: 30, damage: 0, size: 1 },
  cop: { label: 'POLICE', hp: 9, speed: 46, damage: 0, size: 1.05, shirt: PALETTE.skyDim, trim: PALETTE.ink },
  rival: { label: 'KESSLER', hp: 7, speed: 42, damage: 2, size: 1.1, shirt: PALETTE.violetDim, trim: PALETTE.ember, armed: 'pistol' },
  collector: { label: 'COLLECTOR', hp: 9, speed: 38, damage: 2, size: 1.2, shirt: PALETTE.emberDim, trim: PALETTE.barkDim },
};

const NAMES = ['DESI', 'RAY', 'TOOTS', 'BIRD', 'LUCKY', 'SHOES', 'MARCY', 'HALF PINT',
  'CLEO', 'SPEED', 'JUNE', 'PAPA', 'SLIM', 'DUKE', 'ROSA', 'TITO'];

// --- the run -----------------------------------------------------------------

const LAST_DAY = 21;            // the task force moves in on the morning of 22
const DAY_LENGTH = 150;         // seconds of daylight before the streets turn
const NIGHT_AT = 0.62;          // where in the day the light goes
const START_CASH = 700;
const START_DEBT = 1000;
const DEBT_RATE = 0.06;         // a day, compounding, and Vito does the sums
const CREW_COST = 400;
const CREW_WAGE = 140;
const CREW_STOCK = 12;          // units a hand takes out with them
const SELL_EVERY = 9;           // seconds between a hand's sales
const RETAIL = 1.38;           // what the street pays over the counter price
const HEAT_MAX = 100;
const BRIBE = 350;
const TITHE = 250;
const PATCH_UP = 300;
const BIKE_JOB = 'benny';

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
const DEAD_MENU = [
  { id: 'continue', label: 'WAKE UP AT THE CLINIC' },
  { id: 'quit', label: 'THAT IS THAT' },
];

const HOW_TO = [
  'MOVE       D-PAD',
  'TALK / GO IN   A',
  'SWING OR SHOOT B',
  'CHANGE WEAPON  SELECT',
  'PAUSE          START',
  '',
  'BUY LOW ON THE QUAY. SELL HIGH UP THE HILL.',
  'PUT A CREW ON A CORNER AND COLLECT.',
  'THE POLICE CAN BE PAID. THE TOWN CANNOT.',
  'EVERY BODY YOU LEAVE IS ONE FEWER CUSTOMER.',
];

const OPENING = [
  'Twenty-one days, Vito said, and he said it like it was a favour.',
  'A thousand dollars of his money is in your pocket and the interest starts tonight.',
  'The bus out of here leaves from the depot on the quay. Be on it with more than you came with.',
];

const ENDING = {
  bus: ['The 6:40 pulls out past the warehouses with you on it.',
    'Nobody asks what is in the bag.'],
  taken: ['They come for the whole street on the morning of the twenty-second.',
    'You are not on the bus. You are on a list.'],
  dead: ['The sirens arrive about four minutes after they are any use.'],
  prison: ['Reeves does the paperwork himself, slowly, and does not look up.',
    'The bus goes at 6:40. You are not going to be on it.'],
};

// --- small tools -------------------------------------------------------------

// mulberry32, same as everything else in here.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over a handful of small numbers. Used to seed a generator from a
// (day, place, good) triple so a price can be looked up rather than remembered.
function hash(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h = Math.imul(h ^ ((n >>> 0) & 0xff), 0x01000193);
    h = Math.imul(h ^ (((n >>> 8) >>> 0) & 0xff), 0x01000193);
    h = Math.imul(h ^ (((n >>> 16) >>> 0) & 0xff), 0x01000193);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// A debt reads as -$300, never as $-300.
const money = (n) => (n < 0 ? `-$${Math.abs(Math.round(n))}` : `$${Math.round(n)}`);

const rect = (x, y, w, h, fill) =>
  ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r, fill });

const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const facing = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));

// The talk box is narrow because a face takes up the left third of it, which is
// the trade this game makes: fewer words on screen at once, and you are looking
// at somebody while you read them.
const WRAP = 26;
function paginate(paragraphs, lines = 3) {
  const pages = [];
  for (const para of paragraphs) {
    const wrapped = [];
    let line = '';
    for (const word of String(para).split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= WRAP) line += ` ${word}`;
      else { wrapped.push(line); line = word; }
    }
    wrapped.push(line);
    for (let i = 0; i < wrapped.length; i += lines) pages.push(wrapped.slice(i, i + lines));
  }
  return pages;
}

// What a market charges for a thing today. Seeded from the date and the door,
// so it is a fact about the world rather than a number somebody is keeping:
// nothing you do today can move it, and a test can ask what Tuesday costs.
function priceAt(placeId, goodId, day) {
  const place = PLACES[placeId];
  const good = GOOD[goodId];
  const index = Object.keys(PLACES).indexOf(placeId);
  const roll = rng(hash(day, index, GOODS.findIndex((g) => g.id === goodId)));
  roll();
  // Two rolls, added. One flat roll gives a town where every price is equally
  // likely to be silly; two gives a town with an ordinary week and the odd
  // spike, which is the week worth trading. The spread here is about three to
  // one, which is wider than the whole map, so the answer to "where do I take
  // this" is a different door most mornings.
  const swing = 0.55 + (roll() + roll()) * 0.62;
  const district = DISTRICTS.find((d) => d.id === place.district);
  return Math.max(4, Math.round(good.base * district.want[goodId] * place.bias * swing));
}

// --- the script --------------------------------------------------------------
//
// Everybody's words, kept out of the machine that says them. They are pure
// functions of the run, so a person who has already told you something tells
// you the next thing instead of the same thing -- somebody who repeats himself
// is a sign, not a character. What the options next to them actually *do*
// lives in openPlace(); this is only ever the talking.
//
// Every word has to fit the box: WRAP is 26 characters and test/kingpin.test.js
// walks the whole script checking it.

const MARKET_TALK = {
  docks: (run) => {
    if (run.day <= 1) {
      return [
        'Franny does not shake hands. She points at a crate and waits.',
        'Wholesale off the boat. If you are selling it back to me you are doing this wrong.',
      ];
    }
    if (run.sold > 40) return ['You are moving weight now. Take the pallet, not the box.'];
    return ['Everything on this quay came off a boat and none of it has paper. Prices move daily.'];
  },
  pawn: (run) => (run.town.dead > 3
    ? ['Marlow keeps the counter between you and him the whole time now.']
    : ['Marlow buys anything with a serial number and asks after nobody.']),
  motel: (run) => (run.heat > 50
    ? ['Room six opens the door four inches. There is a squad car on the quay, he says, and shuts it.']
    : ['Room six. Curtains shut at two in the afternoon, and he has cash in a shoebox.']),
  store: (run) => (run.town.goodwill > 0
    ? ['Mr Oyelaran heard what you gave the church. He has coffee on.']
    : ['Mr Oyelaran sells milk at the front and other things through the back.']),
  villa: (run) => (run.town.dead > 6
    ? ['Mrs Lowry has read the paper. She pays, but she does not offer you a chair.']
    : ['Mrs Lowry pays uptown prices because uptown is where she has to live afterwards.']),
};

const ARMS_TALK = (run) => (run.town.copsKilled > 0
  ? ['Dale has the radio on and it is all about you. He will still sell you anything.']
  : ['Dale keeps the good stuff behind the counter and the terrible stuff in front of it.']);

const ARMS_WORDS = {
  pistol: 'Heavy, honest, and it will make everybody on the street run.',
  uzi: 'It empties in four seconds and it is deafening. That is the whole review.',
  rifle: 'Nobody carries one of these to be left alone. It will bring the town down on you.',
};

const COPSHOP_TALK = (run) => {
  if (run.town.copsKilled > 0) {
    return ['Reeves does not get up. There is nothing in your pockets that fixes what you did.'];
  }
  if (run.busts >= 3) return ['Reeves has your sheet on the desk, face up, where you can read it.'];
  if (run.heat > 60) return ['Reeves looks at you a long moment. He knows. He is deciding what it costs.'];
  return ['Sergeant Reeves has a drawer he does not lock and a way of not asking questions.'];
};

const CHURCH_TALK = (run) => {
  if (run.town.dead > 4) {
    return ['Father Mulcahy buried two of them this week.',
      'He does not refuse you. He just knows what the box is for now.'];
  }
  return ['The boiler is out and the hall is shut, and he is still here at nine at night.'];
};

const CONFESSION = (run) => {
  if (run.town.dead === 0 && run.sold > 0) {
    return ['You have not hurt anybody. That is not nothing, and I am not going to tell you it is.'];
  }
  if (run.town.dead > 6) {
    return ['I will say it plainly. There are fewer people on this street than there were.',
      'They were the same people who bought from you. You are eating the room you stand in.'];
  }
  if (run.town.dead > 0) return ['One is a mistake. Two is a habit. Sit down a while.'];
  return ['Sit as long as you like. It is warmer in here than out there, which is the entire ministry tonight.'];
};

const CLINIC_TALK = (run) => (run.health <= 4
  ? ['Doc Abadi looks at you once and starts laying things out on the tray.']
  : ['She stitches for cash and does not write anything down.']);

const TOWERS_TALK = (run, left) => {
  if (left <= 0 && run.town.dead > 0) {
    return ['Pearl folds her arms. Nobody is coming down those stairs for you.',
      'Word got round about what happens to people who stand next to you.'];
  }
  if (left <= 0) return ['Everybody she has is already working for you. Go and pay them.'];
  if (run.town.dead > 2) return ['She sends one down anyway, and she watches you leave with them.'];
  return ['Aunt Pearl knows who needs the work and who can be trusted with it, which is not the same list.'];
};

const VITO_TALK = (run) => {
  if (!run.story.metVito) {
    return ['Vito has the back booth, a glass of milk and a ledger he does not need.',
      'Sit down, he says. You are already in it, so you may as well hear the terms.'];
  }
  if (run.debt <= 0) return ['You are square with him, which he finds unsettling and slightly rude.'];
  if (run.debt > 1800) return ['He does not mention the money. Two men by the door do it for him.'];
  return ['A thousand was the number and the number goes up nightly. He did explain this.'];
};

const VITO_JOB = [
  'Twenty-one days. On the twenty-second they put a task force on this town and it will not matter what you meant.',
  'Buy on the quay, sell it up the hill. Do not sell to me, do not sell near me.',
  'One thing first. Take the parcel under this table to Benny at the garage and I will knock some off.',
];

const BENNY_JOB = [
  'Benny takes the parcel, does not open it, and puts it straight in the safe.',
  'He wheels out a green ten-speed with the gears taped where the shifter should be.',
  'Take it. Nobody in this town looks twice at a man on a bicycle, and that is worth more than the bike.',
];

const BENNY_TALK = (run) => (run.story.bike
  ? ['Benny nods at the bike. Still rolling, he says, which is more than he can say for the van.']
  : ['Benny fixes cars for people who cannot go to a garage that keeps records.']);

const DEPOT_TALK = (run) => {
  if (run.day < 3) return ['The clerk taps the timetable. Nothing worth catching yet, and you know it.'];
  return [`Two hundred and the 6:40 takes you out past the warehouses.`,
    'Whatever is in your pockets when it pulls out is what this was all for.'];
};

const HOME_TALK = (run) => {
  if (run.heat > 55) return ['There is a car parked across the road that was not there this morning.'];
  if (run.day >= LAST_DAY - 1) return ['One more night in this room and then it is over one way or the other.'];
  return ['A mattress, a hot plate, and a box under the bed that nobody has found yet.'];
};

const STREET_TALK = (run, district) => {
  if (run.town.dead > 5) return 'They look at your hands before they look at your face, and then they walk on.';
  if (run.heat > 55) return 'There has been a car round twice, they say, and then they remember somewhere to be.';
  if (district.id === 'heights') return 'They ask if you are lost in a way that means they hope you are.';
  if (district.id === 'flats') return 'Everybody out here is waiting for something. Mostly for the lights to come on.';
  if (district.id === 'docks') return 'Boats in at four, they say. Whole quay smells of diesel and money.';
  return 'They talk about the weather and the rent, in that order, at length.';
};

const WANT_WORDS = {
  grass: 'They ask, quietly, if you are holding.',
  pills: 'They have not slept and they would like not to sleep some more.',
  powder: 'They are very glad to see you and have been for some time.',
  irons: 'They want something small that fits in a coat.',
  chops: 'They want something that is not small at all, and they have the money.',
};

const CREW_TALK = (run, hand) => {
  if (hand.corner === null) return 'Waiting on you to say where. There are corners all over this town.';
  if (hand.stock <= 0) return 'Sold out an hour ago and has been standing here looking like a lemon.';
  if (hand.held > 900) return 'Holding more than they are comfortable holding, and it shows.';
  return 'Working. Nods at you without turning round, which is correct.';
};

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);

  // Everything scales off one number. The HUD needs three rows of the body font
  // and the field takes what is left, which on a 720x480 tube is a 30 pixel
  // tile and a twenty by eleven window onto a town five times that size.
  const TILE = Math.max(8, Math.floor(Math.min(court.w / VIEW_COLS, (court.h - 104) / VIEW_ROWS)));
  const field = {
    x: court.x + Math.floor((court.w - VIEW_COLS * TILE) / 2),
    y: court.y + (court.h - VIEW_ROWS * TILE),
    w: VIEW_COLS * TILE,
    h: VIEW_ROWS * TILE,
  };
  const hud = { x: court.x, y: court.y, w: court.w, h: field.y - court.y };
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const WORLD_W = COLS * TILE;
  const WORLD_H = ROWS * TILE;

  const random = rng(options.seed ?? 0x4b494e47);
  const table = options.scores ?? scores;
  const sounds = [];
  const say = (name) => sounds.push(name);

  const cx = (col) => (col + 0.5) * TILE;
  const cy = (row) => (row + 0.5) * TILE;
  const colAt = (x) => Math.floor(x / TILE);
  const rowAt = (y) => Math.floor(y / TILE);

  // --- what a run is --------------------------------------------------------

  const run = {
    day: 1,
    clock: 0,
    cash: START_CASH,
    debt: START_DEBT,
    bag: {},
    stash: {},
    moved: {},
    ammo: 0,
    owns: { fist: true, bat: false, pistol: false, uzi: false, rifle: false },
    weapon: 0,
    health: 12,
    maxHealth: 12,
    heat: 0,
    crew: [],
    // What the town is, and what you have done to it. `dead` is the number of
    // people who lived here and now do not, and it is the only number in this
    // object that can never be walked back.
    town: { people: 72, dead: 0, copsKilled: 0, goodwill: 0 },
    story: { metVito: false, job: null, bike: false, rivals: false, warned: false },
    busts: 0,
    sold: 0,
    ending: null,
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
    score: 0,
    playTime: 0,
    repeat: 0,
  };

  let locals = [];
  let foes = [];
  let shots = [];
  let talk = null;
  let market = null;
  const cards = [];

  const player = {
    x: cx(START.col), y: cy(START.row), dir: 'up', walk: 0,
    swing: 0, cool: 0, hit: new Set(), invuln: 0, kx: 0, ky: 0, loud: 0,
  };
  const cam = { x: 0, y: 0 };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };

  // --- the map at runtime ---------------------------------------------------

  const tileAt = (col, row) => {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return 'block';
    return GLYPH[TOWN[row][col]];
  };
  const solidAt = (x, y) => SOLID.has(tileAt(colAt(x), rowAt(y)));
  const boxed = (x, y, half) =>
    solidAt(x - half, y - half) || solidAt(x + half, y - half)
    || solidAt(x - half, y + half) || solidAt(x + half, y + half);

  // Axes resolved separately, so walking into a corner slides along it rather
  // than stopping dead -- the difference between a wall and flypaper, and it
  // matters more here than anywhere because most of this game is being chased.
  function moveBox(ent, dx, dy, half) {
    if (dx && !boxed(ent.x + dx, ent.y, half)) ent.x += dx;
    if (dy && !boxed(ent.x, ent.y + dy, half)) ent.y += dy;
  }

  const districtOf = (x, y) => districtAt(clamp(colAt(x), 0, COLS - 1), clamp(rowAt(y), 0, ROWS - 1));
  const placeAt = (col, row) => Object.values(PLACES).find((p) => p.at[0] === col && p.at[1] === row) ?? null;
  const cornerIndexAt = (col, row) => CORNERS.findIndex((k) => k.col === col && k.row === row);

  // --- the economy ----------------------------------------------------------

  // Demand. Every death takes a slice off it and every tithe puts a sliver
  // back, and it multiplies every price anybody pays you -- on a corner, in a
  // doorway, or in the street. A quiet fortnight is worth more than a gun.
  const demand = () => clamp(1 - run.town.dead * 0.035 + run.town.goodwill * 0.02, 0.3, 1.15);
  const recruitsLeft = () => clamp(Math.floor(run.town.people / 12) - run.crew.length, 0, 6);
  const carried = () => GOODS.reduce((n, g) => n + (run.bag[g.id] ?? 0) * g.bulk, 0);
  const capacity = () => BAG + (run.story.bike ? 12 : 0);

  // How much of a thing has gone across one counter lately. A shop is a person
  // with a safe and a spare room, not a market: sell Mrs Lowry thirty units and
  // she is paying two thirds by the end of it, and buying the quay out moves
  // the price the other way. It is the whole reason to own more than one route,
  // and the reason a corner -- which sells to the street, a unit at a time --
  // is worth the wages and the heat.
  const moved = (placeId, goodId) => run.moved[`${placeId}:${goodId}`] ?? 0;
  const noteMoved = (placeId, goodId) => {
    if (placeId) run.moved[`${placeId}:${goodId}`] = moved(placeId, goodId) + 1;
  };

  const buyPrice = (placeId, goodId) =>
    Math.round(priceAt(placeId, goodId, run.day) * (1 + run.heat / 260) * (1 + 0.02 * moved(placeId, goodId)));
  const sellPrice = (placeId, goodId) =>
    Math.round((priceAt(placeId, goodId, run.day) * demand() * 0.94) / (1 + 0.022 * moved(placeId, goodId)));

  // And a counter recovers. Somebody sells the spare room on, the safe fills
  // back up, and two minutes later they want some more -- which is the whole
  // argument for having a second errand to run rather than pacing one street.
  function restockCounters(dt) {
    for (const key of Object.keys(run.moved)) {
      const left = run.moved[key] - dt * 0.05;
      if (left <= 0) delete run.moved[key];
      else run.moved[key] = left;
    }
  }

  // What the street pays, which is what a corner and a doorway both run on.
  const streetPrice = (districtId, goodId, salt = 0) => {
    const d = DISTRICTS.find((x) => x.id === districtId);
    const roll = rng(hash(run.day, salt, GOODS.findIndex((g) => g.id === goodId)));
    return Math.max(3, Math.round(GOOD[goodId].base * d.want[goodId] * (0.9 + roll() * 0.35) * demand() * RETAIL));
  };

  const bagOf = (id) => run.bag[id] ?? 0;
  const addBag = (id, n) => { run.bag[id] = Math.max(0, bagOf(id) + n); };

  const netWorth = () => {
    const goods = GOODS.reduce((n, g) => n + bagOf(g.id) * g.base * 0.6 + (run.stash[g.id] ?? 0) * g.base * 0.6, 0);
    const held = run.crew.reduce((n, c) => n + c.held, 0);
    return Math.round(run.cash + goods + held - run.debt);
  };

  // --- heat -----------------------------------------------------------------

  const wanted = () => clamp(Math.floor(run.heat / 22), 0, 4);
  function warm(amount) {
    run.heat = clamp(run.heat + amount, 0, HEAT_MAX);
    // One warning, the first time it gets properly dangerous, because being
    // hunted without being told is just an unfair map.
    if (!run.story.warned && run.heat > 55) {
      run.story.warned = true;
      card('THE HEAT', ['They have your description now. Get off the street or get it cooled down.']);
      say('siren');
    }
  }
  const cool = (amount) => { run.heat = clamp(run.heat - amount, 0, HEAT_MAX); };

  // --- cards ----------------------------------------------------------------
  //
  // Anything that happens to you rather than because of you goes on a card:
  // dawn, a bust, a corner raided, a body in the paper. They queue, they stop
  // the world, and they take the pad until A -- the same rule tomo.js uses,
  // for the same reason, which is that a note that expires is a note nobody
  // read.
  function card(title, lines) {
    cards.push({ title, lines, t: 0 });
  }

  // --- talking --------------------------------------------------------------
  //
  // A page at a time with a face beside it, and then the list of things you can
  // say. Options are built when the conversation opens, so they close over what
  // was true when you knocked; anything that has to be re-read builds a new
  // conversation instead of editing this one.
  const TYPE_RATE = 52;

  function beginTalk({ who, face, lines, options = [], then = null }) {
    talk = {
      who, face, pages: paginate(lines), page: 0, reveal: 0,
      options, cursor: 0, then, choosing: false,
    };
    say('talk');
  }

  function closeTalk() {
    const then = talk.then;
    talk = null;
    if (then) then();
  }

  function advanceTalk(dt, frame) {
    if (talk.choosing) {
      const list = talk.options;
      if (frame.pressed.up) { talk.cursor = (talk.cursor + list.length - 1) % list.length; say('move'); }
      if (frame.pressed.down) { talk.cursor = (talk.cursor + 1) % list.length; say('move'); }
      if (frame.pressed.b) { say('back'); closeTalk(); return; }
      if (!frame.pressed.a && !frame.pressed.start) return;
      const choice = list[talk.cursor];
      say('select');
      const act = choice.act;
      closeTalk();
      if (act) act();
      return;
    }

    const page = talk.pages[talk.page];
    const full = page.join(' ').length;
    talk.reveal = Math.min(full, talk.reveal + TYPE_RATE * dt);
    if (!(frame.pressed.a || frame.pressed.b || frame.pressed.start)) return;
    if (talk.reveal < full) { talk.reveal = full; return; }

    talk.page++;
    if (talk.page < talk.pages.length) { talk.reveal = 0; say('talk'); return; }
    if (talk.options.length) { talk.choosing = true; talk.cursor = 0; say('talk'); return; }
    closeTalk();
  }

  // --- people in the street -------------------------------------------------

  function makeLook() {
    return {
      body: SHIRTS[Math.floor(random() * SHIRTS.length)],
      head: SKINS[Math.floor(random() * SKINS.length)],
      trim: SHIRTS[Math.floor(random() * SHIRTS.length)],
    };
  }

  function openTileNear(col, row, tries = 24) {
    for (let i = 0; i < tries; i++) {
      const c = clamp(col + Math.floor((random() - 0.5) * 14), 1, COLS - 2);
      const r = clamp(row + Math.floor((random() - 0.5) * 12), 1, ROWS - 2);
      if (!SOLID.has(tileAt(c, r))) return [c, r];
    }
    return null;
  }

  // Spawns just outside the window, so nobody is ever seen arriving. The count
  // is a function of how many people are left alive in this town, which is the
  // whole consequence system in one line.
  function restock() {
    const want = clamp(Math.round(run.town.people / 7), 1, 11);
    let guard = 0;
    while (locals.length < want && guard++ < 6) {
      const edge = Math.floor(random() * 4);
      const col = colAt(cam.x + field.w / 2) + (edge === 0 ? -13 : edge === 1 ? 13 : Math.floor((random() - 0.5) * 26));
      const row = rowAt(cam.y + field.h / 2) + (edge === 2 ? -8 : edge === 3 ? 8 : Math.floor((random() - 0.5) * 16));
      const spot = openTileNear(clamp(col, 1, COLS - 2), clamp(row, 1, ROWS - 2), 8);
      if (!spot) break;
      const district = districtAt(spot[0], spot[1]);
      // Roughly half of them are in the market for something, and what they
      // want is what their end of town wants.
      const wantsOne = random() < 0.5;
      const pick = GOODS[Math.floor(random() * GOODS.length)];
      locals.push({
        kind: 'local', x: cx(spot[0]), y: cy(spot[1]), dir: 'down',
        look: makeLook(), hp: KINDS.local.hp, phase: random() * 6.28, seed: random() * 6.28,
        wants: wantsOne && district.want[pick.id] >= 0.85 ? pick.id : null,
        salt: Math.floor(random() * 9000), panic: 0, hurt: 0, walkT: 0, vx: 0, vy: 0,
      });
    }
    const far = TILE * 26;
    locals = locals.filter((p) =>
      Math.abs(p.x - (cam.x + field.w / 2)) < far && Math.abs(p.y - (cam.y + field.h / 2)) < far);
  }

  function wander(p, dt) {
    p.phase += dt;
    if (p.hurt > 0) p.hurt -= dt;
    if (p.panic > 0) p.panic -= dt;
    p.walkT -= dt;
    if (p.walkT <= 0) {
      p.walkT = 0.7 + random() * 1.8;
      const a = random() * Math.PI * 2;
      p.vx = Math.cos(a);
      p.vy = Math.sin(a);
      if (random() < 0.3) { p.vx = 0; p.vy = 0; }
    }
    let [vx, vy] = [p.vx, p.vy];
    let speed = KINDS.local.speed;
    if (p.panic > 0) {
      // Away from whatever just went off, and quickly.
      const dx = p.x - player.x;
      const dy = p.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      vx = dx / d; vy = dy / d;
      speed = 84;
    }
    if (vx || vy) {
      const before = [p.x, p.y];
      moveBox(p, vx * speed * dt, vy * speed * dt, TILE * 0.26);
      if (p.x === before[0] && p.y === before[1]) p.walkT = 0;
      p.dir = facing(vx, vy);
    }
  }

  const scare = (x, y, radius) => {
    for (const p of locals) {
      if (Math.hypot(p.x - x, p.y - y) < radius) p.panic = 1.6 + random();
    }
  };

  // --- crew -----------------------------------------------------------------

  function hire() {
    const name = NAMES[(run.crew.length + Math.floor(random() * NAMES.length)) % NAMES.length];
    const hand = {
      name: run.crew.some((c) => c.name === name) ? `${name} II` : name,
      look: makeLook(), corner: null, good: null, stock: 0, held: 0,
      x: player.x, y: player.y, phase: random() * 6.28, hp: KINDS.crew.hp,
      sellT: SELL_EVERY, dir: 'down', hurt: 0,
    };
    run.crew.push(hand);
    return hand;
  }

  function postCrew(hand, cornerIndex, goodId) {
    const spot = CORNERS[cornerIndex];
    hand.corner = cornerIndex;
    hand.good = goodId;
    const take = Math.min(CREW_STOCK, bagOf(goodId));
    addBag(goodId, -take);
    hand.stock += take;
    hand.x = cx(spot.col);
    hand.y = cy(spot.row);
    hand.sellT = SELL_EVERY * 0.5;
    say('select');
  }

  function crewTick(dt) {
    for (const hand of [...run.crew]) {
      hand.phase += dt;
      if (hand.hurt > 0) hand.hurt -= dt;

      if (hand.corner === null) {
        // Off duty, and off duty means behind you. A gang you cannot see is a
        // gang you forget you are paying.
        const dx = player.x - hand.x;
        const dy = player.y - hand.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > TILE * 1.6) {
          moveBox(hand, (dx / d) * KINDS.crew.speed * 1.5 * dt, (dy / d) * KINDS.crew.speed * 1.5 * dt, TILE * 0.26);
          hand.dir = facing(dx, dy);
        }
        continue;
      }

      if (!hand.stock) continue;
      hand.sellT -= dt;
      if (hand.sellT > 0) continue;
      hand.sellT = SELL_EVERY;

      const spot = CORNERS[hand.corner];
      const price = streetPrice(spot.district, hand.good, hand.corner * 31);
      hand.stock -= 1;
      hand.held += Math.round(price * 0.88);
      run.sold++;
      warm(GOOD[hand.good].heat * 0.32);

      // A corner is a fixed address and the police have a map too. The risk is
      // entirely in the heat, so a quiet operator can run four of them.
      if (run.heat > 45 && random() < (run.heat - 45) / 320) {
        run.crew = run.crew.filter((c) => c !== hand);
        cool(12);
        say('siren');
        card('A RAID', [`${hand.name} went off the corner in the back of a car.`,
          `The ${GOOD[hand.good].name.toLowerCase()} went with them.`]);
      }
    }
  }

  // --- weapons and shooting -------------------------------------------------

  const ownedWeapons = () => WEAPONS.filter((w) => run.owns[w.id]);
  const currentWeapon = () => ownedWeapons()[run.weapon] ?? WEAPONS[0];

  function cycleWeapon() {
    const list = ownedWeapons();
    if (list.length < 2) return;
    run.weapon = (run.weapon + 1) % list.length;
    say('move');
  }

  function fire() {
    const weapon = currentWeapon();
    if (player.cool > 0) return;
    player.cool = weapon.rate;

    if (weapon.melee) {
      player.swing = weapon.rate;
      player.hit.clear();
      say(weapon.sound);
      return;
    }
    if (run.ammo <= 0) { say('beep'); return; }

    run.ammo--;
    const [dx, dy] = DIRV[player.dir];
    const drift = weapon.spread ? (random() - 0.5) * weapon.spread : 0;
    const angle = Math.atan2(dy, dx) + drift;
    shots.push({
      from: 'player', x: player.x + dx * TILE * 0.5, y: player.y + dy * TILE * 0.5,
      vx: Math.cos(angle) * TILE * weapon.speed, vy: Math.sin(angle) * TILE * weapon.speed,
      life: 0.9, damage: weapon.damage, r: TILE * 0.09, fill: PALETTE.sunLit,
    });
    say(weapon.sound);
    warm(weapon.noise);
    player.loud = 3.5;
    scare(player.x, player.y, TILE * 9);
  }

  function meleeHits() {
    const weapon = currentWeapon();
    const [dx, dy] = DIRV[player.dir];
    const hx = player.x + dx * TILE * 0.7;
    const hy = player.y + dy * TILE * 0.7;
    const reach = TILE * 1.1;

    for (const p of [...locals, ...foes]) {
      if (player.hit.has(p)) continue;
      if (Math.hypot(p.x - hx, p.y - hy) > reach) continue;
      player.hit.add(p);
      hurtPerson(p, weapon.damage);
    }
    for (const hand of [...run.crew]) {
      if (player.hit.has(hand)) continue;
      if (Math.hypot(hand.x - hx, hand.y - hy) > reach) continue;
      player.hit.add(hand);   // your own people take it too, and they remember
      hand.hurt = 0.2;
      say('whack');
    }
  }

  // Everything that dies goes through here, so the consequences cannot be
  // dodged by adding a new way to kill somebody later.
  function killed(p) {
    if (p.kind === 'local') {
      run.town.people = Math.max(12, run.town.people - 1);
      run.town.dead++;
      warm(24);
      locals = locals.filter((o) => o !== p);
      scare(p.x, p.y, TILE * 12);
      if (run.town.dead === 1) {
        card('SOMEBODY IS DEAD', ['That was a person who bought from people like you.',
          'There are fewer of them now, and the ones left have heard.']);
      }
      return;
    }
    foes = foes.filter((o) => o !== p);
    if (p.kind === 'cop') {
      run.town.copsKilled++;
      run.heat = HEAT_MAX;
      card('YOU SHOT A POLICEMAN', ['Nothing about the rest of this fortnight is going to be quiet now.']);
      return;
    }
    if (p.kind === 'rival') run.cash += 120;
  }

  function hurtPerson(p, damage) {
    p.hp -= damage;
    p.hurt = 0.18;
    say('whack');
    if (p.kind === 'local') p.panic = 3;
    if (p.kind === 'cop' || p.kind === 'rival') warm(4);
    if (p.hp <= 0) killed(p);
  }

  function hurtPlayer(damage, fromX, fromY) {
    if (player.invuln > 0 || game.screen !== 'play') return;
    run.health -= damage;
    player.invuln = 1.0;
    const dx = player.x - fromX;
    const dy = player.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    player.kx = (dx / d) * 280;
    player.ky = (dy / d) * 280;
    say('hurt');
    if (run.health <= 0) {
      run.health = 0;
      say('over');
      game.cursor = 0;
      talk = null;
      cards.length = 0;
      go('died');
    }
  }

  // --- the police -----------------------------------------------------------

  function spawnFoe(kind, col, row) {
    const cfg = KINDS[kind];
    foes.push({
      kind, x: cx(col), y: cy(row), hp: cfg.hp, dir: 'down',
      look: { body: cfg.shirt, head: SKINS[Math.floor(random() * SKINS.length)], trim: cfg.trim },
      phase: random() * 6.28, cool: 1 + random(), hurt: 0, mode: 'walk', panic: 0,
    });
  }

  function police(dt) {
    const cops = foes.filter((f) => f.kind === 'cop');
    const want = clamp(Math.floor(run.heat / 22), 0, 5);
    if (cops.length < want && random() < dt * 0.9) {
      const spot = openTileNear(colAt(player.x) + (random() < 0.5 ? -12 : 12), rowAt(player.y) + Math.floor((random() - 0.5) * 12));
      if (spot && tileAt(spot[0], spot[1]) === 'road') {
        spawnFoe('cop', spot[0], spot[1]);
        if (cops.length === 0) say('siren');
      }
    }

    // The Kesslers turn up once you are worth robbing, and they go for the
    // corners rather than for you -- an earner standing still is an easier
    // thing to take than a man with a rifle walking about.
    if (!run.story.rivals && (run.crew.length >= 2 || run.cash > 5000 || run.day >= 9)) {
      run.story.rivals = true;
      card('THE KESSLERS', ['Two brothers out of the Heights have started asking after your corners.']);
    }
    if (run.story.rivals && foes.filter((f) => f.kind === 'rival').length < 2 && random() < dt * 0.16) {
      const posted = run.crew.filter((c) => c.corner !== null);
      const near = posted.length ? CORNERS[posted[Math.floor(random() * posted.length)].corner] : null;
      const spot = near
        ? openTileNear(near.col, near.row)
        : openTileNear(colAt(player.x) + 10, rowAt(player.y));
      if (spot) spawnFoe('rival', spot[0], spot[1]);
    }

    if (run.debt > 1600 && foes.filter((f) => f.kind === 'collector').length < 1 && random() < dt * 0.1) {
      const spot = openTileNear(colAt(player.x) + 9, rowAt(player.y) + 4);
      if (spot) spawnFoe('collector', spot[0], spot[1]);
    }
  }

  const BUSTS_BEFORE_TIME = 3;

  function busted(byWhom) {
    run.busts++;
    // A record is the thing that eventually stops you. Three of them, or one
    // dead policeman, and the fortnight ends in a cell rather than on a bus.
    if (run.busts > BUSTS_BEFORE_TIME || run.town.copsKilled > 0) {
      say('busted');
      finish('prison');
      return;
    }
    const fine = Math.min(run.cash, 260 + Math.round(run.heat * 12) * run.busts);
    const lost = GOODS.filter((g) => bagOf(g.id) > 0).map((g) => `${bagOf(g.id)} ${g.name}`);
    for (const g of GOODS) run.bag[g.id] = 0;
    run.cash -= fine;
    run.heat = 14;
    foes = foes.filter((f) => f.kind !== 'cop');
    player.x = cx(PLACES.cops.at[0]);
    player.y = cy(PLACES.cops.at[1] - 1);
    player.invuln = 2;
    say('busted');
    card('BOOKED', [
      `${byWhom} had you against the car before you got a word out.`,
      lost.length ? `They took ${lost.join(', ')}, and ${money(fine)}.` : `They took ${money(fine)} and your afternoon.`,
      run.busts === BUSTS_BEFORE_TIME ? 'One more and you do the fortnight inside.' : `That is ${run.busts} on the sheet.`,
    ]);
  }

  function updateFoe(f, dt) {
    const cfg = KINDS[f.kind];
    f.phase += dt;
    if (f.hurt > 0) f.hurt -= dt;

    // Whichever of you and your nearest posted hand it is interested in.
    let target = player;
    if (f.kind === 'rival') {
      const posted = run.crew.filter((c) => c.corner !== null);
      let best = Math.hypot(player.x - f.x, player.y - f.y);
      for (const hand of posted) {
        const d = Math.hypot(hand.x - f.x, hand.y - f.y);
        if (d < best) { best = d; target = hand; }
      }
    }

    const dx = target.x - f.x;
    const dy = target.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const chasing = f.kind !== 'cop' || run.heat >= 25 || player.loud > 0;

    if (chasing && d < TILE * 16) {
      moveBox(f, (dx / d) * cfg.speed * dt, (dy / d) * cfg.speed * dt, TILE * 0.28);
      f.dir = facing(dx, dy);
    } else {
      f.cool -= dt;
      if (f.cool <= 0) { f.cool = 1.2 + random() * 2; f.dir = ['up', 'down', 'left', 'right'][Math.floor(random() * 4)]; }
      const [vx, vy] = DIRV[f.dir];
      moveBox(f, vx * cfg.speed * 0.45 * dt, vy * cfg.speed * 0.45 * dt, TILE * 0.28);
    }

    // Armed and at a distance: shoot. Up close: hands.
    if (cfg.armed || (f.kind === 'cop' && (run.heat >= 75 || run.town.copsKilled > 0))) {
      f.cool -= dt;
      if (f.cool <= 0 && d < TILE * 8 && d > TILE * 1.2) {
        f.cool = 1.4 + random() * 1.2;
        shots.push({
          from: 'them', x: f.x, y: f.y, vx: (dx / d) * TILE * 12, vy: (dy / d) * TILE * 12,
          life: 1.0, damage: 2, r: TILE * 0.09, fill: PALETTE.ember,
        });
        say('shot');
        scare(f.x, f.y, TILE * 7);
      }
    }

    if (target !== player) {
      // Leaning on one of your hands rather than on you.
      if (d < TILE * 0.7) {
        target.hurt = 0.2;
        target.hp -= dt * 3;
        if (target.hp <= 0) {
          run.crew = run.crew.filter((c) => c !== target);
          card('THEY GOT ONE', [`${target.name} is in an ambulance and the corner is gone.`]);
          say('hurt');
        }
      }
      return;
    }

    if (d >= TILE * 0.62) return;
    if (f.kind === 'cop') { busted('A patrolman'); return; }
    hurtPlayer(cfg.damage, f.x, f.y);
  }

  function updateShots(dt) {
    for (const s of [...shots]) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const drop = () => { shots = shots.filter((o) => o !== s); };
      if (s.life <= 0 || solidAt(s.x, s.y)) { drop(); continue; }

      if (s.from === 'player') {
        const struck = [...foes, ...locals].find((p) => Math.hypot(p.x - s.x, p.y - s.y) < TILE * 0.34);
        if (struck) { hurtPerson(struck, s.damage); drop(); }
        continue;
      }
      if (Math.hypot(player.x - s.x, player.y - s.y) < TILE * 0.4) { hurtPlayer(s.damage, s.x, s.y); drop(); }
    }
  }

  // --- what A does ----------------------------------------------------------
  //
  // One place decides it and the HUD prints what it decided, so the hint and
  // the button can never disagree. Meadowlark learned this the hard way and it
  // is the same rule here: add an action to intent(), never to the handler.
  function intent() {
    const near = (p) => Math.hypot(p.x - player.x, p.y - player.y) < TILE * 1.35;

    const hand = run.crew.find(near);
    if (hand) {
      return {
        kind: 'crew', hand,
        label: hand.corner === null ? `TALK TO ${hand.name}` : `${hand.name}: ${money(hand.held)}`,
      };
    }

    const col = colAt(player.x);
    const row = rowAt(player.y);
    const place = placeAt(col, row);
    if (place) return { kind: 'place', place, label: place.name };

    const corner = cornerIndexAt(col, row);
    if (corner >= 0 && run.crew.some((c) => c.corner === null)) {
      return { kind: 'corner', corner, label: 'PUT SOMEBODY ON THIS CORNER' };
    }

    const body = [...foes, ...locals].filter(near)
      .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
    if (body) {
      if (body.kind === 'cop') return { kind: 'cop', body, label: 'HAVE A WORD' };
      if (body.kind === 'local') {
        return { kind: 'local', body, label: body.wants ? `SELL ${GOOD[body.wants].name}` : 'TALK' };
      }
    }
    if (corner >= 0) return { kind: null, label: 'A CORNER. NOBODY ON IT' };
    return { kind: null, label: '' };
  }

  // --- the doors ------------------------------------------------------------

  const LEAVE = { label: 'LEAVE IT', act: null };

  function openTrade(placeId, mode) {
    const place = placeId ? PLACES[placeId] : null;
    market = {
      place: placeId, mode,
      goods: mode === 'stash' ? GOODS.map((g) => g.id) : place.sells,
      cursor: 0,
    };
    game.repeat = 0;
    go('trade');
    say('door');
  }

  function openPlace(place) {
    say('door');
    const face = place.face;
    const who = place.who;
    const talkTo = (lines, options) => beginTalk({ who, face, lines, options: [...options, LEAVE] });

    switch (place.kind) {
      case 'market': {
        const line = MARKET_TALK[place.id](run);
        talkTo(line, [{ label: 'DO SOME BUSINESS', act: () => openTrade(place.id, 'trade') }]);
        break;
      }

      case 'armoury': {
        const options = [];
        for (const w of WEAPONS.filter((x) => x.cost)) {
          if (run.owns[w.id]) continue;
          options.push({
            label: `${w.name}  ${money(w.cost)}`,
            act: () => {
              if (run.cash < w.cost) return card('NO', ['Dale counts it twice and gives it back.']);
              run.cash -= w.cost;
              run.owns[w.id] = true;
              run.weapon = ownedWeapons().findIndex((x) => x.id === w.id);
              say('unlock');
              card(w.name, [ARMS_WORDS[w.id]]);
            },
          });
        }
        options.push({
          label: `50 ROUNDS  ${money(50 * AMMO_PRICE)}`,
          act: () => {
            if (run.cash < 50 * AMMO_PRICE) return card('NO', ['Not today.']);
            run.cash -= 50 * AMMO_PRICE;
            run.ammo = Math.min(AMMO_MAX, run.ammo + 50);
            say('coin');
          },
        });
        options.push({ label: 'TRADE IRON', act: () => openTrade(place.id, 'trade') });
        talkTo(ARMS_TALK(run), options);
        break;
      }

      case 'police': {
        talkTo(COPSHOP_TALK(run), [{
          label: `LEAVE AN ENVELOPE  ${money(BRIBE)}`,
          act: () => {
            if (run.cash < BRIBE) return card('SGT REEVES', ['He looks at the envelope, then at you. It is not enough and you both know it.']);
            run.cash -= BRIBE;
            cool(38);
            say('coin');
            card('SGT REEVES', ['The envelope goes into a drawer that already has envelopes in it.',
              'Your description comes off the sheet for a while.']);
          },
        }]);
        break;
      }

      case 'church': {
        talkTo(CHURCH_TALK(run), [
          {
            label: `PUT IT IN THE BOX  ${money(TITHE)}`,
            act: () => {
              if (run.cash < TITHE) return card('FR MULCAHY', ['He waves the box away. Not out of kindness.']);
              run.cash -= TITHE;
              run.town.goodwill++;
              cool(16);
              say('coin');
              card("ST BRIGID'S", ['The boiler gets fixed, the hall opens again, and the street decides you are not the worst of it.']);
            },
          },
          {
            label: 'SIT A WHILE',
            act: () => {
              cool(7);
              beginTalk({ who: 'FR MULCAHY', face: 'priest', lines: CONFESSION(run) });
            },
          },
        ]);
        break;
      }

      case 'clinic': {
        talkTo(CLINIC_TALK(run), [{
          label: `PATCH ME UP  ${money(PATCH_UP)}`,
          act: () => {
            if (run.cash < PATCH_UP) return card('DOC ABADI', ['She has heard that one before.']);
            if (run.health >= run.maxHealth) return card('DOC ABADI', ['There is nothing wrong with you that money fixes.']);
            run.cash -= PATCH_UP;
            run.health = run.maxHealth;
            say('heal');
          },
        }]);
        break;
      }

      case 'recruit': {
        const left = recruitsLeft();
        talkTo(TOWERS_TALK(run, left), left > 0 ? [{
          label: `TAKE SOMEBODY ON  ${money(CREW_COST)}`,
          act: () => {
            if (run.cash < CREW_COST) return card('AUNT PEARL', ['She folds her arms. That is the whole answer.']);
            run.cash -= CREW_COST;
            const hand = hire();
            say('select');
            card(hand.name, [`${hand.name} is yours until payday, and payday is ${money(CREW_WAGE)} a night.`,
              'Walk them to a corner and put them on it.']);
          },
        }] : []);
        break;
      }

      case 'bar': {
        const options = [];
        if (!run.story.metVito) {
          options.push({
            label: 'LISTEN',
            act: () => {
              run.story.metVito = true;
              run.story.job = BIKE_JOB;
              beginTalk({
                who: 'VITO', face: 'vito', lines: VITO_JOB,
                then: () => card('AN ERRAND', ["Take the parcel to Benny's, up on the corner of the east road."]),
              });
            },
          });
        }
        if (run.debt > 0) {
          const pay = Math.min(run.debt, 500);
          options.push({
            label: `PAY HIM  ${money(pay)}`,
            act: () => {
              if (run.cash < pay) return card('VITO', ['He laughs, which is worse than the alternative.']);
              run.cash -= pay;
              run.debt -= pay;
              say('coin');
              card('VITO', [run.debt > 0 ? `Still ${money(run.debt)} of it left, and it grows overnight.`
                : 'He tears the page out of the book and puts it in the ashtray. You are nobody\'s now.']);
            },
          });
        }
        options.push({
          label: `BORROW  ${money(500)}`,
          act: () => {
            run.cash += 500;
            run.debt += 600;
            say('coin');
            card('VITO', ['Five hundred out, six hundred owing, and the clock started before you reached the door.']);
          },
        });
        talkTo(VITO_TALK(run), options);
        break;
      }

      case 'garage': {
        if (run.story.job === BIKE_JOB && !run.story.bike) {
          beginTalk({
            who: 'BENNY', face: 'benny', lines: BENNY_JOB,
            then: () => {
              run.story.job = 'done';
              run.story.bike = true;
              run.debt = Math.max(0, run.debt - 250);
              say('unlock');
              card('THE BIKE', ['A green ten-speed with the gears taped where the shifter should be.',
                'You are quicker on it and you can carry more, and nobody in this town looks twice at a bicycle.']);
            },
          });
          break;
        }
        talkTo(BENNY_TALK(run), []);
        break;
      }

      case 'depot': {
        const options = [];
        if (run.day >= 3) {
          options.push({
            label: 'BUY A TICKET  $200',
            act: () => {
              if (run.cash < 200) return card('TICKET CLERK', ['Two hundred, and the machine does not take promises.']);
              run.cash -= 200;
              finish('bus');
            },
          });
        }
        talkTo(DEPOT_TALK(run), options);
        break;
      }

      case 'home': {
        beginTalk({
          who: 'YOUR ROOM', face: null, lines: HOME_TALK(run),
          options: [
            { label: 'SLEEP', act: () => endDay() },
            { label: 'THE BOX UNDER THE BED', act: () => openTrade(null, 'stash') },
            LEAVE,
          ],
        });
        break;
      }

      default:
        throw new Error(`unknown place kind: ${place.kind}`);
    }
  }

  // --- talking to somebody in the street ------------------------------------

  function talkToLocal(body) {
    const district = districtOf(body.x, body.y);
    if (!body.wants || bagOf(body.wants) <= 0) {
      beginTalk({ who: 'A LOCAL', face: 'local', lines: [STREET_TALK(run, district)] });
      return;
    }
    const good = GOOD[body.wants];
    const price = streetPrice(district.id, good.id, body.salt);
    const options = [];
    const sell = (n) => () => {
      const units = Math.min(n, bagOf(good.id));
      if (!units) return;
      addBag(good.id, -units);
      run.cash += price * units;
      run.sold += units;
      warm(good.heat * 0.55 * units);
      body.wants = null;
      say('coin');
    };
    options.push({ label: `SELL ONE  ${money(price)}`, act: sell(1) });
    if (bagOf(good.id) >= 5) options.push({ label: `SELL FIVE  ${money(price * 5)}`, act: sell(5) });
    beginTalk({
      who: 'A LOCAL', face: 'local',
      lines: [`${WANT_WORDS[good.id]} They are holding folded notes and not looking at you.`],
      options,
    });
  }

  function talkToCop(body) {
    beginTalk({
      who: 'PATROLMAN', face: 'cop',
      lines: [run.heat > 50
        ? 'He already has one hand on the radio and the other somewhere you would rather it was not.'
        : 'He is leaning on the car with his cap pushed back, watching the street go past.'],
      options: [
        {
          label: `SLIP HIM  ${money(200)}`,
          act: () => {
            if (run.cash < 200) return card('PATROLMAN', ['He counts it, hands it back, and remembers your face.']);
            run.cash -= 200;
            cool(14);
            say('coin');
            card('PATROLMAN', ['It goes into a top pocket without either of you looking down.']);
          },
        },
        LEAVE,
      ],
    });
  }

  function talkToCrew(hand) {
    const options = [];
    if (hand.held > 0) {
      options.push({
        label: `TAKE THE ${money(hand.held)}`,
        act: () => { run.cash += hand.held; hand.held = 0; say('coin'); },
      });
    }
    if (hand.corner !== null) {
      const good = GOOD[hand.good];
      const spare = bagOf(good.id);
      if (spare > 0) {
        options.push({
          label: `GIVE THEM ${Math.min(CREW_STOCK, spare)} MORE`,
          act: () => {
            const take = Math.min(CREW_STOCK, bagOf(good.id));
            addBag(good.id, -take);
            hand.stock += take;
            say('select');
          },
        });
      }
      options.push({
        label: 'BRING THEM IN',
        act: () => {
          addBag(hand.good, hand.stock);
          hand.stock = 0;
          hand.corner = null;
          hand.good = null;
          say('back');
        },
      });
    }
    options.push({
      label: 'LET THEM GO',
      act: () => {
        run.cash += hand.held;
        addBag(hand.good ?? 'grass', hand.stock);
        run.crew = run.crew.filter((c) => c !== hand);
        say('back');
      },
    });
    beginTalk({
      who: hand.name, face: 'local', lines: [CREW_TALK(run, hand)],
      options: [...options, LEAVE],
    });
  }

  function postAtCorner(cornerIndex) {
    const spare = run.crew.filter((c) => c.corner === null);
    const spot = CORNERS[cornerIndex];
    const options = [];
    for (const good of GOODS) {
      if (bagOf(good.id) <= 0) continue;
      const price = streetPrice(spot.district, good.id, cornerIndex * 31);
      options.push({
        label: `${good.name}  ${money(price)} A GO`,
        act: () => {
          postCrew(spare[0], cornerIndex, good.id);
          card(spare[0].name, [`Working the ${DISTRICTS.find((d) => d.id === spot.district).name.toLowerCase()} corner.`,
            'Come back for the money before somebody else does.']);
        },
      });
    }
    beginTalk({
      who: spare[0].name, face: 'local',
      lines: options.length
        ? ['They look at the corner, then at your bag. What are they selling?']
        : ['They look at the corner, then at your bag, which is empty. Come back with something to sell.'],
      options,
    });
  }

  function interact() {
    const what = intent();
    switch (what.kind) {
      case 'crew': talkToCrew(what.hand); break;
      case 'place': openPlace(what.place); break;
      case 'corner': postAtCorner(what.corner); break;
      case 'local': talkToLocal(what.body); break;
      case 'cop': talkToCop(what.body); break;
      default: break;
    }
  }

  // --- the trade screen -----------------------------------------------------

  const tradeRow = () => market.goods[market.cursor];

  function buyOne() {
    const id = tradeRow();
    if (market.mode === 'stash') {
      if ((run.stash[id] ?? 0) <= 0) return false;
      if (carried() + GOOD[id].bulk > capacity()) return false;
      run.stash[id]--;
      addBag(id, 1);
      return true;
    }
    const price = buyPrice(market.place, id);
    if (run.cash < price) return false;
    if (carried() + GOOD[id].bulk > capacity()) return false;
    run.cash -= price;
    addBag(id, 1);
    noteMoved(market.place, id);
    warm(GOOD[id].heat * 0.25);
    return true;
  }

  function sellOne() {
    const id = tradeRow();
    if (bagOf(id) <= 0) return false;
    if (market.mode === 'stash') {
      addBag(id, -1);
      run.stash[id] = (run.stash[id] ?? 0) + 1;
      return true;
    }
    addBag(id, -1);
    run.cash += sellPrice(market.place, id);
    run.sold++;
    noteMoved(market.place, id);
    warm(GOOD[id].heat * 0.45);
    return true;
  }

  function tradeInput(dt, frame) {
    const list = market.goods;
    if (frame.pressed.up) { market.cursor = (market.cursor + list.length - 1) % list.length; say('move'); }
    if (frame.pressed.down) { market.cursor = (market.cursor + 1) % list.length; say('move'); }

    // Held direction repeats, because buying twenty of anything one press at a
    // time is a worse game than the one this is trying to be.
    let step = frame.pressed.left ? -1 : frame.pressed.right ? 1 : 0;
    if (step) game.repeat = 0.32;
    else if (frame.left || frame.right) {
      game.repeat -= dt;
      if (game.repeat <= 0) { game.repeat = 0.07; step = frame.left ? -1 : 1; }
    } else game.repeat = 0;

    if (step > 0 && buyOne()) say('coin');
    else if (step < 0 && sellOne()) say('coin');

    if (frame.pressed.a) {
      let n = 0;
      while (n < 99 && buyOne()) n++;
      say(n ? 'coin' : 'beep');
    }
    if (frame.pressed.b) {
      let n = 0;
      while (n < 99 && sellOne()) n++;
      say(n ? 'coin' : 'beep');
    }
    if (frame.pressed.start || frame.pressed.select) { market = null; say('back'); go('play'); }
  }

  // --- days -----------------------------------------------------------------

  function endDay() {
    const lines = [];

    // The overnight take. A corner works while you sleep, which is the whole
    // argument for having one.
    let overnight = 0;
    for (const hand of run.crew) {
      if (hand.corner === null || hand.stock <= 0) continue;
      const spot = CORNERS[hand.corner];
      const units = Math.min(3, hand.stock);
      const price = streetPrice(spot.district, hand.good, hand.corner * 31);
      hand.stock -= units;
      hand.held += Math.round(price * units * 0.88);
      overnight += units;
      warm(GOOD[hand.good].heat * 0.3 * units);
    }
    if (overnight) lines.push(`The corners moved ${overnight} overnight.`);

    const wages = run.crew.length * CREW_WAGE;
    if (wages && run.cash >= wages) {
      run.cash -= wages;
      lines.push(`Wages ${money(wages)}.`);
    } else if (wages) {
      lines.push('Nobody got paid, so nobody stayed.');
      for (const hand of run.crew) run.cash += hand.held;
      run.crew = [];
    }

    if (run.debt > 0) {
      const interest = Math.round(run.debt * DEBT_RATE);
      run.debt += interest;
      lines.push(`Vito is owed ${money(run.debt)} now.`);
    }

    run.day++;
    run.clock = 0;
    run.moved = {};
    run.health = Math.min(run.maxHealth, run.health + 4);
    run.heat = Math.round(run.heat * 0.45);
    foes = [];
    shots = [];
    say('snooze');

    if (run.day > LAST_DAY) { finish('taken'); return; }
    card(`DAY ${run.day}`, lines.length ? lines : ['Nothing happened in the night, which is its own kind of profit.']);
  }

  // --- endings --------------------------------------------------------------

  function finish(ending) {
    run.ending = ending;
    const keep = ending === 'bus' ? 1 : ending === 'taken' ? 0.5 : ending === 'prison' ? 0.2 : 0.25;
    let total = Math.max(0, Math.round(netWorth() * keep));
    // The quiet bonus. It is deliberately large enough to beat a fortnight of
    // shooting people, because otherwise the fastest way to a high score would
    // be the one the whole game is arguing against.
    if (ending === 'bus' && run.town.dead === 0) total += 2500;
    game.score = total;
    say(ending === 'bus' ? 'fanfare' : 'over');
    game.placing = total > 0 ? table.placing(GAME, total) : 0;
    game.initials = [0, 0, 0];
    game.slot = 0;
    talk = null;
    market = null;
    cards.length = 0;
    go('over');
  }

  function newRun() {
    run.day = 1;
    run.clock = 0;
    run.cash = START_CASH;
    run.debt = START_DEBT;
    run.bag = {};
    run.stash = {};
    run.moved = {};
    run.ammo = 0;
    run.owns = { fist: true, bat: true, pistol: false, uzi: false, rifle: false };
    run.weapon = 0;
    run.health = 12;
    run.maxHealth = 12;
    run.heat = 0;
    run.crew = [];
    run.town = { people: 72, dead: 0, copsKilled: 0, goodwill: 0 };
    run.story = { metVito: false, job: null, bike: false, rivals: false, warned: false };
    run.busts = 0;
    run.sold = 0;
    run.ending = null;

    game.score = 0;
    game.playTime = 0;
    locals = [];
    foes = [];
    shots = [];
    cards.length = 0;
    talk = null;
    market = null;

    player.x = cx(START.col);
    player.y = cy(START.row);
    player.dir = 'up';
    player.invuln = 0;
    player.swing = 0;
    player.cool = 0;
    player.loud = 0;
    player.kx = 0;
    player.ky = 0;
    player.hit.clear();

    follow(true);
    restock();
    go('play');
    beginTalk({ who: 'VEE', face: 'vee', lines: OPENING });
  }

  function continueRun() {
    run.cash = Math.round(run.cash * 0.5);
    run.health = run.maxHealth;
    run.heat = Math.round(run.heat * 0.5);
    for (const g of GOODS) run.bag[g.id] = 0;
    foes = [];
    shots = [];
    player.x = cx(PLACES.clinic.at[0]);
    player.y = cy(PLACES.clinic.at[1] + 1);
    player.invuln = 2;
    player.kx = 0;
    player.ky = 0;
    follow(true);
    go('play');
    card('DOC ABADI', ['She took what was in your pockets for the stitches and did not itemise it.']);
  }

  // --- the step -------------------------------------------------------------

  function follow(snap = false) {
    const wantX = clamp(player.x - field.w / 2, 0, Math.max(0, WORLD_W - field.w));
    const wantY = clamp(player.y - field.h / 2, 0, Math.max(0, WORLD_H - field.h));
    // Whole pixels only. Tiles are an integer wide, so an integer camera makes
    // every tile rectangle land on an exact boundary -- a half pixel of camera
    // is a one pixel seam of background between two tiles, and a one pixel
    // horizontal line of ink is the one thing an interlaced field cannot draw.
    cam.x = Math.round(snap ? wantX : cam.x + (wantX - cam.x) * 0.35);
    cam.y = Math.round(snap ? wantY : cam.y + (wantY - cam.y) * 0.35);
    buildGround();
  }

  function movePlayer(dt, frame) {
    if (player.invuln > 0) player.invuln -= dt;
    if (player.loud > 0) player.loud -= dt;
    if (player.cool > 0) player.cool -= dt;
    if (player.swing > 0) {
      player.swing -= dt;
      meleeHits();
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
      player.dir = facing(dx, dy);
      player.walk += dt * (run.story.bike ? 13 : 9);
    }
    const speed = TILE * (run.story.bike ? 6.1 : 4.0);
    moveBox(player, (dx * speed + player.kx) * dt, (dy * speed + player.ky) * dt, TILE * 0.26);
    player.kx *= 0.8;
    player.ky *= 0.8;
  }

  // Everything that keeps moving while a conversation or a card is up. The
  // street does not stop because somebody is talking to you, and it is also
  // what makes two seeds draw two different pictures on the opening line.
  function drift(dt) {
    game.playTime += dt;
    for (const p of locals) wander(p, dt);
    restock();
    follow();
  }

  function play(dt, frame) {
    drift(dt);

    if (cards.length) {
      const top = cards[0];
      top.t += dt;
      if (top.t > 0.35 && (frame.pressed.a || frame.pressed.b || frame.pressed.start)) {
        cards.shift();
        say('move');
      }
      return;
    }
    if (talk) { advanceTalk(dt, frame); return; }

    run.clock += dt;
    movePlayer(dt, frame);
    if (game.screen !== 'play') return;

    if (frame.pressed.select) cycleWeapon();
    if (frame.pressed.b) fire();
    if (frame.pressed.a) interact();
    if (game.screen !== 'play') return;

    crewTick(dt);
    restockCounters(dt);
    for (const f of [...foes]) {
      updateFoe(f, dt);
      if (game.screen !== 'play') return;
    }
    updateShots(dt);
    if (game.screen !== 'play') return;

    police(dt);
    // Heat bleeds off on its own, but only just: about five points across a
    // whole day, and less than that once it is high. Walking it off is not a
    // plan. Paying it off is, and so is going to bed.
    cool(dt * (run.heat > 60 ? 0.05 : 0.09));

    // After dark the streets stop being neutral: every hour past sundown adds
    // a little of its own, so there is always a reason to go home.
    if (run.clock > DAY_LENGTH * NIGHT_AT) warm(dt * 0.12);
    if (run.clock > DAY_LENGTH * 1.6) {
      // Nobody can stay out for ever. If you will not go to bed the night ends
      // it for you, at the price of whatever the night cost.
      warm(6);
      endDay();
    }
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
    game.board = table.record(GAME, game.initials.map((i) => scores.ALPHABET[i]).join(''), game.score);
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
        if (!talk && !cards.length && any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        play(dt, any);
        break;

      case 'trade':
        drift(dt);
        tradeInput(dt, any);
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
        else finish('dead');
        break;
      }

      case 'over':
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
  // The town is flat and everything with a pulse is drawn in poster mode, so
  // people carry the black outline the rest of this project is drawn with and
  // two hundred tiles of pavement do not.

  const sx = (x) => field.x + Math.round(x - cam.x);
  const sy = (y) => field.y + Math.round(y - cam.y);
  const onScreen = (x, y, pad = TILE * 2) =>
    x > cam.x - pad && x < cam.x + field.w + pad && y > cam.y - pad && y < cam.y + field.h + pad;

  const KIND_COLOUR = {
    market: PALETTE.sun, police: PALETTE.sky, church: PALETTE.creamDim, armoury: PALETTE.ember,
    recruit: PALETTE.rose, bar: PALETTE.violet, home: PALETTE.moss, garage: PALETTE.barkLit,
    clinic: PALETTE.cream, depot: PALETTE.skyLit,
  };

  const ROADISH = new Set(['road', 'corner']);

  // Is this tile the middle of a road exactly three wide across the given
  // axis? A junction is wide both ways and gets no paint at all, which is what
  // a junction looks like.
  function middleOf(col, row, dc, dr) {
    let run = 1;
    for (let step = 1; step < 4; step++) {
      if (!ROADISH.has(tileAt(col + dc * step, row + dr * step))) break;
      run++;
    }
    let back = 0;
    for (let step = 1; step < 4; step++) {
      if (!ROADISH.has(tileAt(col - dc * step, row - dr * step))) break;
      back++;
    }
    return run === 2 && back === 1;
  }

  function baseColour(col, row) {
    const kind = tileAt(col, row);
    const d = districtAt(col, row);
    switch (kind) {
      case 'road': case 'corner': return d.road;
      case 'walk': return d.walk;
      case 'grass': return d.grass;
      case 'water': return PALETTE.waterDim;
      case 'block': case 'door': return d.wall;
      default: {
        // Whatever it is standing on. A bench on grass and a bin on the
        // pavement should not each bring a square of the wrong ground with it.
        for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const near = tileAt(col + dc, row + dr);
          if (near === 'grass') return d.grass;
          if (near === 'walk') return d.walk;
        }
        return d.road;
      }
    }
  }

  function prop(col, row) {
    const kind = tileAt(col, row);
    const d = districtAt(col, row);
    const x = col * TILE;
    const y = row * TILE;
    const t = TILE;

    switch (kind) {
      case 'block':
        // A window every third tile. On every tile a street reads as graph
        // paper; on none of them it reads as a wall of fog.
        return (col * 3 + row * 5) % 4 === 0
          ? [rect(x + t * 0.22, y + t * 0.24, t * 0.54, t * 0.34, d.trim)]
          : [rect(x, y + t * 0.84, t, t * 0.16, d.trim)];

      case 'door': {
        const place = placeAt(col, row);
        const paint = KIND_COLOUR[place.kind] ?? PALETTE.sun;
        return [
          rect(x, y, t, t * 0.26, paint),                       // the awning, which is the sign
          rect(x + t * 0.24, y + t * 0.3, t * 0.52, t * 0.7, PALETTE.barkDim),
          rect(x + t * 0.62, y + t * 0.58, t * 0.1, t * 0.14, paint),
        ];
      }

      case 'road': {
        const marks = [];
        if (middleOf(col, row, 0, 1) && col % 2 === 0) {
          marks.push(rect(x + t * 0.3, y + t * 0.44, t * 0.4, t * 0.12, PALETTE.sunDim));
        }
        if (middleOf(col, row, 1, 0) && row % 2 === 0) {
          marks.push(rect(x + t * 0.44, y + t * 0.3, t * 0.12, t * 0.4, PALETTE.sunDim));
        }
        return marks;
      }

      case 'corner':
        // Painted like a loading bay, because the whole crew system is about
        // walking back to one and a tinted tile with somebody standing on it
        // is a tile you cannot see.
        return [
          rect(x + t * 0.08, y + t * 0.08, t * 0.84, t * 0.84, d.walk),
          rect(x + t * 0.08, y + t * 0.08, t * 0.84, t * 0.14, PALETTE.sunDim),
          rect(x + t * 0.08, y + t * 0.78, t * 0.84, t * 0.14, PALETTE.sunDim),
          rect(x + t * 0.08, y + t * 0.08, t * 0.14, t * 0.84, PALETTE.sunDim),
          rect(x + t * 0.78, y + t * 0.08, t * 0.14, t * 0.84, PALETTE.sunDim),
        ];

      case 'water':
        return [
          rect(x, y + t * 0.24, t, t * 0.12, PALETTE.water),
          rect(x + t * 0.34, y + t * 0.66, t * 0.44, t * 0.1, PALETTE.waterLit),
        ];

      case 'tree':
        return [
          rect(x + t * 0.42, y + t * 0.4, t * 0.16, t * 0.56, PALETTE.bark),
          disc(x + t * 0.5, y + t * 0.34, t * 0.3, PALETTE.leaf),
          disc(x + t * 0.26, y + t * 0.44, t * 0.18, PALETTE.leafDim),
          disc(x + t * 0.74, y + t * 0.44, t * 0.18, PALETTE.leafLit),
        ];

      case 'bench':
        return [
          rect(x + t * 0.1, y + t * 0.34, t * 0.8, t * 0.2, PALETTE.bark),
          rect(x + t * 0.16, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
          rect(x + t * 0.74, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
        ];

      case 'bin':
        return [
          disc(x + t * 0.5, y + t * 0.56, t * 0.26, PALETTE.stoneDim),
          disc(x + t * 0.5, y + t * 0.42, t * 0.24, PALETTE.stone),
        ];

      case 'fence':
        return [
          rect(x, y + t * 0.12, t, t * 0.1, PALETTE.stone),
          rect(x + t * 0.2, y + t * 0.12, t * 0.1, t * 0.76, PALETTE.stone),
          rect(x + t * 0.7, y + t * 0.12, t * 0.1, t * 0.76, PALETTE.stone),
        ];

      default:
        return [];
    }
  }

  // The visible tiles, merged into runs and kept until the window moves. A step
  // of one tile is eight frames of walking, so this runs about four times a
  // second rather than thirty, and what it costs is paid where nobody is
  // looking at a frame counter.
  let ground = { col: -1, row: -1, shapes: [] };
  function buildGround() {
    const col0 = clamp(colAt(cam.x), 0, COLS - 1);
    const row0 = clamp(rowAt(cam.y), 0, ROWS - 1);
    if (ground.col === col0 && ground.row === row0) return;
    const col1 = Math.min(COLS - 1, col0 + VIEW_COLS + 1);
    const row1 = Math.min(ROWS - 1, row0 + VIEW_ROWS + 1);
    const shapes = [];

    for (let r = row0; r <= row1; r++) {
      let start = col0;
      for (let c = col0 + 1; c <= col1 + 1; c++) {
        if (c <= col1 && baseColour(c, r) === baseColour(start, r)) continue;
        shapes.push(rect(start * TILE, r * TILE, (c - start) * TILE, TILE, baseColour(start, r)));
        start = c;
      }
    }
    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) shapes.push(...prop(c, r));
    }
    ground = { col: col0, row: row0, shapes };
  }

  const shifted = () => {
    const dx = field.x - cam.x;
    const dy = field.y - cam.y;
    return ground.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };

  // --- bodies ---------------------------------------------------------------

  function figure(x, y, look, { size = 1, dir = 'down', bob = 0, tint = null } = {}) {
    const w = TILE * 0.52 * size;
    const h = TILE * 0.58 * size;
    const head = TILE * 0.23 * size;
    const [fx, fy] = DIRV[dir] ?? DIRV.down;
    const hy = y - h / 2 - head * 0.6 + bob;
    return [
      rect(x - w / 2, y - h / 2 + bob, w, h, tint ?? look.body),
      rect(x - w / 2, y + h / 2 - TILE * 0.04, w * 0.38, TILE * 0.15 + bob, look.trim),
      rect(x + w / 2 - w * 0.38, y + h / 2 - TILE * 0.04, w * 0.38, TILE * 0.15 - bob, look.trim),
      disc(x, hy, head, look.head),
      disc(x + fx * head * 0.7, hy + fy * head * 0.5, head * 0.4, look.trim),
    ];
  }

  const PLAYER_LOOK = { body: PALETTE.sky, head: PALETTE.bark, trim: PALETTE.emberDim };

  function playerShapes() {
    const x = sx(player.x);
    const y = sy(player.y);
    const blink = player.invuln > 0 && Math.floor(player.invuln * 14) % 2 === 0;
    const bob = Math.sin(player.walk) * TILE * (run.story.bike ? 0.03 : 0.05);
    const shapes = [];

    if (run.story.bike) {
      // Drawn under the rider and only ever from the side, which is a lie the
      // eye does not mind and a wheel drawn end-on is a rectangle nobody reads
      // as a bicycle.
      const spin = Math.sin(player.walk * 0.5) * TILE * 0.05;
      shapes.push(disc(x - TILE * 0.3, y + TILE * 0.36 + spin, TILE * 0.16, PALETTE.stoneDim));
      shapes.push(disc(x + TILE * 0.3, y + TILE * 0.36 - spin, TILE * 0.16, PALETTE.stoneDim));
      shapes.push(rect(x - TILE * 0.3, y + TILE * 0.28, TILE * 0.6, TILE * 0.1, PALETTE.moss));
    }
    shapes.push(...figure(x, y, PLAYER_LOOK, { dir: player.dir, bob, tint: blink ? PALETTE.creamDim : null }));

    const weapon = currentWeapon();
    if (player.swing > 0) {
      const through = 1 - player.swing / weapon.rate;
      const [fx, fy] = DIRV[player.dir];
      const angle = Math.atan2(fy, fx) + (through - 0.5) * 2.2;
      shapes.push({
        type: 'chain',
        points: [
          { x: Math.round(x + Math.cos(angle) * TILE * 0.34), y: Math.round(y + Math.sin(angle) * TILE * 0.34), r: TILE * 0.07 },
          { x: Math.round(x + Math.cos(angle) * TILE * 1.0), y: Math.round(y + Math.sin(angle) * TILE * 1.0), r: TILE * 0.11 },
        ],
        fill: weapon.id === 'bat' ? PALETTE.barkLit : PALETTE.creamDim,
      });
    } else if (!weapon.melee) {
      // Carried in the hand you are facing with, so what you are holding is
      // legible from across the street -- which is also what the town sees.
      const [fx, fy] = DIRV[player.dir];
      const long = weapon.id === 'rifle' ? 0.9 : weapon.id === 'uzi' ? 0.6 : 0.44;
      shapes.push({
        type: 'chain',
        points: [
          { x: Math.round(x + fx * TILE * 0.2), y: Math.round(y + fy * TILE * 0.2 + TILE * 0.06), r: TILE * 0.07 },
          { x: Math.round(x + fx * TILE * long), y: Math.round(y + fy * TILE * long + TILE * 0.06), r: TILE * 0.07 },
        ],
        fill: PALETTE.stoneDim,
      });
    }
    return shapes;
  }

  function bodyShapes() {
    const shapes = [];
    const all = [];
    for (const p of locals) if (onScreen(p.x, p.y)) all.push({ p, kind: 'local' });
    for (const f of foes) if (onScreen(f.x, f.y)) all.push({ p: f, kind: f.kind });
    for (const c of run.crew) if (onScreen(c.x, c.y)) all.push({ p: c, kind: 'crew' });
    // Sorted by depth, so somebody standing lower on the screen is in front.
    all.sort((a, b) => a.p.y - b.p.y);

    for (const { p, kind } of all) {
      const cfg = KINDS[kind];
      const bob = Math.sin(p.phase * (p.panic > 0 ? 14 : 5)) * TILE * 0.04;
      const tint = p.hurt > 0 ? PALETTE.cream : null;
      shapes.push(...figure(sx(p.x), sy(p.y), p.look, { size: cfg.size, dir: p.dir, bob, tint }));

      if (kind === 'cop') {
        // A cap and a light bar's worth of blue, so the thing you must not walk
        // into is the thing you can pick out of a crowd.
        shapes.push(rect(sx(p.x) - TILE * 0.2, sy(p.y) - TILE * 0.62, TILE * 0.4, TILE * 0.12, PALETTE.skyLit));
      }
      if (kind === 'crew' && p.corner !== null) {
        shapes.push(rect(sx(p.x) - TILE * 0.22, sy(p.y) + TILE * 0.42, TILE * 0.44, TILE * 0.1, PALETTE.sunDim));
      }
      if (kind === 'local' && p.wants && bagOf(p.wants) > 0) {
        // Somebody who wants what you have. It is worth crossing a road for.
        shapes.push(disc(sx(p.x), sy(p.y) - TILE * 0.78, TILE * 0.1, PALETTE.sunLit));
      }
    }
    return shapes;
  }

  // --- the face -------------------------------------------------------------
  //
  // The close-up. A conversation in this game is a person, not a caption, and
  // this is where the difference lives: everything is built from the same six
  // colours and four flags, so a new character is a row in FACES.
  function portraitShapes(id, x, y, size) {
    const face = FACES[id] ?? FACES.local;
    const shapes = [];
    const head = size * 0.4;

    shapes.push(rect(x - size * 0.46, y + head * 0.5, size * 0.92, size * 0.5, face.shirt));
    shapes.push(disc(x, y, head, face.skin));
    // Hair as a disc pushed up behind the head, cropped by the head drawn over
    // it -- there is no arc primitive and there does not need to be.
    if (!face.hat) {
      shapes.push(disc(x, y - head * 0.58, head * 0.84, face.hair));
      shapes.push(disc(x - head * 0.6, y - head * 0.2, head * 0.4, face.hair));
      shapes.push(disc(x + head * 0.6, y - head * 0.2, head * 0.4, face.hair));
    }
    shapes.push(disc(x, y + head * 0.12, head * 0.9, face.skin));

    if (face.beard) {
      shapes.push(disc(x, y + head * 0.62, head * 0.5, face.hair));
      shapes.push(rect(x - head * 0.62, y + head * 0.3, head * 1.24, head * 0.34, face.hair));
      shapes.push(disc(x, y + head * 0.34, head * 0.52, face.skin));
    }
    if (face.shades) {
      shapes.push(rect(x - head * 0.66, y - head * 0.18, head * 1.32, head * 0.34, PALETTE.ink));
    } else {
      shapes.push(disc(x - head * 0.36, y - head * 0.04, Math.max(3, head * 0.13), PALETTE.ink));
      shapes.push(disc(x + head * 0.36, y - head * 0.04, Math.max(3, head * 0.13), PALETTE.ink));
      shapes.push(rect(x - head * 0.58, y - head * 0.36, head * 0.42, Math.max(4, head * 0.14 * (0.6 + face.brow)), face.hair));
      shapes.push(rect(x + head * 0.16, y - head * 0.36, head * 0.42, Math.max(4, head * 0.14 * (0.6 + face.brow)), face.hair));
    }
    shapes.push(rect(x - head * 0.26, y + head * 0.44, head * 0.52, Math.max(4, head * 0.12), PALETTE.barkDim));

    if (face.hat === 'cap') {
      shapes.push(rect(x - head * 0.9, y - head * 0.72, head * 1.8, head * 0.4, face.hair));
      shapes.push(rect(x - head * 1.0, y - head * 0.42, head * 2.0, head * 0.2, PALETTE.ink));
    }
    if (face.hat === 'scarf') {
      shapes.push(disc(x, y - head * 0.58, head * 0.9, face.shirt));
      shapes.push(disc(x, y + head * 0.06, head * 0.9, face.skin));
    }
    return shapes;
  }

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

  function wrapTo(paragraphs, width) {
    const out = [];
    for (const para of paragraphs) {
      let line = '';
      for (const word of String(para).split(' ')) {
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ` ${word}`;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  const clockFace = () => {
    const hour = 7 + (run.clock / DAY_LENGTH) * 14;
    const hh = Math.floor(hour) % 24;
    const mm = Math.floor(((hour % 1) * 60) / 5) * 5;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  // --- the minimap ----------------------------------------------------------
  //
  // Built once: the town never changes shape. Only the dots on top of it are
  // rebuilt, and there are never more than about twenty of those.
  const MINI = 2;
  const miniBox = {
    x: field.x + field.w - COLS * MINI - 12,
    y: field.y + 12,
    w: COLS * MINI,
    h: ROWS * MINI,
  };
  const miniGround = (() => {
    const shapes = [rect(miniBox.x - 3, miniBox.y - 3, miniBox.w + 6, miniBox.h + 6, PALETTE.barkDim)];
    for (let r = 0; r < ROWS; r++) {
      let start = 0;
      for (let c = 1; c <= COLS; c++) {
        if (c < COLS && miniColour(c, r) === miniColour(start, r)) continue;
        shapes.push(rect(miniBox.x + start * MINI, miniBox.y + r * MINI, (c - start) * MINI, MINI, miniColour(start, r)));
        start = c;
      }
    }
    for (const place of Object.values(PLACES)) {
      shapes.push(rect(miniBox.x + place.at[0] * MINI - 1, miniBox.y + place.at[1] * MINI - 1,
        MINI + 2, MINI + 2, KIND_COLOUR[place.kind] ?? PALETTE.sun));
    }
    return shapes;
  })();

  function miniColour(col, row) {
    const kind = tileAt(col, row);
    if (kind === 'water') return PALETTE.waterDim;
    if (kind === 'block' || kind === 'door') return districtAt(col, row).wall;
    if (kind === 'grass') return districtAt(col, row).grass;
    return districtAt(col, row).road;
  }

  function miniParts() {
    const dot = (x, y, size, fill) =>
      rect(miniBox.x + (x / TILE) * MINI - size / 2, miniBox.y + (y / TILE) * MINI - size / 2, size, size, fill);
    const shapes = [...miniGround];
    for (const k of CORNERS) shapes.push(rect(miniBox.x + k.col * MINI, miniBox.y + k.row * MINI, MINI, MINI, PALETTE.sunDim));
    for (const hand of run.crew) shapes.push(dot(hand.x, hand.y, 4, hand.corner === null ? PALETTE.mossDim : PALETTE.moss));
    for (const f of foes) shapes.push(dot(f.x, f.y, 4, f.kind === 'cop' ? PALETTE.skyLit : PALETTE.ember));
    shapes.push(dot(player.x, player.y, 6, PALETTE.cream));
    return shapes;
  }

  // --- the head-up display --------------------------------------------------

  function hudParts() {
    const shapes = [
      rect(court.x, court.y, court.w, hud.h, PALETTE.ink),
      // The two side strips. The tile window is a whole tile wider than the
      // field on each side, so this is the frame that crops it.
      rect(court.x, field.y, field.x - court.x, field.h, PALETTE.ink),
      rect(field.x + field.w, field.y, court.x + court.w - field.x - field.w, field.h, PALETTE.ink),
      rect(court.x + 10, court.y + hud.h - 5, court.w - 20, 3, PALETTE.barkDim),
    ];

    const barY = court.y + 40;
    const bar = (x, w, fraction, fill) => {
      shapes.push(rect(x, barY, w, 16, PALETTE.barkDim));
      shapes.push(rect(x, barY, Math.max(3, w * clamp(fraction, 0, 1)), 16, fill));
    };
    bar(court.x + 76, 120, run.health / run.maxHealth, run.health <= 3 ? PALETTE.emberLit : PALETTE.moss);
    bar(court.x + 274, 120, run.heat / HEAT_MAX, run.heat > 60 ? PALETTE.ember : PALETTE.sun);

    const weapon = currentWeapon();
    const carrying = GOODS.map((g) => `${g.tag}${bagOf(g.id)}`).join(' ');
    const stars = wanted() ? '*'.repeat(wanted()) : '';

    return {
      shapes,
      labels: [
        text(`DAY ${String(run.day).padStart(2, '0')}  ${clockFace()}`, court.x + 12, court.y + 6, { anchor: 'start' }),
        text(money(run.cash), court.x + court.w - 12, court.y + 6, { anchor: 'end', fill: PALETTE.sun }),
        run.debt > 0
          ? text(`OWES ${money(run.debt)}`, mid.x + 60, court.y + 6, { anchor: 'middle', fill: PALETTE.ember })
          : text(DISTRICTS.find((d) => d.id === districtOf(player.x, player.y).id).name, mid.x + 60, court.y + 6,
            { anchor: 'middle', fill: districtOf(player.x, player.y).accent }),
        text('BODY', court.x + 12, court.y + 40, { anchor: 'start', fill: PALETTE.bark }),
        text('HEAT', court.x + 210, court.y + 40, { anchor: 'start', fill: PALETTE.bark }),
        text(stars, court.x + 402, court.y + 40, { anchor: 'start', fill: PALETTE.emberLit }),
        text(weapon.melee ? weapon.name : `${weapon.name} ${run.ammo}`, court.x + court.w - 12, court.y + 40,
          { anchor: 'end', fill: PALETTE.cream }),
        text(carrying, court.x + 12, court.y + 74, { anchor: 'start', fill: PALETTE.stone }),
        text(intent().label, court.x + court.w - 12, court.y + 74, { anchor: 'end', fill: PALETTE.moss }),
      ],
    };
  }

  // --- the talk box ---------------------------------------------------------

  const LINE_H = 32;

  function talkParts() {
    if (!talk) return { shapes: [], portrait: [], labels: [] };
    const rows = talk.choosing ? talk.options.length : talk.pages[talk.page].length;
    const boxH = Math.min(field.h - 16, Math.max(TILE * 5, 54 + rows * LINE_H + 22));
    const x = field.x + 8;
    const y = field.y + field.h - boxH - 8;
    const w = field.w - 16;
    const faceSize = Math.min(TILE * 4.2, boxH - 44);
    const textX = x + faceSize + 40;

    const shapes = [rect(x, y, w, boxH, PALETTE.cream), rect(x + 4, y + 4, w - 8, boxH - 8, PALETTE.ink)];
    const portrait = talk.face
      ? [
        rect(x + 16, y + 22, faceSize, faceSize, PALETTE.barkDim),
        ...portraitShapes(talk.face, x + 16 + faceSize / 2, y + 22 + faceSize * 0.44, faceSize * 0.92),
      ]
      : [];

    const labels = [text(talk.who || '', textX, y + 12, { anchor: 'start', fill: PALETTE.sun })];

    if (talk.choosing) {
      talk.options.forEach((option, i) => {
        labels.push(text(`${i === talk.cursor ? '>' : ' '}${option.label}`, textX, y + 44 + i * LINE_H, {
          anchor: 'start', fill: i === talk.cursor ? PALETTE.sun : PALETTE.cream,
        }));
      });
    } else {
      const page = talk.pages[talk.page];
      let budget = Math.floor(talk.reveal);
      page.forEach((line, i) => {
        labels.push(text(line.slice(0, Math.max(0, budget)), textX, y + 44 + i * LINE_H, { anchor: 'start' }));
        budget -= line.length + 1;
      });
      if (Math.floor(talk.reveal) >= page.join(' ').length) {
        labels.push(text('>>', x + w - 44, y + boxH - 34, { anchor: 'start', fill: PALETTE.sun }));
      }
    }
    return { shapes, portrait, labels };
  }

  function cardParts() {
    if (!cards.length) return { shapes: [], labels: [] };
    const top = cards[0];
    const lines = wrapTo(top.lines, 30);
    const w = TILE * 17;
    const h = 60 + lines.length * 30 + 26;
    const x = mid.x - w / 2;
    const y = field.y + (field.h - h) / 2;

    return {
      shapes: [
        rect(x, y, w, h, PALETTE.cream),
        rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink),
        rect(x + 16, y + 44, w - 32, 3, PALETTE.barkDim),
      ],
      labels: [
        text(top.title, x + 18, y + 12, { anchor: 'start', fill: PALETTE.sun }),
        ...lines.map((line, i) => text(line, x + 18, y + 56 + i * 30, { anchor: 'start' })),
        text('A', x + w - 30, y + h - 30, { anchor: 'start', fill: PALETTE.bark }),
      ],
    };
  }

  // --- screens --------------------------------------------------------------

  function playLayers() {
    const under = shots.filter((s) => onScreen(s.x, s.y, 0)).map((s) => disc(sx(s.x), sy(s.y), s.r, s.fill));
    const bodies = bodyShapes();
    bodies.push(...playerShapes());
    return [
      { flat: true, shapes: shifted() },
      { flat: true, shapes: under },
      { ink: 3, shapes: bodies },
    ];
  }

  function playScreen() {
    const chrome = hudParts();
    const box = talkParts();
    const note = cardParts();
    return {
      layers: [
        ...playLayers(),
        { flat: true, shapes: [...miniParts(), ...chrome.shapes, ...box.shapes, ...note.shapes] },
        ...(box.portrait.length ? [{ ink: 3, shapes: box.portrait }] : []),
      ],
      text: [...chrome.labels, ...box.labels, ...note.labels],
    };
  }

  function tradeScreen() {
    const stash = market.mode === 'stash';
    const place = market.place ? PLACES[market.place] : null;
    const rows = market.goods;
    const top = court.y + 164;

    const shapes = [rect(court.x + 30, court.y + 118, court.w - 60, 3, PALETTE.barkDim)];
    shapes.push(rect(court.x + 30, top + market.cursor * 42 - 6, court.w - 60, 38, PALETTE.barkDim));

    const labels = [
      centred(stash ? 'THE BOX UNDER THE BED' : place.name, court.y + 46, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
      text(money(run.cash), court.x + 40, court.y + 82, { anchor: 'start', fill: PALETTE.sun }),
      text(`BAG ${carried()}/${capacity()}`, court.x + court.w - 40, court.y + 82, { anchor: 'end', fill: PALETTE.stone }),
      text(stash ? 'IN THE BOX' : 'BUY', court.x + 330, court.y + 126, { anchor: 'end', fill: PALETTE.bark }),
      text(stash ? 'ON YOU' : 'SELL', court.x + 470, court.y + 126, { anchor: 'end', fill: PALETTE.bark }),
      text(stash ? '' : 'HELD', court.x + 590, court.y + 126, { anchor: 'end', fill: PALETTE.bark }),
    ];

    rows.forEach((id, i) => {
      const good = GOOD[id];
      const y = top + i * 42;
      const lit = i === market.cursor;
      labels.push(text(good.name, court.x + 40, y, { anchor: 'start', fill: lit ? PALETTE.sun : PALETTE.cream }));
      if (stash) {
        labels.push(text(String(run.stash[id] ?? 0), court.x + 330, y, { anchor: 'end', fill: PALETTE.cream }));
        labels.push(text(String(bagOf(id)), court.x + 470, y, { anchor: 'end', fill: PALETTE.moss }));
      } else {
        labels.push(text(money(buyPrice(market.place, id)), court.x + 330, y, { anchor: 'end', fill: PALETTE.cream }));
        labels.push(text(money(sellPrice(market.place, id)), court.x + 470, y, { anchor: 'end', fill: PALETTE.moss }));
        labels.push(text(String(bagOf(id)), court.x + 590, y, { anchor: 'end', fill: PALETTE.stone }));
      }
    });

    labels.push(centred(stash ? '> TAKE  < STOW  A ALL  B ALL  START OUT' : '> BUY  < SELL  A ALL  B DUMP  START OUT',
      court.y + court.h - 26, { fill: PALETTE.bark }));

    return { layers: [{ flat: true, shapes }], text: labels };
  }

  // A plate to read a menu off. The faded town behind it is a dither, and a
  // dither is exactly the wrong thing to put behind small text.
  function plate(top, height, accent) {
    return [
      rect(field.x + 24, top, field.w - 48, height, PALETTE.ink),
      rect(field.x + 24, top, field.w - 48, 4, accent),
      rect(field.x + 24, top + height - 4, field.w - 48, 4, accent),
    ];
  }

  function pausedScreen() {
    const chrome = hudParts();
    return {
      layers: [
        ...playLayers().map((layer) => ({ ...layer, alpha: 0.22 })),
        { flat: true, shapes: [...chrome.shapes, ...plate(field.y + 22, 200, PALETTE.bark)] },
      ],
      text: [
        ...chrome.labels,
        centred('PAUSED', field.y + 58, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((item, i) => centred(
          `${i === game.cursor ? '> ' : '  '}${item.label}`,
          field.y + 112 + i * 42,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred(`WORTH ${money(netWorth())}`, field.y + field.h - 32, { fill: PALETTE.stone }),
      ],
    };
  }

  function diedScreen() {
    const chrome = hudParts();
    return {
      layers: [
        ...playLayers().map((layer) => ({ ...layer, alpha: 0.18 })),
        { flat: true, shapes: [...chrome.shapes, ...plate(field.y + 22, 210, PALETTE.ember)] },
      ],
      text: [
        ...chrome.labels,
        centred('YOU WENT DOWN', field.y + 56, { scale: 1, font: HEAVY, fill: PALETTE.ember }),
        centred(`IN ${districtOf(player.x, player.y).name}`, field.y + 96, { fill: PALETTE.bark }),
        ...DEAD_MENU.map((item, i) => centred(
          `${i === game.cursor ? '> ' : '  '}${item.label}`,
          field.y + 146 + i * 42,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred('THE CLINIC TAKES HALF OF WHAT YOU HAVE', field.y + field.h - 32, { fill: PALETTE.stone }),
      ],
    };
  }

  // The town at night, from the hill. It is the only picture in the game that
  // is not made of tiles, and it is here so the title screen is a place.
  function skyline() {
    const base = court.y + court.h - 52;
    const shapes = [
      rect(court.x, court.y + 150, court.w, base - court.y - 150, PALETTE.violetDim),
      rect(court.x, base, court.w, 12, PALETTE.stoneDim),
      disc(court.x + court.w - 96, court.y + 96, 34, PALETTE.sunDim),
    ];
    const towers = [[30, 84], [86, 54], [138, 104], [200, 66], [254, 92], [318, 48], [372, 96], [438, 60], [498, 78], [556, 50]];
    for (const [dx, h] of towers) {
      shapes.push(rect(court.x + dx, base - h, 46, h, PALETTE.ink));
      for (let wy = base - h + 16; wy < base - 18; wy += 24) {
        shapes.push(rect(court.x + dx + 10, wy, 10, 10, (dx + wy) % 3 === 0 ? PALETTE.sun : PALETTE.sunDim));
        shapes.push(rect(court.x + dx + 28, wy, 10, 10, (dx + wy) % 4 === 0 ? PALETTE.ember : PALETTE.violet));
      }
    }
    return shapes;
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: [...skyline(), rect(court.x + 60, court.y + 126, court.w - 120, 4, PALETTE.ember)] }],
      text: [
        centred('KINGPIN', court.y + 74, { scale: 2, font: HEAVY, fill: PALETTE.ember }),
        ...MENU.map((item, i) => centred(
          `${i === game.cursor ? '> ' : '  '}${item.label}`,
          court.y + 178 + i * 40,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream },
        )),
        centred('TWENTY-ONE DAYS AND A BUS TICKET OUT', court.y + court.h - 20, { fill: PALETTE.bark }),
      ],
    };
  }

  function howtoScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(court.x + 50, court.y + 74, court.w - 100, 4, PALETTE.bark)] }],
      text: [
        centred('HOW TO PLAY', court.y + 42, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => text(line, court.x + 40, court.y + 96 + i * 30, {
          anchor: 'start', fill: i >= 6 ? PALETTE.moss : PALETTE.cream,
        })),
        centred('B TO GO BACK', court.y + court.h - 26, { fill: PALETTE.bark }),
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
        centred('BIGGEST NIGHTS', court.y + 62, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        centred('B TO GO BACK', court.y + court.h - 26, { fill: PALETTE.bark }),
      ],
    };
  }

  const OVER_TITLE = { bus: 'YOU MADE THE BUS', taken: 'THE TASK FORCE', prison: 'YOU WENT AWAY', dead: 'GAME OVER' };

  function overScreen() {
    const lines = wrapTo(ENDING[run.ending ?? 'dead'], 36);
    const top = court.y + 96;
    const after = top + lines.length * 28 + 20;
    const body = [
      centred(OVER_TITLE[run.ending ?? 'dead'], court.y + 52,
        { scale: 1, font: HEAVY, fill: run.ending === 'bus' ? PALETTE.sun : PALETTE.ember }),
      ...lines.map((line, i) => centred(line, top + i * 28, { fill: PALETTE.cream })),
      centred(`${money(game.score)}`, after, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
      centred(run.town.dead === 0 ? `NOBODY DIED  ${run.sold} SOLD` : `${run.town.dead} DEAD  ${run.sold} SOLD`,
        after + 42, { fill: PALETTE.moss }),
    ];

    const carets = [];
    if (game.placing > 0) {
      const letters = game.initials.map((i) => scores.ALPHABET[i]);
      body.push(centred(`ON THE BOARD AT ${game.placing}`, after + 76, { fill: PALETTE.moss }));
      letters.forEach((letter, i) => {
        const x = mid.x + (i - 1) * 52;
        body.push(text(letter, x, after + 92, { scale: 1, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
        if (i === game.slot) carets.push(rect(x - 4, after + 130, 32, 6, PALETTE.sun));
      });
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 26, { fill: PALETTE.bark }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 26, { fill: PALETTE.bark }));
    }
    return { layers: [{ flat: true, shapes: carets }], text: body };
  }

  const SCREENS = {
    menu: menuScreen,
    howto: howtoScreen,
    scores: scoresScreen,
    play: playScreen,
    trade: tradeScreen,
    paused: pausedScreen,
    died: diedScreen,
    over: overScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Kingpin (${game.screen})`,
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
      if (game.screen === 'play' || game.screen === 'trade' || game.screen === 'paused') {
        if (run.heat >= 55 || foes.some((f) => f.kind === 'cop')) return 'dragnet';
        return run.clock > DAY_LENGTH * NIGHT_AT ? 'neon' : 'vice';
      }
      if (game.screen === 'died') return null;
      return 'vice';
    },
    state() {
      const what = game.screen === 'play' ? intent() : { kind: null, label: '' };
      return {
        screen: game.screen,
        exit: game.exit,
        cursor: game.cursor,
        day: run.day,
        clock: Math.round(run.clock),
        cash: run.cash,
        debt: run.debt,
        heat: Math.round(run.heat),
        wanted: wanted(),
        health: run.health,
        ammo: run.ammo,
        weapon: currentWeapon().id,
        owns: { ...run.owns },
        bag: Object.fromEntries(GOODS.map((g) => [g.id, bagOf(g.id)])),
        stash: { ...run.stash },
        carried: carried(),
        capacity: capacity(),
        worth: netWorth(),
        demand: Number(demand().toFixed(3)),
        recruits: recruitsLeft(),
        people: run.town.people,
        dead: run.town.dead,
        copsKilled: run.town.copsKilled,
        goodwill: run.town.goodwill,
        bike: run.story.bike,
        story: { ...run.story },
        sold: run.sold,
        busts: run.busts,
        crew: run.crew.map((c) => ({
          name: c.name, corner: c.corner, good: c.good, stock: c.stock, held: c.held,
          x: Math.round(c.x), y: Math.round(c.y),
        })),
        foes: foes.map((f) => ({ kind: f.kind, x: Math.round(f.x), y: Math.round(f.y), hp: f.hp })),
        locals: locals.length,
        buyers: locals.filter((p) => p.wants).length,
        crowd: locals.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), wants: p.wants })),
        // What the pad would do if A went down now, which is the one thing a
        // test walking this town has to be able to see.
        intent: what.kind,
        hint: what.label,
        options: talk && talk.choosing ? talk.options.map((o) => o.label) : [],
        talking: talk ? talk.pages.length - talk.page : 0,
        card: cards.length ? cards[0].title : null,
        cards: cards.length,
        trade: market ? { place: market.place, mode: market.mode, good: market.goods[market.cursor] } : null,
        placing: game.placing,
        score: game.score,
        ending: run.ending,
        elapsed: game.elapsed,
        at: [Math.round(player.x), Math.round(player.y)],
        tile: [colAt(player.x), rowAt(player.y)],
        district: districtOf(player.x, player.y).id,
      };
    },
    field,
    court,
    TILE,
    // For a test that has to walk somewhere: the tile a place's door is on, in
    // the same pixels state().at reports.
    centreOf: (col, row) => [cx(col), cy(row)],
  };
}

// Box art for the shell's selector: a street corner at night with somebody
// standing on it, which is the whole game in one picture.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const d = (dx, dy, dr, fill) => ({ type: 'disc', x: Math.round(dx), y: Math.round(dy), r: dr, fill });
  const base = y + h - 12;
  return [
    r(x, y, w, h, PALETTE.violetDim),
    r(x + 6, y + 8, 22, base - y - 8, PALETTE.ink),
    r(x + 10, y + 14, 6, 6, PALETTE.sun),
    r(x + 10, y + 28, 6, 6, PALETTE.sunDim),
    r(x + w - 34, y + 4, 26, base - y - 4, PALETTE.ink),
    r(x + w - 28, y + 12, 6, 6, PALETTE.ember),
    r(x + w - 28, y + 26, 6, 6, PALETTE.sun),
    r(x, base, w, 12, PALETTE.stoneDim),
    r(x + w * 0.42, base - 20, 12, 16, PALETTE.sky),
    d(x + w * 0.46, base - 26, 6, PALETTE.bark),
    r(x + w * 0.56, base - 18, 12, 4, PALETTE.stoneLit),
  ];
}

module.exports = {
  title: 'KINGPIN',
  blurb: 'RUN THE TOWN',
  meta: {
    players: [1],
    rating: 'nsfw',
    audio: '8-bit',
    graphics: '2d',
    content: ['drug dealing', 'gun violence', 'civilian deaths'],
  },
  accent: 'ember',
  emblem,
  create,
  GAME, MENU, PAUSE_MENU, DEAD_MENU, HOW_TO, OPENING, ENDING,
  TOWN, GLYPH, SOLID, COLS, ROWS, PLACES, CORNERS, DISTRICTS, START,
  GOODS, GOOD, WEAPONS, FACES, KINDS, priceAt, paginate, WRAP,
  // The script, so a test can read every branch of it without playing to the
  // one screen that reaches it.
  SPEECH: {
    MARKET_TALK, ARMS_TALK, ARMS_WORDS, COPSHOP_TALK, CHURCH_TALK, CONFESSION, CLINIC_TALK,
    TOWERS_TALK, VITO_TALK, VITO_JOB, BENNY_JOB, BENNY_TALK, DEPOT_TALK, HOME_TALK,
    STREET_TALK, WANT_WORDS, CREW_TALK,
  },
  LAST_DAY, DAY_LENGTH, CREW_COST, CREW_WAGE, BRIBE, TITHE, PATCH_UP,
  START_CASH, START_DEBT, BAG, HEAT_MAX,
};

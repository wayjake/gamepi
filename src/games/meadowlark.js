'use strict';
// Meadowlark -- a farm, four seasons, and no end to it.
//
// The whole holding fits on one screen: fourteen tiles by fourteen, drawn as
// an isometric diorama, with a pond in one corner and a creek down one side.
// You till, sow, water, harvest and ship; you buy better tools, dig channels
// from the water so the soil waters itself, keep hens and cows and sheep, and
// eat some of what you grow or run out of the energy to grow more. Winter grows
// nothing, so the bed will let you sleep straight through it -- if the animals
// have hay and you have food put by.
//
// It obeys the same contract as the arcade games in here: update() is one fixed
// step, scene() has no side effects, the only randomness is seeded, and every
// frame passes the palette / overscan / flicker checks. What is different is
// that a farm has to *persist*: the day's work is written to disk at each
// sleep, and CONTINUE reads it back. Tests hand in a memory store instead.
//
// Three things worth knowing before changing anything:
//
//   The ground is an underlay. Diamonds are not a shape the renderer has, so
//   gfx/iso.js paints them into a canvas the game owns, only when something
//   about the ground changed, and everything with height -- crops, animals,
//   the farmer, the buildings -- is ordinary shapes on top, sorted into
//   diagonal bands so a thing nearer the viewer is drawn over a thing further
//   away and still gets its own outline.
//
//   One function decides what A does. intent() looks at what is in front of
//   the farmer and what is in their hand and returns the action and its label.
//   The HUD prints the label and the button performs the action, so they can
//   never disagree, and a test can read the label to know what pressing A will
//   do.
//
//   The world is data. Crops, shop stock, animals and the map are tables at
//   the top of the file; the state machine below them is the same size it
//   would be for a farm with one crop.

const fs = require('fs');
const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const { sway, hop, cycle } = require('../gfx/motion');
const iso = require('../gfx/iso');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));    // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'meadowlark';
const SAVE_FILE = path.join(scores.DIR, 'meadowlark.json');
const SAVE_VERSION = 1;

// --- time --------------------------------------------------------------------
//
// A game minute is a quarter of a real second, so the eighteen hours between
// waking and collapsing take four and a half minutes. Long enough to do a
// day's work on a farm you can see all of at once; short enough that "one more
// day" is a promise you can keep.
const MINUTE = 0.25;
const WAKE = 6 * 60;
const COLLAPSE = 24 * 60;
const DUSK = 17 * 60;
const NIGHTFALL = 20 * 60;
const DAYS = 28;

const MAX_ENERGY = 100;
const MAX_FOOD = 100;
const FOOD_PER_HOUR = 5;       // the meter drains this much an hour, awake
const FOOD_OVERNIGHT = 20;
const HUNGRY = 30;             // sleep with less than this and you wake tired
const TIRED_WAKE = 60;
const COLLAPSE_WAKE = 50;
const BREAD = 15;              // what Wren charges to feed you a winter day

const COST = { hoe: 2, can: 1, sickle: 1, axe: 3, hammer: 3, spade: 3, seed: 0.5, harvest: 0.5, sprinkler: 1 };
const ACT_TIME = { hoe: 0.4, can: 0.5, sickle: 0.35, axe: 0.45, hammer: 0.45, spade: 0.45, seed: 0.35, harvest: 0.5, sprinkler: 0.35, clear: 0.35 };
const STEP_TIME = 0.2;         // seconds to cross one tile
const TURN_DELAY = 0.09;       // a tap turns; a hold this long walks

// --- the map -----------------------------------------------------------------
//
// Fourteen strings of fourteen. The house, the barn site, the coop site, the
// pasture, the road and the water never move; everything else is grass the
// seed scatters rocks, stumps and weeds over.
const COLS = 14;
const ROWS = 14;
const MAP = [
  'TT.T.......T.T',
  'THHb.....~~~.T',
  'THH.....~~~~~T',
  '..D......~~~..',
  '..............',
  '~....sss......',
  '~....sss......',
  '~....sss.....T',
  '~.............',
  '.BBc..........',
  '.BB...........',
  'fpppppf.......',
  'fpppppf......T',
  '========S=====',
];
const GLYPH = {
  '.': { g: 'grass' },
  T: { g: 'grass', o: 'tree' },
  H: { g: 'house' },
  b: { g: 'grass', o: 'bin' },
  D: { g: 'path' },
  '~': { g: 'water' },
  s: { g: 'soil' },
  B: { g: 'barn' },
  c: { g: 'coop' },
  f: { g: 'grass', o: 'fence' },
  p: { g: 'pasture' },
  '=': { g: 'path' },
  S: { g: 'path', o: 'stall' },
};
const DOOR = { c: 2, r: 3 };            // stand here, face the house, sleep
const START = { c: 2, r: 4, dir: 'down' };
const SOLID_GROUND = new Set(['water', 'house', 'barn', 'coop']);
const SOLID_OBJECT = new Set(['tree', 'rock', 'stump', 'bin', 'stall', 'fence', 'sprinkler', 'sign']);
const TILLABLE = new Set(['grass']);
const SCATTER = { rock: 12, stump: 8, weed: 22 };
const ROCK_HP = 2;
const STUMP_HP = 3;
const WOOD_PER_STUMP = 4;
const STONE_PER_ROCK = 2;

// --- seasons -----------------------------------------------------------------
const SEASONS = [
  { name: 'SPRING', track: 'sprout', accent: PALETTE.moss, grass: PALETTE.moss, tuft: PALETTE.mossLit, pasture: PALETTE.mossLit, canopy: [PALETTE.leaf, PALETTE.leafLit, PALETTE.rose], rain: 0.25 },
  { name: 'SUMMER', track: 'haze', accent: PALETTE.sun, grass: PALETTE.turf, tuft: PALETTE.turfLit, pasture: PALETTE.turfLit, canopy: [PALETTE.leafDim, PALETTE.leaf, PALETTE.leafLit], rain: 0.15 },
  { name: 'AUTUMN', track: 'gleaning', accent: PALETTE.ember, grass: PALETTE.sand, tuft: PALETTE.sunDim, pasture: PALETTE.sandLit, canopy: [PALETTE.ember, PALETTE.sun, PALETTE.emberLit], rain: 0.2 },
  { name: 'WINTER', track: 'hearth', accent: PALETTE.sky, grass: PALETTE.cream, tuft: null, pasture: PALETTE.creamLit, canopy: null, rain: 0 },
];
const WINTER = 3;

// --- crops -------------------------------------------------------------------
//
// `days` to ripen from sowing, watered every day. `regrow` is how many days a
// picked plant takes to fruit again, or 0 if it is pulled up whole. `food` is
// what eating one is worth, in energy. The balance is the old one: cheap, fast
// crops teach the loop, slow ones pay for patience, and the regrowers reward
// getting seed in the ground in the first week.
const CROPS = {
  turnip: { name: 'TURNIP', season: 0, days: 4, price: 20, sells: 60, regrow: 0, food: 14, form: 'root', fruit: PALETTE.cream, leaf: PALETTE.moss },
  potato: { name: 'POTATO', season: 0, days: 6, price: 40, sells: 110, regrow: 0, food: 22, form: 'root', fruit: PALETTE.sandLit, leaf: PALETTE.leaf },
  strawberry: { name: 'STRAWBERRY', season: 0, days: 8, price: 90, sells: 90, regrow: 3, food: 18, form: 'bush', fruit: PALETTE.ember, leaf: PALETTE.leafDim },
  cabbage: { name: 'CABBAGE', season: 0, days: 10, price: 70, sells: 250, regrow: 0, food: 30, form: 'head', fruit: PALETTE.mossLit, leaf: PALETTE.moss },
  pepper: { name: 'PEPPER', season: 1, days: 5, price: 40, sells: 50, regrow: 3, food: 12, form: 'bush', fruit: PALETTE.emberLit, leaf: PALETTE.leaf },
  tomato: { name: 'TOMATO', season: 1, days: 7, price: 60, sells: 80, regrow: 3, food: 18, form: 'bush', fruit: PALETTE.ember, leaf: PALETTE.leaf },
  corn: { name: 'CORN', season: 1, days: 9, price: 100, sells: 120, regrow: 4, food: 26, form: 'stalk', fruit: PALETTE.sun, leaf: PALETTE.leaf },
  melon: { name: 'MELON', season: 1, days: 12, price: 120, sells: 380, regrow: 0, food: 40, form: 'vine', fruit: PALETTE.turfDim, leaf: PALETTE.leaf },
  eggplant: { name: 'EGGPLANT', season: 2, days: 5, price: 30, sells: 60, regrow: 3, food: 16, form: 'bush', fruit: PALETTE.violet, leaf: PALETTE.leaf },
  yam: { name: 'YAM', season: 2, days: 7, price: 50, sells: 160, regrow: 0, food: 28, form: 'root', fruit: PALETTE.rose, leaf: PALETTE.moss },
  cranberry: { name: 'CRANBERRY', season: 2, days: 8, price: 120, sells: 75, regrow: 4, food: 10, form: 'bush', fruit: PALETTE.emberDim, leaf: PALETTE.leafDim, yield: 2 },
  pumpkin: { name: 'PUMPKIN', season: 2, days: 12, price: 110, sells: 400, regrow: 0, food: 40, form: 'vine', fruit: PALETTE.sunDim, leaf: PALETTE.leafDim },
};

// Everything that can be in the bag. Crops sell for CROPS[id].sells and feed
// for CROPS[id].food; these are the rest.
const GOODS = {
  egg: { name: 'EGG', sells: 60, food: 20 },
  milk: { name: 'MILK', sells: 150, food: 35 },
  wool: { name: 'WOOL', sells: 400 },
  hay: { name: 'HAY', sells: 12 },
  stone: { name: 'STONE', sells: 10 },
  wood: { name: 'WOOD', sells: 20 },
  sprinkler: { name: 'SPRINKLER', sells: 300 },
};

const item = (id) => {
  if (id.startsWith('seed:')) return { name: `${CROPS[id.slice(5)].name} SEEDS`, sells: 0 };
  if (CROPS[id]) return CROPS[id];
  return GOODS[id];
};

// --- animals -----------------------------------------------------------------
const ANIMALS = {
  chicken: { name: 'HEN', price: 600, needs: 'coop', gives: 'egg', every: 1, sound: 'cluck', cap: 6 },
  cow: { name: 'COW', price: 2500, needs: 'barn', gives: 'milk', every: 1, sound: 'moo', cap: 4 },
  sheep: { name: 'SHEEP', price: 2200, needs: 'barn', gives: 'wool', every: 4, sound: 'baa', cap: 4 },
};
const NAMES = ['DAISY', 'PIP', 'CLOVER', 'MABEL', 'BISCUIT', 'OTIS', 'HAZEL', 'WREN', 'PUDDING', 'ALFIE', 'MARIGOLD', 'TOAST', 'NUTMEG', 'BEAN'];
const HAPPY_TO_PRODUCE = 3;
const MAX_HAPPY = 10;

// --- the shop ----------------------------------------------------------------
const SHOP = [
  { id: 'tool:axe', name: 'AXE', price: 500, desc: 'CLEARS STUMPS FOR WOOD' },
  { id: 'tool:hammer', name: 'HAMMER', price: 400, desc: 'BREAKS ROCKS FOR STONE' },
  { id: 'tool:spade', name: 'DITCH SPADE', price: 800, desc: 'DIGS CHANNELS FROM WATER' },
  { id: 'tool:copper', name: 'COPPER CAN', price: 1500, desc: 'WATERS THREE, HOLDS 16' },
  { id: 'item:sprinkler', name: 'SPRINKLER', price: 1200, desc: 'WATERS 8 TILES BY A CHANNEL' },
  { id: 'build:coop', name: 'HEN COOP', price: 1500, wood: 12, desc: 'ROOM FOR SIX HENS' },
  { id: 'build:barn', name: 'BARN', price: 3000, wood: 24, desc: 'ROOM FOR FOUR COWS OR SHEEP' },
  { id: 'animal:chicken', name: 'HEN', price: 600, desc: 'AN EGG A DAY, IF FED' },
  { id: 'animal:cow', name: 'COW', price: 2500, desc: 'MILK EVERY DAY, IF FED' },
  { id: 'animal:sheep', name: 'SHEEP', price: 2200, desc: 'WOOL EVERY FOURTH DAY' },
  { id: 'item:hay', name: 'HAY', price: 25, desc: 'ONE ANIMAL, ONE DAY' },
  { id: 'item:stone', name: 'STONE', price: 40, desc: 'ONE CHANNEL EACH' },
  { id: 'item:wood', name: 'WOOD', price: 60, desc: 'FOR BUILDING' },
];
const CAN = { 1: { cap: 8, spread: 1 }, 2: { cap: 16, spread: 3 } };
const TOOL_NAMES = { hoe: 'HOE', can: 'WATERING CAN', copper: 'COPPER CAN', sickle: 'SICKLE', axe: 'AXE', hammer: 'HAMMER', spade: 'DITCH SPADE', seed: 'SEEDS', sprinkler: 'SPRINKLER' };
const TOOL_ORDER = ['hoe', 'can', 'sickle', 'axe', 'hammer', 'spade'];

// Thirty characters is what fits across the stall's counter.
const WREN = [
  'TURNIPS FIRST. THEY FORGIVE.',
  'MELONS: TWELVE DAYS. WORTH IT.',
  'STOCK HAY BEFORE THE SNOW.',
  'NOTHING GROWS. BREAK ROCKS.',
];

// --- screens -----------------------------------------------------------------
const MENU = [
  { id: 'new', label: 'NEW FARM' },
  { id: 'continue', label: 'CONTINUE' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'bag', label: 'BAG' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'quit', label: 'QUIT TO MENU' },
];
const HOW_TO = [
  'WALK WITH THE STICK. A USES WHAT IS',
  'IN YOUR HAND ON THE TILE IN FRONT.',
  'B SWAPS TOOLS. SELECT OPENS THE BAG.',
  'HOE THE GRASS, SOW, WATER, WAIT.',
  'SHIP AT THE BIN BY THE HOUSE. THE',
  'MONEY COMES IN OVERNIGHT.',
  'WORK COSTS ENERGY. EATING GIVES IT',
  'BACK. SLEEP HUNGRY AND YOU WAKE TIRED.',
  'CHANNELS DUG FROM THE WATER SOAK THE',
  'SOIL BESIDE THEM EVERY MORNING.',
  'WINTER GROWS NOTHING. THE BED WILL',
  'SLEEP YOU THROUGH IT, IF YOU CAN PAY.',
];

// --- helpers -----------------------------------------------------------------

// mulberry32, the same seeded generator every scene and game in here uses.
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
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r, fill });
const chain = (points, fill) => ({ type: 'chain', points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), r: p.r })), fill });

// Grid directions. In an isometric view "up" on the pad walks up the screen
// along the grid's r axis, which is up and to the right; the cursor drawn on
// the tile in front is what makes that learnable in a few seconds.
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const WRAP = 34;
function wrap(text, width = WRAP) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

const clockText = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, '0')}${h < 12 ? 'AM' : 'PM'}`;
};

// The default save store: one JSON file beside the high score table, in the
// same directory scores.js keeps outside the working tree so a deploy cannot
// wipe it. Tests pass their own.
const fileStore = {
  load() {
    try { return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { return null; }
  },
  write(data) {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data));
  },
};

function memoryStore() {
  let data = null;
  return { load: () => (data ? JSON.parse(data) : null), write(next) { data = JSON.stringify(next); }, get raw() { return data; } };
}

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const table = options.scores ?? scores;
  const store = options.save ?? fileStore;
  const seed = options.seed ?? 0x4d454144;
  let random = rng(seed);

  // The diorama: 28 half-tiles wide, 28 quarter-tiles tall, whatever fits under
  // a HUD strip and above a hint line. Buildings and trees stand up from their
  // tiles, so the grid starts a little way down from the strip.
  const HUD_H = 44;
  const HEAD = 40;
  const FOOT = 48;
  const hh = Math.floor(Math.min(court.w / (COLS + ROWS) / 2, (court.h - HUD_H - HEAD - FOOT) / (COLS + ROWS)));
  const TW = hh * 4;
  const grid = iso.grid({ cols: COLS, rows: ROWS, tileW: TW, x: mid.x - (COLS + ROWS) * hh, y: court.y + HUD_H + HEAD });
  const { hw } = grid;
  const u = hh / 11; // sprite unit: everything below was drawn at hh = 11

  const ground = iso.target(width, height);
  let groundDirty = true;

  const sounds = [];
  const say = (name) => sounds.push(name);

  // --- state -----------------------------------------------------------------

  // Everything that goes to disk.
  let farm = null;

  // Everything that does not: which screen, what is animating, where the
  // farmer is between tiles.
  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    t: 0,            // seconds of play, for the swaying and the blinking
    cursor: 0,
    top: 0,
    note: null,      // a line for the hint bar, and how long it has left
    act: null,       // the tool swing in progress
    move: null,      // the step in progress
    held: 0,         // how long the stick has been leaned in the facing direction
    card: 0,         // the day card's timer
    handBump: 0,
    night: null,     // the sleep sequence
    prompt: null,
    shownGold: 0,
    qty: 1,          // the shipping quantity
    pets: [],        // hearts over animals
    pressA: false,   // an A that arrived mid-step
    saves: 0,
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; game.cursor = 0; game.top = 0; };
  const note = (text, seconds = 2.2) => { game.note = { text, left: seconds }; };

  // --- building a farm -------------------------------------------------------

  function newFarm() {
    random = rng(seed);
    const tiles = MAP.map((line) => [...line].map((ch) => {
      const spec = GLYPH[ch];
      if (!spec) throw new Error(`unknown map glyph "${ch}"`);
      return { g: spec.g, o: spec.o ?? null, hp: 0, wet: false, crop: null };
    }));
    if (tiles.length !== ROWS || tiles.some((row) => row.length !== COLS)) throw new Error('map is not 14x14');

    // The sites for the buildings you have not bought yet.
    tiles[9][3].g = 'grass'; tiles[9][3].o = 'sign';
    tiles[9][1].g = 'grass'; tiles[9][1].o = 'sign';
    for (const [c, r] of [[2, 9], [1, 10], [2, 10]]) tiles[r][c].g = 'path';

    // Rocks, stumps and weeds wherever there is bare grass and room. The near
    // side of the house and the pasture stay clear: the first morning should
    // be about the plot, not about a rock in front of the door.
    const open = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = tiles[r][c];
        if (t.g !== 'grass' || t.o) continue;
        if (r <= 4 && c <= 4) continue;
        open.push([c, r]);
      }
    }
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    let k = 0;
    for (const [kind, count] of Object.entries(SCATTER)) {
      for (let i = 0; i < count && k < open.length; i++, k++) {
        const [c, r] = open[k];
        tiles[r][c].o = kind;
        tiles[r][c].hp = kind === 'rock' ? ROCK_HP : kind === 'stump' ? STUMP_HP : 0;
      }
    }

    farm = {
      version: SAVE_VERSION,
      seed,
      day: 1, season: 0, year: 1,
      clock: WAKE,
      gold: 500,
      energy: MAX_ENERGY, maxEnergy: MAX_ENERGY, food: MAX_FOOD,
      tiles,
      bag: { 'seed:turnip': 10 },
      tools: { hoe: 1, can: 1, sickle: 1, axe: 0, hammer: 0, spade: 0 },
      water: CAN[1].cap,
      hand: 'hoe',
      seed: 'turnip',
      buildings: { coop: false, barn: false },
      animals: [],
      shipped: {},
      lifetime: { shipped: 0, days: 0, harvested: 0 },
      player: { ...START },
      weather: 'sun',
      names: 0,
    };
    game.shownGold = farm.gold;
    game.saves = 0;
    game.pets = [];
    game.act = null;
    game.move = null;
    game.night = null;
    groundDirty = true;
  }

  function load() {
    const data = store.load();
    if (!data || data.version !== SAVE_VERSION || !Array.isArray(data.tiles)) return false;
    farm = data;
    random = rng((farm.seed ^ (farm.lifetime.days * 7919)) >>> 0);
    game.shownGold = farm.gold;
    game.pets = [];
    game.act = null;
    game.move = null;
    game.night = null;
    groundDirty = true;
    return true;
  }

  function save() {
    store.write(farm);
    game.saves++;
  }

  // --- reading the farm ------------------------------------------------------

  const tileAt = (c, r) => (grid.inside(c, r) ? farm.tiles[r][c] : null);
  const season = () => SEASONS[farm.season];
  const canSpec = () => CAN[farm.tools.can];

  const walkable = (c, r) => {
    const t = tileAt(c, r);
    return Boolean(t) && !SOLID_GROUND.has(t.g) && !SOLID_OBJECT.has(t.o);
  };

  const facing = () => {
    const [dc, dr] = DIRS[farm.player.dir];
    return { c: farm.player.c + dc, r: farm.player.r + dr };
  };

  const animalAt = (c, r) => farm.animals.find((a) => a.c === c && a.r === r) ?? null;
  const ripe = (crop) => crop && !crop.dead && crop.age >= CROPS[crop.id].days;
  const count = (id) => farm.bag[id] ?? 0;
  const give = (id, n = 1) => { farm.bag[id] = count(id) + n; };
  const take = (id, n = 1) => {
    const left = count(id) - n;
    if (left > 0) farm.bag[id] = left;
    else delete farm.bag[id];
  };

  // The hands you can cycle through with B: the tools you own, then seeds if
  // you are holding a packet, then a sprinkler if you have one to place.
  function hands() {
    const out = TOOL_ORDER.filter((tool) => farm.tools[tool] > 0);
    if (farm.seed && count(`seed:${farm.seed}`) > 0) out.push('seed');
    if (count('sprinkler') > 0) out.push('sprinkler');
    return out;
  }

  const handName = () => {
    if (farm.hand === 'seed') return `${CROPS[farm.seed].name} SEEDS x${count(`seed:${farm.seed}`)}`;
    if (farm.hand === 'can') return farm.tools.can === 2 ? TOOL_NAMES.copper : TOOL_NAMES.can;
    return TOOL_NAMES[farm.hand];
  };

  // Which channels have water in them: anything touching the pond or the creek,
  // and anything touching one of those, and so on. Soil beside a live channel
  // is watered at dawn; a sprinkler beside one waters the eight around it.
  function irrigation() {
    const live = new Set();
    const queue = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) if (farm.tiles[r][c].g === 'water') queue.push([c, r]);
    }
    while (queue.length) {
      const [c, r] = queue.pop();
      for (const [dc, dr] of Object.values(DIRS)) {
        const nc = c + dc;
        const nr = r + dr;
        const t = tileAt(nc, nr);
        if (!t || t.g !== 'channel') continue;
        const key = nr * COLS + nc;
        if (live.has(key)) continue;
        live.add(key);
        queue.push([nc, nr]);
      }
    }
    return live;
  }

  const wetBy = (c, r, live) => {
    const t = tileAt(c, r);
    return Boolean(t) && (t.g === 'water' || (t.g === 'channel' && live.has(r * COLS + c)));
  };

  // What A would do right now. The HUD shows `label`; pressing A runs `kind`.
  function intent() {
    const p = farm.player;
    const { c, r } = facing();
    const t = tileAt(c, r);
    const none = (label = '') => ({ kind: 'none', label, c, r });
    if (!t) return none();
    const hand = farm.hand;
    const tired = farm.energy <= 0;
    const tiredNote = 'TOO TIRED. EAT, OR SLEEP.';

    if (t.g === 'house' && p.c === DOOR.c && p.r === DOOR.r) return { kind: 'sleep', label: 'A: GO TO BED', c, r };
    if (t.o === 'bin') return { kind: 'ship', label: 'A: SHIP GOODS', c, r };
    if (t.o === 'stall') return { kind: 'shop', label: "A: WREN'S STALL", c, r };
    if (t.o === 'sign') {
      const which = c === 3 ? 'coop' : 'barn';
      const entry = SHOP.find((e) => e.id === `build:${which}`);
      return none(`${which.toUpperCase()} SITE: ${entry.price}G + ${entry.wood} WOOD, AT THE STALL`);
    }

    const animal = animalAt(c, r);
    if (animal) {
      const spec = ANIMALS[animal.kind];
      if (animal.ready) return { kind: 'collect', label: `A: TAKE ${GOODS[spec.gives].name} FROM ${animal.name}`, c, r, animal };
      if (!animal.petted) return { kind: 'pet', label: `A: PET ${animal.name}`, c, r, animal };
      return none(`${animal.name} IS ${animal.fed ? 'CONTENT' : 'HUNGRY'}`);
    }

    if (t.crop) {
      if (t.crop.dead) {
        if (hand === 'sickle' || hand === 'hoe') return tired ? none(tiredNote) : { kind: 'clear', label: 'A: CLEAR THE DEAD PLANT', c, r };
        return none('WITHERED. THE SICKLE CLEARS IT.');
      }
      if (ripe(t.crop)) return tired ? none(tiredNote) : { kind: 'harvest', label: `A: PICK ${CROPS[t.crop.id].name}`, c, r };
      if (hand === 'can') {
        if (farm.water <= 0) return none('EMPTY CAN. FILL IT AT THE WATER.');
        if (t.wet) return none(`${CROPS[t.crop.id].name}: WATERED`);
        return tired ? none(tiredNote) : { kind: 'can', label: `A: WATER (${farm.water}/${canSpec().cap})`, c, r };
      }
      const left = CROPS[t.crop.id].days - t.crop.age;
      return none(`${CROPS[t.crop.id].name}: ${left} DAY${left === 1 ? '' : 'S'} TO GO${t.wet ? ', WATERED' : ', DRY'}`);
    }

    switch (hand) {
      case 'hoe':
        if (t.o === 'weed') return tired ? none(tiredNote) : { kind: 'clear', label: 'A: PULL THE WEED', c, r };
        if (t.g === 'grass' && !t.o) return tired ? none(tiredNote) : { kind: 'hoe', label: 'A: TILL', c, r };
        if (t.g === 'soil') return none('TILLED. SOW SOMETHING HERE.');
        if (t.o === 'rock') return none('A ROCK. THE HAMMER BREAKS IT.');
        if (t.o === 'stump') return none('A STUMP. THE AXE CLEARS IT.');
        return none();
      case 'can':
        if (wetBy(c, r, liveChannels())) return farm.water >= canSpec().cap ? none('THE CAN IS FULL') : { kind: 'fill', label: 'A: FILL THE CAN', c, r };
        if (t.g === 'soil') {
          if (farm.water <= 0) return none('EMPTY CAN. FILL IT AT THE WATER.');
          if (t.wet) return none('WATERED');
          return tired ? none(tiredNote) : { kind: 'can', label: `A: WATER (${farm.water}/${canSpec().cap})`, c, r };
        }
        return none(farm.water <= 0 ? 'EMPTY CAN. FILL IT AT THE WATER.' : '');
      case 'sickle':
        if (t.o === 'weed') return tired ? none(tiredNote) : { kind: 'clear', label: 'A: CUT THE WEED', c, r };
        if ((t.g === 'grass' || t.g === 'pasture') && !t.o && farm.season !== WINTER) return tired ? none(tiredNote) : { kind: 'sickle', label: 'A: CUT HAY', c, r };
        return none();
      case 'axe':
        if (t.o === 'stump') return tired ? none(tiredNote) : { kind: 'axe', label: `A: CHOP (${t.hp} MORE)`, c, r };
        return none();
      case 'hammer':
        if (t.o === 'rock') return tired ? none(tiredNote) : { kind: 'hammer', label: `A: BREAK (${t.hp} MORE)`, c, r };
        return none();
      case 'spade':
        if (t.g === 'channel') return tired ? none(tiredNote) : { kind: 'unspade', label: 'A: FILL THE CHANNEL IN', c, r };
        if ((t.g === 'grass' || t.g === 'soil') && !t.o) {
          if (count('stone') <= 0) return none('A CHANNEL NEEDS ONE STONE.');
          return tired ? none(tiredNote) : { kind: 'spade', label: `A: DIG A CHANNEL (${count('stone')} STONE)`, c, r };
        }
        return none();
      case 'seed': {
        const crop = CROPS[farm.seed];
        if (t.g !== 'soil') return none(t.g === 'grass' && !t.o ? 'TILL IT FIRST' : '');
        if (crop.season !== farm.season) return none(`${crop.name} IS A ${SEASONS[crop.season].name} CROP`);
        return tired ? none(tiredNote) : { kind: 'seed', label: `A: SOW ${crop.name}`, c, r };
      }
      case 'sprinkler':
        if ((t.g === 'grass' || t.g === 'soil') && !t.o) return tired ? none(tiredNote) : { kind: 'sprinkler', label: 'A: PLACE THE SPRINKLER', c, r };
        return none();
      default:
        return none();
    }
  }

  // Cached for the frame: intent() is asked once by update and once by the HUD.
  let liveCache = null;
  const liveChannels = () => liveCache ?? (liveCache = irrigation());

  // --- doing things ----------------------------------------------------------

  function spend(kind) {
    farm.energy = Math.max(0, farm.energy - (COST[kind] ?? 0));
  }

  // The effect of a tool swing, applied at the moment the tool lands.
  function apply(act) {
    const t = tileAt(act.c, act.r);
    if (!t) return;
    switch (act.kind) {
      case 'hoe':
        t.g = 'soil'; t.wet = false; spend('hoe'); say('till'); groundDirty = true; break;
      case 'clear':
        if (t.o === 'weed') t.o = null;
        if (t.crop && t.crop.dead) t.crop = null;
        spend('sickle'); say('reap'); break;
      case 'sickle':
        give('hay'); spend('sickle'); say('reap'); note('+1 HAY'); break;
      case 'axe':
        t.hp--; spend('axe'); say('chop');
        if (t.hp <= 0) { t.o = null; give('wood', WOOD_PER_STUMP); say('pickup'); note(`+${WOOD_PER_STUMP} WOOD`); }
        break;
      case 'hammer':
        t.hp--; spend('hammer'); say('crack');
        if (t.hp <= 0) { t.o = null; give('stone', STONE_PER_ROCK); say('pickup'); note(`+${STONE_PER_ROCK} STONE`); }
        break;
      case 'spade':
        take('stone'); t.g = 'channel'; t.wet = false; spend('spade'); say('till'); groundDirty = true; liveCache = null; break;
      case 'unspade':
        t.g = 'grass'; give('stone'); spend('spade'); say('till'); groundDirty = true; liveCache = null; break;
      case 'can': {
        const spec = canSpec();
        const [dc, dr] = DIRS[farm.player.dir];
        // The copper can waters the tile in front and the two beside it.
        const targets = spec.spread === 1 ? [[act.c, act.r]] : [[act.c, act.r], [act.c + dr, act.r + dc], [act.c - dr, act.r - dc]];
        let poured = 0;
        for (const [c, r] of targets) {
          const tile = tileAt(c, r);
          if (tile && tile.g === 'soil' && !tile.wet && farm.water > 0) { tile.wet = true; farm.water--; poured++; }
        }
        if (poured) { spend('can'); say('sprinkle'); groundDirty = true; }
        break;
      }
      case 'fill':
        farm.water = canSpec().cap; say('dip'); break;
      case 'seed':
        take(`seed:${farm.seed}`);
        t.crop = { id: farm.seed, age: 0, dead: false };
        spend('seed'); say('sow');
        if (count(`seed:${farm.seed}`) <= 0) { note(`OUT OF ${CROPS[farm.seed].name} SEEDS`); farm.hand = 'hoe'; }
        break;
      case 'harvest': {
        const crop = CROPS[t.crop.id];
        give(t.crop.id, crop.yield ?? 1);
        farm.lifetime.harvested += crop.yield ?? 1;
        if (crop.regrow > 0) t.crop.age = crop.days - crop.regrow;
        else t.crop = null;
        spend('harvest'); say('pickup');
        break;
      }
      case 'sprinkler':
        take('sprinkler'); t.o = 'sprinkler'; spend('sprinkler'); say('till');
        if (count('sprinkler') <= 0) farm.hand = 'hoe';
        break;
      case 'pet':
        act.animal.petted = true;
        act.animal.happy = Math.min(MAX_HAPPY, act.animal.happy + 1);
        game.pets.push({ id: act.animal.id, t: 0 });
        say(ANIMALS[act.animal.kind].sound);
        break;
      case 'collect': {
        const spec = ANIMALS[act.animal.kind];
        act.animal.ready = false;
        act.animal.petted = true;
        give(spec.gives);
        game.pets.push({ id: act.animal.id, t: 0 });
        say('pickup');
        note(`+1 ${GOODS[spec.gives].name} FROM ${act.animal.name}`);
        break;
      }
      default:
        break;
    }
  }

  function eat(id) {
    const food = item(id).food;
    if (!food) return false;
    take(id);
    farm.energy = Math.min(farm.maxEnergy, farm.energy + food);
    farm.food = Math.min(MAX_FOOD, farm.food + food * 2.5);
    say('munch');
    return true;
  }

  function buy(entry) {
    const [kind, what] = entry.id.split(':');
    const owned = () => { say('back'); note('YOU ALREADY HAVE ONE'); return false; };
    if (kind === 'tool') {
      if (what === 'copper' ? farm.tools.can === 2 : farm.tools[what] > 0) return owned();
    }
    if (kind === 'build' && farm.buildings[what]) return owned();
    if (kind === 'animal') {
      const spec = ANIMALS[what];
      if (!farm.buildings[spec.needs]) { say('back'); note(`A ${spec.name} NEEDS THE ${spec.needs.toUpperCase()} FIRST`); return false; }
      const housed = farm.animals.filter((a) => ANIMALS[a.kind].needs === spec.needs).length;
      if (housed >= spec.cap) { say('back'); note(`THE ${spec.needs.toUpperCase()} IS FULL`); return false; }
    }
    if (farm.gold < entry.price) { say('back'); note('NOT ENOUGH GOLD'); return false; }
    if (entry.wood && count('wood') < entry.wood) { say('back'); note(`NEEDS ${entry.wood} WOOD, YOU HAVE ${count('wood')}`); return false; }

    farm.gold -= entry.price;
    if (entry.wood) take('wood', entry.wood);
    switch (kind) {
      case 'seed': give(`seed:${what}`); if (!farm.seed || count(`seed:${farm.seed}`) === 0) farm.seed = what; break;
      case 'item': give(what); break;
      case 'tool':
        if (what === 'copper') { farm.tools.can = 2; farm.water = Math.min(farm.water, CAN[2].cap); } else farm.tools[what] = 1;
        break;
      case 'build':
        farm.buildings[what] = true;
        if (what === 'coop') { farm.tiles[9][3].g = 'coop'; farm.tiles[9][3].o = null; } else {
          for (const [c, r] of [[1, 9], [2, 9], [1, 10], [2, 10]]) { farm.tiles[r][c].g = 'barn'; farm.tiles[r][c].o = null; }
        }
        groundDirty = true;
        say('fanfare');
        break;
      case 'animal': {
        const name = NAMES[farm.names++ % NAMES.length];
        const spot = pastureSpot();
        farm.animals.push({ id: farm.names, kind: what, name, happy: 5, fed: true, petted: false, ready: false, since: 0, c: spot.c, r: spot.r, to: null, t: 0, wait: 1 + random() * 2, face: 1 });
        say(ANIMALS[what].sound);
        note(`${name} THE ${ANIMALS[what].name} JOINS THE FARM`);
        break;
      }
      default: break;
    }
    if (kind !== 'build' && kind !== 'animal') say('coin');
    return true;
  }

  const pasture = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (GLYPH[MAP[r][c]].g === 'pasture') pasture.push({ c, r });
  const pastureSpot = () => pasture[Math.floor(random() * pasture.length)];

  // --- days ------------------------------------------------------------------

  // Rain is decided per calendar day from the seed, not drawn from the running
  // generator, so how much you did yesterday cannot change today's weather.
  function weatherFor(day, seasonIndex, year) {
    if (seasonIndex === WINTER) return 'snow';
    const roll = rng((farm.seed ^ ((year * 4 + seasonIndex) * DAYS + day) * 0x9e3779b1) >>> 0)();
    return roll < SEASONS[seasonIndex].rain ? 'rain' : 'sun';
  }

  // Everything that happens while you are asleep. Returns the lines for the
  // morning's card.
  function endDay({ collapsed = false, quiet = false } = {}) {
    const lines = [];
    let income = 0;

    // The shipping bin is emptied and paid for.
    for (const [id, n] of Object.entries(farm.shipped)) {
      const each = item(id).sells;
      income += each * n;
      if (!quiet) lines.push({ text: `${item(id).name} x${n}`, value: each * n });
    }
    farm.gold += income;
    farm.lifetime.shipped += income;
    farm.shipped = {};

    // The animals eat: grass while there is any, hay otherwise.
    const grazing = farm.season !== WINTER;
    let hungry = 0;
    for (const a of farm.animals) {
      const spec = ANIMALS[a.kind];
      if (grazing) a.fed = true;
      else if (count('hay') > 0) { take('hay'); a.fed = true; } else { a.fed = false; hungry++; }
      a.happy = clamp(a.happy + (a.fed ? 1 : -2) + (a.petted ? 1 : 0), 0, MAX_HAPPY);
      a.petted = false;
      a.since++;
      if (a.fed && a.happy >= HAPPY_TO_PRODUCE && a.since >= spec.every && !a.ready) { a.ready = true; a.since = 0; }
    }
    if (hungry && !quiet) lines.push({ text: `${hungry} ANIMAL${hungry === 1 ? '' : 'S'} WENT HUNGRY`, value: null });

    // The calendar turns.
    const wasSeason = farm.season;
    farm.day++;
    farm.lifetime.days++;
    if (farm.day > DAYS) {
      farm.day = 1;
      farm.season = (farm.season + 1) % 4;
      if (farm.season === 0) {
        farm.year++;
        const name = farm.year - 1 < 10 ? `YR${farm.year - 1}` : `Y${farm.year - 1}`;
        if (table.placing(GAME, farm.lifetime.shipped) > 0) table.record(GAME, name, farm.lifetime.shipped);
      }
    }
    farm.weather = weatherFor(farm.day, farm.season, farm.year);

    // The crops grow, or die with the season, and the ground dries out unless
    // it rained or the channels reach it.
    const live = irrigation();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = farm.tiles[r][c];
        if (t.crop && !t.crop.dead) {
          if (t.wet || farm.weather === 'rain') t.crop.age++;
          if (CROPS[t.crop.id].season !== farm.season) t.crop.dead = true;
        }
        if (t.g !== 'soil') continue;
        t.wet = farm.weather === 'rain';
        if (!t.wet) {
          for (const [dc, dr] of Object.values(DIRS)) if (wetBy(c + dc, r + dr, live)) t.wet = true;
        }
      }
    }
    // Sprinklers, after the channels: one has to be fed by a live channel.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (farm.tiles[r][c].o !== 'sprinkler') continue;
        const fed = Object.values(DIRS).some(([dc, dr]) => wetBy(c + dc, r + dr, live));
        if (!fed) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const t = tileAt(c + dc, r + dr);
            if (t && t.g === 'soil') t.wet = true;
          }
        }
      }
    }

    // You.
    farm.food = Math.max(0, farm.food - FOOD_OVERNIGHT);
    const wake = collapsed ? COLLAPSE_WAKE : farm.food < HUNGRY ? TIRED_WAKE : farm.maxEnergy;
    farm.energy = wake;
    farm.clock = WAKE;
    if (!quiet) {
      if (collapsed) lines.push({ text: 'YOU COLLAPSED. WREN CARRIED YOU HOME.', value: null });
      else if (farm.food < HUNGRY) lines.push({ text: 'YOU WENT TO BED HUNGRY.', value: null });
    }

    farm.player = { ...START };
    game.move = null;
    game.act = null;
    game.pressA = false;
    liveCache = null;
    groundDirty = true;
    return { lines, income, newSeason: farm.season !== wasSeason };
  }

  // Sleeping through winter is a loop of ordinary days with you fed by the
  // bag, then by Wren, then not at all. Produce goes straight to the bin.
  function skipWinter() {
    let days = 0;
    let bread = 0;
    let meals = 0;
    let income = 0;
    while (farm.season === WINTER && days < DAYS) {
      // Ship whatever the animals gave.
      for (const a of farm.animals) {
        if (a.ready) { const gives = ANIMALS[a.kind].gives; farm.shipped[gives] = (farm.shipped[gives] ?? 0) + 1; a.ready = false; }
      }
      // Eat the cheapest thing in the bag, or buy bread.
      const edible = Object.keys(farm.bag).filter((id) => item(id).food).sort((a, b) => item(a).sells - item(b).sells);
      if (edible.length) { take(edible[0]); farm.food = MAX_FOOD; meals++; } else if (farm.gold >= BREAD) { farm.gold -= BREAD; farm.food = MAX_FOOD; bread++; } else farm.food = 0;
      const before = farm.gold;
      endDay({ quiet: true });
      income += farm.gold - before;
      days++;
    }
    const lines = [
      { text: `${days} DAYS OF SNOW`, value: null },
      { text: 'ANIMAL PRODUCE SHIPPED', value: income },
    ];
    if (meals) lines.push({ text: `${meals} MEALS FROM THE BAG`, value: null });
    if (bread) lines.push({ text: `BREAD FROM WREN x${bread}`, value: -bread * BREAD });
    if (farm.food <= 0) lines.push({ text: 'YOU ARRIVE IN SPRING THIN AND TIRED.', value: null });
    return { lines, income, newSeason: true };
  }

  // The night: fade down, the card, the season if it turned, fade up. One
  // timeline, driven by update(), drawn by nightScreen().
  function sleep(how) {
    game.night = { phase: 'dusk', t: 0, how, lines: [], income: 0, newSeason: false, days: 0 };
    go('night');
    say('snooze');
  }

  function advanceNight(dt, frame) {
    const n = game.night;
    n.t += dt;
    switch (n.phase) {
      case 'dusk':
        if (n.t < 1.1) break;
        if (n.how === 'winter') { n.phase = 'winter'; n.t = 0; break; }
        Object.assign(n, endDay({ collapsed: n.how === 'collapse' }));
        save();
        n.phase = 'card'; n.t = 0;
        break;
      case 'winter':
        // The montage counts the days up while the work has already been done
        // -- it is a picture of a simulation that ran in a millisecond.
        if (n.t >= 3.6) {
          Object.assign(n, skipWinter());
          save();
          n.phase = 'card'; n.t = 0;
        }
        break;
      case 'card': {
        const shown = Math.min(n.lines.length + 1, Math.floor(n.t / 0.28));
        if (shown > (n.shown ?? 0)) { n.shown = shown; if (shown <= n.lines.length && n.lines[shown - 1].value) say('coin'); }
        if (n.t > 0.6 && (frame.pressed.a || frame.pressed.start || frame.pressed.b)) {
          n.phase = n.newSeason ? 'season' : 'dawn';
          n.t = 0;
          if (n.phase === 'season') say('bell');
        }
        break;
      }
      case 'season':
        if (n.t >= 2.0) { n.phase = 'dawn'; n.t = 0; }
        break;
      case 'dawn':
        if (n.t >= 1.0) {
          game.night = null;
          game.card = 0.0001;
          say('rooster');
          go('play');
        }
        break;
      default:
        throw new Error(`unknown night phase: ${n.phase}`);
    }
  }

  // --- the step --------------------------------------------------------------

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }
  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function walk(dt, frame) {
    const p = farm.player;
    if (game.move) {
      game.move.t += dt;
      if (game.move.t >= STEP_TIME) {
        p.c = game.move.c; p.r = game.move.r;
        game.move = null;
      } else return;
    }
    const want = Object.keys(DIRS).find((d) => frame[d]);
    if (!want) { game.held = 0; return; }
    if (want !== p.dir) { p.dir = want; game.held = 0; return; }
    game.held += dt;
    if (game.held < TURN_DELAY) return;
    const [dc, dr] = DIRS[want];
    if (!walkable(p.c + dc, p.r + dr)) return;
    game.move = { from: { c: p.c, r: p.r }, c: p.c + dc, r: p.r + dr, t: 0 };
  }

  function wander(dt) {
    for (const a of farm.animals) {
      if (a.to) {
        a.t += dt;
        if (a.t >= 0.5) { a.c = a.to.c; a.r = a.to.r; a.to = null; a.wait = 1.2 + random() * 2.4; }
        continue;
      }
      a.wait -= dt;
      if (a.wait > 0) continue;
      // An animal with the farmer beside it stays put: it has come over to be
      // petted, and a hen that steps away as you reach for her is no fun.
      const p = farm.player;
      if (Math.abs(p.c - a.c) + Math.abs(p.r - a.r) === 1) { a.wait = 0.5; continue; }
      const dirs = Object.values(DIRS).filter(([dc, dr]) => {
        const t = tileAt(a.c + dc, a.r + dr);
        return t && t.g === 'pasture' && !animalAt(a.c + dc, a.r + dr) && !(farm.player.c === a.c + dc && farm.player.r === a.r + dr);
      });
      if (!dirs.length) { a.wait = 1; continue; }
      const [dc, dr] = dirs[Math.floor(random() * dirs.length)];
      a.to = { c: a.c + dc, r: a.r + dr };
      a.t = 0;
      if (dc !== 0) a.face = dc;
    }
  }

  function play(dt, frame) {
    liveCache = null;
    game.t += dt;
    if (game.card > 0) game.card += dt;
    if (game.card > 2.8) game.card = 0;
    if (game.handBump > 0) game.handBump = Math.max(0, game.handBump - dt);
    if (game.note) { game.note.left -= dt; if (game.note.left <= 0) game.note = null; }
    game.pets = game.pets.filter((h) => (h.t += dt) < 0.8);
    wander(dt);

    // The clock, and the meter it drains.
    farm.clock += dt / MINUTE;
    farm.food = Math.max(0, farm.food - (dt / MINUTE / 60) * FOOD_PER_HOUR);
    if (farm.clock >= COLLAPSE) { sleep('collapse'); return; }

    if (game.act) {
      const a = game.act;
      a.t += dt;
      if (!a.done && a.t >= a.dur * 0.5) { a.done = true; apply(a); }
      if (a.t >= a.dur) game.act = null;
      return; // a swing plays out before the next thing
    }

    if (game.card > 0 && game.card < 1.2) return; // the morning card holds the world a moment

    if (frame.pressed.start) { say('select'); go('paused'); return; }
    if (frame.pressed.select) { say('select'); go('bag'); return; }

    if (frame.pressed.b) {
      const list = hands();
      const at = list.indexOf(farm.hand);
      farm.hand = list[(at + 1) % list.length];
      game.handBump = 0.3;
      say('move');
    }

    // A press that lands mid-step waits for the step to finish, then acts
    // from the tile you arrived on rather than the one you were leaving.
    if (frame.pressed.a) game.pressA = true;
    walk(dt, frame);
    if (game.move) return;

    if (game.pressA) {
      game.pressA = false;
      const what = intent();
      switch (what.kind) {
        case 'none': if (what.label) note(what.label); break;
        case 'sleep':
          say('select');
          game.prompt = {
            title: 'THE BED',
            lines: farm.season === WINTER ? ['NOTHING WILL GROW UNTIL SPRING.', `THE ANIMALS WILL NEED ${farm.animals.length * (DAYS - farm.day + 1)} HAY.`] : ['CALL IT A DAY?'],
            options: farm.season === WINTER ? ['SLEEP UNTIL MORNING', 'SLEEP UNTIL SPRING', 'NOT YET'] : ['SLEEP UNTIL MORNING', 'NOT YET'],
            choose: (i) => {
              if (i === 0) sleep('night');
              else if (i === 1 && farm.season === WINTER) sleep('winter');
              else go('play');
            },
          };
          go('prompt');
          break;
        case 'ship': say('select'); game.qty = 1; go('ship'); break;
        case 'shop': say('talk'); go('shop'); break;
        default:
          game.act = { ...what, t: 0, dur: ACT_TIME[what.kind] ?? 0.35, done: false };
          break;
      }
    }
  }

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    game.elapsed += dt;
    if (farm) game.shownGold += clamp(farm.gold - game.shownGold, -Math.max(20, Math.abs(farm.gold - game.shownGold)) * dt * 4, Math.max(20, Math.abs(farm.gold - game.shownGold)) * dt * 4);

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') { say('select'); game.exit = true; break; }
        if (choice === 'howto') { say('select'); go('howto'); break; }
        if (choice === 'continue') {
          if (load()) { say('select'); go('play'); game.card = 0.0001; game.t = 0; } else { say('back'); note('NO FARM SAVED YET', 1.5); }
          break;
        }
        say('select');
        newFarm();
        game.t = 0;
        game.card = 0.0001;
        go('play');
        break;
      }

      case 'howto':
        if (game.note) { game.note.left -= dt; if (game.note.left <= 0) game.note = null; }
        if (confirmed(any) || any.pressed.b) { say('back'); go(farm ? 'paused' : 'menu'); }
        break;

      case 'play':
        play(dt, any);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('play');
        else if (choice === 'bag') go('bag');
        else if (choice === 'howto') go('howto');
        else { farm = null; go('menu'); }
        break;
      }

      case 'bag': {
        const rows = bagRows();
        if (rows.length) {
          moveCursor(any, rows.length);
          game.top = clamp(game.top, game.cursor - 6, game.cursor);
        }
        if (any.pressed.b || any.pressed.select) { say('back'); go('play'); break; }
        if (!confirmed(any) || !rows.length) break;
        const row = rows[game.cursor];
        if (row.id.startsWith('seed:')) { farm.seed = row.id.slice(5); farm.hand = 'seed'; say('select'); go('play'); }
        else if (row.id === 'sprinkler') { farm.hand = 'sprinkler'; say('select'); go('play'); }
        else if (item(row.id).food) {
          if (farm.food >= MAX_FOOD - 5 && farm.energy >= farm.maxEnergy) { say('back'); note('YOU ARE FULL', 1.2); } else { eat(row.id); game.cursor = Math.min(game.cursor, Math.max(0, bagRows().length - 1)); }
        } else { say('back'); note('SHIP IT AT THE BIN', 1.2); }
        break;
      }

      case 'shop': {
        const rows = shopRows();
        moveCursor(any, rows.length);
        game.top = clamp(game.top, game.cursor - 6, game.cursor);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (confirmed(any)) buy(rows[game.cursor]);
        break;
      }

      case 'ship': {
        const rows = shipRows();
        if (rows.length) {
          const before = game.cursor;
          moveCursor(any, rows.length);
          if (game.cursor !== before) game.qty = 1;
          game.top = clamp(game.top, game.cursor - 6, game.cursor);
          const row = rows[game.cursor];
          if (any.pressed.right) { game.qty = Math.min(row.n, game.qty + 1); say('move'); }
          if (any.pressed.left) { game.qty = Math.max(1, game.qty - 1); say('move'); }
          game.qty = clamp(game.qty, 1, row.n);
          if (confirmed(any)) {
            take(row.id, game.qty);
            farm.shipped[row.id] = (farm.shipped[row.id] ?? 0) + game.qty;
            say('coin');
            game.qty = 1;
            game.cursor = Math.min(game.cursor, Math.max(0, shipRows().length - 1));
          }
        }
        if (any.pressed.b) { say('back'); go('play'); }
        break;
      }

      case 'prompt': {
        const pr = game.prompt;
        moveCursor(any, pr.options.length);
        if (any.pressed.b) { say('back'); game.prompt = null; go('play'); break; }
        if (!confirmed(any)) break;
        const choice = game.cursor;
        say('select');
        game.prompt = null;
        pr.choose(choice);
        break;
      }

      case 'night':
        advanceNight(dt, any);
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
    }
  }

  // Rows for the three lists. Built on demand from the bag, so a list is never
  // out of step with what you have.
  const bagRows = () => Object.entries(farm.bag)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a.startsWith('seed:') ? 0 : 1) - (b.startsWith('seed:') ? 0 : 1) || a.localeCompare(b))
    .map(([id, n]) => ({ id, n, name: item(id).name, tag: id.startsWith('seed:') ? 'HOLD' : item(id).food ? `EAT +${item(id).food}` : id === 'sprinkler' ? 'PLACE' : `${item(id).sells}G` }));

  const shipRows = () => Object.entries(farm.bag)
    .filter(([id, n]) => n > 0 && item(id).sells > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => ({ id, n, name: item(id).name, each: item(id).sells }));

  const shopRows = () => [
    ...Object.entries(CROPS).filter(([, crop]) => crop.season === farm.season)
      .map(([id, crop]) => ({ id: `seed:${id}`, name: `${crop.name} SEEDS`, price: crop.price, desc: `${crop.days} DAYS${crop.regrow ? `, REGROWS IN ${crop.regrow}` : ''}. SELLS ${crop.sells}G` })),
    ...SHOP,
  ];

  // --- drawing: the ground ---------------------------------------------------

  // Two dots of a lighter green per grass tile, from a hash so they never move.
  const tuftAt = (c, r, i) => {
    const h = ((c * 73856093) ^ (r * 19349663) ^ (i * 83492791)) >>> 0;
    return { dx: ((h % 100) / 100 - 0.5) * hw * 1.1, dy: (((h >> 7) % 100) / 100 - 0.5) * hh * 1.1 };
  };

  function paintGround() {
    ground.clear(PALETTE.ink);
    const look = season();
    const live = irrigation();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = farm.tiles[r][c];
        const { x, y } = grid.centre(c, r);
        let base = look.grass;
        if (t.g === 'water') base = PALETTE.water;
        else if (t.g === 'path' || t.g === 'house' || t.g === 'barn' || t.g === 'coop') base = PALETTE.stone;
        else if (t.g === 'pasture') base = look.pasture;
        iso.fill(ground, x, y, hw, hh, base);

        if (t.g === 'soil') {
          iso.fill(ground, x, y, hw - 3, hh - 1.5, t.wet ? PALETTE.barkDim : PALETTE.bark);
          // Furrows: two short bands across the plot, darker when wet.
          const furrow = t.wet ? PALETTE.ink : PALETTE.barkDim;
          for (const dy of [-3, 3]) iso.fill(ground, x + dy * 1.6, y + dy, hw * 0.55, 1.2, furrow);
        } else if (t.g === 'channel') {
          iso.fill(ground, x, y, hw - 6, hh - 3, PALETTE.stoneDim);
          iso.fill(ground, x, y, hw - 11, hh - 5.5, live.has(r * COLS + c) ? PALETTE.waterLit : PALETTE.sandDim);
        } else if ((t.g === 'grass' || t.g === 'pasture') && look.tuft && !t.o) {
          for (let i = 0; i < 2; i++) {
            const { dx, dy } = tuftAt(c, r, i);
            iso.fill(ground, x + dx, y + dy, 3, 1.5, look.tuft);
          }
        } else if (t.g === 'water') {
          iso.fill(ground, x - 4, y - 2, 6, 1.2, PALETTE.waterLit);
        } else if (t.g === 'path') {
          iso.fill(ground, x, y, hw - 2, hh - 1, PALETTE.sandDim);
        }
      }
    }
    groundDirty = false;
  }

  // --- drawing: things with height -------------------------------------------

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

  const heart = (x, y, r, fill) => chain([
    { x: x - r * 0.5, y: y - r * 0.3, r: r * 0.6 },
    { x, y: y + r * 0.8, r: r * 0.14 },
    { x: x + r * 0.5, y: y - r * 0.3, r: r * 0.6 },
  ], fill);

  function treeShapes(x, y, c, r) {
    const look = season();
    const shapes = [rect(x - 3 * u, y - 16 * u, 6 * u, 17 * u, PALETTE.bark)];
    const wind = sway(game.t, 3.1, 1.5 * u, (c * 3 + r) / 10);
    if (!look.canopy) {
      shapes.push(disc(x - 7 * u, y - 15 * u, 4 * u, PALETTE.barkDim), disc(x + 6 * u, y - 18 * u, 4 * u, PALETTE.barkDim));
      shapes.push(disc(x, y - 23 * u, 5 * u, PALETTE.barkDim), disc(x, y - 26 * u, 4 * u, PALETTE.creamLit));
      return shapes;
    }
    const [a, b, blossom] = look.canopy;
    shapes.push(disc(x + wind, y - 25 * u, 11 * u, a));
    shapes.push(disc(x - 9 * u + wind * 0.6, y - 17 * u, 8 * u, b));
    shapes.push(disc(x + 9 * u + wind * 0.6, y - 17 * u, 8 * u, a));
    shapes.push(disc(x - 3 * u + wind, y - 30 * u, 3 * u, blossom));
    return shapes;
  }

  function cropShapes(x, y, t, c, r) {
    const crop = t.crop;
    const def = CROPS[crop.id];
    const wind = sway(game.t, 2.3, 1.2 * u, (c * 7 + r * 3) / 10);
    if (crop.dead) {
      return [chain([{ x, y: y - 1, r: 1.5 * u }, { x: x + 3 * u, y: y - 12 * u, r: 1 * u }], PALETTE.barkDim), disc(x - 5 * u, y - 4 * u, 2.5 * u, PALETTE.barkDim)];
    }
    const stage = crop.age / def.days;
    if (stage < 0.25) {
      return [disc(x - 4 * u, y - 1, 1.6 * u, PALETTE.barkLit), disc(x + 3 * u, y - 3 * u, 1.6 * u, PALETTE.barkLit), disc(x, y + 2 * u, 1.6 * u, PALETTE.barkLit)];
    }
    if (stage < 0.5) {
      return [chain([{ x, y: y - 1, r: 1.2 * u }, { x: x + wind, y: y - 8 * u, r: 1.2 * u }], def.leaf), disc(x + wind, y - 9 * u, 3 * u, def.leaf)];
    }
    if (!ripe(crop)) {
      return [
        chain([{ x, y: y - 1, r: 1.4 * u }, { x: x + wind, y: y - 12 * u, r: 1.4 * u }], def.leaf),
        disc(x - 5 * u + wind * 0.5, y - 9 * u, 4 * u, def.leaf), disc(x + 5 * u + wind * 0.5, y - 11 * u, 4 * u, def.leaf), disc(x + wind, y - 14 * u, 3.5 * u, def.leaf),
      ];
    }
    const glint = cycle(game.t, 1.7, (c * 5 + r * 11) / 13) < 0.16 ? [disc(x + 9 * u, y - 20 * u, 2 * u, PALETTE.sunLit)] : [];
    switch (def.form) {
      case 'root':
        return [disc(x - 5 * u + wind, y - 10 * u, 4.5 * u, def.leaf), disc(x + 5 * u + wind, y - 11 * u, 4.5 * u, def.leaf), disc(x + wind, y - 14 * u, 4 * u, def.leaf),
          disc(x, y - 3 * u, 4 * u, def.fruit), ...glint];
      case 'bush':
        return [disc(x - 6 * u, y - 7 * u, 5 * u, def.leaf), disc(x + 6 * u, y - 7 * u, 5 * u, def.leaf), disc(x + wind, y - 12 * u, 5.5 * u, def.leaf),
          disc(x - 5 * u, y - 10 * u, 2.6 * u, def.fruit), disc(x + 5 * u + wind, y - 13 * u, 2.6 * u, def.fruit), disc(x + 1 * u, y - 5 * u, 2.6 * u, def.fruit), ...glint];
      case 'stalk':
        return [chain([{ x, y: y - 1, r: 1.8 * u }, { x: x + wind, y: y - 24 * u, r: 1.4 * u }], def.leaf),
          chain([{ x: x - 1 * u, y: y - 10 * u, r: 1.2 * u }, { x: x - 8 * u + wind, y: y - 16 * u, r: 1 * u }], def.leaf),
          chain([{ x: x + 1 * u, y: y - 14 * u, r: 1.2 * u }, { x: x + 8 * u + wind, y: y - 20 * u, r: 1 * u }], def.leaf),
          rect(x + 2 * u + wind * 0.5, y - 17 * u, 4 * u, 8 * u, def.fruit), ...glint];
      case 'vine':
        return [disc(x - 8 * u, y - 4 * u, 5 * u, def.leaf), disc(x + 7 * u, y - 8 * u, 5 * u, def.leaf), disc(x - 2 * u + wind, y - 11 * u, 4.5 * u, def.leaf),
          disc(x + 3 * u, y - 3 * u, 6.5 * u, def.fruit), disc(x + 3 * u, y - 6 * u, 3 * u, def.fruit), ...glint];
      case 'head':
        return [disc(x - 8 * u, y - 4 * u, 5 * u, def.leaf), disc(x + 8 * u, y - 4 * u, 5 * u, def.leaf), disc(x, y - 6 * u, 7.5 * u, def.fruit), disc(x - 2 * u, y - 8 * u, 3.5 * u, def.leaf), ...glint];
      default:
        return [];
    }
  }

  function propShapes(t, x, y, c, r) {
    switch (t.o) {
      case 'tree': return treeShapes(x, y, c, r);
      case 'rock': return [disc(x, y - 3 * u, 8 * u, PALETTE.stone), disc(x + 4 * u, y - 6 * u, 4.5 * u, PALETTE.stoneLit)];
      case 'stump': return [disc(x, y - 1 * u, 8 * u, PALETTE.bark), disc(x, y - 4 * u, 5.5 * u, PALETTE.barkLit), disc(x, y - 4 * u, 2 * u, PALETTE.bark)];
      case 'weed': {
        const wind = sway(game.t, 1.9, 1.2 * u, (c + r * 2) / 7);
        const stalk = farm.season === WINTER ? PALETTE.stoneDim : PALETTE.mossDim;
        const head = farm.season === WINTER ? PALETTE.stoneLit : farm.season === 2 ? PALETTE.sunDim : PALETTE.moss;
        return [
          chain([{ x: x - 5 * u, y: y - 1, r: 1 * u }, { x: x - 7 * u + wind, y: y - 8 * u, r: 1 * u }], stalk),
          chain([{ x, y: y - 1, r: 1 * u }, { x: x + wind, y: y - 11 * u, r: 1 * u }], stalk),
          chain([{ x: x + 5 * u, y: y - 1, r: 1 * u }, { x: x + 7 * u + wind, y: y - 8 * u, r: 1 * u }], stalk),
          disc(x - 7 * u + wind, y - 9 * u, 2.5 * u, head), disc(x + wind, y - 12 * u, 2.5 * u, head), disc(x + 7 * u + wind, y - 9 * u, 2.5 * u, head),
        ];
      }
      case 'bin': return [rect(x - 11 * u, y - 14 * u, 22 * u, 15 * u, PALETTE.bark), rect(x - 12 * u, y - 18 * u, 24 * u, 5 * u, PALETTE.barkLit), rect(x - 3 * u, y - 10 * u, 6 * u, 3 * u, PALETTE.barkDim)];
      case 'stall': {
        const bob = hop(game.t, 1.4, 1.5 * u);
        return [
          rect(x - 17 * u, y - 14 * u, 34 * u, 15 * u, PALETTE.barkLit),
          rect(x - 20 * u, y - 34 * u, 3 * u, 22 * u, PALETTE.barkDim), rect(x + 17 * u, y - 34 * u, 3 * u, 22 * u, PALETTE.barkDim),
          rect(x - 22 * u, y - 38 * u, 44 * u, 8 * u, PALETTE.rose),
          rect(x - 16 * u, y - 38 * u, 6 * u, 8 * u, PALETTE.cream), rect(x - 4 * u, y - 38 * u, 6 * u, 8 * u, PALETTE.cream), rect(x + 8 * u, y - 38 * u, 6 * u, 8 * u, PALETTE.cream),
          disc(x + 4 * u, y - 22 * u - bob, 6 * u, PALETTE.sky), disc(x + 9 * u, y - 25 * u - bob, 3.5 * u, PALETTE.sky), rect(x + 12 * u, y - 26 * u - bob, 4 * u, 2 * u, PALETTE.sun),
        ];
      }
      case 'fence': {
        // A post, and a rail to the next post along the line.
        const shapes = [rect(x - 2 * u, y - 14 * u, 4 * u, 16 * u, PALETTE.barkLit)];
        for (const [dc, dr] of [[0, 1], [1, 0]]) {
          const next = tileAt(c + dc, r + dr);
          if (!next || next.o !== 'fence') continue;
          const to = grid.centre(c + dc, r + dr);
          shapes.push(chain([{ x, y: y - 10 * u, r: 1.6 * u }, { x: to.x, y: to.y - 10 * u, r: 1.6 * u }], PALETTE.barkLit));
        }
        return shapes;
      }
      case 'sprinkler': return [disc(x, y - 2 * u, 4.5 * u, PALETTE.stoneDim), rect(x - 1.5 * u, y - 12 * u, 3 * u, 10 * u, PALETTE.stone), disc(x, y - 13 * u, 3 * u, PALETTE.sky)];
      case 'sign': return [rect(x - 1.5 * u, y - 12 * u, 3 * u, 12 * u, PALETTE.barkDim), rect(x - 8 * u, y - 19 * u, 16 * u, 9 * u, PALETTE.cream), rect(x - 5 * u, y - 16 * u, 10 * u, 3 * u, PALETTE.barkDim)];
      default: return [];
    }
  }

  // The buildings are drawn from the centre of their footprint.
  function houseShapes() {
    const a = grid.centre(1, 1);
    const b = grid.centre(2, 2);
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2 + hh;
    const night = farm.clock >= DUSK || farm.clock < WAKE;
    const smoke = farm.clock < 10 * 60
      ? [0, 1, 2].map((i) => { const p = cycle(game.t, 2.4, i / 3); return disc(x + 26 * u + sway(game.t, 1.7, 3 * u, i / 3), y - 62 * u - p * 22 * u, (4 - p * 3) * u, PALETTE.creamDim); })
      : [];
    return [
      ...smoke,
      rect(x - 34 * u, y - 36 * u, 68 * u, 34 * u, PALETTE.cream),
      rect(x + 22 * u, y - 56 * u, 8 * u, 18 * u, PALETTE.stoneDim),
      rect(x - 38 * u, y - 46 * u, 76 * u, 12 * u, PALETTE.ember),
      chain([{ x: x - 30 * u, y: y - 46 * u, r: 3 * u }, { x, y: y - 58 * u, r: 3 * u }, { x: x + 30 * u, y: y - 46 * u, r: 3 * u }], PALETTE.ember),
      rect(x - 6 * u, y - 22 * u, 12 * u, 20 * u, PALETTE.barkDim),
      rect(x + 12 * u, y - 30 * u, 10 * u, 10 * u, night ? PALETTE.sun : PALETTE.sky),
      rect(x - 24 * u, y - 30 * u, 10 * u, 10 * u, night ? PALETTE.sun : PALETTE.sky),
    ];
  }

  function barnShapes() {
    const a = grid.centre(1, 9);
    const b = grid.centre(2, 10);
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2 + hh;
    return [
      rect(x - 34 * u, y - 36 * u, 68 * u, 34 * u, PALETTE.ember),
      rect(x - 38 * u, y - 44 * u, 76 * u, 10 * u, PALETTE.emberDim),
      chain([{ x: x - 28 * u, y: y - 44 * u, r: 3 * u }, { x, y: y - 56 * u, r: 3 * u }, { x: x + 28 * u, y: y - 44 * u, r: 3 * u }], PALETTE.emberDim),
      rect(x - 10 * u, y - 26 * u, 20 * u, 24 * u, PALETTE.barkDim),
      rect(x - 10 * u, y - 26 * u, 20 * u, 3 * u, PALETTE.cream), rect(x - 1.5 * u, y - 26 * u, 3 * u, 24 * u, PALETTE.cream),
      rect(x - 28 * u, y - 30 * u, 8 * u, 8 * u, PALETTE.cream), rect(x + 20 * u, y - 30 * u, 8 * u, 8 * u, PALETTE.cream),
    ];
  }

  function coopShapes() {
    const { x, y: cy } = grid.centre(3, 9);
    const y = cy + hh * 0.5;
    return [
      rect(x - 14 * u, y - 22 * u, 28 * u, 20 * u, PALETTE.sun),
      chain([{ x: x - 17 * u, y: y - 22 * u, r: 2.5 * u }, { x, y: y - 32 * u, r: 2.5 * u }, { x: x + 17 * u, y: y - 22 * u, r: 2.5 * u }], PALETTE.bark),
      rect(x - 4 * u, y - 12 * u, 8 * u, 10 * u, PALETTE.barkDim),
      rect(x + 5 * u, y - 18 * u, 5 * u, 5 * u, PALETTE.sky),
    ];
  }

  function animalShapes(a) {
    const spec = ANIMALS[a.kind];
    const from = grid.centre(a.c, a.r);
    let x = from.x;
    let y = from.y;
    if (a.to) {
      const to = grid.centre(a.to.c, a.to.r);
      const p = a.t / 0.5;
      x = lerp(from.x, to.x, p);
      y = lerp(from.y, to.y, p) - hop(p, 1, 2 * u);
    }
    const f = a.face;
    const petted = game.pets.find((h) => h.id === a.id);
    const bump = petted ? hop(petted.t, 0.8, 4 * u) : 0;
    y -= bump;
    const shapes = [];
    switch (a.kind) {
      case 'chicken':
        shapes.push(rect(x - 1 * u - 2 * u, y - 2 * u, 2 * u, 3 * u, PALETTE.sun), rect(x + 1 * u, y - 2 * u, 2 * u, 3 * u, PALETTE.sun));
        shapes.push(disc(x, y - 6 * u, 5 * u, PALETTE.cream), disc(x + f * 4 * u, y - 10 * u, 3.2 * u, PALETTE.cream));
        shapes.push(disc(x + f * 4 * u, y - 13 * u, 1.6 * u, PALETTE.ember), rect(x + f * 6 * u + (f > 0 ? 0 : -3 * u), y - 10.5 * u, 3 * u, 2 * u, PALETTE.sun));
        shapes.push(disc(x - f * 5 * u, y - 7 * u, 2.5 * u, PALETTE.creamDim));
        break;
      case 'cow':
        shapes.push(rect(x - 9 * u, y - 4 * u, 3 * u, 5 * u, PALETTE.barkDim), rect(x + 6 * u, y - 4 * u, 3 * u, 5 * u, PALETTE.barkDim));
        shapes.push(rect(x - 11 * u, y - 14 * u, 22 * u, 11 * u, PALETTE.cream));
        shapes.push(disc(x - 4 * u, y - 10 * u, 3 * u, PALETTE.stoneDim), disc(x + 5 * u, y - 7 * u, 2.5 * u, PALETTE.stoneDim));
        shapes.push(disc(x + f * 11 * u, y - 13 * u, 4.5 * u, PALETTE.cream), disc(x + f * 12 * u, y - 11 * u, 2.5 * u, PALETTE.rose));
        shapes.push(disc(x + f * 9 * u, y - 17 * u, 1.6 * u, PALETTE.barkDim), disc(x + f * 13 * u, y - 17 * u, 1.6 * u, PALETTE.barkDim));
        break;
      case 'sheep':
        shapes.push(rect(x - 8 * u, y - 4 * u, 3 * u, 5 * u, PALETTE.barkDim), rect(x + 5 * u, y - 4 * u, 3 * u, 5 * u, PALETTE.barkDim));
        shapes.push(disc(x - 5 * u, y - 10 * u, 6 * u, PALETTE.creamLit), disc(x + 4 * u, y - 10 * u, 6 * u, PALETTE.creamLit), disc(x, y - 13 * u, 6 * u, PALETTE.creamLit));
        shapes.push(disc(x + f * 10 * u, y - 12 * u, 3.5 * u, PALETTE.stoneDim), disc(x + f * 9 * u, y - 16 * u, 2.5 * u, PALETTE.creamLit));
        break;
      default: break;
    }
    if (a.ready) {
      const bob = hop(game.t, 1.2, 2 * u);
      const gives = spec.gives;
      if (gives === 'egg') shapes.push(disc(x, y - 24 * u - bob, 3.5 * u, PALETTE.cream));
      else if (gives === 'milk') shapes.push(rect(x - 3 * u, y - 27 * u - bob, 6 * u, 7 * u, PALETTE.sky));
      else shapes.push(disc(x, y - 24 * u - bob, 4 * u, PALETTE.creamLit));
    }
    if (petted) shapes.push(heart(x + 6 * u, y - 24 * u - petted.t * 14 * u, 4 * u, PALETTE.rose));
    return shapes;
  }

  // The farmer, and whatever they are swinging.
  function playerShapes() {
    const p = farm.player;
    const from = grid.centre(p.c, p.r);
    let x = from.x;
    let y = from.y;
    let bob = 0;
    if (game.move) {
      const to = grid.centre(game.move.c, game.move.r);
      const t = game.move.t / STEP_TIME;
      x = lerp(from.x, to.x, t);
      y = lerp(from.y, to.y, t);
      bob = hop(t, 1, 1.5 * u);
    }
    const [dc, dr] = DIRS[p.dir];
    const fx = (dc - dr) * 0.89;
    const fy = (dc + dr) * 0.45;
    const act = game.act;
    const through = act ? clamp(act.t / act.dur, 0, 1) : 0;

    const shapes = [
      rect(x - 6 * u, y - 4 * u, 5 * u, 5 * u + (game.move ? bob : 0), PALETTE.barkDim),
      rect(x + 1 * u, y - 4 * u, 5 * u, 5 * u + (game.move ? 1.5 * u - bob : 0), PALETTE.barkDim),
      rect(x - 6.5 * u, y - 16 * u - bob, 13 * u, 13 * u, PALETTE.sky),
      rect(x - 6.5 * u, y - 16 * u - bob, 13 * u, 4 * u, PALETTE.ember),
      disc(x, y - 21 * u - bob, 6 * u, PALETTE.cream),
      disc(x + fx * 3 * u, y - 21 * u - bob + fy * 3 * u, 1.6 * u, PALETTE.barkDim),
      disc(x, y - 25 * u - bob, 6.5 * u, PALETTE.sun),
      rect(x - 10 * u, y - 24 * u - bob, 20 * u, 3 * u, PALETTE.sunDim),
    ];

    // Arms up for a harvest, with the pick held over the head.
    if (act && act.kind === 'harvest' && act.done) {
      const t = tileAt(act.c, act.r);
      const def = CROPS[t?.crop?.id ?? (Object.keys(CROPS).find((id) => count(id) > 0) ?? 'turnip')];
      const lift = easeOut(clamp((through - 0.5) * 2, 0, 1));
      shapes.push(rect(x - 9 * u, y - 24 * u - lift * 6 * u, 3 * u, 10 * u, PALETTE.sky), rect(x + 6 * u, y - 24 * u - lift * 6 * u, 3 * u, 10 * u, PALETTE.sky));
      shapes.push(disc(x, y - 34 * u - lift * 8 * u, 5 * u, def.fruit));
      shapes.push(disc(x - 8 * u, y - 40 * u - lift * 6 * u, 1.6 * u, PALETTE.sunLit), disc(x + 9 * u, y - 36 * u - lift * 10 * u, 1.6 * u, PALETTE.sunLit));
      return shapes;
    }

    // The tool, at rest or mid-swing. Swings go from raised behind to landed on
    // the tile in front; the can tips forward instead.
    const hand = act && act.kind !== 'pet' && act.kind !== 'collect' ? act.kind : farm.hand;
    const tool = hand === 'clear' ? farm.hand : hand;
    const swing = act && ['hoe', 'axe', 'hammer', 'sickle', 'spade', 'clear'].includes(act.kind) ? Math.sin(through * Math.PI) : 0;
    const reach = (0.35 + swing * 0.9) * hw;
    const rise = (1 - swing) * 14 * u;
    const gx = x + fx * 5 * u;
    const gy = y - 12 * u - bob;
    const tx = gx + fx * reach;
    const ty = gy - rise + fy * reach * 0.5 + swing * 6 * u;
    const handle = (head, r = 1.4 * u) => chain([{ x: gx, y: gy, r }, { x: tx, y: ty, r }], head);
    switch (tool) {
      case 'hoe': shapes.push(handle(PALETTE.barkLit), rect(tx - 3 * u, ty - 1 * u, 6 * u, 3 * u, PALETTE.stone)); break;
      case 'axe': shapes.push(handle(PALETTE.barkLit), rect(tx - 2 * u, ty - 4 * u, 5 * u, 6 * u, PALETTE.stoneLit)); break;
      case 'hammer': shapes.push(handle(PALETTE.barkLit), rect(tx - 4 * u, ty - 3 * u, 8 * u, 5 * u, PALETTE.stoneDim)); break;
      case 'spade': shapes.push(handle(PALETTE.barkLit), rect(tx - 2.5 * u, ty - 2 * u, 5 * u, 7 * u, PALETTE.stone)); break;
      case 'sickle': shapes.push(handle(PALETTE.barkLit, 1.2 * u), chain([{ x: tx, y: ty, r: 1.4 * u }, { x: tx + fx * 5 * u, y: ty - 4 * u, r: 1.2 * u }, { x: tx + fx * 2 * u, y: ty - 8 * u, r: 1 * u }], PALETTE.stoneLit)); break;
      case 'can': case 'fill': {
        const tip = act && act.kind === 'can' ? Math.sin(through * Math.PI) : 0;
        const cx = gx + fx * 6 * u;
        const cy = gy - 2 * u - tip * 4 * u;
        shapes.push(rect(cx - 4 * u, cy - 3 * u, 8 * u, 7 * u, PALETTE.sky), rect(cx + fx * 5 * u - 1.5 * u, cy - 5 * u + tip * 4 * u, 3 * u, 5 * u, PALETTE.skyDim));
        if (tip > 0.2) {
          const target = grid.centre(act.c, act.r);
          for (let i = 0; i < 4; i++) {
            const p = ((through * 2.2 + i * 0.25) % 1);
            shapes.push(disc(lerp(cx, target.x, p), lerp(cy, target.y, p) - Math.sin(p * Math.PI) * 8 * u, 1.6 * u, PALETTE.skyLit));
          }
        }
        break;
      }
      case 'seed': {
        shapes.push(rect(gx + fx * 4 * u - 3 * u, gy - 3 * u, 6 * u, 7 * u, PALETTE.creamDim), rect(gx + fx * 4 * u - 2 * u, gy - 1 * u, 4 * u, 3 * u, CROPS[farm.seed].fruit));
        if (act && act.kind === 'seed' && through > 0.3) {
          const target = grid.centre(act.c, act.r);
          for (let i = 0; i < 3; i++) {
            const p = clamp((through - 0.3) / 0.6 + i * 0.12, 0, 1);
            shapes.push(disc(lerp(gx, target.x + (i - 1) * 5 * u, p), lerp(gy, target.y, p) - Math.sin(p * Math.PI) * 10 * u, 1.4 * u, PALETTE.barkLit));
          }
        }
        break;
      }
      case 'sprinkler': shapes.push(disc(gx + fx * 5 * u, gy - 2 * u, 3.5 * u, PALETTE.stone), disc(gx + fx * 5 * u, gy - 6 * u, 2.5 * u, PALETTE.sky)); break;
      default: break;
    }
    return shapes;
  }

  // Dust, chips and splinters where a tool landed.
  function impactShapes() {
    const act = game.act;
    if (!act || !act.done) return [];
    const colours = { hoe: PALETTE.bark, clear: PALETTE.mossDim, sickle: PALETTE.mossLit, axe: PALETTE.barkLit, hammer: PALETTE.stoneLit, spade: PALETTE.barkDim, unspade: PALETTE.barkDim, sprinkler: PALETTE.stone };
    const colour = colours[act.kind];
    if (!colour) return [];
    const p = clamp((act.t - act.dur * 0.5) / (act.dur * 0.5), 0, 1);
    const { x, y } = grid.centre(act.c, act.r);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const angle = i * 1.7 + 0.5;
      out.push(disc(x + Math.cos(angle) * (4 + p * 12) * u, y - 3 * u + Math.sin(angle) * (2 + p * 5) * u - p * 8 * u, Math.max(0.6, (3 - p * 2.6)) * u, colour));
    }
    return out;
  }

  // Everything standing on the ground, sorted into diagonal bands so nearer
  // things draw over further ones. Each band is its own inked layer: a thing
  // in front keeps its outline over the thing behind, and two things side by
  // side in the same band weld, which is the house style.
  function worldLayers() {
    const bands = Array.from({ length: COLS + ROWS - 1 }, () => []);
    const put = (c, r, shapes) => { if (shapes.length) bands[c + r].push(...shapes); };

    put(2, 2, houseShapes());
    if (farm.buildings.barn) put(2, 10, barnShapes());
    if (farm.buildings.coop) put(3, 9, coopShapes());

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = farm.tiles[r][c];
        const { x, y } = grid.centre(c, r);
        if (t.o) put(c, r, propShapes(t, x, y, c, r));
        if (t.crop) put(c, r, cropShapes(x, y, t, c, r));
      }
    }
    for (const a of farm.animals) {
      const c = a.to && a.t > 0.25 ? a.to.c : a.c;
      const r = a.to && a.t > 0.25 ? a.to.r : a.r;
      put(c, r, animalShapes(a));
    }
    {
      const p = farm.player;
      const c = game.move && game.move.t > STEP_TIME / 2 ? game.move.c : p.c;
      const r = game.move && game.move.t > STEP_TIME / 2 ? game.move.r : p.r;
      put(c, r, playerShapes());
      if (game.act) put(game.act.c, game.act.r, impactShapes());
    }
    return bands.filter((b) => b.length).map((shapes) => ({ ink: 3, shapes }));
  }

  // Marks painted flat on the ground before anything stands on it: the ripples,
  // and the cursor on the tile the farmer is facing.
  function groundDecals() {
    const shapes = [];
    const live = liveChannels();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = farm.tiles[r][c];
        if (t.g !== 'water' && !(t.g === 'channel' && live.has(r * COLS + c))) continue;
        const { x, y } = grid.centre(c, r);
        const p = cycle(game.t, 2.6, (c * 3 + r * 5) / 8);
        const w = t.g === 'water' ? 7 * u : 3 * u;
        shapes.push(rect(x - w + sway(game.t, 2.6, 4 * u, (c + r) / 8), y - 2 * u + (p - 0.5) * (t.g === 'water' ? 8 * u : 3 * u), w * 2, 2 * u, PALETTE.waterLit));
      }
    }
    if (game.screen === 'play' || game.screen === 'prompt') {
      const { c, r } = facing();
      if (grid.inside(c, r)) {
        const { x, y } = grid.centre(c, r);
        const what = intent();
        shapes.push(iso.outline(x, y, hw - 2, hh - 1, 1.5 * u, what.kind === 'none' ? PALETTE.creamDim : PALETTE.sun));
      }
    }
    return { flat: true, shapes };
  }

  // Rain and snow live in a hash of time, so a frame is still a pure function
  // of the step count.
  function weatherLayer() {
    const shapes = [];
    if (farm.weather === 'sun') return null;
    const n = farm.weather === 'rain' ? 60 : 40;
    for (let i = 0; i < n; i++) {
      const h = ((i * 2654435761) >>> 0) / 4294967296;
      const speed = farm.weather === 'rain' ? 0.7 : 4.5;
      const p = cycle(game.t, speed, h * 7);
      const x = court.x + (((i * 40503 + 12345) % 1000) / 1000) * court.w + (farm.weather === 'snow' ? sway(game.t, 2 + h, 6, h) : 0);
      const y = court.y + HUD_H + p * (court.h - HUD_H);
      if (farm.weather === 'rain') shapes.push(chain([{ x, y, r: 1 }, { x: x - 3, y: y + 12, r: 1 }], PALETTE.skyLit));
      else shapes.push(disc(x, y, 1.5 + (i % 3) * 0.5, PALETTE.creamLit));
    }
    return { flat: true, shapes };
  }

  // Dusk and night are the same ink veil, dithered. Nothing else here fades.
  const veilAlpha = () => {
    const c = farm.clock;
    if (c >= NIGHTFALL) return 0.5;
    if (c >= DUSK) return 0.22 + 0.28 * ((c - DUSK) / (NIGHTFALL - DUSK));
    return 0;
  };
  const veil = (alpha) => ({ flat: true, alpha, shapes: [rect(court.x, court.y, court.w, court.h, PALETTE.ink)] });

  // --- drawing: the HUD ------------------------------------------------------

  function hudParts({ quiet = false } = {}) {
    const look = season();
    const shapes = [
      rect(court.x, court.y, court.w, HUD_H, PALETTE.ink),
      rect(court.x + 10, court.y + HUD_H - 4, court.w - 20, 3, PALETTE.barkDim),
      rect(court.x + 10, court.y + HUD_H - 4, 120, 3, look.accent),
    ];
    const labels = [
      text(`${look.name} ${farm.day}`, court.x + 14, court.y + 10, { anchor: 'start', fill: look.accent }),
      text(clockText(farm.clock), court.x + 190, court.y + 10, { anchor: 'start', fill: PALETTE.cream }),
      text(`${Math.round(game.shownGold)}G`, court.x + court.w - 14, court.y + 10, { anchor: 'end', fill: PALETTE.sun }),
    ];
    if (farm.weather !== 'sun') labels.push(text(farm.weather.toUpperCase(), court.x + 330, court.y + 10, { anchor: 'start', fill: farm.weather === 'rain' ? PALETTE.sky : PALETTE.creamLit }));
    if (farm.year > 1) labels.push(text(`YEAR ${farm.year}`, court.x + 420, court.y + 10, { anchor: 'start', fill: PALETTE.bark }));

    // The two meters, in the empty corner above the diorama's left shoulder.
    const bx = court.x + 14;
    const by = court.y + HUD_H + 10;
    const bw = 110;
    shapes.push(disc(bx + 6, by + 5, 6, PALETTE.sun));
    shapes.push(rect(bx + 18, by, bw, 10, PALETTE.barkDim));
    shapes.push(rect(bx + 18, by, Math.max(0, bw * farm.energy / MAX_ENERGY), 10, farm.energy > 25 ? PALETTE.sun : PALETTE.ember));
    if (farm.maxEnergy < MAX_ENERGY) shapes.push(rect(bx + 18 + bw * farm.maxEnergy / MAX_ENERGY, by, bw * (1 - farm.maxEnergy / MAX_ENERGY), 10, PALETTE.ink));
    shapes.push(heart(bx + 6, by + 22, 5, PALETTE.ember));
    shapes.push(rect(bx + 18, by + 18, bw, 10, PALETTE.barkDim));
    shapes.push(rect(bx + 18, by + 18, Math.max(0, bw * farm.food / MAX_FOOD), 10, farm.food > HUNGRY ? PALETTE.rose : PALETTE.ember));

    if (quiet) return { shapes, labels };

    // What is in hand, bottom right, bumping when it changes.
    const bump = game.handBump > 0 ? Math.sin((game.handBump / 0.3) * Math.PI) * 6 : 0;
    const hy = court.y + court.h - 86 - bump;
    const hx = court.x + court.w - 14;
    const label = handName();
    const lw = label.length * 16 + 24;
    shapes.push(rect(hx - lw, hy, lw, 30, PALETTE.ink), rect(hx - lw, hy, lw, 3, look.accent));
    labels.push(text(label, hx - 12, hy + 8, { anchor: 'end', fill: PALETTE.cream }));
    if (farm.hand === 'can') {
      const cap = canSpec().cap;
      for (let i = 0; i < cap; i++) shapes.push(rect(hx - lw + 10 + i * 6, hy + 26, 4, 4, i < farm.water ? PALETTE.sky : PALETTE.barkDim));
    }

    // The hint line: a note if one is up, otherwise what A would do.
    const hint = (game.note ? game.note.text : intent().label).slice(0, 38);
    if (hint) labels.push(text(hint, court.x + 14, court.y + court.h - 30, { anchor: 'start', fill: game.note ? PALETTE.sun : PALETTE.creamDim }));

    return { shapes, labels };
  }

  function dayCard() {
    if (game.card <= 0) return { shapes: [], labels: [] };
    const look = season();
    const t = game.card;
    const grow = t < 0.45 ? easeOut(t / 0.45) : t > 2.3 ? 1 - easeOut(Math.min(1, (t - 2.3) / 0.5)) : 1;
    const w = 320 * grow;
    const h = 62;
    const x = mid.x - w / 2;
    const y = court.y + HUD_H + 60;
    const weather = farm.weather === 'rain' ? 'RAIN' : farm.weather === 'snow' ? 'SNOW' : 'FAIR';
    const labels = grow > 0.85 ? [
      centred(`${look.name} · DAY ${farm.day}`, y + 22, { fill: look.accent }),
      centred(`YEAR ${farm.year} · ${weather}`, y + 44, { fill: PALETTE.creamDim }),
    ] : [];
    return {
      shapes: w < 2 ? [] : [rect(x, y, w, h, PALETTE.ink), rect(x, y, w, 4, look.accent), rect(x, y + h - 4, w, 4, look.accent)],
      labels,
    };
  }

  // A boxed list with a cursor, a scroll and a footer: the bag, the shop and
  // the bin all look like this.
  function listBox({ title, subtitle, rows, empty, foot }) {
    const w = 520;
    const x = mid.x - w / 2;
    const y = court.y + 58;
    const visible = 7;
    const rowH = 30;
    const h = 92 + visible * rowH + 36;
    const shapes = [rect(x, y, w, h, PALETTE.cream), rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink)];
    const labels = [text(title, x + 20, y + 14, { anchor: 'start', fill: PALETTE.sun })];
    (subtitle ?? []).slice(0, 2).forEach((line, i) => labels.push(text(line.slice(0, 30), x + 20, y + 40 + i * 22, { anchor: 'start', fill: i === 0 ? PALETTE.creamDim : PALETTE.bark })));

    const top = clamp(game.top, 0, Math.max(0, rows.length - visible));
    const listY = y + 92;
    if (!rows.length) labels.push(text(empty, x + 20, listY + 8, { anchor: 'start', fill: PALETTE.bark }));
    rows.slice(top, top + visible).forEach((row, i) => {
      const index = top + i;
      const selected = index === game.cursor;
      const ry = listY + i * rowH;
      if (selected) shapes.push(rect(x + 10, ry - 4, w - 20, rowH - 2, PALETTE.barkDim));
      labels.push(text(`${selected ? '▶ ' : '  '}${row.left}`, x + 20, ry, { anchor: 'start', fill: row.dim ? PALETTE.bark : selected ? PALETTE.sun : PALETTE.cream }));
      labels.push(text(row.right, x + w - 24, ry, { anchor: 'end', fill: row.dim ? PALETTE.bark : selected ? PALETTE.sun : PALETTE.creamDim }));
    });
    if (top > 0) labels.push(text('▲', x + w - 24, listY - 22, { anchor: 'end', fill: PALETTE.bark }));
    if (top + visible < rows.length) labels.push(text('▼', x + w - 24, listY + visible * rowH - 6, { anchor: 'end', fill: PALETTE.bark }));

    const footY = y + h - 32;
    shapes.push(rect(x + 16, footY - 8, w - 32, 3, PALETTE.barkDim));
    labels.push(text(foot, x + 20, footY, { anchor: 'start', fill: PALETTE.bark }));
    return { shapes, labels };
  }

  // --- screens ---------------------------------------------------------------

  // `cursor: false` drops the tile cursor and the hint line for a screen with
  // a panel over the farm: the panel is what A acts on now.
  function playParts({ cursor = true } = {}) {
    if (groundDirty) paintGround();
    const layers = [groundDecals(), ...worldLayers()];
    const weather = weatherLayer();
    if (weather) layers.push(weather);
    const alpha = veilAlpha();
    if (alpha > 0) layers.push(veil(alpha));
    const hud = hudParts({ quiet: !cursor });
    const card = dayCard();
    layers.push({ flat: true, shapes: [...hud.shapes, ...card.shapes] });
    if (!cursor) layers[0] = { flat: true, shapes: layers[0].shapes.filter((s) => s.type !== 'chain') };
    return { underlay: ground, layers, text: [...hud.labels, ...card.labels] };
  }

  function playScreen() {
    return playParts();
  }

  function overlay(inner, box) {
    return { ...inner, layers: [...inner.layers, { flat: true, shapes: box.shapes }], text: [...inner.text, ...box.labels] };
  }

  function pausedScreen() {
    const w = 320;
    const x = mid.x - w / 2;
    const y = court.y + 110;
    const h = 60 + PAUSE_MENU.length * 40;
    const box = {
      shapes: [rect(x, y, w, h, PALETTE.cream), rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink)],
      labels: [
        centred('PAUSED', y + 30, { fill: PALETTE.sun }),
        ...PAUSE_MENU.map((entry, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${entry.label}`, y + 74 + i * 40, { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
      ],
    };
    return overlay(playParts({ cursor: false }), box);
  }

  function bagScreen() {
    const rows = bagRows().map((row) => ({ left: `${row.name} x${row.n}`, right: row.tag }));
    return overlay(playParts({ cursor: false }), listBox({
      title: `BAG · ENERGY ${Math.round(farm.energy)}`,
      subtitle: ['SEEDS GO IN HAND. FOOD GOES IN YOU.'],
      rows, empty: 'NOTHING IN IT YET',
      foot: 'A: HOLD / EAT    B: CLOSE',
    }));
  }

  function shopScreen() {
    const rows = shopRows();
    const row = rows[game.cursor];
    const owned = (entry) => {
      const [kind, what] = entry.id.split(':');
      if (kind === 'tool') return what === 'copper' ? farm.tools.can === 2 : farm.tools[what] > 0;
      if (kind === 'build') return farm.buildings[what];
      return false;
    };
    return overlay(playParts({ cursor: false }), listBox({
      title: `WREN'S STALL · ${Math.round(farm.gold)}G`,
      subtitle: [row.desc, row.wood ? `PLUS ${row.wood} WOOD. YOU HAVE ${count('wood')}.` : WREN[farm.season]],
      rows: rows.map((entry) => ({ left: entry.name, right: owned(entry) ? 'OWNED' : `${entry.price}G`, dim: owned(entry) })),
      empty: '', foot: 'A: BUY    B: LEAVE',
    }));
  }

  function shipScreen() {
    const rows = shipRows();
    const row = rows[game.cursor];
    const due = Object.entries(farm.shipped).reduce((sum, [id, n]) => sum + item(id).sells * n, 0);
    return overlay(playParts({ cursor: false }), listBox({
      title: `SHIPPING BIN · ${due}G DUE AT DAWN`,
      subtitle: row ? [`${row.name}: ${row.each}G EACH.`, `SHIP ${game.qty} FOR ${row.each * game.qty}G`] : ['NOTHING TO SHIP.', 'KEEP SOME BACK TO EAT.'],
      rows: rows.map((r, i) => ({ left: `${r.name} x${r.n}`, right: i === game.cursor ? `◀ ${game.qty} ▶` : `${r.each}G` })),
      empty: '',
      foot: 'A: SHIP  ◀ ▶: HOW MANY  B: CLOSE',
    }));
  }

  function promptScreen() {
    const pr = game.prompt;
    const w = 440;
    const x = mid.x - w / 2;
    const lines = pr.lines.flatMap((l) => wrap(l, 26));
    const h = 60 + lines.length * 24 + pr.options.length * 34 + 20;
    const y = court.y + 100;
    const box = {
      shapes: [rect(x, y, w, h, PALETTE.cream), rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink)],
      labels: [
        text(pr.title, x + 20, y + 14, { anchor: 'start', fill: PALETTE.sun }),
        ...lines.map((line, i) => text(line, x + 20, y + 44 + i * 24, { anchor: 'start', fill: PALETTE.cream })),
        ...pr.options.map((opt, i) => text(`${i === game.cursor ? '▶ ' : '  '}${opt}`, x + 20, y + 60 + lines.length * 24 + i * 34, { anchor: 'start', fill: i === game.cursor ? PALETTE.sun : PALETTE.creamDim })),
      ],
    };
    return overlay(playParts(), box);
  }

  function nightScreen() {
    const n = game.night;
    const look = season();
    switch (n.phase) {
      case 'dusk': {
        const inner = playParts({ cursor: false });
        const a = clamp(n.t / 1.0, 0, 1);
        inner.layers.push(veil(Math.max(veilAlpha(), a)));
        if (a > 0.5) inner.text.push(centred('Z z z', court.y + 150, { font: HEAVY, scale: 1, fill: PALETTE.creamDim }));
        return inner;
      }
      case 'winter': {
        const shown = Math.min(DAYS, farm.day + Math.floor((n.t / 3.2) * (DAYS - farm.day + 1)));
        const flakes = [];
        for (let i = 0; i < 70; i++) {
          const h = ((i * 2654435761) >>> 0) / 4294967296;
          const p = cycle(n.t, 3 + h, h * 5);
          flakes.push(disc(court.x + (((i * 40503 + 12345) % 1000) / 1000) * court.w + sway(n.t, 1.5 + h, 8, h), court.y + p * court.h, 1.5 + (i % 3) * 0.6, PALETTE.creamLit));
        }
        return {
          layers: [{ flat: true, shapes: [rect(mid.x - 10, court.y + court.h - 60, 20, 10, PALETTE.ink), ...flakes] }],
          text: [
            centred('WINTER', court.y + 150, { font: HEAVY, scale: 2, fill: PALETTE.sky }),
            centred(`DAY ${shown}`, court.y + 230, { fill: PALETTE.cream }),
          ],
        };
      }
      case 'card': {
        const shown = n.shown ?? 0;
        const w = 460;
        const x = mid.x - w / 2;
        const y = court.y + 60;
        const rows = n.lines.slice(0, shown);
        const labels = [
          centred(n.how === 'winter' ? 'THE THAW' : `NIGHT ${farm.lifetime.days}`, y + 36, { font: HEAVY, scale: 1, fill: look.accent }),
          ...rows.map((line, i) => [
            text(line.text, x + 24, y + 80 + i * 28, { anchor: 'start', fill: line.value === null ? PALETTE.creamDim : PALETTE.cream }),
            ...(line.value === null ? [] : [text(`${line.value > 0 ? '+' : ''}${line.value}G`, x + w - 24, y + 80 + i * 28, { anchor: 'end', fill: line.value >= 0 ? PALETTE.sun : PALETTE.ember })]),
          ]).flat(),
        ];
        const ruleY = y + 84 + n.lines.length * 28;
        if (shown > n.lines.length) {
          labels.push(text('IN THE PURSE', x + 24, ruleY + 12, { anchor: 'start', fill: PALETTE.cream }));
          labels.push(text(`${farm.gold}G`, x + w - 24, ruleY + 12, { anchor: 'end', fill: PALETTE.sun }));
          labels.push(centred('PRESS A', court.y + court.h - 60, { fill: PALETTE.bark }));
        }
        return {
          layers: [{ flat: true, shapes: [rect(x, y, w, 8, look.accent), rect(x, ruleY, w, 3, PALETTE.barkDim)] }],
          text: labels,
        };
      }
      case 'season': {
        const grow = easeOut(clamp(n.t / 0.8, 0, 1));
        return {
          layers: [{ flat: true, shapes: [
            rect(mid.x - 200 * grow, court.y + 200, 400 * grow, 5, look.accent),
            rect(mid.x - 200 * grow, court.y + 276, 400 * grow, 5, look.accent),
          ] }],
          text: [centred(look.name, court.y + 240, { font: HEAVY, scale: 2, fill: look.accent }), centred(`YEAR ${farm.year}`, court.y + 310, { fill: PALETTE.creamDim })],
        };
      }
      case 'dawn': {
        const inner = playParts({ cursor: false });
        inner.layers.push(veil(Math.max(veilAlpha(), 1 - clamp(n.t / 0.9, 0, 1))));
        return inner;
      }
      default:
        throw new Error(`unknown night phase: ${n.phase}`);
    }
  }

  // The title: a hill, the house, a tree, and the seasons going round.
  function menuScreen() {
    const which = Math.floor(game.elapsed / 3.2) % 4;
    const look = SEASONS[which];
    const base = court.y + court.h - 60;
    const canopy = look.canopy ?? [PALETTE.barkDim, PALETTE.barkDim, PALETTE.creamLit];
    const wind = sway(game.elapsed, 2.8, 3);
    const winter = which === WINTER;
    const shapes = [
      disc(mid.x + 60, base + 150, 240, look.grass),
      disc(mid.x - 230, base + 170, 200, look.pasture),
      rect(court.x, base + 30, court.w, court.h, PALETTE.ink),
      rect(mid.x + 90, base - 36, 60, 40, PALETTE.cream),
      rect(mid.x + 84, base - 48, 72, 12, PALETTE.ember),
      chain([{ x: mid.x + 92, y: base - 48, r: 3 }, { x: mid.x + 120, y: base - 62, r: 3 }, { x: mid.x + 148, y: base - 48, r: 3 }], PALETTE.ember),
      rect(mid.x + 114, base - 20, 12, 24, PALETTE.barkDim),
      rect(mid.x + 100, base - 30, 9, 9, winter || which === 2 ? PALETTE.sun : PALETTE.sky),
      rect(mid.x - 124, base - 24, 8, 34, PALETTE.bark),
      disc(mid.x - 120 + wind, base - 44, 20, canopy[0]),
      disc(mid.x - 136 + wind * 0.6, base - 30, 14, canopy[1]),
      disc(mid.x - 104 + wind * 0.6, base - 30, 14, canopy[0]),
      disc(mid.x - 126 + wind, base - 56, 5, canopy[2]),
      disc(court.x + court.w - 90, court.y + 74, 22, winter ? PALETTE.creamLit : PALETTE.sun),
    ];
    for (let i = 0; i < 6; i++) shapes.push(rect(mid.x - 40 + i * 22, base + 4, 14, 6, winter ? PALETTE.creamLit : PALETTE.bark));
    if (!winter) for (let i = 0; i < 5; i++) shapes.push(disc(mid.x - 250 + i * 70 + wind, base + 20 + (i % 2) * 6, 3, look.tuft));
    return {
      layers: [{ ink: 3, shapes }, { flat: true, shapes: [rect(mid.x - 150, court.y + 108, 300, 4, look.accent)] }],
      text: [
        centred('MEADOWLARK', court.y + 70, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...MENU.map((entry, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${entry.label}`, court.y + 142 + i * 36, { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
        centred(game.note ? game.note.text : look.name, court.y + court.h - 22, { fill: game.note ? PALETTE.sun : look.accent }),
      ],
    };
  }

  function howtoScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 62, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('HOW TO PLAY', court.y + 36, { scale: 1, font: HEAVY, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => text(line, court.x + 44, court.y + 80 + i * 28, { anchor: 'start', fill: i % 2 === 0 && [0, 4, 8].includes(i) ? PALETTE.sun : PALETTE.cream })),
        centred('B TO GO BACK', court.y + court.h - 26, { fill: PALETTE.bark }),
      ],
    };
  }

  const SCREENS = {
    menu: menuScreen, howto: howtoScreen, play: playScreen, paused: pausedScreen,
    bag: bagScreen, shop: shopScreen, ship: shipScreen, prompt: promptScreen, night: nightScreen,
  };

  function scene() {
    const built = SCREENS[game.screen]();
    return {
      title: `Meadowlark (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      underlay: built.underlay ?? null,
      matte: court,
      matteColour: PALETTE.ink,
      ink: 3,
      font: FONT,
      layers: built.layers,
      text: built.text,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    // The menu has its own theme; the farm plays the season's, and the sleep
    // fade is silent so the morning's track arrives on its own.
    music() {
      if (!farm || game.screen === 'menu' || game.screen === 'howto') return 'meadow';
      if (game.screen === 'night') return game.night.phase === 'dusk' || game.night.phase === 'card' ? null : season().track;
      return season().track;
    },
    state() {
      if (!farm) return { screen: game.screen, exit: game.exit, cursor: game.cursor, elapsed: game.elapsed, farm: null };
      const what = game.screen === 'play' ? intent() : null;
      const { c, r } = facing();
      const t = tileAt(c, r);
      return {
        screen: game.screen, exit: game.exit, cursor: game.cursor, elapsed: game.elapsed,
        day: farm.day, season: farm.season, year: farm.year, clock: Math.round(farm.clock * 10) / 10,
        weather: farm.weather,
        gold: farm.gold, energy: Math.round(farm.energy * 10) / 10, food: Math.round(farm.food), maxEnergy: farm.maxEnergy,
        hand: farm.hand, seed: farm.seed, water: farm.water, tools: { ...farm.tools }, buildings: { ...farm.buildings },
        bag: { ...farm.bag },
        shipped: { ...farm.shipped },
        lifetime: { ...farm.lifetime },
        at: [farm.player.c, farm.player.r], dir: farm.player.dir, moving: Boolean(game.move), acting: game.act ? game.act.kind : null,
        target: t ? { c, r, ground: t.g, object: t.o, wet: t.wet, crop: t.crop ? { ...t.crop, ripe: ripe(t.crop) } : null } : null,
        intent: what ? what.kind : null,
        hint: what ? what.label : null,
        animals: farm.animals.map((a) => ({ kind: a.kind, name: a.name, happy: a.happy, fed: a.fed, ready: a.ready, at: [a.c, a.r] })),
        night: game.night ? game.night.phase : null,
        prompt: game.prompt ? game.prompt.options : null,
        saves: game.saves,
        card: game.card > 0,
      };
    },
    // For the tests: the map as it stands, and a way to read a tile.
    tile: (c, r) => (farm ? JSON.parse(JSON.stringify(tileAt(c, r))) : null),
    walkable: (c, r) => Boolean(farm) && walkable(c, r),
    irrigation: () => (farm ? [...irrigation()].map((k) => [k % COLS, Math.floor(k / COLS)]) : []),
    court,
    grid,
  };
}

// Box art: a green diamond of field, three plots, the house and the sun.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) => ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const d = (dx, dy, dr, fill) => ({ type: 'disc', x: Math.round(dx), y: Math.round(dy), r: dr, fill });
  const cx = x + w / 2;
  const cy = y + h * 0.62;
  const shapes = [];
  // Diamonds out of stacked rects: the emblem is tiny and drawn once a frame.
  const diamond = (px, py, hw, hh, fill) => {
    for (let row = -hh; row < hh; row++) {
      const reach = Math.max(1, Math.round(hw * (1 - Math.abs(row + 0.5) / hh)));
      shapes.push(r(px - reach, py + row, reach * 2, 1, fill));
    }
  };
  diamond(cx, cy, w * 0.46, h * 0.3, PALETTE.moss);
  diamond(cx - 14, cy - 4, 10, 5, PALETTE.bark);
  diamond(cx + 2, cy + 4, 10, 5, PALETTE.barkDim);
  diamond(cx + 18, cy - 4, 10, 5, PALETTE.bark);
  shapes.push(d(cx - 14, cy - 8, 3, PALETTE.mossLit), d(cx + 2, cy, 3, PALETTE.ember), d(cx + 18, cy - 8, 3, PALETTE.sun));
  shapes.push(r(cx - 10, cy - 30, 20, 12, PALETTE.cream), r(cx - 12, cy - 35, 24, 5, PALETTE.ember), r(cx - 3, cy - 25, 6, 7, PALETTE.barkDim));
  shapes.push(d(x + w - 14, y + 12, 7, PALETTE.sun));
  return shapes;
}

module.exports = {
  title: 'MEADOWLARK',
  blurb: 'TEND THE LAND',
  meta: {
    players: [1],
    rating: 'pg',
    audio: '8-bit',
    graphics: '2d',
  },
  accent: 'moss',
  emblem,
  create,
  GAME, MENU, PAUSE_MENU, HOW_TO, CROPS, GOODS, ANIMALS, SHOP, SEASONS, MAP, GLYPH, COLS, ROWS, DAYS,
  WAKE, COLLAPSE, MINUTE, DOOR, START, CAN, COST, HUNGRY, TIRED_WAKE, COLLAPSE_WAKE, BREAD, SAVE_VERSION,
  SOLID_GROUND, SOLID_OBJECT, memoryStore, wrap,
};

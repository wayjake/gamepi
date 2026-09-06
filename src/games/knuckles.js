'use strict';
// Timmy Tough Knuckles -- a side-scrolling brawler through one day of middle
// school. Streets of Rage with pencils.
//
// Five stages, five bosses, three lives, two players. The world is a strip:
// x runs along it, y is depth, and a punch only lands on somebody standing on
// the same lane (within LANE of your feet). The camera follows you right and
// never scrolls back; at each wave point it locks, the doors open, and it only
// lets go when everyone it let in is on the floor.
//
// The rules worth knowing before changing anything here:
//
//   Everybody is one figure() in different colours at a different size, and a
//   sprite is one inked layer. Sprites are sorted by their feet and each one
//   is its own layer so a nearer kid's outline cuts into a further one -- and
//   so that no two sprites can leave a one-pixel sliver of ink between their
//   fills, which strobes on an interlaced field. Inside one figure every part
//   overlaps its neighbour for the same reason.
//
//   A telegraph commits to its aim. An enemy takes its facing when the wind-up
//   starts and swings where it was looking; a charge goes where it was aimed.
//   That is what makes stepping off the lane a dodge rather than a delay.
//
//   Weapons are hits, not time. A pencil is eight, a ruler six, a squishy
//   three throws, and fists are for ever. Only a hit that lands counts.
//
//   Bosses have poise. Anything `tough` staggers on every third hit instead of
//   every hit, and a kick that would floor a goon only staggers a boss --
//   unless it has just finished a charge, when it is `stunned`, takes double,
//   and goes down. Without that a boss is punched to death from a corner
//   without ever swinging back.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));    // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'knuckles';
const LIVES = 3;
const HUD_H = 56;      // the black band at the top of the picture
const WALL_H = 150;    // the backdrop between the HUD and the floor
const LANE = 14;       // how far apart two pairs of feet can be and still trade blows
const INK = 3;
const WRAP = 38;       // characters across a card at scale 2
const GRACE = 0.5;     // seconds before a card takes the button that produced it
const COMBO = 3;       // the punch that floors somebody
const COMBO_WINDOW = 0.8;
const KICK = { reach: 42, time: 0.36 };
const LUNCH_HEAL = 10;
const LUNCH_POINTS = 150;
const CLEAR_BONUS = 1000;
const LIFE_BONUS = 250;
const SURVIVE_BONUS = 2500;
const RESPAWN_INVULN = 2.0;
const AGGRO = [2, 2, 3, 3, 3]; // how many may come at you at once, per stage

// --- the kids ----------------------------------------------------------------

const HEROES = {
  timmy: {
    name: 'TIMMY', blurb: 'TOUGH KNUCKLES', speed: 150, hp: 20, punch: 1, kick: 2, rate: 1, size: 1,
    stats: { speed: 3, power: 3, grit: 3 },
    body: PALETTE.sky, trim: PALETTE.skyDim, skin: PALETTE.cream, hair: PALETTE.bark, alt: PALETTE.violet,
  },
  rosa: {
    name: 'ROSA', blurb: 'FAST HANDS', speed: 190, hp: 16, punch: 1, kick: 2, rate: 1.35, size: 0.95,
    stats: { speed: 5, power: 2, grit: 2 },
    body: PALETTE.rose, trim: PALETTE.roseDim, skin: PALETTE.cream, hair: PALETTE.ink, alt: PALETTE.sun,
  },
  moose: {
    name: 'MOOSE', blurb: 'HELD BACK TWICE', speed: 118, hp: 26, punch: 2, kick: 3, rate: 0.8, size: 1.15,
    stats: { speed: 2, power: 5, grit: 4 },
    body: PALETTE.moss, trim: PALETTE.mossDim, skin: PALETTE.cream, hair: PALETTE.sun, alt: PALETTE.ember,
  },
};
const ROSTER = ['timmy', 'rosa', 'moose'];

// --- what you can hit them with ----------------------------------------------
//
// `hits` is how many landed blows a weapon survives; null is for ever. A thrown
// weapon spends a hit per throw whether or not it connects, and lands on the
// floor with what it has left.
const WEAPONS = {
  fists: { name: 'FISTS', reach: 30, damage: 0, time: 0.22, hits: null },
  pencil: { name: 'PENCIL', reach: 36, damage: 1, time: 0.16, hits: 8 },
  ruler: { name: 'RULER', reach: 54, damage: 2, time: 0.30, hits: 6 },
  squishy: { name: 'SQUISHY', reach: 0, damage: 2, time: 0.24, hits: 3, thrown: true, speed: 420 },
};
const PICKUPS = ['pencil', 'ruler', 'squishy'];

// --- the other kids ----------------------------------------------------------
//
// One new kind per stage. `wind` is the telegraph, `reach` how far the swing
// goes, `recover` how long they stand there afterwards regretting it.
const KINDS = {
  goon: {
    label: 'GOON', hp: 3, speed: 70, damage: 2, reach: 26, wind: 0.42, recover: 0.5, points: 100, size: 1,
    body: PALETTE.ember, trim: PALETTE.emberDim, skin: PALETTE.cream, hair: PALETTE.barkDim,
  },
  // In, one hit, and out again before you have turned round.
  runner: {
    label: 'RUNNER', hp: 2, speed: 160, damage: 2, reach: 24, wind: 0.24, recover: 0.3, points: 150, size: 0.9,
    hitRun: true,
    body: PALETTE.sun, trim: PALETTE.sunDim, skin: PALETTE.cream, hair: PALETTE.ember,
  },
  // Keeps its distance and throws paper. Walk up to it and it swings like
  // anyone else, badly.
  thrower: {
    label: 'THROWER', hp: 3, speed: 65, damage: 2, reach: 24, wind: 0.5, recover: 0.6, points: 200, size: 1,
    ranged: 'wad', keep: 210, every: 2.4,
    body: PALETTE.violet, trim: PALETTE.violetDim, skin: PALETTE.cream, hair: PALETTE.bark,
  },
  // Does not flinch. Shoulder-charges down the lane when it has the room.
  jock: {
    label: 'JOCK', hp: 8, speed: 60, damage: 4, reach: 32, wind: 0.55, recover: 0.7, points: 300, size: 1.25,
    tough: true, charge: { speed: 330, for: 0.6, every: 3.5, wind: 0.5 },
    body: PALETTE.stone, trim: PALETTE.stoneDim, skin: PALETTE.cream, hair: PALETTE.sunDim,
  },
  // Carries a ruler, which is a reach you do not have, and drops it.
  monitor: {
    label: 'MONITOR', hp: 5, speed: 85, damage: 3, reach: 52, wind: 0.36, recover: 0.5, points: 250, size: 1,
    armed: 'ruler',
    body: PALETTE.moss, trim: PALETTE.sun, skin: PALETTE.cream, hair: PALETTE.ink,
  },
};
const KIND_ORDER = ['goon', 'runner', 'thrower', 'jock', 'monitor'];

// --- the staff ---------------------------------------------------------------

const BOSSES = {
  biff: {
    name: 'BIFF', title: 'HALL BULLY', hp: 32, speed: 88, damage: 4, reach: 36, wind: 0.5, recover: 0.6,
    points: 1000, size: 1.4, tough: true, charge: { speed: 360, for: 0.7, every: 3.2, wind: 0.55 },
    taunt: 'HEY NEW KID. NICE LUNCH MONEY.',
    body: PALETTE.emberDim, trim: PALETTE.ink, skin: PALETTE.cream, hair: PALETTE.ember,
  },
  grunt: {
    name: 'COACH GRUNT', title: 'P.E.', hp: 40, speed: 95, damage: 3, reach: 34, wind: 0.45, recover: 0.6,
    points: 1500, size: 1.3, tough: true, ranged: 'ball', keep: 230, every: 2.0,
    summons: { kind: 'runner', every: 9, max: 2 },
    taunt: 'TEN LAPS. NOW.',
    body: PALETTE.sunDim, trim: PALETTE.stoneDim, skin: PALETTE.creamDim, hair: PALETTE.ember, cap: true, whistle: true,
  },
  twin: {
    name: 'DEX AND REX', title: 'THE TWINS', hp: 24, speed: 110, damage: 3, reach: 30, wind: 0.4, recover: 0.5,
    points: 900, size: 1.15, tough: true, count: 2, charge: { speed: 340, for: 0.55, every: 2.8, wind: 0.45 },
    taunt: 'WE GOT HIM FIRST.',
    body: PALETTE.turf, trim: PALETTE.turfDim, skin: PALETTE.cream, hair: PALETTE.sun,
  },
  hatch: {
    name: 'V.P. HATCH', title: 'VICE PRINCIPAL', hp: 48, speed: 92, damage: 3, reach: 36, wind: 0.45, recover: 0.6,
    points: 2000, size: 1.3, tough: true, ranged: 'clipboard', keep: 200, every: 2.6,
    summons: { kind: 'monitor', every: 11, max: 2 },
    taunt: 'THAT IS A DETENTION.',
    body: PALETTE.violetDim, trim: PALETTE.violet, skin: PALETTE.cream, hair: PALETTE.stone, glasses: true,
  },
  stern: {
    name: 'PRINCIPAL STERN', title: 'THE PRINCIPAL', hp: 64, speed: 80, damage: 5, reach: 50, wind: 0.65, recover: 0.8,
    points: 3000, size: 1.55, tough: true, slam: true, fan: { every: 3.0, below: 0.5 },
    summons: { kind: 'goon', every: 8, max: 3 },
    taunt: 'SEE ME IN MY OFFICE. FOREVER.',
    body: PALETTE.stoneDim, trim: PALETTE.ink, skin: PALETTE.cream, hair: PALETTE.creamDim, tie: true,
  },
};

// --- the day -----------------------------------------------------------------
//
// `at` is the camera position a wave locks at; the boss wave is always at the
// end of the strip. Item `at`s are world x, `lane` is 0..1 down the floor.
const LEVELS = [
  {
    id: 'hall', name: 'THE HALLWAYS', track: 'homeroom', length: 2500, boss: 'biff', tough: 0,
    brief: [
      'FIRST DAY AT BRAMBLE HOLLOW MIDDLE.',
      'YOUR LUNCH MONEY IS GONE, AND SO IS',
      'NUGGET, THE CLASS HAMSTER.',
      'BIFF KNOWS SOMETHING. FIND BIFF.',
    ],
    waves: [
      { at: 0, foes: ['goon', 'goon'] },
      { at: 520, foes: ['goon', 'goon', 'goon'] },
      { at: 1100, foes: ['goon', 'runner', 'goon'] },
      { at: 1600, foes: ['runner', 'goon', 'runner', 'goon'] },
    ],
    items: [
      { at: 140, lane: 0.55, kind: 'pencil' }, { at: 220, lane: 0.25, kind: 'lunch' },
      { at: 900, lane: 0.5, kind: 'pencil' }, { at: 1400, lane: 0.7, kind: 'lunch' },
      { at: 1500, lane: 0.3, kind: 'squishy' }, { at: 2100, lane: 0.5, kind: 'pencil' },
    ],
  },
  {
    id: 'gym', name: 'THE GYM', track: 'gymclass', length: 2900, boss: 'grunt', tough: 0,
    brief: [
      'BIFF TALKED. NUGGET WENT TO THE GYM',
      'IN A DODGEBALL BAG.',
      'COACH GRUNT DOES NOT LIKE QUESTIONS.',
      'HE LIKES LAPS.',
    ],
    waves: [
      { at: 0, foes: ['goon', 'goon', 'thrower'] },
      { at: 600, foes: ['runner', 'runner', 'thrower'] },
      { at: 1250, foes: ['goon', 'goon', 'goon', 'thrower'] },
      { at: 1900, foes: ['thrower', 'runner', 'thrower', 'goon', 'runner'] },
    ],
    items: [
      { at: 160, lane: 0.5, kind: 'ruler' }, { at: 800, lane: 0.3, kind: 'lunch' },
      { at: 1000, lane: 0.7, kind: 'squishy' }, { at: 1650, lane: 0.5, kind: 'pencil' },
      { at: 2200, lane: 0.4, kind: 'lunch' }, { at: 2500, lane: 0.6, kind: 'ruler' },
    ],
  },
  {
    id: 'field', name: 'THE SOCCER FIELD', track: 'fieldday', length: 3100, boss: 'twin', tough: 1,
    brief: [
      'THE COACH GAVE NUGGET TO THE TWINS',
      'FOR SAFE KEEPING. DEX AND REX HAVE',
      'NEVER KEPT ANYTHING SAFE.',
      'THEY ARE OUT ON THE FIELD.',
    ],
    waves: [
      { at: 0, foes: ['jock', 'goon', 'goon'] },
      { at: 650, foes: ['runner', 'runner', 'runner', 'thrower'] },
      { at: 1350, foes: ['jock', 'runner', 'jock'] },
      { at: 2050, foes: ['goon', 'thrower', 'goon', 'thrower', 'jock', 'goon'] },
    ],
    items: [
      { at: 180, lane: 0.4, kind: 'ruler' }, { at: 850, lane: 0.6, kind: 'lunch' },
      { at: 1150, lane: 0.3, kind: 'squishy' }, { at: 1800, lane: 0.5, kind: 'ruler' },
      { at: 2300, lane: 0.7, kind: 'lunch' }, { at: 2700, lane: 0.4, kind: 'pencil' },
    ],
  },
  {
    id: 'courts', name: 'THE BASKETBALL COURTS', track: 'fieldday', length: 3100, boss: 'hatch', tough: 1,
    brief: [
      'THE TWINS WERE ONLY FOLLOWING ORDERS.',
      'V.P. HATCH WRITES THE ORDERS.',
      'SHE IS ON THE COURTS WITH A WHISTLE',
      'AND A CLIPBOARD.',
    ],
    waves: [
      { at: 0, foes: ['monitor', 'goon', 'goon'] },
      { at: 650, foes: ['monitor', 'runner', 'monitor', 'runner'] },
      { at: 1350, foes: ['jock', 'thrower', 'monitor', 'thrower'] },
      { at: 2050, foes: ['monitor', 'jock', 'runner', 'monitor', 'runner', 'thrower'] },
    ],
    items: [
      { at: 200, lane: 0.5, kind: 'lunch' }, { at: 900, lane: 0.3, kind: 'squishy' },
      { at: 1600, lane: 0.6, kind: 'lunch' }, { at: 1750, lane: 0.4, kind: 'pencil' },
      { at: 2350, lane: 0.5, kind: 'lunch' }, { at: 2750, lane: 0.6, kind: 'squishy' },
    ],
  },
  {
    id: 'auditorium', name: 'THE AUDITORIUM', track: 'assembly', length: 3500, boss: 'stern', tough: 2,
    brief: [
      'IT WAS PRINCIPAL STERN ALL ALONG.',
      'NO HAMSTERS. NO LUNCH MONEY. NO FUN.',
      'THE WHOLE SCHOOL IS IN THE AUDITORIUM',
      'FOR ASSEMBLY. SO IS NUGGET.',
    ],
    waves: [
      { at: 0, foes: ['goon', 'goon', 'runner', 'goon', 'runner'] },
      { at: 600, foes: ['monitor', 'thrower', 'monitor', 'thrower'] },
      { at: 1250, foes: ['jock', 'runner', 'monitor', 'jock', 'runner'] },
      { at: 1900, foes: ['thrower', 'jock', 'monitor', 'goon', 'monitor', 'thrower', 'goon'] },
      { at: 2500, foes: ['runner', 'jock', 'monitor', 'runner', 'jock', 'monitor', 'runner'] },
    ],
    items: [
      { at: 180, lane: 0.5, kind: 'ruler' }, { at: 800, lane: 0.4, kind: 'lunch' },
      { at: 1100, lane: 0.6, kind: 'squishy' }, { at: 1700, lane: 0.3, kind: 'lunch' },
      { at: 2200, lane: 0.5, kind: 'ruler' }, { at: 2800, lane: 0.6, kind: 'lunch' },
      { at: 3000, lane: 0.4, kind: 'squishy' },
    ],
  },
];

const ENDING = [
  'NUGGET IS BACK IN HOMEROOM.',
  'PRINCIPAL STERN IS IN DETENTION.',
  'YOUR LUNCH MONEY BOUGHT TWO PUDDINGS.',
  'YOU SURVIVED MIDDLE SCHOOL.',
  'AT LEAST UNTIL TOMORROW.',
];

const HOW_TO = [
  'D-PAD   MOVE, AND CHANGE LANE',
  'A       PUNCH, OR SWING WHAT YOU HOLD',
  'B       KICK. IT KNOCKS THEM DOWN',
  '',
  'WALK OVER A PENCIL, RULER OR SQUISHY',
  'TO PICK IT UP. EACH BREAKS AFTER A',
  'FEW HITS. LUNCH BOXES HEAL.',
  '',
  'THREE LIVES. START PAUSES.',
];

const MENU = [
  { id: '1p', label: '1 PLAYER' },
  { id: '2p', label: '2 PLAYERS' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'RESTART' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

// mulberry32, same as everywhere else in here: nothing may use Math.random.
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
const sign = (v) => (v < 0 ? -1 : 1);
const rect = (x, y, w, h, fill) =>
  ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r, fill });
const pt = (x, y, r) => ({ x: Math.round(x), y: Math.round(y), r });
const chain = (points, fill) => ({ type: 'chain', points, fill });

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const random = rng(options.seed ?? 0x4b4e5543);
  const table = options.scores ?? scores;
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };

  // The floor: where feet may go.
  const wallY = court.y + HUD_H;
  const floorY = wallY + WALL_H;
  const floorH = court.y + court.h - floorY;
  const field = { top: floorY + 26, bottom: court.y + court.h - 10 };
  const laneY = (u) => field.top + u * (field.bottom - field.top);

  const sounds = [];
  const say = (name) => sounds.push(name);

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,      // seconds inside the current screen
    clock: 0,        // seconds since the machine was switched on: the papers drift on it
    cursor: 0,
    players: 1,
    picks: [{ hero: 0, locked: false }, { hero: 1, locked: false }],
    pickedAt: 0,
    board: table.table(GAME),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,
    won: false,
    level: 0,
    wave: 0,
    locked: false,
    cam: 0,
    intro: 0,        // boss name card
    clearIn: 0,      // countdown from the last boss falling to the card
    playTime: 0,
    bonus: { clear: 0, lives: 0 },
  };
  const run = { score: 0 };

  let players = [];
  let enemies = [];
  let items = [];
  let shots = [];
  let effects = [];
  let queue = [];

  // Drifting paper for the menus, seeded so a frame is a function of (seed, t).
  const papers = Array.from({ length: 12 }, () => ({
    x: random() * court.w, y: court.y + 30 + random() * (court.h - 60),
    speed: 18 + random() * 30, phase: random() * 6.28, w: 8 + Math.floor(random() * 6),
  }));

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };
  const level = () => LEVELS[game.level];
  const allWaves = () => [...level().waves, { at: level().length - court.w, boss: level().boss }];
  const livePlayers = () => players.filter((p) => !p.out && p.down <= 0);
  const bossAlive = () => enemies.some((e) => e.boss && e.mode !== 'dying');

  // --- the run --------------------------------------------------------------

  function makePlayer(index, heroId) {
    const hero = HEROES[heroId];
    return {
      index, hero, heroId,
      x: 0, y: 0, facing: 1,
      hp: hero.hp, maxHp: hero.hp, lives: LIVES,
      weapon: { kind: 'fists', hits: null },
      attack: null, combo: 0, comboT: 0,
      hurt: 0, invuln: 0, down: 0, dying: false, out: false,
      kx: 0, walk: 0,
    };
  }

  function newRun() {
    players = game.picks.slice(0, game.players).map((pick, i) => makePlayer(i, ROSTER[pick.hero]));
    run.score = 0;
    game.won = false;
    game.playTime = 0;
    startLevel(0);
  }

  function startLevel(index) {
    game.level = index;
    game.wave = 0;
    game.locked = false;
    game.cam = 0;
    game.intro = 0;
    game.clearIn = 0;
    enemies = [];
    shots = [];
    effects = [];
    queue = [];
    items = level().items.map((it) => ({ kind: it.kind, x: it.at, y: laneY(it.lane), left: null }));
    players.forEach((p, i) => {
      p.x = 80 + i * 50;
      p.y = laneY(0.5 + (i ? 0.15 : 0));
      p.facing = 1;
      p.attack = null; p.hurt = 0; p.kx = 0; p.combo = 0;
      if (!p.out) { p.down = 0; p.dying = false; }
    });
    go('brief');
  }

  function nextLevel() {
    if (game.level + 1 < LEVELS.length) startLevel(game.level + 1);
    else go('ending');
  }

  function levelClear() {
    const lives = players.reduce((s, p) => s + Math.max(0, p.lives), 0);
    game.bonus = { clear: CLEAR_BONUS, lives: lives * LIFE_BONUS };
    run.score += game.bonus.clear + game.bonus.lives;
    say('fanfare');
    go('clear');
  }

  function finish(won) {
    game.won = won;
    if (won) run.score += SURVIVE_BONUS;
    say(won ? 'fanfare' : 'over');
    game.placing = run.score > 0 ? table.placing(GAME, run.score) : 0;
    game.initials = [0, 0, 0];
    game.slot = 0;
    go('over');
  }

  // --- spawning -------------------------------------------------------------

  function spawnFoe(kind, side, boss = false) {
    const cfg = boss ? BOSSES[kind] : KINDS[kind];
    const edge = side > 0 ? game.cam + court.w + 30 : game.cam - 30;
    const hp = boss ? cfg.hp * (game.players === 2 ? 1.5 : 1) : cfg.hp + level().tough;
    const e = {
      kind, boss, cfg,
      x: edge - side * random() * 30, y: laneY(0.15 + random() * 0.7), facing: -side,
      hp, maxHp: hp,
      mode: 'approach', timer: 0, flash: 0, kx: 0,
      cool: (cfg.every ?? 0) * (0.5 + random() * 0.5),
      chargeCool: 1.2 + random() * 1.5,
      fanCool: cfg.fan ? cfg.fan.every : 0,
      hover: (random() - 0.5) * 120,
      phase: random() * 6.28,
      slot: false, entered: false, charging: false, stunned: false, poise: 0,
      weapon: cfg.armed ?? null,
      summonIn: cfg.summons ? cfg.summons.every * 0.6 : 0,
    };
    enemies.push(e);
    return e;
  }

  function triggerWave() {
    const wave = allWaves()[game.wave];
    game.locked = true;
    if (wave.boss) {
      const count = BOSSES[wave.boss].count ?? 1;
      for (let i = 0; i < count; i++) queue.push({ kind: wave.boss, boss: true, side: 1, in: 0.3 + i * 0.7 });
      game.intro = 2.2;
      say('ding');
    } else {
      wave.foes.forEach((kind, i) => queue.push({ kind, boss: false, side: i % 2 === 0 ? 1 : -1, in: i * 0.45 }));
    }
  }

  function updateQueue(dt) {
    for (const q of queue) q.in -= dt;
    const ready = queue.filter((q) => q.in <= 0);
    queue = queue.filter((q) => q.in > 0);
    for (const q of ready) spawnFoe(q.kind, q.side, q.boss);
  }

  // Only so many may come at you at once; the rest hang back and wait their
  // turn, which is what keeps five goons from being a wall.
  function assignSlots() {
    const busy = new Set(['dying', 'down', 'rise']);
    const live = livePlayers();
    const near = (e) => Math.min(...live.map((p) => Math.hypot(p.x - e.x, p.y - e.y)));
    const fighters = enemies.filter((e) => !e.boss && !busy.has(e.mode));
    if (live.length) fighters.sort((a, b) => near(a) - near(b));
    fighters.forEach((e, i) => { e.slot = i < AGGRO[game.level]; });
    for (const e of enemies) if (e.boss) e.slot = true;
  }

  // --- hits -----------------------------------------------------------------

  function dropFrom(e) {
    const at = { x: clamp(e.x, game.cam + 20, game.cam + court.w - 20), y: clamp(e.y, field.top, field.bottom) };
    if (e.weapon) { items.push({ kind: e.weapon, ...at, left: null }); return; }
    if (e.boss) { items.push({ kind: 'lunch', ...at, left: null }); return; }
    const roll = random();
    if (roll < 0.10) items.push({ kind: 'lunch', ...at, left: null });
    else if (roll < 0.24) items.push({ kind: 'pencil', ...at, left: null });
    else if (roll < 0.30) items.push({ kind: 'squishy', ...at, left: null });
  }

  function hitEnemy(e, damage, dir, knock) {
    const cfg = e.cfg;
    if (e.mode === 'dying' || e.mode === 'down' || e.mode === 'rise') return false;
    e.hp -= damage * (e.stunned ? 2 : 1);
    e.flash = 0.14;
    if (e.hp <= 0) {
      e.hp = 0;
      e.mode = 'dying';
      e.timer = e.boss ? 1.3 : 0.55;
      e.kx = dir * 120;
      e.charging = false;
      run.score += cfg.points;
      say(e.boss ? 'boom' : 'thud');
      dropFrom(e);
      return true;
    }
    const stagger = () => { e.mode = 'hurt'; e.timer = 0.28; e.kx = dir * 90; e.charging = false; };
    const floor = () => { e.mode = 'down'; e.timer = 1.0; e.kx = dir * 200; e.charging = false; e.stunned = false; say('thud'); };
    if (!cfg.tough) { if (knock) floor(); else stagger(); return true; }
    if (e.stunned) { floor(); return true; }
    if (knock) { stagger(); return true; }
    e.poise++;
    if (e.poise >= 3) { e.poise = 0; stagger(); }
    return true;
  }

  function hurtPlayer(p, damage, fromX, knock) {
    if (p.out || p.down > 0 || p.invuln > 0 || game.screen !== 'play') return;
    p.hp -= damage;
    p.attack = null;
    p.combo = 0;
    const dir = p.x >= fromX ? 1 : -1;
    p.kx = dir * (knock ? 220 : 130);
    say('hurt');
    if (p.hp <= 0) {
      p.hp = 0;
      p.lives -= 1;
      p.down = 1.8;
      p.dying = true;
      p.hurt = 0;
      say('thud');
      return;
    }
    if (knock) { p.down = 0.9; p.dying = false; p.hurt = 0; say('thud'); }
    else { p.hurt = 0.32; p.invuln = 0.9; }
  }

  function fire(shot) {
    shots.push({ t: 0, vy: 0, life: 1.6, ...shot });
  }

  function reachOf(p, kick) {
    const base = kick ? KICK.reach : WEAPONS[p.weapon.kind].reach;
    return base * (0.8 + 0.2 * p.hero.size);
  }

  function beginAttack(p, kind) {
    const w = WEAPONS[p.weapon.kind];
    if (kind === 'punch' && w.thrown) { throwSquishy(p); return; }
    const total = (kind === 'kick' ? KICK.time : w.time) / p.hero.rate;
    p.attack = { kind: kind === 'kick' ? 'kick' : p.weapon.kind === 'fists' ? 'punch' : 'weapon', timer: 0, total, landed: false };
    say('swing');
  }

  function throwSquishy(p) {
    const w = WEAPONS.squishy;
    fire({ kind: 'squishy', from: 'player', x: p.x + p.facing * 14, y: p.y, vx: p.facing * w.speed,
      r: 8, damage: w.damage, knock: true, life: 0.85, left: p.weapon.hits - 1, fill: PALETTE.rose });
    p.weapon.hits -= 1;
    if (p.weapon.hits <= 0) p.weapon = { kind: 'fists', hits: null };
    p.attack = { kind: 'throw', timer: 0, total: w.time / p.hero.rate, landed: true };
    say('toss');
  }

  function resolveAttack(p) {
    const kick = p.attack.kind === 'kick';
    const w = WEAPONS[p.weapon.kind];
    const reach = reachOf(p, kick);
    const knock = kick || p.combo + 1 >= COMBO;
    const damage = kick ? p.hero.kick : p.hero.punch + w.damage + (knock ? 1 : 0);
    let landed = 0;
    for (const e of enemies) {
      const half = 10 * e.cfg.size;
      const dx = (e.x - p.x) * p.facing;
      if (dx < -half || dx > reach + half || Math.abs(e.y - p.y) >= LANE) continue;
      if (!hitEnemy(e, damage, p.facing, knock)) continue;
      landed++;
      effects.push({ x: p.x + p.facing * Math.min(dx, reach), y: e.y - 30 * e.cfg.size, t: 0.14 });
    }
    if (!landed) { p.combo = 0; return; }
    say(kick ? 'kick' : 'whack');
    if (kick) return;
    p.combo = knock ? 0 : p.combo + 1;
    p.comboT = COMBO_WINDOW;
    if (w.hits !== null) {
      p.weapon.hits -= 1;
      if (p.weapon.hits <= 0) { p.weapon = { kind: 'fists', hits: null }; say('snap'); }
    }
  }

  function collect(p) {
    for (const item of [...items]) {
      if (Math.abs(item.x - p.x) > 18 || Math.abs(item.y - p.y) >= LANE) continue;
      if (item.kind === 'lunch') {
        if (p.hp >= p.maxHp) run.score += LUNCH_POINTS;
        p.hp = Math.min(p.maxHp, p.hp + LUNCH_HEAL);
        say('heal');
      } else {
        if (p.weapon.kind !== 'fists') continue;
        p.weapon = { kind: item.kind, hits: item.left ?? WEAPONS[item.kind].hits };
        say('pickup');
      }
      items = items.filter((other) => other !== item);
    }
  }

  // --- the players ----------------------------------------------------------

  function updatePlayer(p, frame, dt) {
    if (p.out) return;
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.kx) { p.x += p.kx * dt; p.kx *= Math.max(0, 1 - 9 * dt); if (Math.abs(p.kx) < 4) p.kx = 0; }
    p.x = clamp(p.x, game.cam + 14, game.cam + court.w - 14);
    p.y = clamp(p.y, field.top, field.bottom);

    if (p.down > 0) {
      p.down -= dt;
      if (p.down > 0) return;
      p.down = 0;
      if (!p.dying) { p.invuln = 1.0; return; }
      p.dying = false;
      if (p.lives > 0) { p.hp = p.maxHp; p.invuln = RESPAWN_INVULN; return; }
      p.out = true;
      if (players.every((q) => q.out)) finish(false);
      return;
    }
    if (p.hurt > 0) { p.hurt -= dt; return; }

    if (p.attack) {
      p.attack.timer += dt;
      if (!p.attack.landed && p.attack.timer >= p.attack.total * 0.45) { p.attack.landed = true; resolveAttack(p); }
      if (p.attack && p.attack.timer >= p.attack.total) p.attack = null;
      return;
    }
    p.comboT = Math.max(0, p.comboT - dt);
    if (p.comboT === 0) p.combo = 0;

    const mx = (frame.right ? 1 : 0) - (frame.left ? 1 : 0);
    const my = (frame.down ? 1 : 0) - (frame.up ? 1 : 0);
    if (mx) p.facing = mx;
    if (mx || my) {
      p.x = clamp(p.x + mx * p.hero.speed * dt, game.cam + 14, game.cam + court.w - 14);
      p.y = clamp(p.y + my * p.hero.speed * 0.62 * dt, field.top, field.bottom);
      p.walk += dt * 11;
    } else {
      p.walk = 0;
    }

    if (frame.pressed.a) beginAttack(p, 'punch');
    else if (frame.pressed.b) beginAttack(p, 'kick');
    collect(p);
  }

  // --- the other side -------------------------------------------------------

  function nearestPlayer(e) {
    let best = null;
    let d = Infinity;
    for (const p of livePlayers()) {
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (dist < d) { d = dist; best = p; }
    }
    return best;
  }

  function strike(e) {
    const cfg = e.cfg;
    if (e.charging) {
      e.mode = 'charge';
      e.timer = cfg.charge.for;
      e.chargeCool = cfg.charge.every;
      e.charging = false;
      return;
    }
    e.mode = cfg.hitRun ? 'retreat' : 'recover';
    e.timer = cfg.hitRun ? 0.7 : cfg.recover;
    say('swing');
    for (const p of livePlayers()) {
      const dx = (p.x - e.x) * e.facing;
      if (dx > -8 && dx < cfg.reach + 10 && Math.abs(p.y - e.y) < LANE) hurtPlayer(p, cfg.damage, e.x, Boolean(cfg.slam));
    }
  }

  function throwAt(e) {
    const cfg = e.cfg;
    const look = { wad: { r: 6, fill: PALETTE.cream, damage: 2, speed: 300 },
      ball: { r: 9, fill: PALETTE.ember, damage: 3, speed: 330 },
      clipboard: { r: 8, fill: PALETTE.cream, damage: 3, speed: 300, boomerang: true } }[cfg.ranged];
    fire({ kind: cfg.ranged, from: 'enemy', x: e.x + e.facing * 16, y: e.y, vx: e.facing * look.speed,
      r: look.r, fill: look.fill, damage: look.damage, knock: false, boomerang: look.boomerang ?? false, origin: e.x });
    say('toss');
  }

  function fanAt(e) {
    for (const vy of [-70, 0, 70]) {
      fire({ kind: 'slip', from: 'enemy', x: e.x + e.facing * 16, y: e.y, vx: e.facing * 260, vy,
        r: 6, fill: PALETTE.rose, damage: 2, knock: false, life: 1.4 });
    }
    say('toss');
  }

  function walk(e, dt) {
    const cfg = e.cfg;
    const t = nearestPlayer(e);
    if (!t) return;
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const adx = Math.abs(dx);
    e.facing = sign(dx || e.facing);

    // A charge wants a lane and some room.
    if (cfg.charge && e.slot && e.chargeCool <= 0 && Math.abs(dy) < LANE && adx > 90 && adx < 330) {
      e.mode = 'wind'; e.charging = true; e.timer = cfg.charge.wind; return;
    }
    // A swing wants you in reach. The thrower swings too, if you make it.
    if (e.slot && adx < cfg.reach + 4 && Math.abs(dy) < LANE) {
      e.mode = 'wind'; e.charging = false; e.timer = cfg.wind; return;
    }
    // A throw wants a lane and a gap.
    if (cfg.ranged && e.slot && e.cool <= 0 && Math.abs(dy) < LANE && adx > cfg.keep * 0.5 && adx < cfg.keep * 1.6) {
      e.mode = 'throw'; e.timer = cfg.wind; return;
    }
    if (cfg.fan && e.slot && e.fanCool <= 0 && e.hp <= e.maxHp * cfg.fan.below && adx > 60) {
      e.mode = 'throw'; e.timer = cfg.wind; e.fanning = true; return;
    }

    let gx;
    let gy = t.y;
    if (cfg.ranged) {
      gx = clamp(t.x - e.facing * cfg.keep, game.cam + 40, game.cam + court.w - 40);
    } else if (e.slot) {
      gx = t.x - e.facing * (cfg.reach * 0.85 + 6);
    } else {
      // Hang back and wait for a slot: walk to arm's length, not away from it.
      gx = adx > 150 ? t.x - e.facing * 150 : e.x;
      gy = clamp(t.y + e.hover, field.top, field.bottom);
    }
    const speed = cfg.speed;
    const stepX = clamp(gx - e.x, -speed * dt, speed * dt);
    const stepY = clamp(gy - e.y, -speed * 0.7 * dt, speed * 0.7 * dt);
    e.x += stepX;
    e.y += stepY;
    e.walking = Math.abs(stepX) + Math.abs(stepY) > 0.2;
  }

  function updateEnemy(e, dt) {
    const cfg = e.cfg;
    e.flash = Math.max(0, e.flash - dt);
    e.cool = Math.max(0, e.cool - dt);
    e.chargeCool = Math.max(0, e.chargeCool - dt);
    e.fanCool = Math.max(0, e.fanCool - dt);
    e.phase += dt;
    e.walking = false;
    if (e.kx) { e.x += e.kx * dt; e.kx *= Math.max(0, 1 - 9 * dt); if (Math.abs(e.kx) < 4) e.kx = 0; }

    // Once in the room, nobody leaves it: a thrower that kept its distance by
    // standing just off the edge of the screen could neither be hit nor throw.
    if (!e.entered && e.x > game.cam + 20 && e.x < game.cam + court.w - 20) e.entered = true;
    if (e.entered) e.x = clamp(e.x, game.cam + 12, game.cam + court.w - 12);
    e.y = clamp(e.y, field.top, field.bottom);

    if (cfg.summons && e.mode !== 'dying') {
      e.summonIn -= dt;
      const alive = enemies.filter((o) => o.kind === cfg.summons.kind && o.mode !== 'dying').length;
      if (e.summonIn <= 0) {
        e.summonIn = cfg.summons.every;
        if (alive < cfg.summons.max) { spawnFoe(cfg.summons.kind, random() < 0.5 ? 1 : -1); say('whistle'); }
      }
    }

    switch (e.mode) {
      case 'dying':
        e.timer -= dt;
        if (e.timer <= 0) enemies = enemies.filter((o) => o !== e);
        return;
      case 'down':
        e.timer -= dt;
        if (e.timer <= 0) { e.mode = 'rise'; e.timer = 0.35; }
        return;
      case 'rise':
      case 'hurt':
        e.timer -= dt;
        if (e.timer <= 0) e.mode = 'approach';
        return;
      case 'recover':
        e.timer -= dt;
        if (e.timer <= 0) { e.mode = 'approach'; e.stunned = false; }
        return;
      case 'retreat': {
        const t = nearestPlayer(e);
        e.timer -= dt;
        if (t) { e.x -= sign(t.x - e.x) * cfg.speed * 1.1 * dt; e.walking = true; }
        if (e.timer <= 0) e.mode = 'approach';
        return;
      }
      case 'wind':
        e.timer -= dt;
        if (e.timer <= 0) strike(e);
        return;
      case 'throw':
        e.timer -= dt;
        if (e.timer > 0) return;
        if (e.fanning) { fanAt(e); e.fanning = false; e.fanCool = cfg.fan.every; }
        else { throwAt(e); e.cool = cfg.every; }
        e.mode = 'recover';
        e.timer = cfg.recover;
        return;
      case 'charge': {
        e.x += e.facing * cfg.charge.speed * dt;
        e.timer -= dt;
        e.walking = true;
        let hit = false;
        for (const p of livePlayers()) {
          const dx = (p.x - e.x) * e.facing;
          if (dx > -10 && dx < 22 * cfg.size && Math.abs(p.y - e.y) < LANE) { hurtPlayer(p, cfg.damage, e.x, true); hit = true; }
        }
        const off = e.entered && (e.x <= game.cam + 12 || e.x >= game.cam + court.w - 12);
        if (hit || off || e.timer <= 0) {
          e.mode = 'recover';
          e.timer = cfg.recover + 0.6;
          e.stunned = true;
        }
        return;
      }
      default:
        walk(e, dt);
    }
  }

  // --- things in the air ----------------------------------------------------

  function updateShots(dt) {
    for (const s of [...shots]) {
      s.t += dt;
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.boomerang && !s.back && s.t > 0.55) { s.back = true; s.vx = -s.vx; }

      let gone = s.life <= 0 || s.x < game.cam - 40 || s.x > game.cam + court.w + 40;
      if (s.boomerang && s.back && (s.x - s.origin) * s.vx > 0) gone = true;

      if (!gone && s.from === 'enemy') {
        for (const p of livePlayers()) {
          if (Math.abs(s.x - p.x) < 12 + s.r && Math.abs(s.y - p.y) < LANE && p.invuln <= 0) {
            hurtPlayer(p, s.damage, s.x, s.knock);
            gone = true;
            break;
          }
        }
      } else if (!gone) {
        for (const e of enemies) {
          if (Math.abs(s.x - e.x) < 12 * e.cfg.size + s.r && Math.abs(s.y - e.y) < LANE && hitEnemy(e, s.damage, sign(s.vx), true)) {
            effects.push({ x: s.x, y: e.y - 30 * e.cfg.size, t: 0.14 });
            gone = true;
            break;
          }
        }
      }
      if (!gone) continue;
      if (s.kind === 'squishy' && s.left > 0) {
        items.push({ kind: 'squishy', x: clamp(s.x, game.cam + 20, game.cam + court.w - 20), y: s.y, left: s.left });
      }
      shots = shots.filter((o) => o !== s);
    }
  }

  function updateEffects(dt) {
    for (const fx of effects) fx.t -= dt;
    effects = effects.filter((fx) => fx.t > 0);
  }

  // --- the camera and the waves ---------------------------------------------

  const waveLimit = () => (game.wave < allWaves().length ? allWaves()[game.wave].at : level().length - court.w);

  function updateCamera() {
    const live = players.filter((p) => !p.out);
    if (!live.length) return;
    const avg = live.reduce((s, p) => s + p.x, 0) / live.length;
    const limit = waveLimit();
    if (!game.locked) game.cam = clamp(Math.max(game.cam, avg - court.w * 0.42), 0, limit);
    // Whatever the camera leaves behind is gone: nobody can walk back to it.
    items = items.filter((item) => item.x >= game.cam + 10);
    if (!game.locked && game.wave < allWaves().length && game.cam >= limit - 0.5) triggerWave();
  }

  function checkWave(dt) {
    if (game.locked && !queue.length && !enemies.length) {
      game.locked = false;
      game.wave++;
      if (game.wave >= allWaves().length) game.clearIn = 1.0;
    }
    if (game.clearIn > 0) {
      game.clearIn -= dt;
      if (game.clearIn <= 0) { game.clearIn = 0; levelClear(); }
    }
  }

  function play(dt, p1, p2) {
    game.playTime += dt;
    if (game.intro > 0) game.intro -= dt;
    updatePlayer(players[0], p1, dt);
    if (players[1]) updatePlayer(players[1], p2, dt);
    if (game.screen !== 'play') return; // the last kid just went down
    updateQueue(dt);
    assignSlots();
    for (const e of [...enemies]) updateEnemy(e, dt);
    updateShots(dt);
    updateEffects(dt);
    updateCamera();
    checkWave(dt);
  }

  // --- menus ----------------------------------------------------------------

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }

  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function beginPick(count) {
    game.players = count;
    game.picks = [{ hero: 0, locked: false }, { hero: 1, locked: false }];
    game.pickedAt = 0;
    go('pick');
  }

  function pick(frame, i) {
    const p = game.picks[i];
    if (!p.locked) {
      const n = ROSTER.length;
      if (frame.pressed.left || frame.pressed.up) { p.hero = (p.hero + n - 1) % n; say('move'); }
      if (frame.pressed.right || frame.pressed.down) { p.hero = (p.hero + 1) % n; say('move'); }
      if (frame.pressed.a) { p.locked = true; say('select'); }
    } else if (frame.pressed.b) {
      p.locked = false;
      say('back');
    }
  }

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

  // --- the step -------------------------------------------------------------

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    game.elapsed += dt;
    game.clock += dt;

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        say('select');
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') game.exit = true;
        else if (choice === 'scores') { game.board = table.table(GAME); go('scores'); }
        else if (choice === 'howto') go('howto');
        else beginPick(choice === '2p' ? 2 : 1);
        break;
      }

      case 'howto':
      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); game.cursor = 0; go('menu'); }
        break;

      case 'pick': {
        pick(p1, 0);
        if (game.players === 2) pick(p2, 1);
        const needed = game.picks.slice(0, game.players);
        if (needed.every((p) => p.locked)) {
          game.pickedAt += dt;
          if (game.pickedAt >= 0.5) newRun();
        } else {
          game.pickedAt = 0;
          if (any.pressed.b && !needed.some((p) => p.locked)) { say('back'); game.cursor = 0; go('menu'); }
        }
        break;
      }

      case 'brief':
        if (game.elapsed >= GRACE && confirmed(any)) { say('bell'); go('play'); }
        break;

      case 'play':
        if (any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        play(dt, p1, p2);
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

      case 'clear':
        if (game.elapsed >= 1.0 && confirmed(any)) { say('select'); nextLevel(); }
        break;

      case 'ending':
        if (game.elapsed >= GRACE && confirmed(any)) finish(true);
        break;

      case 'over':
        if (game.elapsed < 0.6) break;
        if (game.placing > 0) { editInitials(any); break; }
        if (confirmed(any) || any.pressed.b) { say('select'); game.cursor = 0; go('menu'); }
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
    }
  }

  // --- drawing --------------------------------------------------------------

  const sx = (x) => court.x + x - game.cam;

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

  // Everybody. Feet at (x, y); every part overlaps the next so a figure never
  // leaves a one-pixel gap of ink inside itself.
  function figure(x, y, look, o = {}) {
    const s = o.size ?? 1;
    const f = o.facing ?? 1;
    const pose = o.pose ?? 'stand';
    const body = o.tint ?? look.body;
    const skin = o.tint ?? look.skin;
    const trim = o.tint ?? look.trim;
    const r = (v) => Math.max(3, v);
    const shapes = [];
    const hr = 9 * s;

    if (pose === 'down') {
      shapes.push(rect(x - 14 * s, y - 10 * s, 28 * s, 10 * s, body));
      shapes.push(rect(x + f * 12 * s - 6 * s, y - 9 * s, 14 * s, 8 * s, trim));
      shapes.push(disc(x - f * 20 * s, y - 8 * s, hr, skin));
      shapes.push(rect(x - f * 20 * s - hr, y - 8 * s - hr + 2 * s, 2 * hr, 6 * s, look.hair));
      return shapes;
    }

    const legH = 14 * s;
    const bh = 22 * s;
    const chest = y - legH - bh + 3 * s;
    const stride = o.walk ? Math.sin(o.walk) * 5 * s : 0;
    const lean = pose === 'hurt' ? -f * 3 * s : pose === 'charge' ? f * 4 * s : 0;

    // Legs.
    if (pose === 'kick') {
      shapes.push(rect(x - 3.5 * s - f * 3 * s, y - legH, 7 * s, legH, trim));
      shapes.push(chain([pt(x, y - legH + 3 * s, r(4 * s)), pt(x + f * (o.reach ?? 30), y - legH - 3 * s, r(5 * s))], trim));
    } else {
      shapes.push(rect(x - 8 * s + stride, y - legH, 7 * s, legH, trim));
      shapes.push(rect(x + 1 * s - stride, y - legH, 7 * s, legH, trim));
    }
    // Body and head.
    shapes.push(rect(x - 9 * s + lean, chest, 18 * s, bh, body));
    if (look.tie) shapes.push(rect(x - 2 * s + lean, chest + 2 * s, 4 * s, 12 * s, PALETTE.ember));
    const headY = chest - hr + 4 * s;
    shapes.push(disc(x + lean, headY, hr, skin));
    shapes.push(rect(x - hr + lean, headY - hr - 1 * s, 2 * hr, 7 * s, look.hair));
    if (look.cap) shapes.push(rect(x + lean + (f > 0 ? hr - 2 * s : -hr - 6 * s), headY - hr + 2 * s, 8 * s, 4 * s, look.hair));
    if (look.glasses) shapes.push(rect(x + lean + (f > 0 ? 1 * s : -11 * s), headY - 2 * s, 10 * s, 3 * s, PALETTE.ink));
    shapes.push(disc(x + lean + f * 4 * s, headY - 1 * s, r(3 * s), PALETTE.ink));
    if (look.whistle) shapes.push(disc(x + lean + f * 6 * s, chest + 4 * s, r(3 * s), PALETTE.sun));

    // The arm, and whatever is in the hand.
    const shoulder = pt(x + lean + f * 4 * s, chest + 5 * s, r(3.5 * s));
    let hand;
    switch (pose) {
      case 'punch': hand = pt(x + f * (o.reach ?? 30), chest + 6 * s, r(4.5 * s)); break;
      case 'weapon': hand = pt(x + f * 12 * s, chest + 6 * s, r(4 * s)); break;
      case 'wind': hand = pt(x - f * 10 * s, chest + 4 * s, r(4.5 * s)); break;
      case 'throw': hand = pt(x - f * 4 * s, chest - 8 * s, r(4 * s)); break;
      case 'hurt': hand = pt(x - f * 6 * s, chest - 2 * s, r(4 * s)); break;
      case 'charge': hand = pt(x + f * 16 * s, chest + 8 * s, r(4.5 * s)); break;
      default: hand = pt(x + f * (8 * s + stride), chest + 16 * s, r(3.5 * s));
    }
    shapes.push(chain([shoulder, hand], skin));

    const held = o.weapon;
    if (held === 'pencil') {
      const ahead = pose === 'weapon' ? (o.reach ?? 36) - 12 * s : 16 * s;
      shapes.push(chain([pt(hand.x, hand.y, r(3 * s)), pt(hand.x + f * ahead, hand.y - (pose === 'weapon' ? 0 : 6 * s), r(2.5 * s))], PALETTE.sun));
      shapes.push(disc(hand.x + f * ahead, hand.y - (pose === 'weapon' ? 0 : 6 * s), r(2.5 * s), PALETTE.ink));
    } else if (held === 'ruler') {
      const len = pose === 'weapon' ? (o.reach ?? 54) - 8 * s : 30 * s;
      const rx = f > 0 ? hand.x - 4 * s : hand.x - len + 4 * s;
      shapes.push(rect(rx, hand.y - 3 * s, len, 6 * s, PALETTE.sunLit));
    } else if (held === 'squishy') {
      shapes.push(disc(hand.x, hand.y, r(7 * s), PALETTE.rose));
    } else if (held === 'clipboard') {
      shapes.push(rect(hand.x - 6 * s, hand.y - 8 * s, 12 * s, 16 * s, PALETTE.cream));
    }
    return shapes;
  }

  const lookOf = (p) => {
    const hero = p.hero;
    const twin = players.length === 2 && players[0].heroId === players[1].heroId;
    return p.index === 1 && twin ? { ...hero, body: hero.alt } : hero;
  };

  function playerSprite(p) {
    if (p.out) return null;
    const blink = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;
    const tint = blink ? PALETTE.creamDim : null;
    const opts = { size: p.hero.size, facing: p.facing, tint, weapon: p.weapon.kind === 'fists' ? null : p.weapon.kind };
    if (p.down > 0) opts.pose = 'down';
    else if (p.hurt > 0) opts.pose = 'hurt';
    else if (p.attack) {
      const swing = p.attack.timer / p.attack.total;
      const out = Math.sin(Math.min(1, swing) * Math.PI);
      opts.pose = p.attack.kind === 'throw' ? 'throw' : p.attack.kind;
      opts.reach = reachOf(p, p.attack.kind === 'kick') * (0.35 + 0.65 * out);
    } else if (p.walk) opts.walk = p.walk;
    return { y: p.y, shapes: figure(sx(p.x), p.y, lookOf(p), opts) };
  }

  function enemySprite(e) {
    const cfg = e.cfg;
    const winding = e.mode === 'wind' || e.mode === 'throw';
    const tint = e.flash > 0 ? PALETTE.cream : winding ? PALETTE.sunLit : e.stunned ? PALETTE.stoneLit : null;
    const opts = { size: cfg.size, facing: e.facing, tint, weapon: e.weapon ?? (cfg.ranged === 'clipboard' ? 'clipboard' : null) };
    if (e.mode === 'dying' || e.mode === 'down') opts.pose = 'down';
    else if (e.mode === 'hurt') opts.pose = 'hurt';
    else if (e.mode === 'wind') opts.pose = e.charging ? 'charge' : 'wind';
    else if (e.mode === 'throw') opts.pose = 'throw';
    else if (e.mode === 'charge') opts.pose = 'charge';
    else if (e.mode === 'recover') opts.pose = 'punch', opts.reach = cfg.reach * 0.9;
    else if (e.walking) opts.walk = e.phase * 11;
    const shake = e.mode === 'dying' && e.boss ? Math.sin(e.timer * 50) * 3 : 0;
    return { y: e.y, shapes: figure(sx(e.x) + shake, e.y, cfg, opts) };
  }

  const ITEM_LOOK = {
    lunch: (x, y) => [rect(x - 10, y - 14, 20, 12, PALETTE.ember), rect(x - 4, y - 18, 8, 6, PALETTE.emberDim), rect(x - 10, y - 8, 20, 3, PALETTE.cream)],
    pencil: (x, y) => [chain([pt(x - 10, y - 4, 3), pt(x + 8, y - 8, 3)], PALETTE.sun), disc(x + 10, y - 8, 3, PALETTE.ink)],
    ruler: (x, y) => [rect(x - 16, y - 8, 32, 7, PALETTE.sunLit)],
    squishy: (x, y) => [disc(x, y - 8, 8, PALETTE.rose), disc(x - 3, y - 9, 3, PALETTE.ink), disc(x + 3, y - 9, 3, PALETTE.ink)],
  };

  const itemSprite = (item) => {
    const lift = Math.sin(game.playTime * 3 + item.x) * 2;
    return { y: item.y, shapes: ITEM_LOOK[item.kind](sx(item.x), item.y + lift) };
  };

  const shotSprite = (s) => {
    const x = sx(s.x);
    const y = s.y - 26;
    if (s.kind === 'clipboard') return { y: s.y, shapes: [rect(x - 7, y - 9, 14, 18, PALETTE.cream), rect(x - 4, y - 12, 8, 5, PALETTE.stone)] };
    if (s.kind === 'slip') return { y: s.y, shapes: [rect(x - 7, y - 5, 14, 10, PALETTE.rose)] };
    return { y: s.y, shapes: [disc(x, y, s.r, s.fill)] };
  };

  // One inked layer per sprite, nearest last.
  function spriteLayers() {
    const sprites = [];
    for (const item of items) sprites.push(itemSprite(item));
    for (const e of enemies) sprites.push(enemySprite(e));
    for (const p of players) { const sp = playerSprite(p); if (sp) sprites.push(sp); }
    for (const s of shots) sprites.push(shotSprite(s));
    sprites.sort((a, b) => a.y - b.y);
    return sprites.map((sp) => ({ ink: INK, shapes: sp.shapes }));
  }

  function shadows() {
    const fill = { hall: PALETTE.stoneDim, gym: PALETTE.bark, field: PALETTE.turfDim, courts: PALETTE.ink, auditorium: PALETTE.barkDim }[level().id];
    const out = [];
    const pill = (x, y, w) => out.push(chain([pt(x - w, y, 5), pt(x + w, y, 5)], fill));
    for (const p of players) if (!p.out) pill(sx(p.x), p.y, 8 * p.hero.size);
    for (const e of enemies) pill(sx(e.x), e.y, 8 * e.cfg.size);
    return out;
  }

  // --- backdrops --------------------------------------------------------------
  //
  // Every stage is a wall band and a floor band, tiled from the camera.
  function tiled(period, draw) {
    const first = Math.floor((game.cam - 160) / period);
    const last = Math.ceil((game.cam + court.w + 160) / period);
    for (let k = first; k <= last; k++) draw(court.x + k * period - game.cam, k);
  }

  function backdrop() {
    const shapes = [];
    const id = level().id;

    if (id === 'hall') {
      shapes.push(rect(court.x, wallY, court.w, WALL_H, PALETTE.creamDim));
      tiled(44, (x, k) => {
        if (k % 9 === 0) {
          shapes.push(rect(x, wallY + 18, 84, WALL_H - 28, PALETTE.bark));
          shapes.push(rect(x + 14, wallY + 30, 26, 34, PALETTE.creamDim));
          shapes.push(rect(x + 44, wallY + 30, 26, 34, PALETTE.creamDim));
          shapes.push(disc(x + 60, wallY + 90, 4, PALETTE.sun));
        } else if (k % 9 !== 1) {
          shapes.push(rect(x + 4, wallY + 30, 36, 104, PALETTE.sky));
          shapes.push(rect(x + 12, wallY + 40, 20, 6, PALETTE.skyDim));
          shapes.push(rect(x + 12, wallY + 52, 20, 6, PALETTE.skyDim));
          shapes.push(rect(x + 28, wallY + 84, 5, 12, PALETTE.skyDim));
        }
      });
      shapes.push(rect(court.x, floorY - 10, court.w, 10, PALETTE.barkDim));
      shapes.push(rect(court.x, floorY, court.w, floorH, PALETTE.stone));
      tiled(40, (x, k) => {
        for (let row = 0; row < 6; row++) {
          if ((k + row) % 2 === 0) shapes.push(rect(x, floorY + row * 40, 40, 40, PALETTE.stoneLit));
        }
      });
    } else if (id === 'gym') {
      shapes.push(rect(court.x, wallY, court.w, WALL_H, PALETTE.barkDim));
      for (let i = 0; i < 5; i++) {
        shapes.push(rect(court.x, wallY + 36 + i * 22, court.w, 22, i % 2 ? PALETTE.bark : PALETTE.barkLit));
      }
      tiled(300, (x) => shapes.push(rect(x + 40, wallY + 6, 130, 22, PALETTE.sun), rect(x + 52, wallY + 12, 106, 4, PALETTE.ember)));
      tiled(60, (x) => shapes.push(rect(x, wallY + 34, 6, WALL_H - 34, PALETTE.barkDim)));
      shapes.push(rect(court.x, floorY, court.w, floorH, PALETTE.barkLit));
      shapes.push(rect(court.x, floorY + 6, court.w, 4, PALETTE.cream));
      shapes.push(rect(court.x, floorY + floorH - 12, court.w, 4, PALETTE.cream));
      tiled(900, (x) => {
        shapes.push(rect(x - 2, floorY + 6, 4, floorH - 14, PALETTE.cream));
        shapes.push(disc(x, floorY + floorH / 2, 46, PALETTE.cream));
        shapes.push(disc(x, floorY + floorH / 2, 40, PALETTE.barkLit));
      });
    } else if (id === 'field') {
      shapes.push(rect(court.x, wallY, court.w, WALL_H, PALETTE.sky));
      shapes.push(rect(court.x, wallY + WALL_H - 28, court.w, 28, PALETTE.turfDim));
      tiled(140, (x, k) => {
        const h = 60 + (k % 3) * 12;
        shapes.push(rect(x - 6, wallY + WALL_H - h, 12, h, PALETTE.bark));
        shapes.push(disc(x, wallY + WALL_H - h - 10, 34, PALETTE.leafDim));
        shapes.push(disc(x - 10, wallY + WALL_H - h - 22, 26, PALETTE.leaf));
      });
      tiled(1200, (x) => {
        shapes.push(rect(x, wallY + 60, 8, 64, PALETTE.cream));
        shapes.push(rect(x + 150, wallY + 60, 8, 64, PALETTE.cream));
        shapes.push(rect(x, wallY + 60, 158, 8, PALETTE.cream));
        shapes.push(rect(x + 8, wallY + 68, 142, 52, PALETTE.stoneLit));
      });
      shapes.push(rect(court.x, floorY, court.w, floorH, PALETTE.turf));
      tiled(80, (x) => shapes.push(rect(x, floorY, 40, floorH, PALETTE.turfLit)));
      shapes.push(rect(court.x, floorY + 6, court.w, 4, PALETTE.cream));
      shapes.push(rect(court.x, floorY + floorH - 12, court.w, 4, PALETTE.cream));
      tiled(600, (x) => shapes.push(rect(x - 2, floorY + 6, 4, floorH - 14, PALETTE.cream)));
    } else if (id === 'courts') {
      shapes.push(rect(court.x, wallY, court.w, WALL_H, PALETTE.skyDim));
      shapes.push(rect(court.x, wallY + 40, court.w, WALL_H - 40, PALETTE.stoneDim));
      shapes.push(rect(court.x, wallY + 40, court.w, 6, PALETTE.stone));
      tiled(90, (x) => shapes.push(rect(x, wallY + 40, 6, WALL_H - 40, PALETTE.stone)));
      tiled(800, (x) => {
        shapes.push(rect(x - 5, wallY + 20, 10, WALL_H - 20, PALETTE.bark));
        shapes.push(rect(x - 26, wallY + 14, 52, 36, PALETTE.cream));
        shapes.push(rect(x - 10, wallY + 26, 20, 16, PALETTE.stone));
        shapes.push(rect(x - 12, wallY + 48, 24, 6, PALETTE.emberLit));
      });
      shapes.push(rect(court.x, floorY, court.w, floorH, PALETTE.stoneDim));
      shapes.push(rect(court.x, floorY + 6, court.w, 4, PALETTE.sun));
      shapes.push(rect(court.x, floorY + floorH - 12, court.w, 4, PALETTE.sun));
      tiled(800, (x) => {
        shapes.push(rect(x - 60, floorY + 6, 4, 100, PALETTE.sun));
        shapes.push(rect(x + 56, floorY + 6, 4, 100, PALETTE.sun));
        shapes.push(rect(x - 60, floorY + 102, 120, 4, PALETTE.sun));
      });
    } else {
      shapes.push(rect(court.x, wallY, court.w, WALL_H, PALETTE.violetDim));
      tiled(48, (x) => {
        shapes.push(rect(x, wallY, 24, WALL_H - 20, PALETTE.emberDim));
        shapes.push(rect(x + 24, wallY, 24, WALL_H - 20, PALETTE.ember));
      });
      shapes.push(rect(court.x, wallY, court.w, 22, PALETTE.emberDim));
      shapes.push(rect(court.x, wallY + 22, court.w, 6, PALETTE.sun));
      shapes.push(rect(court.x, floorY - 20, court.w, 20, PALETTE.barkDim));
      tiled(60, (x) => shapes.push(disc(x, floorY - 8, 5, PALETTE.sun)));
      shapes.push(rect(court.x, floorY, court.w, floorH, PALETTE.bark));
      for (let row = 1; row < 8; row++) shapes.push(rect(court.x, floorY + row * 30, court.w, 3, PALETTE.barkDim));
      tiled(240, (x) => shapes.push(rect(x, floorY, 3, floorH, PALETTE.barkDim)));
    }
    return shapes;
  }

  // --- chrome -----------------------------------------------------------------

  function hudParts() {
    const shapes = [
      rect(court.x, court.y, court.w, HUD_H, PALETTE.ink),
      rect(court.x + 8, court.y + HUD_H - 4, court.w - 16, 2, PALETTE.barkDim),
    ];
    const labels = [];
    players.forEach((p, i) => {
      // Player two's block is pushed to the edge: the score sits between them
      // and a six-figure score is 192 pixels wide.
      const bx = i === 0 ? court.x + 12 : court.x + court.w - 12 - 200;
      const look = lookOf(p);
      labels.push(text(look.name, bx, court.y + 6, { anchor: 'start', fill: p.out ? PALETTE.barkDim : look.body }));
      shapes.push(rect(bx + 86, court.y + 9, 114, 16, PALETTE.barkDim));
      const frac = p.maxHp ? p.hp / p.maxHp : 0;
      if (frac > 0) shapes.push(rect(bx + 89, court.y + 12, Math.max(2, 108 * frac), 10, frac > 0.3 ? PALETTE.moss : PALETTE.ember));
      for (let j = 0; j < p.lives; j++) shapes.push(disc(bx + 94 + j * 16, court.y + 40, 5, PALETTE.cream));
      const w = WEAPONS[p.weapon.kind];
      labels.push(text(p.out ? 'OUT' : `${w.name}${w.hits === null ? '' : ` ${p.weapon.hits}`}`, bx, court.y + 32,
        { anchor: 'start', scale: 1, fill: PALETTE.sun }));
    });
    labels.push(centred(`SCORE ${String(run.score).padStart(6, '0')}`, court.y + 22, { fill: PALETTE.cream }));
    labels.push(centred(`${game.level + 1}  ${level().name}`, court.y + 44, { scale: 1, fill: PALETTE.bark }));
    return { shapes, labels };
  }

  function bossParts() {
    const bosses = enemies.filter((e) => e.boss);
    if (!bosses.length) return { shapes: [], labels: [] };
    const hp = bosses.reduce((s, e) => s + e.hp, 0);
    const max = bosses.reduce((s, e) => s + e.maxHp, 0);
    const w = 300;
    const x = mid.x - w / 2;
    const y = wallY + 8;
    const cfg = bosses[0].cfg;
    const shapes = [
      rect(x - 3, y - 3, w + 6, 20, PALETTE.ink),
      rect(x, y, w, 14, PALETTE.barkDim),
      ...(hp > 0 ? [rect(x, y, Math.max(2, (w * hp) / max), 14, PALETTE.ember)] : []),
    ];
    const labels = [text(cfg.name, mid.x, y + 22, { scale: 1, fill: PALETTE.cream })];
    if (game.intro > 0) {
      shapes.push(rect(mid.x - 250, mid.y - 66, 500, 108, PALETTE.ink));
      labels.push(centred(cfg.name, mid.y - 34, { font: HEAVY, scale: 1, fill: PALETTE.sun }));
      labels.push(centred(cfg.title, mid.y - 4, { scale: 1, fill: PALETTE.bark }));
      labels.push(centred(cfg.taunt, mid.y + 22, { fill: PALETTE.cream }));
    }
    return { shapes, labels };
  }

  function goParts() {
    if (game.locked || game.wave >= allWaves().length || game.clearIn > 0) return null;
    if (Math.floor(game.playTime * 3) % 2 !== 0) return null;
    const x = court.x + court.w - 26;
    const y = floorY + 60;
    return {
      layer: { ink: INK, shapes: [chain([pt(x - 40, y, 6), pt(x, y, 11)], PALETTE.cream)] },
      label: text('GO', x - 84, y - 16, { fill: PALETTE.sun }),
    };
  }

  function playLayers() {
    return [
      { flat: true, shapes: [...backdrop(), ...shadows()] },
      ...spriteLayers(),
    ];
  }

  function playScreen() {
    const hud = hudParts();
    const boss = bossParts();
    const go_ = goParts();
    const stars = effects.map((fx) => disc(sx(fx.x), fx.y, 5, PALETTE.sun));
    return {
      layers: [
        ...playLayers(),
        ...(go_ ? [go_.layer] : []),
        { flat: true, shapes: [...stars, ...hud.shapes, ...boss.shapes] },
      ],
      text: [...hud.labels, ...boss.labels, ...(go_ ? [go_.label] : [])],
    };
  }

  function pausedScreen() {
    const hud = hudParts();
    // One faded layer rather than one per sprite: the dither breaks every ink
    // run up anyway, and a scratch copy per sprite is a slow way to be still.
    const all = playLayers();
    const faded = [
      { ...all[0], alpha: 0.25 },
      { ink: INK, alpha: 0.25, shapes: all.slice(1).flatMap((layer) => layer.shapes) },
    ];
    return {
      layers: [...faded, { flat: true, shapes: hud.shapes }],
      text: [
        ...hud.labels,
        centred('PAUSED', wallY + 60, { font: HEAVY, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((item, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${item.label}`, wallY + 140 + i * 44,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
      ],
    };
  }

  // The lockers along the bottom of every card, and the paper going past.
  function dressing() {
    const shapes = [];
    for (const paper of papers) {
      const x = court.x + ((paper.x + game.clock * paper.speed) % court.w);
      const y = paper.y + Math.sin(game.clock * 1.7 + paper.phase) * 6;
      shapes.push(rect(x, y, paper.w, paper.w * 0.75, PALETTE.creamDim));
    }
    const base = court.y + court.h - 44;
    shapes.push(rect(court.x, base, court.w, 44, PALETTE.stoneDim));
    for (let x = court.x + 8; x < court.x + court.w - 30; x += 40) {
      shapes.push(rect(x, base - 60, 32, 60, PALETTE.skyDim));
      shapes.push(rect(x + 8, base - 50, 16, 5, PALETTE.ink));
    }
    return shapes;
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: dressing() }],
      text: [
        centred('TIMMY', court.y + 46, { fill: PALETTE.sky }),
        centred('TOUGH KNUCKLES', court.y + 90, { font: HEAVY, fill: PALETTE.sun }),
        ...MENU.map((item, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${item.label}`, court.y + 170 + i * 40,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
        centred('START OR A TO CHOOSE', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function pickScreen() {
    const shapes = dressing();
    const layers = [{ flat: true, shapes }];
    const labels = [centred(game.players === 2 ? 'CHOOSE YOUR KIDS' : 'CHOOSE YOUR KID', court.y + 40, { font: HEAVY, scale: 1, fill: PALETTE.sun })];
    ROSTER.forEach((id, i) => {
      const hero = HEROES[id];
      const cx = mid.x + (i - 1) * 196;
      const card = { x: cx - 84, y: court.y + 78, w: 168, h: 236 };
      const on = game.picks.slice(0, game.players).map((p, j) => (p.hero === i ? j : -1)).filter((j) => j >= 0);
      const border = on.length ? (on[0] === 0 ? PALETTE.sky : PALETTE.rose) : PALETTE.barkDim;
      shapes.push(rect(card.x - 4, card.y - 4, card.w + 8, card.h + 8, border));
      shapes.push(rect(card.x, card.y, card.w, card.h, PALETTE.ink));
      layers.push({ ink: INK, shapes: figure(cx, card.y + 128, hero, { size: 2.2, facing: 1, walk: on.length ? game.clock * 9 : 0 }) });
      labels.push(text(hero.name, cx, card.y + 142, { fill: on.length ? PALETTE.sun : PALETTE.cream }));
      labels.push(text(hero.blurb, cx, card.y + 172, { scale: 1, fill: PALETTE.bark }));
      ['speed', 'power', 'grit'].forEach((stat, row) => {
        const y = card.y + 192 + row * 14;
        labels.push(text(stat.toUpperCase(), card.x + 12, y - 2, { anchor: 'start', scale: 1, fill: PALETTE.creamDim }));
        for (let k = 0; k < 5; k++) {
          shapes.push(rect(card.x + 70 + k * 19, y, 16, 10, k < hero.stats[stat] ? PALETTE.sun : PALETTE.barkDim));
        }
      });
      on.forEach((j, n) => {
        const pick = game.picks[j];
        labels.push(text(pick.locked ? `P${j + 1} READY` : `P${j + 1}`, cx + (on.length > 1 ? (n ? 44 : -44) : 0), card.y - 30,
          { scale: 1, fill: j === 0 ? PALETTE.sky : PALETTE.rose }));
      });
    });
    labels.push(centred('A PICKS   B BACKS OUT', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }));
    return { layers, text: labels };
  }

  function briefScreen() {
    const lvl = level();
    return {
      layers: [{ flat: true, shapes: dressing() }],
      text: [
        centred(`STAGE ${game.level + 1}`, court.y + 44, { fill: PALETTE.bark }),
        centred(lvl.name, court.y + 88, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...lvl.brief.map((line, i) => centred(line, court.y + 160 + i * 36, { fill: PALETTE.cream })),
        centred(game.elapsed >= GRACE ? 'A TO START' : '', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function clearScreen() {
    return {
      layers: [{ flat: true, shapes: dressing() }],
      text: [
        centred('STAGE CLEAR', court.y + 70, { font: HEAVY, fill: PALETTE.sun }),
        centred(`CLEAR BONUS ${game.bonus.clear}`, court.y + 150, { fill: PALETTE.cream }),
        centred(`LIVES BONUS ${game.bonus.lives}`, court.y + 186, { fill: PALETTE.cream }),
        centred(`SCORE ${run.score}`, court.y + 240, { fill: PALETTE.moss }),
        centred(game.elapsed >= 1 ? 'A TO CONTINUE' : '', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function endingScreen() {
    return {
      layers: [{ flat: true, shapes: dressing() }],
      text: [
        centred('LAST BELL', court.y + 50, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...ENDING.map((line, i) => centred(line, court.y + 120 + i * 36, { fill: PALETTE.cream })),
        centred(game.elapsed >= GRACE ? 'A' : '', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function howtoScreen() {
    return {
      layers: [{ flat: true, shapes: dressing() }],
      text: [
        centred('HOW TO PLAY', court.y + 44, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => centred(line, court.y + 100 + i * 30, { fill: PALETTE.cream })),
        centred('B TO GO BACK', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function scoresScreen() {
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 180, court.y + 106 + i * 32, { anchor: 'start', fill: PALETTE.bark }),
      text(row.name, mid.x - 60, court.y + 106 + i * 32, { anchor: 'start', fill: PALETTE.cream }),
      text(row.score === null ? '   --' : String(row.score).padStart(6, ' '), mid.x + 190, court.y + 106 + i * 32,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();
    return {
      layers: [{ flat: true, shapes: [...dressing(), rect(court.x + 60, court.y + 92, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('HIGH SCORES', court.y + 50, { font: HEAVY, scale: 1, fill: PALETTE.sun }),
        ...rows,
        centred('B TO GO BACK', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }),
      ],
    };
  }

  function overScreen() {
    const body = [
      centred(game.won ? 'YOU SURVIVED' : 'GAME OVER', court.y + 70, { font: HEAVY, fill: game.won ? PALETTE.sun : PALETTE.ember }),
      centred(`SCORE ${run.score}`, court.y + 150, { fill: PALETTE.cream }),
    ];
    const carets = [];
    if (game.placing > 0) {
      body.push(centred(`NEW HIGH SCORE  RANK ${game.placing}`, court.y + 200, { fill: PALETTE.moss }));
      game.initials.forEach((letter, i) => {
        const x = mid.x + (i - 1) * 52;
        body.push(text(scores.ALPHABET[letter], x, court.y + 230, { font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
      });
      carets.push(rect(mid.x + (game.slot - 1) * 52 - 16, court.y + 302, 32, 6, PALETTE.sun));
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 30, { scale: 1, fill: PALETTE.cream }));
    }
    return { layers: [{ flat: true, shapes: [...dressing(), ...carets] }], text: body };
  }

  const SCREENS = {
    menu: menuScreen, pick: pickScreen, brief: briefScreen, play: playScreen, paused: pausedScreen,
    clear: clearScreen, ending: endingScreen, howto: howtoScreen, scores: scoresScreen, over: overScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Timmy Tough Knuckles (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      matte: court,
      matteColour: PALETTE.ink,
      ink: INK,
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
      const s = game.screen;
      if (s === 'play' || s === 'paused' || s === 'clear') return bossAlive() ? 'detention' : level().track;
      if (s === 'brief') return level().track;
      if (s === 'over' && !game.won) return null;
      return 'recess';
    },
    state() {
      return {
        screen: game.screen,
        exit: game.exit,
        cursor: game.cursor,
        players: game.players,
        picks: game.picks.map((p) => ({ hero: ROSTER[p.hero], locked: p.locked })),
        level: LEVELS[game.level].id,
        stage: game.level + 1,
        wave: game.wave,
        locked: game.locked,
        cam: Math.round(game.cam),
        intro: game.intro > 0,
        score: run.score,
        lives: players.map((p) => p.lives),
        hp: players.map((p) => p.hp),
        maxHp: players.map((p) => p.maxHp),
        out: players.map((p) => p.out),
        down: players.map((p) => p.down > 0),
        weapon: players.map((p) => ({ ...p.weapon })),
        at: players.map((p) => [Math.round(p.x), Math.round(p.y)]),
        facing: players.map((p) => p.facing),
        foes: enemies.map((e) => ({
          kind: e.kind, boss: e.boss, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp, mode: e.mode,
          facing: e.facing, charging: e.charging, stunned: e.stunned, slot: e.slot,
        })),
        items: items.map((i) => ({ kind: i.kind, x: Math.round(i.x), y: Math.round(i.y) })),
        shots: shots.map((s) => ({ kind: s.kind, from: s.from, x: Math.round(s.x), y: Math.round(s.y), vx: s.vx })),
        boss: bossAlive() ? { kind: enemies.find((e) => e.boss).kind, hp: enemies.filter((e) => e.boss).reduce((s, e) => s + e.hp, 0) } : null,
        placing: game.placing,
        won: game.won,
        elapsed: game.elapsed,
        playTime: game.playTime,
      };
    },
    court,
    field,
  };
}

// Box art: a row of lockers and a kid with his fists up.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const d = (dx, dy, dr, fill) => ({ type: 'disc', x: Math.round(dx), y: Math.round(dy), r: dr, fill });
  const base = y + h - 12;
  const out = [r(x, y, w, h - 12, PALETTE.creamDim), r(x, base, w, 12, PALETTE.stone)];
  for (let lx = x + 4; lx < x + w - 14; lx += 18) {
    out.push(r(lx, y + 6, 14, h - 24, PALETTE.sky));
    out.push(r(lx + 4, y + 12, 6, 3, PALETTE.skyDim));
  }
  const cx = x + w * 0.5;
  out.push(r(cx - 7, base - 26, 14, 18, PALETTE.sky));
  out.push(r(cx - 7, base - 10, 5, 10, PALETTE.skyDim));
  out.push(r(cx + 2, base - 10, 5, 10, PALETTE.skyDim));
  out.push(d(cx, base - 32, 7, PALETTE.cream));
  out.push(r(cx - 7, base - 40, 14, 5, PALETTE.bark));
  out.push(d(cx + 14, base - 22, 4, PALETTE.cream));
  return out;
}

module.exports = {
  title: 'TOUGH KNUCKLES',
  blurb: 'TIMMY VS MIDDLE SCHOOL',
  meta: {
    players: [1, 2],
    rating: 'pg',
    audio: '8-bit',
    graphics: '2d',
    content: ['cartoon fighting'],
  },
  accent: 'sky',
  emblem,
  create,
  GAME, MENU, PAUSE_MENU, HEROES, ROSTER, WEAPONS, PICKUPS, KINDS, KIND_ORDER, BOSSES, LEVELS,
  ENDING, HOW_TO, LIVES, LANE, WRAP, COMBO, LUNCH_HEAL, CLEAR_BONUS, LIFE_BONUS, SURVIVE_BONUS,
};

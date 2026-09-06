'use strict';
// Rimward: the crossing to the galactic rim, one family at a time.
//
// The Oregon Trail, with the wagon swapped for a family ship and the Willamette
// for a settlement on the far edge of the disc. It has the same bones: a purse
// that depends on who you were before you left, a store where every crate
// competes for the same hold, a route with forks, a calendar that never stops,
// and a stream of things going wrong on the way. What is new is that some of
// the things going wrong shoot back, so there is a turn-based fight in it, and
// that the ship itself can be improved at a dockyard -- a bigger tank means
// fewer stops at stations that charge double, a better drive means fewer days
// eating.
//
// The shape is pong's: a state machine with a screen name, driven a fixed step
// at a time, drawing whatever it currently is with no side effects. Everything
// random comes from one seeded generator and is consumed only in update(), so
// the same seed and the same pad give the same voyage, ending and all.
//
// Time: a ship's day passes every DAY seconds of screen time while the travel
// screen is up and nothing else is. Menus, events, the chart and a fight all
// stop the calendar -- you cannot starve while reading.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const { sway, pulse, cycle } = require('../gfx/motion');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));   // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'rimward';

// --- the calendar ------------------------------------------------------------

const DAY = 0.5;           // seconds of screen time per ship's day
const LOAD_TIME = 2.4;     // the drive spooling up, between a dock and the void
const OVER_GRACE = 0.6;    // so the button that ended it doesn't skip the ending
const EVENT_COOLDOWN = 2;  // days of peace after anything happens

// --- the ship ----------------------------------------------------------------
//
// Five systems, three marks each. Every mark is a trade against the purse: the
// drive shortens the calendar (fewer days, fewer rations), the tank skips the
// dear stations, the plating and the cannon are for the Narrows, and the hold is
// what lets you carry enough of everything else.

const ENGINE = [3.0, 4.0, 5.2];       // light years a day, at cruise
const TANK = [90, 140, 200];          // fuel units
const HULL = [100, 150, 200];         // hull points
const CANNON = [[9, 15], [15, 23], [22, 32]];   // damage, low..high
const CARGO = [300, 450, 650];        // hold capacity, in mass units
const SYSTEMS = [
  { key: 'engine', label: 'DRIVE', cost: [0, 900, 2000], line: ['3.0 LY/DAY', '4.0 LY/DAY', '5.2 LY/DAY'] },
  { key: 'tank', label: 'TANK', cost: [0, 450, 1000], line: TANK.map((v) => `${v} UNITS`) },
  { key: 'hull', label: 'PLATING', cost: [0, 650, 1400], line: HULL.map((v) => `${v} HULL`) },
  { key: 'cannon', label: 'CANNON', cost: [0, 700, 1500], line: CANNON.map(([lo, hi]) => `${lo}-${hi} DMG`) },
  { key: 'cargo', label: 'HOLD', cost: [0, 400, 850], line: CARGO.map((v) => `${v} MASS`) },
];

const FUEL_PER_LY = 0.55;  // at cruise, mark 1 drive
const DRIFT = 0.4;         // light years a day with a dry tank: momentum only
const HULL_REPAIR = 25;    // what one spare puts back

const PACES = [
  { id: 'coast', label: 'COAST', speed: 0.6, fuel: 0.7, hazard: 0.85, wear: 0 },
  { id: 'cruise', label: 'CRUISE', speed: 1.0, fuel: 1.0, hazard: 1.0, wear: 0 },
  { id: 'burn', label: 'BURN', speed: 1.45, fuel: 1.5, hazard: 1.25, wear: 0.6 },
];
const RATIONS = [
  { id: 'meagre', label: 'MEAGRE', each: 0.5, health: -2 },
  { id: 'normal', label: 'NORMAL', each: 1.0, health: 1 },
  { id: 'full', label: 'FULL', each: 1.5, health: 3 },
];
const STARVING = -7;       // a day with nothing to eat
const SICK = -5;           // a day of fever
const HURT = -2;           // a day with a broken arm

// Supplies. Fuel lives in the tank; everything else shares the hold.
const SUPPLIES = [
  { key: 'fuel', label: 'FUEL', price: 5, step: 10, mass: 0 },
  { key: 'rations', label: 'RATIONS', price: 2, step: 10, mass: 1 },
  { key: 'spares', label: 'SPARES', price: 45, step: 1, mass: 4 },
  { key: 'medkits', label: 'MEDKITS', price: 70, step: 1, mass: 2 },
];
const SELL_BACK = 0.5;

// Who you were before. A merchant leaves rich and scores as a merchant; a
// prospector leaves with a shovel and a family and is worth three times as much
// for arriving anyway.
const PROFESSIONS = [
  { id: 'merchant', label: 'MERCHANT', credits: 7000, mult: 1, line: '7000 CR       SCORE X1' },
  { id: 'mechanic', label: 'MECHANIC', credits: 4200, mult: 2, line: '4200 CR       SCORE X2' },
  { id: 'prospector', label: 'PROSPECTOR', credits: 2600, mult: 3, line: '2600 CR       SCORE X3' },
];

// --- the route ---------------------------------------------------------------
//
// Six places and seven legs, two of which are forks. Chart positions are
// fractions of the chart rectangle. `price` scales the stores: everything costs
// more the further from Sol it had to be hauled. `upgrades` is which docks can
// refit a ship at all.

const NODES = {
  sol: { id: 'sol', name: 'SOL DOCKS', short: 'SOL', kind: 'station', price: 1.0, upgrades: true, chart: [0.06, 0.72] },
  barnard: { id: 'barnard', name: "BARNARD'S BUOY", short: 'BARNARD', kind: 'beacon', price: 0, upgrades: false, chart: [0.21, 0.46] },
  tau: { id: 'tau', name: 'TAU CETI STATION', short: 'TAU CETI', kind: 'station', price: 1.3, upgrades: true, chart: [0.35, 0.74] },
  anchor: { id: 'anchor', name: 'ANCHOR STATION', short: 'ANCHOR', kind: 'station', price: 1.7, upgrades: true, chart: [0.57, 0.40] },
  kepler: { id: 'kepler', name: "KEPLER'S REST", short: 'KEPLER', kind: 'outpost', price: 2.4, upgrades: false, chart: [0.72, 0.72] },
  haven: { id: 'haven', name: 'NEW HAVEN', short: 'HAVEN', kind: 'home', price: 0, upgrades: false, chart: [0.91, 0.36] },
};

// `mix` weights the kinds of trouble a region deals out; anything not named is
// weight 1. `via` is the bend in the drawn line, so two legs between the same
// two places don't lie on top of each other.
const LEGS = [
  { id: 'shallows', from: 'sol', to: 'barnard', ly: 38, hazard: 0.10, name: 'THE SHALLOWS', line: 'BUSY LANES, LIGHT WEATHER',
    mix: { hauler: 2, morale: 2, pirate: 0.3, drone: 0.4 }, via: [] },
  { id: 'lanes', from: 'barnard', to: 'tau', ly: 52, hazard: 0.14, name: 'THE SHALLOWS', line: 'BUSY LANES, LIGHT WEATHER',
    mix: { hauler: 2, flare: 1.5, pirate: 0.5 }, via: [] },
  { id: 'reef', from: 'tau', to: 'anchor', ly: 58, hazard: 0.34, name: 'THE REEF', line: 'SHORT. ROCKS. NOBODY SWEEPS IT.',
    mix: { meteor: 4, breach: 2, derelict: 2, hauler: 0.2, morale: 0.5 }, via: [[0.43, 0.52]] },
  { id: 'arc', from: 'tau', to: 'anchor', ly: 96, hazard: 0.12, name: 'THE LONG ARC', line: 'LONG. QUIET. PATROLLED.',
    mix: { hauler: 2, nav: 1.5, pirate: 0.3, meteor: 0.5 }, via: [[0.42, 0.92], [0.55, 0.66]] },
  { id: 'narrows', from: 'anchor', to: 'kepler', ly: 74, hazard: 0.26, name: 'THE NARROWS', line: 'A NEBULA. PIRATES LIKE THE COVER.',
    mix: { pirate: 4, drone: 2, nav: 2, hauler: 0.3, flare: 0.5 }, via: [[0.66, 0.52]] },
  { id: 'dark', from: 'kepler', to: 'haven', ly: 48, hazard: 0.18, name: 'THE DARK', line: 'SHORT. NO STARS TO STEER BY.',
    mix: { nav: 3, drone: 2, coolant: 2, hauler: 0, morale: 0.5, ice: 0 }, via: [[0.80, 0.44]] },
  { id: 'pilgrim', from: 'kepler', to: 'haven', ly: 72, hazard: 0.10, name: 'PILGRIM ROAD', line: 'LONG. OTHER FAMILIES ON IT.',
    mix: { hauler: 3, morale: 2, stowaway: 2, pirate: 0.4 }, via: [[0.86, 0.74]] },
];

const outgoing = (nodeId) => LEGS.filter((leg) => leg.from === nodeId);
const legById = (id) => LEGS.find((leg) => leg.id === id);

// What a dock offers depends on what kind of dock it is. A beacon is a light
// and nothing else; an outpost has a store but no crane.
function stationMenuFor(here) {
  const items = [];
  if (here.kind !== 'beacon') items.push({ id: 'stores', label: 'STORES' });
  if (here.upgrades) items.push({ id: 'dockyard', label: 'DOCKYARD' });
  if (here.kind !== 'beacon') items.push({ id: 'rest', label: 'REST (2 DAYS)' });
  items.push({ id: 'chart', label: 'STAR CHART' });
  items.push({ id: 'depart', label: 'DEPART' });
  return items;
}

// --- who is aboard -----------------------------------------------------------

const FIRST_NAMES = ['ADA', 'JUNO', 'ELI', 'MARA', 'OTIS', 'NELL', 'CASS', 'TOBIN', 'IRIS', 'ROOK',
  'PIP', 'WREN', 'HOLT', 'LENA', 'DUNE', 'ORLA', 'BRAM', 'TESS', 'KIT', 'SAUL', 'ZORA', 'FINN'];
const SURNAMES = ['VANCE', 'OKORO', 'HALVORSEN', 'REYES', 'TANAKA', 'MBEKI', 'LINDQVIST', 'FARR', 'ACHEBE', 'DUVAL'];
const SHIP_NAMES = ['KESTREL', 'PROVIDENCE', 'HALCYON', 'MERIDIAN', 'WAYFARER', 'LODESTAR', 'CORMORANT', 'PILGRIM'];
const ROLES = ['CAPTAIN', 'PARTNER', 'ELDEST', 'MIDDLE', 'YOUNGEST'];

// What can be wrong with someone. Sickness costs health every day until it
// clears or a medkit does; an injury costs less and heals on its own.
const AILMENTS = {
  fever: { label: 'VOID FEVER', sick: true },
  rads: { label: 'RAD SICKNESS', sick: true },
  arm: { label: 'BROKEN ARM', sick: false, days: 10 },
  concussion: { label: 'CONCUSSION', sick: false, days: 6 },
};

// --- what shoots back --------------------------------------------------------

const ENEMIES = {
  drone: { id: 'drone', name: 'ROGUE DRONE', hp: 30, hit: [5, 10], aim: 0.7, speed: 3, loot: { credits: 90 },
    line: 'AN OLD MINING DRONE, ITS OWNERS LONG DEAD, STILL DEFENDING A CLAIM NOBODY WANTS.' },
  cutter: { id: 'cutter', name: 'PIRATE CUTTER', hp: 55, hit: [8, 15], aim: 0.75, speed: 2, loot: { credits: 260, fuel: 15 },
    line: 'A CUTTER DROPS OUT OF THE HAZE WITH ITS RUNNING LIGHTS OFF AND ITS GUNS WARM.' },
  corvette: { id: 'corvette', name: 'RAIDER CORVETTE', hp: 90, hit: [12, 22], aim: 0.8, speed: 1, loot: { credits: 600, fuel: 30, spares: 1 },
    line: 'A RAIDER CORVETTE, TWICE YOUR TONNAGE, HAILS YOU WITH A SINGLE WORD: STOP.' },
};

const ACTIONS = [
  { id: 'fire', label: 'FIRE CANNON' },
  { id: 'brace', label: 'BRACE' },
  { id: 'patch', label: 'PATCH (1 SPARE)' },
  { id: 'flee', label: 'RUN FOR IT' },
];
const BRACE_FACTOR = 0.4;

// --- the trail ---------------------------------------------------------------
//
// Everything that can happen between one dock and the next. `kind` is what the
// leg's mix weighs; `text` is the card; `choices` puts a question to the
// captain, and each choice's `apply` (or the event's own) returns what came of
// it, as the line that goes on the next card. An apply may also send the family
// into a fight.
//
// The context an apply gets is the small API further down: it can hurt the
// ship, hurt a person, take supplies, give them, and cost days.

const EVENTS = [
  {
    id: 'meteors', kind: 'meteor', title: 'MICROMETEOR SWARM',
    text: 'GRIT AT TWENTY KLICKS A SECOND RAKES THE HULL BEFORE THE ALARM HAS FINISHED SOUNDING.',
    apply: (c, r) => c.damage(6 + Math.floor(r() * 12)),
  },
  {
    id: 'breach', kind: 'breach', title: 'HULL BREACH',
    text: 'SOMETHING THE SIZE OF A FIST COMES THROUGH THE HOLD AND OUT THE OTHER SIDE. THE AIR SCREAMS OUT AFTER IT.',
    apply: (c, r) => `${c.damage(14 + Math.floor(r() * 12))}. ${c.injure('concussion')}`,
  },
  {
    id: 'flare', kind: 'flare', title: 'SOLAR FLARE',
    text: 'THE STAR YOU ARE PASSING COUGHS. THERE IS NOWHERE TO HIDE FROM IT BUT BEHIND THE WATER TANK, AND NOT EVERYONE FITS.',
    apply: (c) => c.sicken('rads'),
  },
  {
    id: 'misfire', kind: 'drive', title: 'DRIVE MISFIRE',
    text: 'THE DRIVE STUTTERS, HOLDS, AND DIES. THE INJECTOR ASSEMBLY IS SLAG.',
    choices: [
      { label: 'FIT A SPARE', apply: (c) => (c.spend('spares', 1) ? 'A SPARE GOES IN. UNDER WAY BY MORNING.' : `NO SPARES. ${c.days(4)} IMPROVISING, AND ${c.damage(10)}.`) },
      { label: 'IMPROVISE', apply: (c, r) => (c.mechanic && r() < 0.5 ? 'THE MECHANIC RIGS IT WITH SOLDER AND SPITE. NO SPARE NEEDED.' : `${c.days(4)} IMPROVISING, AND ${c.damage(10)}.`) },
    ],
  },
  {
    id: 'coolant', kind: 'coolant', title: 'COOLANT LEAK',
    text: 'A SEAL LETS GO IN THE TANK ROOM. BY THE TIME ANYONE SMELLS IT, A TENTH OF THE FUEL HAS GONE TO ICE OUTSIDE.',
    apply: (c) => c.lose('fuel', Math.ceil(c.sup.fuel * 0.1)),
  },
  {
    id: 'spoil', kind: 'spoil', title: 'RATIONS SPOILED',
    text: 'A FREEZER UNIT FAILS IN THE NIGHT. THE SMELL WAKES THE YOUNGEST FIRST.',
    apply: (c) => c.lose('rations', Math.ceil(c.sup.rations * 0.15)),
  },
  {
    id: 'fever', kind: 'sick', title: 'VOID FEVER',
    text: 'A COUGH, THEN A TEMPERATURE, THEN THE SHAKES. IT IS THE VOID FEVER, AND IT DOES NOT CARE WHO IT TAKES.',
    apply: (c) => c.sicken('fever'),
  },
  {
    id: 'fall', kind: 'sick', title: 'A FALL IN THE HOLD',
    text: 'THE GRAVITY HICCUPS DURING A COURSE CORRECTION. SOMEBODY WAS ON A LADDER.',
    apply: (c) => c.injure('arm'),
  },
  {
    id: 'derelict', kind: 'derelict', title: 'DERELICT',
    text: 'A HULL TUMBLES PAST, DARK AND OLD. NO BEACON, NO ANSWER, NO OBVIOUS DAMAGE. IT COULD BE FULL OF ANYTHING.',
    choices: [
      { label: 'BOARD IT', apply: (c, r) => {
        const roll = r();
        if (roll < 0.45) return `THE HOLD IS STRIPPED BUT THE ENGINE ROOM IS NOT. ${c.gain('spares', 2)}, ${c.gain('fuel', 20)}.`;
        if (roll < 0.7) return `A STRONGBOX, UNOPENED. ${c.gain('credits', 300 + Math.floor(r() * 400))}.`;
        if (roll < 0.85) return 'STRIPPED TO THE FRAMES. SOMEBODY GOT HERE FIRST.';
        return { battle: 'cutter', outcome: 'THE DERELICT WAS BAIT. THE CUTTER THAT SET IT COMES ROUND THE HULL WITH ITS GUNS OUT.' };
      } },
      { label: 'LEAVE IT', apply: () => 'YOU LEAVE IT TO THE DARK. THE KIDS WATCH IT GO FROM THE PORTHOLE.' },
    ],
  },
  {
    id: 'pirates', kind: 'pirate', title: 'PIRATES',
    text: 'A CUTTER MATCHES YOUR COURSE, THEN YOUR SPEED, THEN OPENS A CHANNEL. THE PRICE OF PASSAGE IS EVERYTHING IN THE STRONGBOX.',
    choices: [
      { label: 'FIGHT', apply: () => ({ battle: 'cutter', outcome: 'YOU CLOSE THE CHANNEL AND RUN OUT THE CANNON.' }) },
      { label: 'PAY THEM', apply: (c) => (c.sup.credits >= 200 ? `${c.lose('credits', Math.min(c.sup.credits, 200 + Math.floor(c.sup.credits * 0.2)))}. THEY LET YOU GO.`
        : { battle: 'cutter', outcome: 'THEY COUNT WHAT YOU HAVE AND LAUGH. THEN THEY OPEN FIRE.' }) },
      { label: 'RUN', apply: (c, r) => (r() < c.fleeChance(2) ? 'YOU BURN HARD AND THE CUTTER FALLS BEHIND, SPITTING.' : { battle: 'cutter', outcome: 'THEY ARE FASTER. THE FIRST SHOT COMES ACROSS THE BOW.' }) },
    ],
  },
  {
    id: 'raiders', kind: 'pirate', title: 'RAIDERS',
    text: 'SOMETHING BIG COMES OUT OF THE NEBULA ON A COLLISION COURSE. IT IS NOT SLOWING DOWN.',
    apply: () => ({ battle: 'corvette', outcome: 'THERE IS NO OUTRUNNING IT. YOU TURN TO FACE IT.' }),
  },
  {
    id: 'drone', kind: 'drone', title: 'ROGUE DRONE',
    text: 'A DRONE ON A FORTY-YEAR PATROL DECIDES THAT YOU ARE A CLAIM JUMPER.',
    apply: () => ({ battle: 'drone', outcome: 'IT OPENS FIRE WITHOUT A WORD.' }),
  },
  {
    id: 'hauler', kind: 'hauler', title: 'PASSING HAULER',
    text: 'A BULK HAULER HAILS YOU, BORED AND FRIENDLY. THE CAPTAIN HAS FUEL TO SPARE AND WILL PART WITH TWENTY UNITS FOR A HUNDRED AND FIFTY.',
    choices: [
      { label: 'BUY IT', apply: (c) => (c.sup.credits >= 150 && c.room('fuel') >= 20 ? `${c.lose('credits', 150)}. ${c.gain('fuel', 20)}.` : 'YOU CANNOT TAKE IT. THE HAULER SHRUGS AND MOVES ON.') },
      { label: 'DECLINE', apply: () => 'YOU TRADE NEWS INSTEAD. THE RIM, THEY SAY, IS FILLING UP.' },
    ],
  },
  {
    id: 'ice', kind: 'ice', title: 'ICE COMET',
    text: 'A COMET, MOSTLY WATER. TWO DAYS ALONGSIDE IT AND THE RECYCLERS ARE FULL FOR THE FIRST TIME SINCE SOL.',
    apply: (c) => `${c.days(2)}. ${c.gain('rations', 25)}.`,
  },
  {
    id: 'nav', kind: 'nav', title: 'NAVIGATION ERROR',
    text: 'THE STAR FIX WAS WRONG BY A DEGREE. A DEGREE, OUT HERE, IS A LOT OF NOTHING TO CROSS BACK.',
    apply: (c) => c.days(3),
  },
  {
    id: 'slingshot', kind: 'nav', title: 'GRAVITY ASSIST',
    text: 'A DEAD STAR SITS JUST OFF THE LINE. THE CAPTAIN THREADS IT CLOSE AND IT FLINGS YOU ON YOUR WAY.',
    apply: (c) => c.jump(8),
  },
  {
    id: 'stowaway', kind: 'stowaway', title: 'STOWAWAY',
    text: 'A GIRL OF FOURTEEN IN THE AFT LOCKER, THREE DAYS WITHOUT WATER. SHE SAYS SHE CAN FIX ANYTHING, AND SHE IS RIGHT.',
    apply: (c) => `${c.lose('rations', 10)}, AND ${c.repair(15)}. SHE STAYS TILL THE NEXT PORT.`,
  },
  {
    id: 'birthday', kind: 'morale', title: 'A BIRTHDAY',
    text: 'THE YOUNGEST TURNS SEVEN IN THE DARK BETWEEN STARS. THERE IS A CAKE OF SORTS. NOBODY MENTIONS THE RATIONS.',
    apply: (c) => c.cheer(6),
  },
  {
    id: 'naming', kind: 'morale', title: 'A NEW STAR',
    text: 'THE KIDS FIND A STAR ON NO CHART AND NAME IT AFTER THE SHIP. IT IS PROBABLY A REFLECTION. NOBODY TELLS THEM.',
    apply: (c) => c.cheer(4),
  },
];

// --- the almanac -------------------------------------------------------------
// What a captain should know before the docks are behind them. Thirty-six
// columns is what fits across the picture with a margin at this size.

const ALMANAC = [
  { title: 'THE CROSSING', lines: [
    'THE RIM IS THREE HUNDRED LIGHT YEARS',
    'OUT. FAMILIES HAVE BEEN GOING FOR A',
    'DECADE, AND NEW HAVEN HAS ROOM.',
    '',
    'YOU LEAVE SOL WITH A PURSE, A SHIP,',
    'AND FIVE PEOPLE. THE CALENDAR RUNS',
    'WHILE YOU FLY. EVERY DAY EATS',
    'RATIONS AND FUEL. ARRIVE WITH BOTH.',
  ] },
  { title: 'PROVISIONING', lines: [
    'FUEL FILLS THE TANK. RATIONS, SPARES',
    'AND MEDKITS SHARE THE HOLD, AND THE',
    'HOLD IS SMALL. ONE RATION FEEDS ONE',
    'PERSON ONE DAY AT NORMAL.',
    '',
    'STATIONS FURTHER OUT CHARGE MORE.',
    'A SPARE FIXES A DRIVE OR PATCHES',
    'THE HULL. A MEDKIT CURES ANYTHING.',
  ] },
  { title: 'THE SHIP', lines: [
    'FIVE SYSTEMS, THREE MARKS EACH, AT',
    'ANY DOCKYARD WITH A CRANE:',
    '',
    'DRIVE    MORE LIGHT YEARS A DAY',
    'TANK     MORE FUEL BETWEEN STOPS',
    'PLATING  MORE HULL TO LOSE',
    'CANNON   HARDER HITTING',
    'HOLD     MORE OF EVERYTHING ELSE',
  ] },
  { title: 'HAZARDS', lines: [
    'METEORS AND BREACHES TAKE HULL.',
    'FLARES AND FEVER TAKE PEOPLE.',
    'A MISFIRE TAKES A SPARE OR A WEEK.',
    'A LEAK TAKES FUEL. THE DARK TAKES',
    'YOUR BEARINGS.',
    '',
    'BURNING HARD GETS YOU THERE SOONER',
    'AND WEARS THE HULL DOING IT.',
  ] },
  { title: 'WHAT SHOOTS BACK', lines: [
    'DRONES ARE SMALL AND FAST. CUTTERS',
    'WANT YOUR STRONGBOX. A CORVETTE',
    'WANTS THE SHIP.',
    '',
    'FIRE TO HIT. BRACE TO TAKE LESS.',
    'PATCH TO SPEND A SPARE ON HULL.',
    'RUN, IF YOUR DRIVE IS BETTER THAN',
    'THEIRS. A DEAD SHIP IS A DEAD FAMILY.',
  ] },
  { title: 'THE ROUTE', lines: [
    'SOL TO TAU CETI IS EASY.',
    'THEN CHOOSE: THE REEF, SHORT AND',
    'FULL OF ROCKS, OR THE LONG ARC.',
    'THE NARROWS IS A NEBULA, AND',
    'PIRATES LIKE THE COVER.',
    'FROM KEPLER, THE DARK IS SHORT AND',
    'HAS NO STARS TO STEER BY. PILGRIM',
    'ROAD IS LONG AND HAS COMPANY.',
  ] },
];

// --- menus -------------------------------------------------------------------

const MENU = [
  { id: 'new', label: 'NEW VOYAGE' },
  { id: 'almanac', label: 'ALMANAC' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'quit', label: 'ABANDON VOYAGE' },
];
const TRAVEL_MENU = [
  { id: 'continue', label: 'CONTINUE' },
  { id: 'pace', label: 'PACE' },
  { id: 'rations', label: 'RATIONS' },
  { id: 'repair', label: 'PATCH HULL' },
  { id: 'crew', label: 'CREW' },
  { id: 'supplies', label: 'SUPPLIES' },
  { id: 'chart', label: 'STAR CHART' },
];

// --- helpers -----------------------------------------------------------------

// mulberry32, same as every other seeded thing in this repo.
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
const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r: Math.round(r), fill });

// Greedy word wrap, for the cards. Words longer than a line are cut, which
// none of the text above needs but a stray one shouldn't crash the frame.
function wrap(body, cols) {
  const lines = [];
  let line = '';
  for (const word of body.split(' ')) {
    if (word.length > cols) {
      if (line) { lines.push(line); line = ''; }
      for (let i = 0; i < word.length; i += cols) lines.push(word.slice(i, i + cols));
      continue;
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const random = rng(options.seed ?? 0x52494d57);
  const table = options.scores ?? scores;
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };

  const sounds = [];
  const say = (name) => sounds.push(name);

  // The backdrop. Seeded once; scrolled by how far the ship has gone, so a
  // faster pace visibly moves the stars faster and a dry tank visibly doesn't.
  const stars = [];
  for (let i = 0; i < 64; i++) {
    stars.push({
      x: random() * court.w,
      y: random() * court.h,
      depth: 0.25 + random() * 0.75,
      size: random() < 0.75 ? 2 : 3,
      tint: ['cream', 'cream', 'sky', 'sun', 'bark'][Math.floor(random() * 5)],
    });
  }

  // A family and a ship, drawn from the same seed.
  const pick = (list, taken) => {
    let choice;
    do choice = list[Math.floor(random() * list.length)]; while (taken.has(choice));
    taken.add(choice);
    return choice;
  };
  const surname = SURNAMES[Math.floor(random() * SURNAMES.length)];
  const shipName = SHIP_NAMES[Math.floor(random() * SHIP_NAMES.length)];
  const takenNames = new Set();
  const freshCrew = () => ROLES.map((role) => ({
    name: pick(FIRST_NAMES, takenNames), role, health: 100, ailment: null, daysHurt: 0, alive: true, cause: null, died: 0,
  }));

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    cursor: 0,
    page: 0,
    board: table.table(GAME),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,
    tally: 0,
    ending: null,       // settled | perished | destroyed
    epitaph: '',

    profession: null,
    crew: freshCrew(),
    ship: { engine: 1, tank: 1, hull: 1, cannon: 1, cargo: 1 },
    hull: HULL[0],
    sup: { credits: 0, fuel: 0, rations: 0, spares: 0, medkits: 0 },
    pace: 1,
    rations: 1,

    day: 1,
    clock: 0,           // seconds into the current day
    at: 'sol',          // the node we are docked at, or null under way
    leg: null,          // the leg id we are on, or null when docked
    gone: 0,            // light years into the leg
    dist: 0,            // light years altogether
    course: 0,          // which outgoing leg the chart has highlighted
    chartChoose: false, // the chart is asking, not just showing
    cooldown: 0,
    adrift: false,
    log: [],            // the last few things that happened, for the travel panel

    shopKind: 'stores', // stores | dockyard
    event: null,        // { id, phase: ask | told, outcome, next }
    battle: null,       // { enemy, hp, braced, phase: choose | report, log: [] }
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; game.cursor = 0; };
  const alive = () => game.crew.filter((p) => p.alive);
  const node = () => NODES[game.at];
  const leg = () => (game.leg ? legById(game.leg) : null);
  const pace = () => PACES[game.pace];
  const ration = () => RATIONS[game.rations];
  const isMechanic = () => game.profession === 'mechanic';
  const note = (line) => { game.log = [...game.log.slice(-2), line.length > 38 ? `${line.slice(0, 35)}...` : line]; };

  const cargoUsed = () => SUPPLIES.reduce((sum, s) => sum + game.sup[s.key] * s.mass, 0);
  const cargoCap = () => CARGO[game.ship.cargo - 1];
  const tankCap = () => TANK[game.ship.tank - 1];
  const hullMax = () => HULL[game.ship.hull - 1];
  const speedPerDay = () => (game.sup.fuel > 0 ? ENGINE[game.ship.engine - 1] * pace().speed : DRIFT);
  const fuelPerDay = () => (game.sup.fuel > 0 ? FUEL_PER_LY * pace().fuel * ENGINE[game.ship.engine - 1] * pace().speed : 0);
  const fleeChance = (enemySpeed) => clamp(0.35 + 0.2 * (game.ship.engine - enemySpeed), 0.1, 0.9);

  // How much of a supply can still be taken aboard.
  const room = (key) => {
    if (key === 'fuel') return Math.floor(tankCap() - game.sup.fuel);
    const mass = SUPPLIES.find((s) => s.key === key).mass;
    return Math.floor((cargoCap() - cargoUsed()) / mass);
  };

  // --- the small API events and fights use ---------------------------------

  const ctx = {
    get sup() { return game.sup; },
    get mechanic() { return isMechanic(); },
    fleeChance,
    room,
    damage(amount) {
      game.hull = Math.max(0, game.hull - amount);
      say('ram');
      return `HULL -${amount}`;
    },
    repair(amount) {
      const before = game.hull;
      game.hull = Math.min(hullMax(), game.hull + amount);
      return `HULL +${game.hull - before}`;
    },
    lose(key, amount) {
      const taken = Math.min(game.sup[key], amount);
      game.sup[key] -= taken;
      return `${key.toUpperCase()} -${Math.round(taken)}`;
    },
    gain(key, amount) {
      const given = key === 'credits' ? amount : Math.min(amount, room(key));
      game.sup[key] += given;
      return `${key.toUpperCase()} +${given}`;
    },
    spend(key, amount) {
      if (game.sup[key] < amount) return false;
      game.sup[key] -= amount;
      return true;
    },
    days(n) {
      for (let i = 0; i < n; i++) feed();
      game.day += n;
      return `${n} DAYS LOST`;
    },
    jump(ly) {
      const current = leg();
      const gained = Math.min(ly, current.ly - game.gone);
      game.gone += gained;
      game.dist += gained;
      return `${gained} LY GAINED`;
    },
    cheer(amount) {
      for (const p of alive()) p.health = Math.min(100, p.health + amount);
      return `EVERYONE +${amount} HEALTH`;
    },
    sicken(kind) {
      const well = alive().filter((p) => !p.ailment);
      if (!well.length) return 'NOBODY LEFT TO CATCH IT.';
      const p = well[Math.floor(random() * well.length)];
      p.ailment = kind;
      p.daysHurt = AILMENTS[kind].days ?? 0;
      return `${p.name} HAS ${AILMENTS[kind].label}`;
    },
    injure(kind) { return ctx.sicken(kind); },
  };

  // --- the calendar ----------------------------------------------------------

  // One day of eating, for everyone still here. Rations first, then health.
  function feed() {
    const people = alive();
    const need = people.length * ration().each;
    const fed = game.sup.rations >= need;
    game.sup.rations = fed ? game.sup.rations - need : 0;

    for (const p of people) {
      let delta = fed ? ration().health : STARVING;
      if (p.ailment) {
        const a = AILMENTS[p.ailment];
        delta += a.sick ? SICK : HURT;
        if (a.sick) {
          // Fever breaks on its own sometimes, and sooner on a full plate.
          if (random() < (fed && game.rations === 2 ? 0.2 : 0.08)) { p.ailment = null; note(`${p.name} IS OVER THE ${a.label}`); }
        } else if (--p.daysHurt <= 0) {
          p.ailment = null;
          note(`${p.name}'S ${a.label} HAS HEALED`);
        }
      }
      p.health = clamp(p.health + delta, 0, 100);
      if (p.health <= 0) {
        p.alive = false;
        p.died = game.day;
        p.cause = p.ailment ? AILMENTS[p.ailment].label : fed ? 'EXHAUSTION' : 'STARVATION';
        note(`${p.name} HAS DIED OF ${p.cause}`);
        say('over');
      }
    }
  }

  function finish(ending) {
    game.ending = ending;
    // Nobody walks away from a ship that has come apart.
    if (ending === 'destroyed') {
      for (const p of alive()) { p.alive = false; p.died = game.day; p.cause = 'LOST WITH THE SHIP'; }
    }
    const survivors = alive().length;
    const raw = Math.round(game.dist) * 5 + survivors * 400 + Math.floor(game.sup.credits / 5)
      + (ending === 'settled' ? 1500 : 0);
    game.tally = raw * (PROFESSIONS.find((p) => p.id === game.profession)?.mult ?? 1);
    game.placing = game.tally > 0 ? table.placing(GAME, game.tally) : 0;
    game.initials = [0, 0, 0];
    game.slot = 0;

    if (ending === 'settled') {
      game.epitaph = survivors === 5 ? 'ALL FIVE OF YOU STEP OUT ONTO NEW GROUND.'
        : `${survivors} OF YOU STEP OUT ONTO NEW GROUND.`;
      say('fanfare');
    } else if (ending === 'destroyed') {
      game.epitaph = `THE ${shipName} BROKE UP IN ${leg()?.name ?? 'THE VOID'}, DAY ${game.day}.`;
      say('wreck');
    } else {
      game.epitaph = `THE ${shipName} DRIFTS ON, EMPTY, DAY ${game.day}.`;
      say('over');
    }
    go('over');
  }

  function checkDead() {
    if (!alive().length) { finish('perished'); return true; }
    if (game.hull <= 0) { finish('destroyed'); return true; }
    return false;
  }

  function arrive(nodeId) {
    game.at = nodeId;
    game.leg = null;
    game.gone = 0;
    game.course = 0;
    game.adrift = false;
    note(`ARRIVED AT ${NODES[nodeId].name}`);
    if (NODES[nodeId].kind === 'home') { finish('settled'); return; }
    say('crossing');
    go('station');
  }

  function tickDay() {
    const current = leg();
    game.day++;

    const speed = speedPerDay();
    const burn = Math.min(game.sup.fuel, fuelPerDay());
    game.sup.fuel -= burn;
    if (game.sup.fuel <= 0.001) {
      game.sup.fuel = 0;
      if (!game.adrift) { game.adrift = true; note('THE TANK IS DRY. ADRIFT.'); say('siren'); }
    }
    game.gone += speed;
    game.dist += speed;
    if (pace().wear) game.hull = Math.max(0, game.hull - pace().wear);

    feed();
    if (checkDead()) return;

    if (game.gone >= current.ly) { arrive(current.to); return; }

    if (game.cooldown > 0) { game.cooldown--; return; }
    const chance = (0.04 + current.hazard * 0.5) * pace().hazard;
    if (random() < chance) startEvent(current);
  }

  // --- the trail -------------------------------------------------------------

  function startEvent(current) {
    const weighted = EVENTS.map((e) => ({ e, w: current.mix[e.kind] ?? 1 }));
    const total = weighted.reduce((sum, { w }) => sum + w, 0);
    let roll = random() * total;
    let chosen = weighted[weighted.length - 1].e;
    for (const { e, w } of weighted) { roll -= w; if (roll <= 0) { chosen = e; break; } }

    game.cooldown = EVENT_COOLDOWN;
    game.event = { id: chosen.id, phase: chosen.choices ? 'ask' : 'told', outcome: null, next: null };
    if (!chosen.choices) resolveEvent(chosen.apply(ctx, random));
    say('alarm');
    go('event');
  }

  // An apply hands back a line, or a line plus a fight to have next.
  function resolveEvent(result) {
    const out = typeof result === 'string' ? { outcome: result } : result;
    game.event.outcome = out.outcome;
    game.event.next = out.battle ?? null;
    game.event.phase = 'told';
    if (out.outcome) note(out.outcome);
  }

  function leaveEvent() {
    const next = game.event.next;
    game.event = null;
    if (checkDead()) return;
    if (next) startBattle(next);
    else go('travel');
  }

  // --- the fight -------------------------------------------------------------

  function startBattle(kind) {
    const enemy = ENEMIES[kind];
    game.battle = { enemy: kind, hp: enemy.hp, braced: false, phase: 'choose', log: [enemy.line], over: null };
    say('siren');
    go('battle');
  }

  const roll = ([lo, hi]) => lo + Math.floor(random() * (hi - lo + 1));

  function enemyTurn() {
    const b = game.battle;
    const enemy = ENEMIES[b.enemy];
    const lines = [];
    // A beaten-up enemy may break off, which is the fight ending the way most
    // fights do.
    if (b.hp < enemy.hp * 0.3 && random() < 0.35) {
      lines.push(`THE ${enemy.name} BREAKS OFF AND RUNS.`);
      b.over = 'fled';
      return lines;
    }
    if (random() < enemy.aim) {
      let dmg = roll(enemy.hit);
      if (b.braced) dmg = Math.max(1, Math.round(dmg * BRACE_FACTOR));
      game.hull = Math.max(0, game.hull - dmg);
      say('ram');
      lines.push(`${enemy.name} HITS. HULL -${dmg}${b.braced ? ' (BRACED)' : ''}.`);
      if (random() < 0.25) lines.push(ctx.injure(random() < 0.5 ? 'concussion' : 'arm'));
    } else {
      lines.push(`${enemy.name} FIRES AND MISSES.`);
    }
    return lines;
  }

  function playerTurn(action) {
    const b = game.battle;
    const enemy = ENEMIES[b.enemy];
    b.braced = false;
    switch (action) {
      case 'fire': {
        say('cannon');
        if (random() < 0.85) {
          const dmg = roll(CANNON[game.ship.cannon - 1]);
          b.hp = Math.max(0, b.hp - dmg);
          if (b.hp <= 0) { b.over = 'won'; say('wreck'); return [`DIRECT HIT. THE ${enemy.name} COMES APART.`]; }
          return [`HIT. ${enemy.name} -${dmg}.`];
        }
        return ['THE SHOT GOES WIDE.'];
      }
      case 'brace':
        b.braced = true;
        return ['YOU TURN THE PLATING TO THEM.'];
      case 'patch':
        if (!ctx.spend('spares', 1)) return ['NO SPARES LEFT TO PATCH WITH.'];
        say('fuel');
        return [ctx.repair(HULL_REPAIR)];
      case 'flee':
        if (random() < fleeChance(enemy.speed)) { b.over = 'escaped'; return ['YOU BURN HARD AND LOSE THEM.']; }
        return ['THEY STAY ON YOU.'];
      default:
        throw new Error(`unknown action: ${action}`);
    }
  }

  function battleRound(action) {
    const b = game.battle;
    const lines = playerTurn(action);
    if (!b.over) lines.push(...enemyTurn());
    b.log = lines.slice(-3);
    b.phase = 'report';
  }

  function leaveBattle() {
    const b = game.battle;
    const enemy = ENEMIES[b.enemy];
    if (game.hull <= 0) { game.battle = null; checkDead(); return; }
    if (b.over === 'won') {
      const got = Object.entries(enemy.loot).map(([key, amount]) => ctx.gain(key, amount));
      note(`SALVAGE: ${got.join(', ')}`);
      say('crossing');
    }
    game.battle = null;
    game.cooldown = EVENT_COOLDOWN;
    if (checkDead()) return;
    go('travel');
  }

  // --- docks -----------------------------------------------------------------

  const stationMenu = () => stationMenuFor(node());

  function shopRows() {
    if (game.shopKind === 'dockyard') return [...SYSTEMS.map((s) => ({ kind: 'system', ...s })), { kind: 'leave', label: 'BACK' }];
    return [...SUPPLIES.map((s) => ({ kind: 'supply', ...s })), { kind: 'leave', label: 'BACK' }];
  }

  const priceOf = (supply) => {
    const base = supply.price * node().price;
    return Math.max(1, Math.round(supply.key === 'spares' && isMechanic() ? base / 2 : base));
  };

  function buy(supply, count) {
    // Burning leaves the tank at a fraction; the pump sells whole units, so
    // the fraction goes before the first one goes in, or a full tank could
    // never be reached again.
    if (supply.key === 'fuel') game.sup.fuel = Math.floor(game.sup.fuel);
    const can = Math.min(count, room(supply.key), Math.floor(game.sup.credits / priceOf(supply)));
    if (can <= 0) { say('back'); return; }
    game.sup[supply.key] += can;
    game.sup.credits -= can * priceOf(supply);
    say('fuel');
  }

  function sell(supply, count) {
    const can = Math.min(count, game.sup[supply.key]);
    if (can <= 0) { say('back'); return; }
    game.sup[supply.key] -= can;
    game.sup.credits += Math.floor(can * priceOf(supply) * SELL_BACK);
    say('move');
  }

  function refit(system) {
    const mark = game.ship[system.key];
    if (mark >= 3) { say('back'); return; }
    const cost = Math.round(system.cost[mark] * node().price);
    if (game.sup.credits < cost) { say('back'); return; }
    game.sup.credits -= cost;
    game.ship[system.key] = mark + 1;
    if (system.key === 'hull') game.hull += HULL[mark] - HULL[mark - 1];
    say('select');
  }

  function rest() {
    ctx.days(2);
    for (const p of alive()) {
      p.health = Math.min(100, p.health + 20);
      if (p.ailment && random() < 0.5) p.ailment = null;
    }
    note('TWO DAYS OF REAL GRAVITY AND REAL SLEEP');
    say('select');
    checkDead();
  }

  function depart() {
    const options = outgoing(game.at);
    if (options.length === 1) setCourse(options[0]);
    else { game.course = 0; go('chart'); game.chartChoose = true; }
  }

  function setCourse(chosen) {
    game.leg = chosen.id;
    game.gone = 0;
    game.clock = 0;
    game.chartChoose = false;
    game.at = null;
    note(`UNDER WAY: ${chosen.name}`);
    say('warp');
    go('loading');
  }

  function newVoyage(profession) {
    game.profession = profession.id;
    game.ship = { engine: 1, tank: 1, hull: 1, cannon: 1, cargo: 1 };
    game.hull = HULL[0];
    game.sup = { credits: profession.credits, fuel: 0, rations: 0, spares: 0, medkits: 0 };
    game.pace = 1;
    game.rations = 1;
    game.day = 1;
    game.clock = 0;
    game.at = 'sol';
    game.leg = null;
    game.gone = 0;
    game.dist = 0;
    game.cooldown = 0;
    game.adrift = false;
    game.ending = null;
    game.log = ['THE DOCKS ARE OPEN. BUY WHAT YOU CAN.'];
    game.event = null;
    game.battle = null;
    go('station');
  }

  // --- input -----------------------------------------------------------------

  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }

  function editInitials(frame) {
    const size = scores.ALPHABET.length;
    if (frame.pressed.up) { game.initials[game.slot] = (game.initials[game.slot] + size - 1) % size; say('move'); }
    if (frame.pressed.down) { game.initials[game.slot] = (game.initials[game.slot] + 1) % size; say('move'); }
    if (frame.pressed.left && game.slot > 0) { game.slot--; say('move'); }
    if (frame.pressed.right && game.slot < 2) { game.slot++; say('move'); }
    if (!confirmed(frame)) return;
    if (game.slot < 2) { game.slot++; say('move'); return; }
    game.board = table.record(GAME, game.initials.map((i) => scores.ALPHABET[i]).join(''), game.tally);
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
        if (choice === 'scores') { game.board = table.table(GAME); go('scores'); }
        else if (choice === 'almanac') { game.page = 0; go('almanac'); }
        else {
          // The family on the origin screen is the family that leaves. A second
          // voyage gets a new one, drawn on the way in rather than on the way out.
          if (game.profession) { takenNames.clear(); game.crew = freshCrew(); }
          go('origin');
        }
        break;
      }

      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); go('menu'); }
        break;

      case 'almanac':
        if (any.pressed.left && game.page > 0) { game.page--; say('move'); }
        if (any.pressed.right && game.page < ALMANAC.length - 1) { game.page++; say('move'); }
        if (any.pressed.b || any.pressed.start) { say('back'); go('menu'); game.cursor = 1; }
        else if (any.pressed.a) {
          if (game.page < ALMANAC.length - 1) { game.page++; say('move'); } else { say('back'); go('menu'); game.cursor = 1; }
        }
        break;

      case 'origin':
        moveCursor(any, PROFESSIONS.length);
        if (any.pressed.b) { say('back'); go('menu'); break; }
        if (confirmed(any)) { say('select'); newVoyage(PROFESSIONS[game.cursor]); }
        break;

      case 'station': {
        const items = stationMenu();
        moveCursor(any, items.length);
        if (!confirmed(any)) break;
        say('select');
        const choice = items[game.cursor].id;
        if (choice === 'stores' || choice === 'dockyard') { game.shopKind = choice; go('shop'); }
        else if (choice === 'rest') rest();
        else if (choice === 'chart') { game.chartChoose = false; go('chart'); }
        else depart();
        break;
      }

      case 'shop': {
        const rows = shopRows();
        moveCursor(any, rows.length);
        const row = rows[game.cursor];
        if (any.pressed.b) { say('back'); go('station'); break; }
        if (row.kind === 'supply') {
          if (any.pressed.right || any.pressed.a) buy(row, row.step);
          if (any.pressed.left) sell(row, row.step);
        } else if (row.kind === 'system') {
          if (any.pressed.a || any.pressed.right) refit(row);
        } else if (confirmed(any)) { say('back'); go('station'); }
        if (any.pressed.start) { say('back'); go('station'); }
        break;
      }

      case 'chart': {
        const options = game.chartChoose ? outgoing(game.at) : [];
        if (options.length) {
          if (any.pressed.left || any.pressed.up) { game.course = (game.course + options.length - 1) % options.length; say('move'); }
          if (any.pressed.right || any.pressed.down) { game.course = (game.course + 1) % options.length; say('move'); }
          if (any.pressed.a) { say('select'); setCourse(options[game.course]); break; }
          if (any.pressed.b) { say('back'); go('station'); }
        } else if (confirmed(any) || any.pressed.b) {
          say('back');
          go(game.at ? 'station' : 'travel');
        }
        break;
      }

      case 'loading':
        if (game.elapsed >= LOAD_TIME) { game.clock = 0; go('travel'); }
        break;

      case 'travel':
        if (any.pressed.start) { say('select'); go('paused'); break; }
        if (any.pressed.a) { say('select'); go('options'); break; }
        game.clock += dt;
        while (game.clock >= DAY && game.screen === 'travel') {
          game.clock -= DAY;
          tickDay();
        }
        break;

      case 'options': {
        moveCursor(any, TRAVEL_MENU.length);
        const id = TRAVEL_MENU[game.cursor].id;
        if (id === 'pace') {
          if (any.pressed.left) { game.pace = (game.pace + PACES.length - 1) % PACES.length; say('move'); }
          if (any.pressed.right) { game.pace = (game.pace + 1) % PACES.length; say('move'); }
        } else if (id === 'rations') {
          if (any.pressed.left) { game.rations = (game.rations + RATIONS.length - 1) % RATIONS.length; say('move'); }
          if (any.pressed.right) { game.rations = (game.rations + 1) % RATIONS.length; say('move'); }
        }
        if (any.pressed.b || any.pressed.start) { say('back'); go('travel'); break; }
        if (!any.pressed.a) break;
        if (id === 'continue') { say('back'); go('travel'); }
        else if (id === 'repair') {
          if (game.hull >= hullMax()) say('back');
          else if (ctx.spend('spares', 1)) { note(`PATCHED: ${ctx.repair(HULL_REPAIR)}`); ctx.days(1); say('fuel'); checkDead(); }
          else say('back');
        }
        else if (id === 'crew') { say('select'); go('crew'); }
        else if (id === 'supplies') { say('select'); go('supplies'); }
        else if (id === 'chart') { say('select'); game.chartChoose = false; go('chart'); }
        break;
      }

      case 'crew': {
        const people = game.crew;
        moveCursor(any, people.length);
        if (any.pressed.b || any.pressed.start) { say('back'); go('options'); break; }
        if (!any.pressed.a) break;
        const p = people[game.cursor];
        if (p.alive && (p.ailment || p.health < 60) && ctx.spend('medkits', 1)) {
          p.ailment = null;
          p.health = Math.min(100, p.health + 30);
          note(`MEDKIT USED ON ${p.name}`);
          say('fuel');
        } else say('back');
        break;
      }

      case 'supplies':
        if (confirmed(any) || any.pressed.b) { say('back'); go('options'); }
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('travel'); break; }
        if (!confirmed(any)) break;
        say('select');
        if (PAUSE_MENU[game.cursor].id === 'resume') go('travel');
        else go('menu');
        break;
      }

      case 'event': {
        const spec = EVENTS.find((e) => e.id === game.event.id);
        if (game.event.phase === 'ask') {
          moveCursor(any, spec.choices.length);
          if (any.pressed.a) { say('select'); resolveEvent(spec.choices[game.cursor].apply(ctx, random)); }
        } else if (game.elapsed >= 0.3 && (confirmed(any) || any.pressed.b)) {
          say('select');
          leaveEvent();
        }
        break;
      }

      case 'battle': {
        const b = game.battle;
        if (b.phase === 'choose') {
          moveCursor(any, ACTIONS.length);
          if (any.pressed.a) battleRound(ACTIONS[game.cursor].id);
        } else if (game.elapsed >= 0.2 && (confirmed(any) || any.pressed.b)) {
          if (b.over || game.hull <= 0) leaveBattle();
          else { b.phase = 'choose'; game.elapsed = 0; }
        }
        break;
      }

      case 'over':
        if (game.elapsed < OVER_GRACE) break;
        if (game.placing > 0) { editInitials(any); break; }
        if (confirmed(any) || any.pressed.b) { say('select'); go('menu'); }
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
    }
  }

  // --- drawing ---------------------------------------------------------------

  const text = (body, x, y, opts = {}) => ({
    text: body, x: Math.round(x), y: Math.round(y),
    scale: opts.scale ?? 2, anchor: opts.anchor ?? 'start',
    fill: opts.fill ?? PALETTE.cream, font: opts.font ?? FONT,
  });
  const centred = (body, y, opts = {}) => {
    const font = opts.font ?? FONT;
    const scale = opts.scale ?? 2;
    return text(body, mid.x, y - (font.height * scale) / 2, { ...opts, anchor: 'middle', font, scale });
  };
  const LEFT = court.x + 16;
  const RIGHT = court.x + court.w - 16;
  const LINE = 32; // one line of body text, at scale 2
  const COLS = 36;

  // The backdrop. Scroll is in light years; every screen is over the same sky,
  // so the ship's progress is visible even from the pause menu.
  function starfield(scroll, band = null) {
    const top = band ? band.y : court.y;
    const h = band ? band.h : court.h;
    return stars.map((s) => {
      const x = court.x + (((s.x - scroll * 40 * s.depth) % court.w) + court.w) % court.w;
      const y = top + s.y * (h / court.h);
      if (x + s.size > court.x + court.w || y + s.size > top + h) return null;
      return rect(x, y, s.size, s.size, PALETTE[s.tint]);
    }).filter(Boolean);
  }

  const scrollNow = () => game.dist + (game.screen === 'travel' ? (game.clock / DAY) * speedPerDay() : 0);

  // The family ship, side on, nose to the right. Poster style: the two-pass
  // layer gives it the ink outline everything in the house wears.
  function shipShapes(cx, cy, t, { colour = PALETTE.cream, flip = false, scale = 1 } = {}) {
    const d = flip ? -1 : 1;
    const S = scale;
    const glow = pulse(t, 0.35, 0.25);
    const body = [
      { type: 'chain', fill: colour, points: [
        { x: cx - 46 * S * d, y: cy, r: 13 * S }, { x: cx + 6 * S * d, y: cy, r: 14 * S }, { x: cx + 48 * S * d, y: cy, r: 7 * S },
      ] },
      rect(flip ? cx + 22 * S : cx - 54 * S, cy - 30 * S, 32 * S, 12 * S, colour),      // dorsal fin
      rect(cx - (flip ? 6 : 38) * S, cy + 12 * S, 44 * S, 10 * S, PALETTE.bark),        // cargo pod
      rect(flip ? cx + 44 * S : cx - 66 * S, cy - 8 * S, 22 * S, 16 * S, PALETTE.bark),   // drive housing
      disc(cx + 24 * S * d, cy - 7 * S, 7 * S, PALETTE.sky),                             // cockpit
    ];
    const flame = [
      disc(cx - 70 * S * d, cy, 7 * S * glow, PALETTE.sun),
      disc(cx - 78 * S * d, cy, 4 * S * glow, PALETTE.ember),
    ];
    const portholes = [-14, -2, 10].map((o) => disc(cx + o * S * d, cy + 3 * S, 2.5 * S, PALETTE.sun));
    return { body, flame, portholes };
  }

  function shipLayers(cx, cy, t, opts) {
    const s = shipShapes(cx, cy, t, opts);
    return [
      { flat: true, shapes: s.flame },
      { ink: 4, shapes: s.body },
      { flat: true, shapes: s.portholes },
    ];
  }

  function menuList(items, cursor, top, opts = {}) {
    return items.map((item, i) => {
      const selected = i === cursor;
      return centred(`${selected ? '▶ ' : '  '}${item.label}`, top + i * (opts.pitch ?? 40), {
        scale: 2, fill: selected ? PALETTE.sun : PALETTE.cream,
      });
    });
  }

  const footer = (body) => centred(body, court.y + court.h - 24, { scale: 2, fill: PALETTE.bark });

  function menuScreen() {
    return {
      layers: [
        { flat: true, shapes: starfield(game.elapsed * 0.6) },
        ...shipLayers(mid.x, court.y + 132, game.elapsed),
      ],
      text: [
        centred('RIMWARD', court.y + 58, { scale: 2, font: HEAVY, fill: PALETTE.violet }),
        ...menuList(MENU, game.cursor, court.y + 232),
        footer('START OR A TO CHOOSE'),
      ],
    };
  }

  function scoresScreen() {
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 180, court.y + 120 + i * 34, { fill: PALETTE.bark }),
      text(row.name, mid.x - 60, court.y + 120 + i * 34),
      text(row.score === null ? '  --' : String(row.score).padStart(6, ' '), mid.x + 200, court.y + 120 + i * 34,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();
    return {
      layers: [{ flat: true, shapes: [...starfield(0), rect(court.x + 60, court.y + 104, court.w - 120, 4, PALETTE.bark)] }],
      text: [centred('SETTLERS', court.y + 60, { scale: 2, font: HEAVY, fill: PALETTE.sun }), ...rows, footer('B TO GO BACK')],
    };
  }

  function almanacScreen() {
    const page = ALMANAC[game.page];
    return {
      layers: [{ flat: true, shapes: [...starfield(0), rect(court.x + 40, court.y + 84, court.w - 80, 4, PALETTE.bark)] }],
      text: [
        centred(page.title, court.y + 52, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...page.lines.map((line, i) => text(line, LEFT + 16, court.y + 104 + i * LINE)),
        footer(`${game.page + 1} / ${ALMANAC.length}     LEFT RIGHT   B BACK`),
      ],
    };
  }

  function originScreen() {
    const family = game.crew.map((p, i) => text(`${p.role.padEnd(9, ' ')} ${p.name}`, LEFT + 32, court.y + 104 + i * LINE,
      { fill: i === 0 ? PALETTE.sun : PALETTE.cream }));
    const labels = PROFESSIONS.map((p, i) => {
      const selected = i === game.cursor;
      return text(`${selected ? '▶ ' : '  '}${p.label.padEnd(11, ' ')}${p.line}`, LEFT + 8, court.y + 292 + i * 34,
        { fill: selected ? PALETTE.sun : PALETTE.cream });
    });
    return {
      layers: [{ flat: true, shapes: [
        ...starfield(0),
        rect(court.x + 40, court.y + 82, court.w - 80, 4, PALETTE.bark),
        rect(court.x + 40, court.y + 274, court.w - 80, 4, PALETTE.bark),
      ] }],
      text: [
        centred(`THE ${surname} FAMILY`, court.y + 44, { scale: 2, font: HEAVY, fill: PALETTE.violet }),
        ...family,
        text(`SHIP: ${shipName}`, RIGHT - 16, court.y + 104, { anchor: 'end', fill: PALETTE.sky }),
        text('BEFORE SOL,', RIGHT - 16, court.y + 136, { anchor: 'end', fill: PALETTE.bark }),
        text('YOU WERE A', RIGHT - 16, court.y + 168, { anchor: 'end', fill: PALETTE.bark }),
        ...labels,
        footer('A TO LEAVE EARTH'),
      ],
    };
  }

  // The panel of numbers every docked screen shares.
  function purseLine(y) {
    return [
      text(`CR ${game.sup.credits}`, LEFT, y, { fill: PALETTE.sun }),
      text(`FUEL ${Math.floor(game.sup.fuel)}/${tankCap()}`, LEFT + 176, y, { fill: PALETTE.sky }),
      text(`HOLD ${cargoUsed()}/${cargoCap()}`, RIGHT, y, { anchor: 'end', fill: PALETTE.moss }),
    ];
  }

  function stationScreen() {
    const here = node();
    const items = stationMenu();
    const flavour = {
      station: 'CRANES, CREDIT, AND A DECENT BAR',
      outpost: 'ONE DOME, ONE STORE, HARD PRICES',
      beacon: 'A LIGHT IN THE DARK. NOTHING TO BUY',
      home: '',
    }[here.kind];
    return {
      layers: [
        { flat: true, shapes: [...starfield(game.dist), rect(court.x + 40, court.y + 90, court.w - 80, 4, PALETTE.bark)] },
        ...shipLayers(court.x + 118, court.y + 300, game.elapsed, { scale: 0.7 }),
      ],
      text: [
        centred(here.name, court.y + 48, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        centred(flavour, court.y + 78, { scale: 2, fill: PALETTE.bark }),
        ...purseLine(court.y + 104),
        text(`DAY ${game.day}`, LEFT, court.y + 136, { fill: PALETTE.cream }),
        text(`HULL ${Math.round(game.hull)}/${hullMax()}`, LEFT + 176, court.y + 136, { fill: PALETTE.cream }),
        text(`${alive().length} ABOARD`, RIGHT, court.y + 136, { anchor: 'end', fill: PALETTE.cream }),
        ...items.map((item, i) => text(`${i === game.cursor ? '▶ ' : '  '}${item.label}`, court.x + 300, court.y + 190 + i * 36,
          { fill: i === game.cursor ? PALETTE.sun : PALETTE.cream })),
        text(game.log[game.log.length - 1] ?? '', LEFT, court.y + court.h - 56, { fill: PALETTE.bark }),
      ],
    };
  }

  function shopScreen() {
    const rows = shopRows();
    const dock = game.shopKind === 'dockyard';
    const lines = rows.map((row, i) => {
      const selected = i === game.cursor;
      const fill = selected ? PALETTE.sun : PALETTE.cream;
      const y = court.y + 150 + i * 36;
      const mark = selected ? '▶ ' : '  ';
      if (row.kind === 'supply') {
        return [
          text(`${mark}${row.label}`, LEFT, y, { fill }),
          text(`${priceOf(row)} CR`, LEFT + 220, y, { fill: PALETTE.bark }),
          text(`< ${String(Math.floor(game.sup[row.key])).padStart(4, ' ')} >`, RIGHT, y, { anchor: 'end', fill }),
        ];
      }
      if (row.kind === 'system') {
        const level = game.ship[row.key];
        const cost = level >= 3 ? 'MAX' : `${Math.round(row.cost[level] * node().price)} CR`;
        return [
          text(`${mark}${row.label}`, LEFT, y, { fill }),
          text(`MK${level}  ${row.line[level - 1]}`, LEFT + 190, y, { fill: PALETTE.bark }),
          text(cost, RIGHT, y, { anchor: 'end', fill }),
        ];
      }
      return [text(`${mark}${row.label}`, LEFT, y, { fill })];
    }).flat();
    return {
      layers: [{ flat: true, shapes: [...starfield(game.dist), rect(court.x + 40, court.y + 86, court.w - 80, 4, PALETTE.bark)] }],
      text: [
        centred(dock ? 'DOCKYARD' : 'STORES', court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...purseLine(court.y + 100),
        ...lines,
        footer(dock ? 'A TO REFIT   B BACK' : 'RIGHT BUYS   LEFT SELLS   B BACK'),
      ],
    };
  }

  // The star chart. Legs are chains, so they bend; nodes are discs; the ship is
  // the cream dot. In choose mode the two ways on flash between sky and sun.
  function chartScreen() {
    const area = { x: court.x + 24, y: court.y + 92, w: court.w - 48, h: 236 };
    const pt = ([fx, fy]) => ({ x: area.x + fx * area.w, y: area.y + fy * area.h });
    const options = game.chartChoose ? outgoing(game.at) : [];
    const chosen = options[game.course] ?? null;
    const shapes = [...starfield(game.dist, area)];
    const labels = [];

    const flash = cycle(game.elapsed, 0.6) < 0.5;
    for (const l of LEGS) {
      const points = [NODES[l.from].chart, ...l.via, NODES[l.to].chart].map((f) => ({ ...pt(f), r: 2 }));
      const candidate = options.includes(l);
      const colour = l.id === game.leg ? PALETTE.sun
        : candidate ? (l === chosen && flash ? PALETTE.sun : PALETTE.sky)
        : PALETTE.bark;
      shapes.push({ type: 'chain', fill: colour, points });
    }
    for (const n of Object.values(NODES)) {
      const p = pt(n.chart);
      const fill = n.id === game.at ? PALETTE.sun : n.kind === 'home' ? PALETTE.moss : n.kind === 'beacon' ? PALETTE.bark : PALETTE.cream;
      shapes.push(disc(p.x, p.y, n.kind === 'beacon' ? 4 : 6, fill));
      const above = n.chart[1] < 0.5;
      labels.push(text(n.short, p.x, above ? p.y - 44 : p.y + 12, { anchor: 'middle', fill: PALETTE.bark }));
    }

    // Where the ship is: at a node, or so far along a leg.
    const here = leg();
    if (here) {
      const points = [NODES[here.from].chart, ...here.via, NODES[here.to].chart].map(pt);
      const along = clamp(game.gone / here.ly, 0, 1) * (points.length - 1);
      const i = Math.min(points.length - 2, Math.floor(along));
      const f = along - i;
      const x = points[i].x + (points[i + 1].x - points[i].x) * f;
      const y = points[i].y + (points[i + 1].y - points[i].y) * f;
      shapes.push(disc(x, y, 5, PALETTE.cream));
    }

    const described = chosen ?? here ?? (game.at ? outgoing(game.at)[0] : LEGS[0]);
    const hazard = described.hazard >= 0.25 ? 'HIGH' : described.hazard >= 0.14 ? 'FAIR' : 'LOW';
    return {
      layers: [{ flat: true, shapes }],
      text: [
        centred('STAR CHART', court.y + 40, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...labels,
        text(`${described.name}  ${described.ly} LY  HAZARD ${hazard}`, LEFT, court.y + 344, { fill: PALETTE.sun }),
        text(described.line, LEFT, court.y + 376, { fill: PALETTE.cream }),
        footer(options.length ? 'LEFT RIGHT TO PICK   A SETS COURSE' : 'B TO GO BACK'),
      ],
    };
  }

  // The drive spooling: stars stretch into lines as the bar fills.
  function loadingScreen() {
    const done = clamp(game.elapsed / LOAD_TIME, 0, 1);
    const stretch = done * done * 90;
    const streaks = stars.map((s) => {
      const x = court.x + (((s.x - game.dist * 40 * s.depth) % court.w) + court.w) % court.w;
      const len = Math.min(stretch * s.depth, x - court.x);
      return { type: 'chain', fill: PALETTE[s.tint], points: [{ x: x - len, y: court.y + s.y, r: 2 }, { x, y: court.y + s.y, r: 2 }] };
    });
    const barW = court.w - 120;
    const dest = NODES[leg().to];
    return {
      layers: [
        { flat: true, shapes: streaks },
        ...shipLayers(mid.x, court.y + 170, game.elapsed),
        { flat: true, shapes: [
          rect(court.x + 60, court.y + court.h - 96, barW, 18, PALETTE.bark),
          rect(court.x + 60, court.y + court.h - 96, Math.max(4, barW * done), 18, PALETTE.violet),
        ] },
      ],
      text: [
        centred(done < 0.5 ? 'SPOOLING DRIVE' : 'PLOTTING COURSE', court.y + 52, { scale: 2, font: HEAVY, fill: PALETTE.violet }),
        centred(`${leg().name}  ·  ${dest.name}`, court.y + court.h - 124, { fill: PALETTE.cream }),
        footer(`${Math.round(done * 100)}%`),
      ],
    };
  }

  // The main screen: sky above, the ship in it, the ledger below.
  function travelLayers(t, scroll) {
    const sky = { y: court.y, h: 222 };
    const bob = sway(t, 2.6, 4);
    return [
      { flat: true, shapes: starfield(scroll, sky) },
      ...shipLayers(court.x + 190, court.y + 124 + bob, t),
      { flat: true, shapes: [rect(court.x + 24, court.y + 228, court.w - 48, 4, PALETTE.bark)] },
    ];
  }

  function statusText() {
    const current = leg();
    const dest = NODES[current.to];
    const left = Math.max(0, Math.ceil(current.ly - game.gone));
    const sick = alive().filter((p) => p.ailment).length;
    // Four rows in three columns. The middle column starts where the widest
    // thing in the first (DAY 123, FUEL 200) ends, and the right column is
    // anchored to the edge, so nothing runs into anything at any value.
    const y0 = court.y + 242;
    const MIDDLE = LEFT + 160;
    return [
      text(`DAY ${game.day}`, LEFT, y0, { fill: PALETTE.sun }),
      text(current.name, MIDDLE, y0, { fill: PALETTE.cream }),
      text(`FUEL ${Math.floor(game.sup.fuel)}`, LEFT, y0 + LINE, { fill: game.adrift ? PALETTE.ember : PALETTE.sky }),
      text(`RATIONS ${Math.floor(game.sup.rations)}`, MIDDLE, y0 + LINE, { fill: game.sup.rations < 20 ? PALETTE.ember : PALETTE.cream }),
      text(`HULL ${Math.round(game.hull)}/${hullMax()}`, RIGHT, y0 + LINE, { anchor: 'end', fill: game.hull < 40 ? PALETTE.ember : PALETTE.cream }),
      text(`PACE ${pace().label}`, LEFT, y0 + LINE * 2, { fill: PALETTE.bark }),
      text(`${ration().label} MEALS`, MIDDLE + 30, y0 + LINE * 2, { fill: PALETTE.bark }),
      text(sick ? `${sick} SICK` : `${alive().length} ABOARD`, RIGHT, y0 + LINE * 2, { anchor: 'end', fill: sick ? PALETTE.ember : PALETTE.moss }),
      text(`${left} LY TO ${dest.name}`, LEFT, y0 + LINE * 3, { fill: PALETTE.cream }),
      text(game.log[game.log.length - 1] ?? '', LEFT, y0 + LINE * 4 + 2, { fill: PALETTE.bark }),
    ];
  }

  // How far along the leg, as a bar beside the day count.
  function legBar() {
    const current = leg();
    const w = 176;
    const x = RIGHT - w;
    const y = court.y + 252;
    return [rect(x, y, w, 12, PALETTE.bark), rect(x, y, Math.max(2, w * clamp(game.gone / current.ly, 0, 1)), 12, PALETTE.sun)];
  }

  function travelScreen() {
    return {
      layers: [...travelLayers(game.elapsed, scrollNow()), { flat: true, shapes: legBar() }],
      text: [...statusText(), footer('A OPTIONS   START PAUSE')],
    };
  }

  function optionsScreen() {
    const rows = TRAVEL_MENU.map((item, i) => {
      const selected = i === game.cursor;
      const fill = selected ? PALETTE.sun : PALETTE.cream;
      const y = court.y + 14 + i * 32;
      const value = item.id === 'pace' ? `< ${pace().label} >`
        : item.id === 'rations' ? `< ${ration().label} >`
        : item.id === 'repair' ? `${game.sup.spares} SPARES` : '';
      return [
        text(`${selected ? '▶ ' : '  '}${item.label}`, LEFT + 40, y, { fill }),
        text(value, RIGHT - 40, y, { anchor: 'end', fill: PALETTE.bark }),
      ];
    }).flat();
    return {
      layers: [{ ...travelLayers(game.elapsed, scrollNow())[0], alpha: 0.25 }],
      text: [...rows, ...statusText().slice(0, 5), footer('A CHOOSE   B BACK')],
    };
  }

  function crewScreen() {
    const rows = game.crew.map((p, i) => {
      const selected = i === game.cursor;
      const y = court.y + 100 + i * 40;
      const status = !p.alive ? `DIED DAY ${p.died}` : p.ailment ? AILMENTS[p.ailment].label : p.health >= 70 ? 'WELL' : p.health >= 40 ? 'POORLY' : 'FAILING';
      const fill = !p.alive ? PALETTE.bark : selected ? PALETTE.sun : PALETTE.cream;
      return [
        text(`${selected ? '▶ ' : '  '}${p.name}`, LEFT, y, { fill }),
        text(p.role, LEFT + 180, y, { fill: PALETTE.bark }),
        text(p.alive ? String(p.health).padStart(3, ' ') : '  -', LEFT + 340, y, { fill }),
        text(status, RIGHT, y, { anchor: 'end', fill: p.alive && p.ailment ? PALETTE.ember : fill }),
      ];
    }).flat();
    const bars = game.crew.map((p, i) => {
      if (!p.alive) return [];
      const y = court.y + 100 + i * 40 + 34;
      return [rect(LEFT + 342, y, 48, 4, PALETTE.bark), rect(LEFT + 342, y, Math.max(2, 48 * p.health / 100), 4, p.health >= 40 ? PALETTE.moss : PALETTE.ember)];
    }).flat();
    return {
      layers: [{ flat: true, shapes: [...starfield(game.dist), rect(court.x + 40, court.y + 84, court.w - 80, 4, PALETTE.bark), ...bars] }],
      text: [
        centred(`THE ${surname} FAMILY`, court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        text(`MEDKITS ${game.sup.medkits}`, LEFT, court.y + 318, { fill: PALETTE.sky }),
        footer('A USES A MEDKIT   B BACK'),
      ],
    };
  }

  function suppliesScreen() {
    const rows = SUPPLIES.map((s, i) => {
      const y = court.y + 100 + i * 36;
      const have = Math.floor(game.sup[s.key]);
      return [
        text(s.label, LEFT, y),
        text(String(have).padStart(5, ' '), LEFT + 220, y, { fill: PALETTE.sun }),
        text(s.key === 'fuel' ? `TANK ${tankCap()}` : `MASS ${have * s.mass}`, RIGHT, y, { anchor: 'end', fill: PALETTE.bark }),
      ];
    }).flat();
    const days = (need) => (need > 0 ? Math.floor(game.sup.rations / need) : 0);
    const need = alive().length * ration().each;
    const reach = game.sup.fuel / Math.max(0.01, fuelPerDay()) * speedPerDay();
    return {
      layers: [{ flat: true, shapes: [...starfield(game.dist), rect(court.x + 40, court.y + 84, court.w - 80, 4, PALETTE.bark)] }],
      text: [
        centred('THE HOLD', court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        text(`CREDITS ${game.sup.credits}`, LEFT, court.y + 260, { fill: PALETTE.sun }),
        text(`HOLD ${cargoUsed()}/${cargoCap()}`, RIGHT, court.y + 260, { anchor: 'end', fill: PALETTE.moss }),
        text(`${days(need)} DAYS OF FOOD AT ${ration().label}`, LEFT, court.y + 300, { fill: PALETTE.cream }),
        text(`${Math.floor(reach)} LY OF FUEL AT ${pace().label}`, LEFT, court.y + 332, { fill: PALETTE.cream }),
        footer('B BACK'),
      ],
    };
  }

  function pausedScreen() {
    return {
      layers: [{ ...travelLayers(game.elapsed, scrollNow())[0], alpha: 0.25 }],
      text: [
        centred('PAUSED', court.y + 110, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(PAUSE_MENU, game.cursor, court.y + 220),
      ],
    };
  }

  function eventScreen() {
    const spec = EVENTS.find((e) => e.id === game.event.id);
    const body = wrap(spec.text, COLS).slice(0, 5).map((line, i) => text(line, LEFT + 16, court.y + 104 + i * LINE));
    const bottom = court.y + 104 + body.length * LINE + 16;
    const rest = [];
    if (game.event.phase === 'ask') {
      spec.choices.forEach((choice, i) => {
        const selected = i === game.cursor;
        rest.push(text(`${selected ? '▶ ' : '  '}${choice.label}`, LEFT + 40, bottom + i * 34, { fill: selected ? PALETTE.sun : PALETTE.cream }));
      });
    } else {
      wrap(game.event.outcome ?? '', COLS).forEach((line, i) => rest.push(text(line, LEFT + 16, bottom + i * LINE, { fill: PALETTE.sun })));
    }
    return {
      layers: [{ flat: true, shapes: [...starfield(game.dist), rect(court.x + 40, court.y + 84, court.w - 80, 4, PALETTE.ember)] }],
      text: [
        centred(spec.title, court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.ember }),
        ...body,
        ...rest,
        footer(game.event.phase === 'ask' ? 'A TO DECIDE' : 'A TO CARRY ON'),
      ],
    };
  }

  function battleScreen() {
    const b = game.battle;
    const enemy = ENEMIES[b.enemy];
    const t = game.elapsed;
    const ours = { x: court.x + 150, y: court.y + 130 + sway(t, 2.2, 5) };
    const theirs = { x: court.x + 500, y: court.y + 110 + sway(t, 1.7, 6, 0.3) };
    const barW = 160;
    const bars = [
      rect(ours.x - barW / 2, court.y + 200, barW, 10, PALETTE.bark),
      rect(ours.x - barW / 2, court.y + 200, Math.max(2, barW * game.hull / hullMax()), 10, game.hull > hullMax() * 0.3 ? PALETTE.moss : PALETTE.ember),
      rect(theirs.x - barW / 2, court.y + 200, barW, 10, PALETTE.bark),
      rect(theirs.x - barW / 2, court.y + 200, Math.max(2, barW * b.hp / enemy.hp), 10, PALETTE.ember),
      rect(court.x + 24, court.y + 236, court.w - 48, 4, PALETTE.bark),
    ];
    const actions = ACTIONS.map((a, i) => {
      const selected = b.phase === 'choose' && i === game.cursor;
      return text(`${selected ? '▶ ' : '  '}${a.label}`, LEFT, court.y + 256 + i * 34, { fill: selected ? PALETTE.sun : b.phase === 'choose' ? PALETTE.cream : PALETTE.bark });
    });
    const log = b.log.flatMap((line) => wrap(line, 19)).slice(0, 5).map((line, i) => text(line, court.x + 336, court.y + 256 + i * LINE, { fill: PALETTE.cream }));
    return {
      layers: [
        { flat: true, shapes: starfield(game.dist, { y: court.y, h: 230 }) },
        ...shipLayers(ours.x, ours.y, t, { scale: 0.8 }),
        ...(b.hp > 0 ? shipLayers(theirs.x, theirs.y, t, { colour: PALETTE.ember, flip: true, scale: b.enemy === 'corvette' ? 1.0 : b.enemy === 'drone' ? 0.5 : 0.7 }) : []),
        { flat: true, shapes: bars },
      ],
      text: [
        text(shipName, ours.x, court.y + 216, { anchor: 'middle', fill: PALETTE.cream }),
        text(enemy.name, theirs.x, court.y + 216, { anchor: 'middle', fill: PALETTE.ember }),
        text(`HULL ${Math.round(game.hull)}`, ours.x, court.y + 24, { anchor: 'middle', fill: PALETTE.moss }),
        text(`${b.hp}`, theirs.x, court.y + 24, { anchor: 'middle', fill: PALETTE.ember }),
        ...actions,
        ...log,
        footer(b.phase === 'choose' ? 'A TO ACT' : 'A TO CARRY ON'),
      ],
    };
  }

  function overScreen() {
    const won = game.ending === 'settled';
    const headline = won ? 'NEW HAVEN' : game.ending === 'destroyed' ? 'SHIP LOST' : 'ALL HANDS LOST';
    const body = [
      centred(headline, court.y + 60, { scale: 2, font: HEAVY, fill: won ? PALETTE.moss : PALETTE.ember }),
      ...wrap(game.epitaph, COLS).map((line, i) => centred(line, court.y + 120 + i * LINE)),
      centred(`DAY ${game.day}   ${Math.round(game.dist)} LY   ${alive().length} ALIVE`, court.y + 196, { fill: PALETTE.bark }),
      centred(`SCORE ${game.tally}`, court.y + 236, { fill: PALETTE.sun }),
    ];
    const lost = game.crew.filter((p) => !p.alive).slice(0, 2);
    lost.forEach((p, i) => body.push(centred(`${p.name}, ${p.cause}, DAY ${p.died}`, court.y + 270 + i * 28, { fill: PALETTE.bark })));

    const shapes = [];
    if (game.placing > 0) {
      body.push(centred(`SETTLER RANK ${game.placing}`, court.y + 326, { fill: PALETTE.moss }));
      game.initials.forEach((index, i) => {
        const x = mid.x + (i - 1) * 52;
        body.push(text(scores.ALPHABET[index], x, court.y + 344, { anchor: 'middle', scale: 2, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
      });
      shapes.push(rect(mid.x + (game.slot - 1) * 52 - 16, court.y + 384, 32, 6, PALETTE.sun));
      body.push(footer('UP DOWN TO PICK   A TO ENTER'));
    } else {
      body.push(footer('PRESS START'));
    }
    return { layers: [{ flat: true, shapes: [...starfield(game.dist), ...shapes] }], text: body };
  }

  const SCREENS = {
    menu: menuScreen, scores: scoresScreen, almanac: almanacScreen, origin: originScreen,
    station: stationScreen, shop: shopScreen, chart: chartScreen, loading: loadingScreen,
    travel: travelScreen, options: optionsScreen, crew: crewScreen, supplies: suppliesScreen,
    paused: pausedScreen, event: eventScreen, battle: battleScreen, over: overScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Rimward (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      matte: court,
      matteColour: PALETTE.ink,
      font: FONT,
      layers,
      text: labels,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    // The voyage theme under everything but a fight, where the cannon has to
    // be heard.
    music() { return game.screen === 'battle' ? null : 'voyage'; },
    state() {
      return {
        screen: game.screen, exit: game.exit, cursor: game.cursor, elapsed: game.elapsed, page: game.page,
        profession: game.profession, ship: { ...game.ship }, hull: game.hull, sup: { ...game.sup },
        pace: PACES[game.pace].id, rations: RATIONS[game.rations].id,
        day: game.day, at: game.at, leg: game.leg, gone: game.gone, dist: game.dist, adrift: game.adrift,
        course: game.course, chartChoose: game.chartChoose,
        crew: game.crew.map((p) => ({ ...p })),
        event: game.event ? { ...game.event } : null,
        battle: game.battle ? { ...game.battle, log: [...game.battle.log] } : null,
        ending: game.ending, tally: game.tally, placing: game.placing, epitaph: game.epitaph,
        surname, shipName,
      };
    },
    court,
  };
}

// Box art for the selector: the ship, small, over a few stars.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) => ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  return [
    r(x + 10, y + 8, 2, 2, PALETTE.cream), r(x + w - 14, y + 10, 3, 3, PALETTE.sky),
    r(x + 24, y + h - 12, 2, 2, PALETTE.cream), r(x + w - 30, y + h - 9, 2, 2, PALETTE.sun),
    r(x + w * 0.62, y + 6, 2, 2, PALETTE.cream),
    { type: 'disc', x: Math.round(cx - 34), y: Math.round(cy), r: 4, fill: PALETTE.sun },
    { type: 'chain', fill: PALETTE.cream, points: [{ x: cx - 24, y: cy, r: 6 }, { x: cx + 2, y: cy, r: 7 }, { x: cx + 26, y: cy, r: 3 }] },
    r(cx - 20, cy - 14, 14, 6, PALETTE.cream),
    r(cx - 14, cy + 6, 22, 5, PALETTE.bark),
    { type: 'disc', x: Math.round(cx + 12), y: Math.round(cy - 3), r: 3, fill: PALETTE.sky },
  ];
}

module.exports = {
  title: 'RIMWARD',
  blurb: 'THE LONG HAUL TO THE RIM',
  meta: {
    players: [1],
    rating: 'pg',
    audio: '8-bit',
    graphics: '2d',
    content: ['peril', 'crew illness and death'],
  },
  accent: 'violet',
  emblem,
  create, GAME, MENU, PAUSE_MENU, TRAVEL_MENU, ACTIONS, stationMenuFor, outgoing,
  NODES, LEGS, EVENTS, ENEMIES, PROFESSIONS, SYSTEMS, SUPPLIES, PACES, RATIONS, ALMANAC,
  ENGINE, TANK, HULL, CANNON, CARGO, DAY, LOAD_TIME, FUEL_PER_LY, DRIFT, wrap,
};

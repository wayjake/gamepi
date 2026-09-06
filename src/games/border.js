'use strict';
// Border Patrol: a run for the line, north through the desert, in 3D.
//
// The shape is golf's -- a state machine with its own menu, pause menu, score
// board and game over screen, drawing 3D into a target it owns and handing the
// result to the 2D pipeline as an underlay. What is different is that golf has
// a course and this has a *road*, which has to go on for ever.
//
// It goes on for ever by repeating. Every function that describes the world is
// a pure function of world z and every one of them repeats on ROAD_PERIOD (or
// on a factor of it), so the tarmac, the paint, the marker posts and the
// scenery are each built once as a single mesh a road-period long and placed
// again and again down the desert. Nothing is generated while you drive; a tile
// three miles ahead is the same tile you passed three miles back, and the frame
// loop allocates no geometry at all.
//
// The other half of that bargain is where the world ends. A finite ground plane
// shows you its own edges, so the desert is dead flat out to FLAT_HALF -- which
// is where the drivable world already stopped -- and banks up into dunes past
// it, high enough that you cannot see over them and never need to.
//
// The run has a shape as well as a road. You set off towards a low sun with
// billboards selling you the north; the sun sinks as you go, the billboards
// change their tone, a wall goes up beside the road, and in the last sector a
// wall rises across the whole horizon and takes the sun with it. Behind the
// gap in it is a walled pen with the cruisers already waiting, and you can see
// them from half a sector out. You never get there. A thousand units short of
// the line a pickup comes across the sand from the right, stops across the
// road, and its driver tells you what is waiting at the line and offers you
// somewhere else. You get in, she drives off the highway onto a dirt track to
// the left, and the chase is over: the cruisers do not follow onto dirt.
//
// From there the game changes shape twice. The dirt road is a second, straight
// 3D world driven for you with captions over it (`dirt`), and at the end of it
// is a town on foot from above (`town`, in border/town.js), where the rest of
// the game happens. Everything that carries the run's story is a one-off
// placed by z like the checkpoint gantry -- the periodic world underneath it
// is untouched.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const { TAU } = require('../gfx/motion');
const scene3d = require('../gfx/scene3d');
const mesh = require('../gfx/mesh');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');
const town = require('./border/town');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz'));

const GAME = 'border';

// --- the world ---------------------------------------------------------------

const ROAD_PERIOD = 1800;   // the road repeats exactly this often
const GROUND_TILE = 900;    // ...and the sand twice as often, so both line up
const GROUND_HALF = 900;
const GROUND_COLS = 18;     // 100 units a column: a vertex lands on FLAT_HALF
const GROUND_ROWS = 30;
const FLAT_HALF = 300;      // dead flat to here, dunes past it
const DUNE_RISE = 300;      // and this far to climb them

const ROAD_HALF = 26;       // tarmac, either side of the centre line
const VERGE = 66;           // marker posts, and as far off the road as you get
const POST_STEP = 36;

// How far there is to see. The far edge of the sand lands at least this far off,
// which at a camera height of twelve units is within a pixel of the horizon --
// so the ground simply ends in sky, the way it should.
const SEE_BACK = 220;
const SEE_AHEAD = 1250;

// The road wanders, on two sines an octave apart so it never quite repeats
// inside a period the way one alone would. Both are periodic on ROAD_PERIOD,
// which is what lets one mesh be laid end to end for ever.
const roadCentre = (z) => Math.sin(z * TAU / ROAD_PERIOD) * 44 + Math.sin(z * TAU * 2 / ROAD_PERIOD + 1.1) * 18;

// Its heading, for pointing anything that has to lie square across it.
const roadAim = (z) => Math.atan2(roadCentre(z + 4) - roadCentre(z - 4), 8);

const smoothstep = (t) => t * t * (3 - 2 * t);

// The sand. Flat out to FLAT_HALF, which is well past anywhere a car can reach,
// then dunes. Flat is exact rather than nearly-flat and the grid has a vertex
// at exactly FLAT_HALF, so the surface the cars drive on is the surface that is
// drawn -- there is no interpolated slope creeping in under the road.
function desertY(x, z) {
  const a = Math.abs(x);
  if (a <= FLAT_HALF) return 0;
  const rise = smoothstep(Math.min(1, (a - FLAT_HALF) / DUNE_RISE));
  const dunes = 52
    + Math.sin(z * (TAU / GROUND_TILE) * 3 + x * 0.011) * 17
    + Math.sin(x * 0.008 + z * (TAU / GROUND_TILE)) * 13;
  return rise * dunes;
}

// How far off the tarmac something is: 0 on it, 1 in the sand.
const offRoad = (x, z) => (Math.abs(x - roadCentre(z)) > ROAD_HALF ? 1 : 0);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the run -----------------------------------------------------------------

const LEG = 2400;           // to the next checkpoint
const SECTORS = 2;          // and this many of them to the line
const RUN = LEG * SECTORS;

// The rescue. It comes this far short of the line: close enough that the wall
// and the pen are on the horizon while she talks, which is the argument. The
// car brakes to RESCUE_STOP, the dirt track crosses the highway just ahead of
// it, and the truck stops on the track in front of the car.
const RESCUE_Z = RUN - 1000;
const RESCUE_STOP = RESCUE_Z + 100;
const TRACK_Z = RESCUE_STOP + 30;
const TRACK_HALF = 11;
const TRACK_GAP = 46;       // the opening in the roadside wall either side
const TRUCK_FROM = 210;     // where the truck appears, right of the road
const TRUCK_TOP = 62;
const WALK_SPEED = 14;      // you, on foot, between the two vehicles
const DIRT_LENGTH = 1000;   // the dirt road, truck stop to town
const DIRT_SPEED = 44;
const CAPTION_RATE = 40;    // characters a second
const CAPTION_HOLD = 2.4;   // a finished caption waits this long before the next
const CAPTION_WRAP = 36;
const CAPTION_H = 112;      // the caption plate: a name and two lines of the body font
const TOWN_SIGN = { x: 64, z: DIRT_LENGTH - 130 };

const CAR_W = 7.4;          // collision half-extents, shared by everything on
const CAR_L = 15.5;         // four wheels: they are all roughly saloon-sized

const RAM_SPEED = 15;       // close on a cruiser faster than this and it goes
const RAM_PUSH = 46;        // and a door-to-door hit shoves it this hard
const SAND_WRECK = 12;      // a cruiser this far into the sand at speed is gone
const COP_GRIP = 30;
const MAX_COPS = 5;

// Cruisers hold station beside you and come in one at a time. BESIDE is where
// they wait, LUNGE how long a swerve at you lasts, and LUNGE_GAP the least time
// between one cruiser's swerve and the next's -- so a hit is a thing you see
// coming, not a thing that is always happening.
const BESIDE = 20;
const LUNGE = 0.9;
const LUNGE_GAP = 3.0;
const LUNGE_REST = 5;       // a cruiser waits at least this long between its own
const SHOVED_GRIP = 0.25;   // how much of its steering a cruiser keeps while you lean on it

// Every hit costs body, and mass decides how much. BODY_SIDE is a flat-out
// door-to-door hit before the car's mass is divided in; a gentle lean costs a
// quarter of it. IMPACT_GAP is how long one contact stays one contact --
// overlap resolves every frame, and a shove that lasts a second is one hit.
const BODY_SIDE = 0.09;
const BODY_TAP = 0.012;     // nudging the cruiser in front, nose to tail
const BODY_NOSE = 0.004;    // per unit of closing speed when you send it
const BODY_POST = 0.05;     // scraping the posts, flat out
const IMPACT_GAP = 1.2;
const TOUCH = 1.5;          // how far apart two cars can be and still be touching
const TYRE_BODY = 0.35;     // what a stack of spares puts back

// Being caught is being stopped. Slower than PIN_SPEED with a cruiser inside
// NEAR for PIN_TIME and you are pulled over; get moving and it drains.
const NEAR = 26;
const PIN_SPEED = 20;
const PIN_TIME = 3.0;

const PICKUP_STEP = 620;    // roughly this far between things on the road
const TYRE_ODDS = 0.3;      // and this many of them are spares, not fuel
const CAN_FUEL = 0.24;

const WRECK_SCORE = 250;
const CAN_SCORE = 25;
const SECTOR_SCORE = 500;
const RESCUE_SCORE = 1500;

// --- the shape of the run -----------------------------------------------------
// The sun starts SUN_HIGH above the camera and is SUN_LOW by the line; the sky
// turns at DUSK_SECTOR. The fence and the wall stand straight, out past the
// posts, indifferent to the road wandering under them: SIDE_TILE divides LEG,
// so a tile of fence is never half in one sector and half in the next.
const SUN_HIGH = 120;
const SUN_LOW = -130;
const DUSK_SECTOR = SECTORS;
const SIDE_TILE = 600;
const FENCE_X = 175;
const WALL_X = 150;
const WALL_H = 22;
const LINE_H = 46;          // the wall across the world at the line
const PEN_DEPTH = 340;      // the pen's back wall
const PARKED_Z = 245;       // the cruisers waiting inside it

// Roadside signs. What they say is the run's story: sold the north for a
// sector, warned off it for the next. The ones past the rescue are never read
// up close, but they are on the road ahead while she talks. Fourteen characters
// fit the board at the distance the text switches on.
const SIGN_W = 66;
const SIGN_Y = 17;
const SIGN_NEAR = 120;      // the text is readable at scale 2 inside this...
const SIGN_FAR = 240;       // ...scale 1 inside this, and only a board past it
const SIGNS = [
  { z: 320, side: 1, text: 'THE NORTH', tone: 'bark' },
  { z: 900, side: -1, text: 'LAND OF PLENTY', tone: 'bark' },
  { z: 1500, side: 1, text: 'JOBS AHEAD', tone: 'bark' },
  { z: 2050, side: -1, text: 'A BETTER LIFE', tone: 'bark' },
  { z: 2650, side: 1, text: 'PATROLLED', tone: 'ember' },
  { z: 3100, side: -1, text: 'NO STOPPING', tone: 'ember' },
  { z: 3500, side: 1, text: 'YOU ARE SEEN', tone: 'ember' },
  { z: 4000, side: -1, text: 'PAPERS AHEAD', tone: 'ember' },
  { z: 4300, side: 1, text: 'WAIT HERE', tone: 'ember' },
  { z: 4600, side: -1, text: 'WELCOME', tone: 'bark' },
];
const signX = (sign) => roadCentre(sign.z) + sign.side * (VERGE + 18);

// The three cruisers parked across the road inside the pen.
const PARKED = [{ dx: -19, yaw: 0.5 }, { dx: 0, yaw: 0 }, { dx: 19, yaw: -0.5 }];

// The three cars. Every number here is a trade: the truck cannot be caught in a
// straight line but cannot get out of its own way either, and the coupe can
// outrun the first sector's cruisers and gets shoved into the sand by them.
const CARS = [
  {
    id: 'mula', name: 'LA MULA', line: 'STEADY  ·  BIG TANK', ramp: 'sun',
    top: 63, accel: 25, brake: 40, grip: 34, mass: 1.0, tank: 1.0, thirst: 0.0205,
    body: { w: 7.2, l: 16.0, h: 3.2, roof: 2.9, cabin: -0.6 },
  },
  {
    id: 'toro', name: 'EL TORO', line: 'HEAVY  ·  TAKES A HIT', ramp: 'ember',
    top: 55, accel: 18, brake: 33, grip: 25, mass: 1.55, tank: 1.22, thirst: 0.0245,
    body: { w: 8.4, l: 19.0, h: 4.4, roof: 3.6, cabin: 3.4 },
  },
  {
    id: 'liebre', name: 'LA LIEBRE', line: 'FAST  ·  LIGHT', ramp: 'violet',
    top: 77, accel: 33, brake: 46, grip: 44, mass: 0.68, tank: 0.82, thirst: 0.0265,
    body: { w: 6.8, l: 15.0, h: 2.6, roof: 2.2, cabin: -1.4 },
  },
];

const COP_BODY = { w: 7.4, l: 16.5, h: 3.3, roof: 3.0, cabin: -0.4 };
const copTop = (sector) => 71 + sector * 3.5;

// Rosa's pickup: a cab forward, a bed behind with a tarp over something.
const TRUCK_BODY = { w: 8.0, l: 19.0, h: 3.4, roof: 3.2, cabin: 3.6 };

// What she says on the highway, and what she says on the dirt. Each entry is
// one caption; a long one wraps to two lines at CAPTION_WRAP and is split into
// more captions if it needs more than that.
const RESCUE_SCRIPT = [
  { who: 'ROSA', text: 'HEY. YOU\'RE IN TROUBLE.' },
  { who: 'ROSA', text: 'THAT LINE UP THERE? THEY\'RE WAITING FOR YOU. THEY ALWAYS ARE.' },
  { who: 'ROSA', text: 'I KNOW A PLACE THEY DON\'T GO. A SAFE CITY, PAST THE HILLS.' },
  { who: 'ROSA', text: 'GET IN.' },
];
const DIRT_SCRIPT = [
  { at: 30, who: 'ROSA', text: 'THE POLICE CAN\'T CHASE US OUT HERE. NO PAVEMENT. THEY WON\'T RISK THE CARS.' },
  { at: 300, who: 'ROSA', text: 'IT\'S CALLED REFUGIO. IT ISN\'T MUCH.' },
  { at: 520, who: 'ROSA', text: 'BUT NOBODY THERE WILL TURN YOU IN. NOT ONE OF THEM.' },
  { at: 740, who: 'ROSA', text: 'YOU\'LL NEED WORK, AND YOU\'LL NEED PEOPLE. WE\'VE GOT BOTH.' },
  { at: DIRT_LENGTH - 90, who: 'ROSA', text: 'THERE. HOME, FOR NOW.' },
];

const MENU = [
  { id: 'play', label: 'RUN FOR THE LINE' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'RESTART RUN' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

// --- geometry ----------------------------------------------------------------
// Everything here is built once. `addBox` and friends write into a builder that
// is already open, which is how thirty pieces of roadside furniture end up as
// one mesh and one model rather than thirty of each -- the renderer pays per
// model, and a cactus is not worth a model.

function addBox(b, x, y, z, w, h, d) {
  const [hw, hh, hd] = [w / 2, h / 2, d / 2];
  const v = [
    b.vertex(x - hw, y - hh, z - hd), b.vertex(x + hw, y - hh, z - hd),
    b.vertex(x + hw, y + hh, z - hd), b.vertex(x - hw, y + hh, z - hd),
    b.vertex(x - hw, y - hh, z + hd), b.vertex(x + hw, y - hh, z + hd),
    b.vertex(x + hw, y + hh, z + hd), b.vertex(x - hw, y + hh, z + hd),
  ];
  b.quad(v[1], v[0], v[3], v[2]); // -z
  b.quad(v[4], v[5], v[6], v[7]); // +z
  b.quad(v[0], v[4], v[7], v[3]); // -x
  b.quad(v[5], v[1], v[2], v[6]); // +x
  b.quad(v[3], v[7], v[6], v[2]); // +y
  b.quad(v[0], v[1], v[5], v[4]); // -y
}

// Four triangles and no floor: a boulder is only ever seen from above the sand
// it is sitting on.
function addRock(b, x, y, z, r, h) {
  const top = b.vertex(x, y + h, z);
  const ring = [
    b.vertex(x - r, y, z), b.vertex(x, y, z - r * 0.8),
    b.vertex(x + r, y, z), b.vertex(x, y, z + r * 0.8),
  ];
  for (let i = 0; i < 4; i++) b.triangle(top, ring[(i + 1) % 4], ring[i]);
}

// A five-sided frustum, wound outwards like mesh.cylinder. Far enough away that
// five sides is four more than it needs.
function addMesa(b, x, y, z, r, h, cap) {
  const base = [];
  const top = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    base.push(b.vertex(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
    top.push(b.vertex(x + Math.cos(a) * cap, y + h, z + Math.sin(a) * cap));
  }
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    b.quad(base[i], top[i], top[j], base[j]);
  }
  const centre = b.vertex(x, y + h, z);
  for (let i = 0; i < 5; i++) b.triangle(top[(i + 1) % 5], top[i], centre);
}

// One arm, because a saguaro with one arm still reads as a saguaro and the
// second one costs twelve triangles a plant.
function addCactus(b, x, z, s) {
  addBox(b, x, 8.5 * s, z, 2.8 * s, 17 * s, 2.8 * s);
  addBox(b, x - 2.7 * s, 9.5 * s, z, 3.0 * s, 2.1 * s, 2.3 * s);
  addBox(b, x - 3.7 * s, 12.5 * s, z, 2.1 * s, 6.6 * s, 2.3 * s);
}

// A band laid along the road, from `from` to `to` either side of its centre.
// The tarmac, the edge paint and the checkpoint stripes are all this.
function ribbon(from, to, lift, rows, z0 = 0, z1 = ROAD_PERIOD, centre = roadCentre) {
  const b = mesh.builder();
  let previous = null;
  for (let r = 0; r <= rows; r++) {
    const z = z0 + ((z1 - z0) * r) / rows;
    const c = centre(z);
    const pair = [b.vertex(c + from, lift, z), b.vertex(c + to, lift, z)];
    if (previous) b.quad(previous[0], pair[0], pair[1], previous[1]);
    previous = pair;
  }
  return b.done();
}

function centreLine() {
  const b = mesh.builder();
  const dash = 13;
  const gap = 19;
  for (let z = 0; z + dash < ROAD_PERIOD; z += dash + gap) {
    const c0 = roadCentre(z);
    const c1 = roadCentre(z + dash);
    const v = [
      b.vertex(c0 - 1.5, 0.14, z), b.vertex(c1 - 1.5, 0.14, z + dash),
      b.vertex(c1 + 1.5, 0.14, z + dash), b.vertex(c0 + 1.5, 0.14, z),
    ];
    b.quad(v[0], v[1], v[2], v[3]);
  }
  return b.done();
}

function edgeLines() {
  const b = mesh.builder();
  const rows = 90;
  for (const side of [-1, 1]) {
    let previous = null;
    for (let r = 0; r <= rows; r++) {
      const z = (ROAD_PERIOD * r) / rows;
      const c = roadCentre(z);
      const inner = c + side * (ROAD_HALF - 3.0);
      const outer = c + side * (ROAD_HALF - 0.6);
      const pair = side < 0
        ? [b.vertex(outer, 0.14, z), b.vertex(inner, 0.14, z)]
        : [b.vertex(inner, 0.14, z), b.vertex(outer, 0.14, z)];
      if (previous) b.quad(previous[0], pair[0], pair[1], previous[1]);
      previous = pair;
    }
  }
  return b.done();
}

// Marker posts down both verges. Flat panels facing back down the road and
// drawn two-sided, because a post you see for a third of a second at seventy
// units a second does not need six faces -- and at that speed the stream of
// them flicking past is most of what tells you how fast you are going.
function markerPosts(parity) {
  const b = mesh.builder();
  let n = 0;
  for (let z = 0; z < ROAD_PERIOD; z += POST_STEP, n++) {
    if (n % 2 !== parity) continue;
    const c = roadCentre(z);
    for (const side of [-1, 1]) {
      const x = c + side * VERGE;
      const v = [
        b.vertex(x - 1.1, 0.3, z), b.vertex(x + 1.1, 0.3, z),
        b.vertex(x + 1.1, 6.8, z), b.vertex(x - 1.1, 6.8, z),
      ];
      b.quad(v[0], v[1], v[2], v[3]);
    }
  }
  return b.done();
}

// A car is three meshes, split by what colour they are rather than by what part
// of the car they are: the panels, the dark bits (glass and tyres, which are the
// same grey at this size), and the lamps. Three models a vehicle, and a shape
// that still reads as a car from directly behind at eighty units a second --
// which, in a game played entirely from directly behind, is the only view that
// has to work.
const FLOOR = 1.2;

function bodyMesh(spec) {
  const b = mesh.builder();
  const glass = spec.roof * 0.55;
  addBox(b, 0, spec.h / 2 + FLOOR, 0, spec.w, spec.h, spec.l);
  addBox(b, 0, FLOOR + spec.h + glass + (spec.roof - glass) / 2, spec.cabin,
    spec.w * 0.78, spec.roof - glass, spec.l * 0.42);
  return b.done();
}

function trimMesh(spec) {
  const b = mesh.builder();
  const glass = spec.roof * 0.55;
  addBox(b, 0, FLOOR + spec.h + glass / 2, spec.cabin, spec.w * 0.82, glass, spec.l * 0.44);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(b, sx * spec.w * 0.47, FLOOR, sz * spec.l * 0.31, spec.w * 0.14, 2.4, spec.l * 0.2);
    }
  }
  return b.done();
}

function lampMesh(spec) {
  const b = mesh.builder();
  for (const sx of [-1, 1]) {
    addBox(b, sx * spec.w * 0.31, FLOOR + spec.h * 0.62, -spec.l / 2, spec.w * 0.24, 1.3, 0.7);
  }
  return b.done();
}

// The line itself: a chequer painted across the tarmac, half of it in each of
// two meshes so the two colours can be two models. A plain band came out two
// pixels tall from any distance worth seeing it at, which read as a scratch on
// the tube rather than as a finish line.
function chequerMesh(parity) {
  const b = mesh.builder();
  const blocks = 6;
  const w = (ROAD_HALF * 2) / blocks;
  for (let i = 0; i < blocks; i++) {
    if (i % 2 !== parity) continue;
    const x0 = -ROAD_HALF + i * w;
    const v = [
      b.vertex(x0, 0.2, -5), b.vertex(x0, 0.2, 5),
      b.vertex(x0 + w, 0.2, 5), b.vertex(x0 + w, 0.2, -5),
    ];
    b.quad(v[0], v[1], v[2], v[3]);
  }
  return b.done();
}

// The sun, which is a disc standing up in the XY plane a long way down the road
// and moved along with the camera, so it never gets any closer. There is no sky
// box and no gradient -- one flat circle of PALETTE.sun on the pink is the whole
// sunset, and the dunes cut the bottom off it for free because it is real
// geometry with a real depth.
function sunMesh(radius) {
  const b = mesh.builder();
  const centre = b.vertex(0, 0, 0);
  const rim = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    rim.push(b.vertex(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  for (let i = 0; i < 20; i++) b.triangle(centre, rim[i], rim[(i + 1) % 20]);
  return b.done();
}

function canMesh() {
  const b = mesh.builder();
  addBox(b, 0, 2.6, 0, 3.4, 5.2, 2.4);
  addBox(b, 0, 5.8, 0, 1.2, 1.4, 1.2);
  return b.done();
}

// The checkpoint: two gantry legs and a beam across, square to the road.
function gateMesh() {
  const b = mesh.builder();
  for (const side of [-1, 1]) addBox(b, side * (ROAD_HALF + 4), 9, 0, 3.4, 18, 3.4);
  addBox(b, 0, 19.5, 0, (ROAD_HALF + 6) * 2, 3.4, 3.0);
  return b.done();
}

// A billboard: a board on two posts, facing back down the road. The words go
// on afterwards, in 2D, projected onto the middle of the board -- see
// signLabels() -- because there is no way to paint text on a triangle here
// and no need to invent one for sixteen signs.
function signMesh() {
  const b = mesh.builder();
  for (const side of [-1, 1]) addBox(b, side * (SIGN_W / 2 - 7), 4.5, 0, 1.6, 9, 1.6);
  addBox(b, 0, SIGN_Y, 0, SIGN_W, 16, 1.2);
  return b.done();
}

// A stack of spares: two tyres lying flat, which at this size is two short
// dark cylinders and reads better than one tall one.
function tyreMesh() {
  const b = mesh.builder();
  for (let i = 0; i < 2; i++) {
    const y = i * 2.2;
    const ring = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      ring.push([b.vertex(Math.cos(a) * 3.2, y, Math.sin(a) * 3.2), b.vertex(Math.cos(a) * 3.2, y + 2.2, Math.sin(a) * 3.2)]);
    }
    const cap = b.vertex(0, y + 2.2, 0);
    for (let k = 0; k < 8; k++) {
      const j = (k + 1) % 8;
      b.quad(ring[k][0], ring[k][1], ring[j][1], ring[j][0]);
      b.triangle(ring[j][1], ring[k][1], cap);
    }
  }
  return b.done();
}

// One tile of wire fence, both sides of the road: posts and two rails. It
// stands straight at FENCE_X whatever the road does, which is what makes one
// tile of it repeat on SIDE_TILE rather than on the road's period.
function fenceMesh() {
  const b = mesh.builder();
  for (const side of [-1, 1]) {
    const x = side * FENCE_X;
    for (let z = 0; z < SIDE_TILE; z += 30) addBox(b, x, 4.5, z, 1.2, 9, 1.2);
    addBox(b, x, 3.2, SIDE_TILE / 2, 0.5, 0.6, SIDE_TILE);
    addBox(b, x, 7.4, SIDE_TILE / 2, 0.5, 0.6, SIDE_TILE);
  }
  return b.done();
}

// One tile of slat wall, both sides, closer in than the fence was. With `gap`
// (a z inside the tile) it is the one tile the dirt track crosses through: an
// opening TRACK_GAP wide in both walls, with a post either side of it.
function wallMesh(gap = null) {
  const b = mesh.builder();
  const spans = gap === null
    ? [[0, SIDE_TILE]]
    : [[0, gap - TRACK_GAP / 2], [gap + TRACK_GAP / 2, SIDE_TILE]];
  for (const side of [-1, 1]) {
    const x = side * WALL_X;
    for (const [z0, z1] of spans) addBox(b, x, WALL_H / 2, (z0 + z1) / 2, 1.6, WALL_H, z1 - z0);
    for (let z = 0; z < SIDE_TILE; z += 40) {
      if (gap !== null && Math.abs(z - gap) < TRACK_GAP / 2) continue;
      addBox(b, x, WALL_H / 2 + 1, z, 3, WALL_H + 2, 3);
    }
    if (gap !== null) {
      for (const end of [gap - TRACK_GAP / 2, gap + TRACK_GAP / 2]) addBox(b, x, WALL_H / 2 + 1, end, 3, WALL_H + 2, 3);
    }
  }
  return b.done();
}

// The dirt track across the highway, in two pieces so it never fights the
// tarmac for the same pixels. It follows the sand up over the dunes either
// side, which is what makes it a road into the hills rather than a stripe.
function crossingMesh() {
  const b = mesh.builder();
  const centre = roadCentre(TRACK_Z);
  const runs = [[-GROUND_HALF + 40, centre - ROAD_HALF], [centre + ROAD_HALF, GROUND_HALF - 40]];
  for (const [x0, x1] of runs) {
    let previous = null;
    for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 40) {
      const y = desertY(x, TRACK_Z) + 0.05;
      const pair = [b.vertex(x, y, TRACK_Z - TRACK_HALF), b.vertex(x, y, TRACK_Z + TRACK_HALF)];
      if (previous) b.quad(previous[0], pair[0], pair[1], previous[1]);
      previous = pair;
    }
  }
  return b.done();
}

// Rosa's pickup, in the same three colours a car is plus a fourth for what is
// under the tarp in the bed. The cab is forward, the bed is the body's top.
function truckMesh() {
  const b = mesh.builder();
  const spec = TRUCK_BODY;
  const glass = spec.roof * 0.55;
  addBox(b, 0, spec.h / 2 + FLOOR, 0, spec.w, spec.h, spec.l);
  addBox(b, 0, FLOOR + spec.h + glass + (spec.roof - glass) / 2, spec.cabin,
    spec.w * 0.9, spec.roof - glass, spec.l * 0.42);
  return b.done();
}
function truckLoadMesh() {
  const b = mesh.builder();
  addBox(b, 0, FLOOR + TRUCK_BODY.h + 0.6, -4.6, TRUCK_BODY.w * 0.84, 1.2, 8.4);
  return b.done();
}

// You, on foot, for the one walk in the game: a body and a head, so the shirt
// can be one colour and the face another.
function walkerMesh() {
  const b = mesh.builder();
  addBox(b, 0, 2.0, 0, 1.9, 4.0, 1.1);
  return b.done();
}
function walkerHeadMesh() {
  const b = mesh.builder();
  addBox(b, 0, 4.8, 0, 1.5, 1.5, 1.4);
  return b.done();
}

// --- the dirt road -----------------------------------------------------------
//
// A second world, straight, with the same dunes in a different colour and a
// town at the end of it. Nothing here shares a tile with the highway; it is
// only ever seen from the truck.

function trackPosts() {
  const b = mesh.builder();
  for (let z = 0; z < ROAD_PERIOD; z += 45) {
    for (const side of [-1, 1]) addBox(b, side * (TRACK_HALF + 8), 2.6, z, 1.4, 5.2, 1.4);
  }
  return b.done();
}

function addCylinder(b, x, y, z, r, h, sides) {
  const bottom = [];
  const top = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    bottom.push(b.vertex(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
    top.push(b.vertex(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.quad(bottom[i], top[i], top[j], bottom[j]);
  }
  const cap = b.vertex(x, y + h, z);
  for (let i = 0; i < sides; i++) b.triangle(top[(i + 1) % sides], top[i], cap);
}

function addCone(b, x, y, z, r, h, sides) {
  const rim = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    rim.push(b.vertex(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
  }
  const apex = b.vertex(x, y + h, z);
  for (let i = 0; i < sides; i++) b.triangle(rim[(i + 1) % sides], rim[i], apex);
}

// Refugio from the road: adobe either side of the track, the church at the
// end of it and a water tower over the roofs. Every window is lit, because
// it is dusk and because a town with its lights on is the whole promise.
// Positions are relative to where the truck stops.
const HOUSES = [
  [-42, 70, 22, 9, 18], [44, 80, 26, 10, 20], [-70, 130, 20, 8, 16], [58, 150, 20, 9, 18],
  [-36, 180, 28, 11, 22], [46, 215, 22, 9, 18], [-64, 240, 24, 10, 20], [72, 260, 30, 12, 24],
  [-40, 300, 22, 9, 18], [40, 330, 26, 10, 20],
];
const CHURCH_Z = 400;
function townMeshes() {
  const walls = mesh.builder();
  const wood = mesh.builder();
  const lights = mesh.builder();
  const tank = mesh.builder();
  const steeple = mesh.builder();

  for (const [x, z, w, h, d] of HOUSES) {
    addBox(walls, x, h / 2, z, w, h, d);
    const front = z - d / 2 - 0.3;
    for (const side of [-1, 1]) addBox(lights, x + side * w * 0.28, 4.4, front, 3, 3, 0.5);
    addBox(wood, x, 2.6, front, 3, 5.2, 0.5);
  }
  addBox(walls, 0, 7, CHURCH_Z, 34, 14, 40);
  addBox(walls, 0, 15, CHURCH_Z - 16, 10, 30, 10);
  addBox(lights, 0, 22, CHURCH_Z - 21.3, 3, 4, 0.5);
  addBox(wood, 0, 3.5, CHURCH_Z - 21.3, 4, 7, 0.5);
  addCone(steeple, 0, 30, CHURCH_Z - 16, 7.4, 9, 8);
  addBox(walls, 0, 41.2, CHURCH_Z - 16, 0.7, 3.2, 0.7);
  addBox(walls, 0, 41.8, CHURCH_Z - 16, 2.2, 0.7, 0.7);

  const tx = 64;
  const tz = 300;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(tank, tx + sx * 3.6, 10, tz + sz * 3.6, 1.2, 20, 1.2);
  addCylinder(tank, tx, 20, tz, 7, 9, 8);
  addCone(tank, tx, 29, tz, 7.6, 4, 8);

  return { walls: walls.done(), wood: wood.done(), lights: lights.done(), tank: tank.done(), steeple: steeple.done() };
}

// The scrub either side of the track, from the seed like the desert's.
function furnishScrub(random) {
  const cacti = mesh.builder();
  const rocks = mesh.builder();
  const mesas = mesh.builder();
  for (let i = 0; i < 16; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    addCactus(cacti, side * (TRACK_HALF + 14 + random() * 150), z, 0.7 + random() * 0.6);
  }
  for (let i = 0; i < 22; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    addRock(rocks, side * (TRACK_HALF + 10 + random() * 200), 0, z, 2.5 + random() * 5, 2 + random() * 4);
  }
  for (let i = 0; i < 7; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (420 + random() * 360);
    addMesa(mesas, x, desertY(x, z % GROUND_TILE), z, 50 + random() * 40, 40 + random() * 50, 24 + random() * 20);
  }
  return { cacti: cacti.done(), rocks: rocks.done(), mesas: mesas.done() };
}

// The wall across the world. It runs the full width of the sand and stands
// taller than anything else on the flat, so from half a sector out it is the
// horizon, and the sun sets behind it. With a gap it is the line, and the
// gantry stands in the gap; without one it is the back of the pen.
function lineWallMesh(gap) {
  const b = mesh.builder();
  const edge = GROUND_HALF;
  if (gap) {
    addBox(b, (gap[0] - edge) / 2, LINE_H / 2, 0, gap[0] + edge, LINE_H, 6);
    addBox(b, (gap[1] + edge) / 2, LINE_H / 2, 0, edge - gap[1], LINE_H, 6);
  } else {
    addBox(b, 0, LINE_H / 2, 0, edge * 2, LINE_H, 6);
  }
  for (let x = -edge; x <= edge; x += 60) {
    if (gap && x > gap[0] - 4 && x < gap[1] + 4) continue;
    addBox(b, x, LINE_H / 2 + 1, 0, 4, LINE_H + 2, 9);
  }
  return b.done();
}

// A floodlight for the pen: a mast, with the lamp a separate model so it can be
// lit.
function mastMesh() {
  const b = mesh.builder();
  addBox(b, 0, 16, 0, 2, 32, 2);
  return b.done();
}
function lampMeshFlood() {
  const b = mesh.builder();
  addBox(b, 0, 33, 0, 6, 2.2, 4);
  return b.done();
}

// Where the road meets the line, and so where the gap in the wall goes.
const LINE_CENTRE = roadCentre(RUN);

// Everything that does not depend on the seed, built once for the process.
const WORLD = {
  ground: mesh.grid(GROUND_HALF * 2, GROUND_TILE, GROUND_COLS, GROUND_ROWS, desertY),
  road: ribbon(-ROAD_HALF, ROAD_HALF, 0.06, 90),
  dashes: centreLine(),
  edges: edgeLines(),
  posts: [markerPosts(0), markerPosts(1)],
  gate: gateMesh(),
  stripe: [chequerMesh(0), chequerMesh(1)],
  sun: sunMesh(300),
  can: canMesh(),
  tyre: tyreMesh(),
  sign: signMesh(),
  fence: fenceMesh(),
  wall: wallMesh(),
  line: lineWallMesh([LINE_CENTRE - ROAD_HALF - 8, LINE_CENTRE + ROAD_HALF + 8]),
  pen: lineWallMesh(null),
  mast: mastMesh(),
  flood: lampMeshFlood(),
  crossing: crossingMesh(),
  truckBody: truckMesh(),
  truckTrim: trimMesh(TRUCK_BODY),
  truckLamps: lampMesh(TRUCK_BODY),
  truckLoad: truckLoadMesh(),
  walker: walkerMesh(),
  walkerHead: walkerHeadMesh(),
  copBody: bodyMesh(COP_BODY),
  copTrim: trimMesh(COP_BODY),
  copLamps: lampMesh(COP_BODY),
  copLight: (() => { const b = mesh.builder(); addBox(b, 0, 0, 0, 5.4, 1.5, 1.8); return b.done(); })(),
  bodies: CARS.map((car) => bodyMesh(car.body)),
  trims: CARS.map((car) => trimMesh(car.body)),
  lamps: CARS.map((car) => lampMesh(car.body)),
};

// The wall tile the track crosses through. A tile is chosen by the sector its
// start is in, so the crossing has to be in the last sector -- the one with a
// wall -- and the load check says so rather than drawing a fence with a hole.
const CROSSING_TILE = Math.floor(TRACK_Z / SIDE_TILE) * SIDE_TILE;
if (Math.floor(CROSSING_TILE / LEG) + 1 !== SECTORS) throw new Error('the dirt track has to cross the highway in the last sector');
WORLD.wallGap = wallMesh(TRACK_Z - CROSSING_TILE);

const DIRT = {
  track: ribbon(-TRACK_HALF, TRACK_HALF, 0.06, 20, 0, ROAD_PERIOD, () => 0),
  posts: trackPosts(),
  ...townMeshes(),
};

// Tarmac wants to be darker than the sand it runs through, and no amount of
// lighting will do it: a surface facing straight up under this sun lands on the
// top step of its ramp whatever its ambient is, so the road and the desert
// would come out the same brightness in different hues. `bias` is the way down
// -- the same mechanism golf's mowing stripes use -- and one step is exactly
// the difference between bleached sand and asphalt.
const ROAD_BIAS = new Int8Array(WORLD.road.count).fill(-1);

// The furniture, placed from the seed so a run is the same desert every time it
// is driven, and merged by material so it costs three models rather than forty.
function furnish(random) {
  const cacti = mesh.builder();
  const rocks = mesh.builder();
  const mesas = mesh.builder();

  for (let i = 0; i < 13; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    const x = roadCentre(z) + side * (VERGE + 14 + random() * 130);
    if (Math.abs(x) > FLAT_HALF - 20) continue;
    addCactus(cacti, x, z, 0.75 + random() * 0.6);
  }
  for (let i = 0; i < 18; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    const x = roadCentre(z) + side * (VERGE + 8 + random() * 170);
    if (Math.abs(x) > FLAT_HALF - 10) continue;
    addRock(rocks, x, 0, z, 3 + random() * 5, 2 + random() * 4);
  }
  for (let i = 0; i < 9; i++) {
    const z = random() * ROAD_PERIOD;
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (400 + random() * 380);
    addMesa(mesas, x, desertY(x, z % GROUND_TILE), z, 46 + random() * 46, 40 + random() * 60, 26 + random() * 24);
  }

  return { cacti: cacti.done(), rocks: rocks.done(), mesas: mesas.done() };
}

// Which copies of a tile are worth drawing, given where the camera is.
function tiles(z, span) {
  const first = Math.floor((z - SEE_BACK) / span);
  const last = Math.floor((z + SEE_AHEAD) / span);
  const out = [];
  for (let i = first; i <= last; i++) out.push(i * span);
  return out;
}

// --- the game ----------------------------------------------------------------

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const table = options.scores ?? scores;
  const seed = options.seed ?? 0x424f5244;

  // Two generators from the one seed: the desert is dealt out once at startup,
  // the run deals from its own as it goes. Sharing one would make where a
  // cactus landed depend on how long the last run lasted.
  const scenery = furnish(rng(seed ^ 0x9e3779b9));
  const scrub = furnishScrub(rng(seed ^ 0x5bd1e995));
  const luck = rng(seed);

  const target = scene3d.target(width, height);

  const sounds = [];
  const say = (name) => sounds.push(name);

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    cursor: 0,
    car: 0,
    board: table.table(GAME),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,

    x: 0, z: 0, speed: 0, drift: 0, push: 0,
    fuel: 1, body: 1, pinned: 0,
    distance: 0, sector: 1, legEnd: LEG,
    score: 0, wrecks: 0, cans: 0, spares: 0,
    ending: '',
    cops: [],
    pickups: [],
    nextPickup: 0,
    spawnIn: 0,
    lungeIn: 0,
    engineIn: 0,
    engineFlip: false,
    bumpFor: 0,
    message: '',
    messageFor: 0,

    // The rescue and the dirt road: what phase the cut is in, the truck, you
    // on foot, and the captions. The town is its own machine (border/town.js)
    // and lives here only while the screen is `town`.
    cut: null,
    dz: 0,
    script: [],
    caption: null,
    pausedFrom: 'play',
    town: null,
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };
  // Which world is on screen, looking through the pause menu.
  const stage = () => (game.screen === 'paused' ? game.pausedFrom : game.screen);
  const spec = () => CARS[game.car];
  const announce = (text, seconds = 1.8) => { game.message = text; game.messageFor = seconds; };

  function resetRun() {
    game.x = roadCentre(0);
    game.z = 0;
    game.speed = 0;
    game.drift = 0;
    game.push = 0;
    game.fuel = spec().tank;
    game.body = 1;
    game.pinned = 0;
    game.distance = 0;
    game.sector = 1;
    game.legEnd = LEG;
    game.score = 0;
    game.wrecks = 0;
    game.cans = 0;
    game.spares = 0;
    game.ending = '';
    game.cops = [];
    game.pickups = [];
    game.nextPickup = 420;
    game.spawnIn = 3.5;
    game.lungeIn = 0;
    game.engineIn = 0;
    game.bumpFor = 0;
    game.message = '';
    game.messageFor = 0;
    game.cut = null;
    game.dz = 0;
    game.script = [];
    game.caption = null;
    game.pausedFrom = 'play';
    game.town = null;
  }

  // --- driving ---------------------------------------------------------------

  function drive(dt, frame) {
    const car = spec();
    const dry = game.fuel <= 0;
    const sand = offRoad(game.x, game.z);
    const ceiling = car.top * (sand ? 0.6 : 1);

    // Throttle stops at the ceiling rather than fighting a drag term for it:
    // balancing acceleration against drag put the real top speed 15% over the
    // one on the car's card, which made the card a lie.
    if (frame.a && !dry) game.speed = Math.min(ceiling, game.speed + car.accel * dt);
    else game.speed -= (dry ? 6 : 10) * dt;
    if (frame.b) game.speed -= car.brake * dt;
    if (game.speed > ceiling) game.speed -= (game.speed - ceiling) * 2.4 * dt;
    game.speed = clamp(game.speed, 0, car.top);

    // Steering bites less the slower you are going, which is the only reason a
    // standing start feels like one.
    const steer = (frame.right ? 1 : 0) - (frame.left ? 1 : 0);
    const bite = 0.3 + 0.7 * Math.min(1, game.speed / (car.top * 0.55));
    game.drift += (steer * car.grip * bite - game.drift) * Math.min(1, 9 * dt);
    game.x += (game.drift + game.push) * dt;
    game.push *= Math.max(0, 1 - 5 * dt);

    game.z += game.speed * dt;
    game.distance += game.speed * dt;

    // The posts are the edge of the world, and hitting them costs you.
    const off = game.x - roadCentre(game.z);
    if (Math.abs(off) > VERGE - 3) {
      game.x = roadCentre(game.z) + Math.sign(off) * (VERGE - 3);
      game.drift = -game.drift * 0.25;
      game.push = 0;
      if (game.speed > 18 && game.bumpFor <= 0) {
        say('skid');
        game.bumpFor = 0.5;
        hurt(BODY_POST * (game.speed / car.top) / car.mass);
      }
      game.speed *= 0.86;
    }
    if (game.bumpFor > 0) game.bumpFor -= dt;

    game.fuel -= car.thirst * dt * (0.45 + 0.55 * (game.speed / car.top)) * (sand ? 1.4 : 1);
    if (game.fuel < 0) game.fuel = 0;

    engine(dt);
  }

  // The engine, fired as a stream of one-shots because the only looping voice
  // the mixer has is playing the theme. Faster the harder you are working it.
  function engine(dt) {
    const car = spec();
    game.engineIn -= dt;
    if (game.engineIn <= 0 && game.fuel > 0) {
      game.engineIn = Math.max(0.085, 0.25 - 0.155 * (game.speed / car.top));
      game.engineFlip = !game.engineFlip;
      say(game.engineFlip ? 'engineLow' : 'engineHigh');
    }
  }

  // Body comes off in hits and never in a trickle: what is checked at the end
  // of the step is whether there is any left.
  function hurt(amount) {
    game.body = Math.max(0, game.body - amount);
  }

  // `wrecked` is how long it has been spinning, so it is both the flag and the
  // clock that eventually removes it; it starts at a hair above zero rather
  // than at zero, which is what "still on the road" means.
  function wreckCop(cop, push) {
    cop.wrecked = 1e-6;
    cop.push = push;
    cop.spinRate = (push < 0 ? -1 : 1) * (4.5 + Math.abs(push) * 0.03);
    game.wrecks++;
    game.score += WRECK_SCORE;
    announce(`WRECKED  +${WRECK_SCORE}`, 1.5);
    say('wreck');
  }

  function spawnCop() {
    // From ahead only when there is something to get ahead of: a cruiser
    // waiting up the road for a car that is not coming is a cruiser wasted.
    const ahead = luck() < 0.34 && game.speed > 30;
    const z = game.z + (ahead ? 200 + luck() * 120 : -(150 + luck() * 90));
    const side = luck() < 0.5 ? -1 : 1;
    const lane = roadCentre(z) + side * luck() * ROAD_HALF;
    game.cops.push({
      x: lane,
      z,
      speed: ahead ? Math.max(16, game.speed * 0.55) : game.speed + 8,
      top: copTop(game.sector),
      drift: 0,
      push: 0,
      side,               // which side of you it works from
      lunge: 0,           // seconds left of a swerve at you
      lungeAt: 0,         // ...and where it is aimed, fixed when it starts
      lungeIn: 2 + luck() * 3,
      hitAgo: 1,          // since it last touched you
      touching: false,    // ...and whether it still is
      shunted: false,     // ...nose to tail, rather than door to door
      phase: luck() * TAU,
      spin: 0,
      spinRate: 0,
      wrecked: 0,
    });
    say('siren');
  }

  function stepCops(dt) {
    for (const cop of game.cops) {
      if (cop.wrecked > 0) {
        cop.wrecked += dt;
        cop.spin += cop.spinRate * dt;
        cop.x += cop.push * dt;
        cop.push *= Math.max(0, 1 - 1.2 * dt);
        cop.speed = Math.max(0, cop.speed - 24 * dt);
        cop.z += cop.speed * dt;
        continue;
      }

      // Sent on ahead at the rescue: straight up the middle to the line, to
      // wait with the others. Out of the story, but not out of the picture.
      if (cop.leaving) {
        cop.drift += ((roadCentre(cop.z) - cop.x) * 0.9 - cop.drift) * Math.min(1, 6 * dt);
        cop.x += cop.drift * dt;
        cop.speed = cop.z < RUN + PARKED_Z - 60
          ? Math.min(cop.top, cop.speed + 24 * dt)
          : Math.max(0, cop.speed - 34 * dt);
        cop.z += cop.speed * dt;
        continue;
      }

      // A cruiser holds station beside you and, now and then, comes across at
      // you -- one at a time, with a whoop first, so a hit is a thing you saw
      // coming and could have braked out of. Between lunges it sways a little,
      // which is what makes it a car rather than a fixture. Its own steering
      // keeps it on the tarmac: only a shove from you can put one in the sand.
      cop.hitAgo += dt;
      const dz = cop.z - game.z;
      const alongside = Math.abs(dz) < CAR_L * 2.2;
      const doorToDoor = Math.abs(dz) < CAR_L * 0.9;
      const centre = roadCentre(cop.z);
      if (Math.abs(game.x + cop.side * BESIDE - centre) > ROAD_HALF + 6) cop.side = -cop.side;

      // Only from square alongside: a swerve from a length back is a shunt up
      // the tail, and a shunt is not the hit this is meant to be.
      cop.lungeIn -= dt;
      if (cop.lunge > 0) {
        cop.lunge -= dt;
      } else if (doorToDoor && cop.lungeIn <= 0 && game.lungeIn <= 0) {
        // It commits to where you are when it sets off and never re-aims:
        // a swerve that tracks you cannot be stepped out of.
        cop.lunge = LUNGE;
        cop.lungeAt = game.x;
        cop.lungeIn = LUNGE_REST + luck() * 6;
        game.lungeIn = LUNGE_GAP;
        say('siren');
      }

      // It wants a lane beside yours but it will not leave the tarmac to keep
      // one: steer at it and it runs out of road before you run out of car,
      // which is what makes it something you can lean on. And while you are
      // leaning on it, it has most of no steering at all.
      const sway = Math.sin(game.elapsed * 0.9 + cop.phase) * 3;
      const post = cop.lunge > 0 ? cop.lungeAt : game.x + cop.side * BESIDE + sway;
      const want = clamp(post, centre - (ROAD_HALF - 4), centre + (ROAD_HALF - 4));
      const grip = cop.touching ? COP_GRIP * SHOVED_GRIP : COP_GRIP;
      const aim = clamp((want - cop.x) * (cop.lunge > 0 ? 1.4 : 0.9), -grip, grip);
      cop.drift += (aim - cop.drift) * Math.min(1, 6 * dt);
      cop.x += (cop.drift + cop.push) * dt;
      cop.push *= Math.max(0, 1 - 4.5 * dt);

      // Behind, it catches up; beside, it matches you; ahead, it waits for
      // you, and well ahead it all but stops to. None of that is a speed of
      // its own -- a cruiser only ever has yours, plus or minus -- which is
      // why standing still is being caught.
      // A cruiser in front that you are already pushing eases off instead
      // of braking into you: braking there fed a spiral -- every shunt shared
      // the speed out, it braked below that, another shunt -- that ended with
      // both cars stopped in the road.
      let target;
      if (alongside) target = game.speed + (cop.touching && cop.shunted && dz > 0 ? 4 : clamp(-dz * 0.5, -8, 8));
      else if (dz < 0) target = Math.max(14, game.speed + 18);
      else target = game.speed - (dz > 90 ? 28 : 8);
      target = clamp(target, 0, cop.top);
      cop.speed += clamp(target - cop.speed, -34 * dt, 24 * dt);
      cop.z += cop.speed * dt;

      // Into the sand at speed, and it is over. Nothing decides that a cruiser
      // has been wrecked as a special case: being off the tarmac is the whole
      // condition, which is why shoving one there is worth doing. Your car
      // takes the sand at a crawl; theirs was never built for it.
      const out = cop.x - roadCentre(cop.z);
      if (Math.abs(out) > ROAD_HALF + SAND_WRECK && cop.speed > 18) {
        wreckCop(cop, cop.push !== 0 ? cop.push : Math.sign(out) * 30);
      }
    }

    game.cops = game.cops.filter((cop) => cop.z > game.z - 340 && cop.wrecked < 4);
  }

  function collide() {
    const car = spec();
    for (const cop of game.cops) {
      if (cop.wrecked > 0) continue;
      const dx = cop.x - game.x;
      const dz = cop.z - game.z;
      const ox = CAR_W - Math.abs(dx);
      const oz = CAR_L - Math.abs(dz);
      // Door to door, "touching" reaches a little past the panels: resolving
      // the overlap leaves the two exactly apart, and if that counted as
      // separated the cruiser got its steering back every other frame and a
      // held lean went nowhere.
      if (ox <= -TOUCH || oz <= 0) { cop.touching = false; continue; }

      // A hit is the moment two cars that were apart are not: a shove held
      // for a second is one hit, and the chatter of contact resolving and
      // re-forming a frame later is not another one.
      const hit = ox > 0 && !cop.touching && cop.hitAgo > IMPACT_GAP;
      cop.touching = true;

      const sx = dx < 0 ? -1 : 1;
      const sz = dz < 0 ? -1 : 1;

      if (ox > 0 && oz < ox) {
        // Nose to tail. Arrive on a cruiser fast enough and it is gone; any
        // other shunt, from either end, shares the speed out by mass -- the one
        // in front is pushed on, the one behind is held up -- and costs you
        // paint in proportion. A cruiser up your tail does not stop you: the
        // first version drained your speed every frame it touched, and being
        // caught from behind is not what being caught means here.
        game.z -= sz * oz * 0.55;
        cop.z += sz * oz * 0.45;
        cop.shunted = true;
        const closing = (game.speed - cop.speed) * sz;
        if (closing <= 0) continue;
        if (sz > 0 && closing > RAM_SPEED) {
          wreckCop(cop, (sx || 1) * 44);
          game.speed = Math.max(0, game.speed - closing * 0.3 / car.mass);
          hurt(closing * BODY_NOSE / car.mass);
        } else {
          const mean = (game.speed * car.mass + cop.speed) / (car.mass + 1);
          game.speed = mean;
          cop.speed = mean;
          if (hit) {
            cop.hitAgo = 0;
            hurt((closing > RAM_SPEED ? closing * BODY_NOSE : BODY_TAP) / car.mass);
            say('ram');
          }
        }
      } else {
        // Door to door: the one the whole game is about. Mass decides who ends
        // up where, and a cruiser shoved past the posts is off the road. What
        // the hit costs you is how hard the two of you came together, and a
        // shove held for a second is one hit, not thirty.
        const share = car.mass / (car.mass + 1);
        cop.shunted = false;
        if (ox > 0) {
          cop.x += sx * ox * share;
          game.x -= sx * ox * (1 - share);
        }
        const vp = game.drift + game.push;
        const vc = cop.drift + cop.push;
        if (hit) {
          cop.hitAgo = 0;
          hurt(BODY_SIDE * clamp(Math.abs(vp - vc) / 60, 0.25, 1) / car.mass);
          say('ram');
          cop.push += sx * RAM_PUSH * car.mass;
          game.push -= sx * (RAM_PUSH * 0.55) / car.mass;
        } else if ((vp - vc) * sx > 0) {
          // Still together and still pushing: the pair moves as one, at the
          // lateral speed their momentum adds up to. Each keeps steering, so
          // the shove is the difference between what you want and what it
          // can manage -- and it is not managing much.
          const pair = (vp * car.mass + vc) / (car.mass + 1);
          game.drift = pair - game.push;
          cop.drift = pair - cop.push;
        }
        game.speed = Math.max(0, game.speed - 6 * (1 / 30) / car.mass);
      }
    }
  }

  function stepPickups() {
    while (game.nextPickup < game.z + SEE_AHEAD && game.nextPickup < RUN) {
      const z = game.nextPickup;
      const kind = luck() < TYRE_ODDS ? 'tyre' : 'can';
      game.pickups.push({ kind, x: roadCentre(z) + (luck() - 0.5) * (ROAD_HALF * 1.5), z, taken: false });
      game.nextPickup += PICKUP_STEP * (0.7 + luck() * 0.6);
    }
    game.pickups = game.pickups.filter((item) => item.z > game.z - 60);

    for (const item of game.pickups) {
      if (item.taken) continue;
      if (Math.abs(item.x - game.x) < 8 && Math.abs(item.z - game.z) < 10) {
        item.taken = true;
        game.score += CAN_SCORE;
        if (item.kind === 'can') {
          game.cans++;
          game.fuel = Math.min(spec().tank, game.fuel + CAN_FUEL);
          announce('FUEL', 1.1);
          say('fuel');
        } else {
          game.spares++;
          game.body = Math.min(1, game.body + TYRE_BODY);
          announce('SPARES', 1.1);
          say('heal');
        }
      }
    }
  }

  // Being pulled over. A cruiser inside NEAR while you are slower than
  // PIN_SPEED runs the clock; anything else drains it, faster than it filled.
  function pressure(dt) {
    let near = false;
    for (const cop of game.cops) {
      if (cop.wrecked > 0) continue;
      if (Math.hypot(cop.x - game.x, (cop.z - game.z) * 0.55) < NEAR) near = true;
    }
    const pinned = near && game.speed < PIN_SPEED;
    if (pinned && game.pinned === 0) say('siren');
    game.pinned = clamp(game.pinned + (pinned ? dt : -1.5 * dt), 0, PIN_TIME);
  }

  function finish(ending) {
    game.ending = ending;
    game.score += Math.round(game.distance / 8);
    say(ending === 'busted' ? 'busted' : 'over');
    game.placing = table.placing(GAME, game.score);
    game.initials = [0, 0, 0];
    game.slot = 0;
    go('over');
  }

  function crossed() {
    game.score += SECTOR_SCORE;
    game.sector++;
    game.legEnd += LEG;
    game.fuel = spec().tank;
    game.body = 1;
    game.pinned = 0;
    for (const cop of game.cops) if (cop.wrecked === 0) cop.wrecked = 1e-6;
    announce(`SECTOR ${game.sector}  ·  PATCHED UP`, 2.4);
    say('crossing');
  }

  function running(dt, frame) {
    if (game.messageFor > 0) game.messageFor -= dt;
    game.lungeIn -= dt;

    drive(dt, frame);
    stepCops(dt);
    collide();
    stepPickups();
    pressure(dt);

    game.spawnIn -= dt;
    const live = game.cops.filter((cop) => cop.wrecked === 0).length;
    const wanted = Math.min(MAX_COPS, game.sector + 1);
    if (live < wanted && game.spawnIn <= 0) {
      game.spawnIn = 1.8 + luck() * 2.4;
      spawnCop();
    }

    if (game.z >= RESCUE_Z) { rescue(); return; }
    if (game.z >= game.legEnd) { crossed(); return; }
    if (game.body <= 0) { say('wreck'); finish('wrecked'); return; }
    if (game.pinned >= PIN_TIME) { finish('busted'); return; }
    if (game.fuel <= 0 && game.speed < 6) { finish('dry'); }
  }

  // --- the rescue ------------------------------------------------------------
  //
  // Captions. One at a time over the picture, typed out, and gone after a
  // beat or a press of A -- whichever is first. So the cut plays itself to a
  // player who has put the pad down, and hurries for one who has not.

  function wrapCaption(body) {
    const lines = [];
    let line = '';
    for (const word of body.split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= CAPTION_WRAP) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
    const pages = [];
    for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
    return pages;
  }

  function narrate(entries) {
    for (const entry of entries) {
      for (const lines of wrapCaption(entry.text)) game.script.push({ who: entry.who, lines });
    }
  }

  function stepCaption(dt, frame) {
    if (!game.caption) {
      if (game.script.length) { game.caption = { ...game.script.shift(), reveal: 0, age: 0 }; say('talk'); }
      return;
    }
    const cap = game.caption;
    const full = cap.lines.join(' ').length;
    if (cap.reveal < full) {
      cap.reveal = frame.pressed.a ? full : Math.min(full, cap.reveal + CAPTION_RATE * dt);
      return;
    }
    cap.age += dt;
    if (frame.pressed.a || cap.age >= CAPTION_HOLD) game.caption = null;
  }

  const quiet = () => !game.caption && game.script.length === 0;

  // The run stops being a run. The cruisers behind lift off and stop; the
  // ones ahead are sent on to the line, which is where she says they are.
  function rescue() {
    game.score += RESCUE_SCORE;
    game.pinned = 0;
    game.messageFor = 0;
    for (const cop of game.cops) {
      if (cop.wrecked > 0) continue;
      if (cop.z > game.z + CAR_L) cop.leaving = true;
      else { cop.top = 0; cop.speed = Math.min(cop.speed, game.speed * 0.7); }
    }
    game.cut = {
      phase: 'brake',
      t: 0,
      truck: { x: TRUCK_FROM, y: 0, z: TRACK_Z, speed: TRUCK_TOP, stopX: roadCentre(TRACK_Z) + 1 },
      walker: null,
    };
    say('skid');
    go('rescue');
  }

  // The truck comes across the sand to the road and stops on the track, in
  // front of the car. Returns true once it has.
  function truckIn(dt) {
    const truck = game.cut.truck;
    const left = Math.max(0, truck.x - truck.stopX);
    truck.speed = Math.min(TRUCK_TOP, Math.sqrt(2 * 28 * left));
    truck.x -= truck.speed * dt;
    truck.y = desertY(truck.x, truck.z);
    if (truck.x <= truck.stopX) { truck.x = truck.stopX; truck.speed = 0; return true; }
    return false;
  }

  function rescuing(dt, frame) {
    const cut = game.cut;
    cut.t += dt;
    stepCops(dt);
    stepCaption(dt, frame);

    switch (cut.phase) {
      case 'brake': {
        // The same brake as any stop: down the middle of the road, and the
        // pad has nothing to say about it.
        const left = Math.max(0, RESCUE_STOP - game.z);
        game.speed = Math.min(game.speed, Math.sqrt(2 * 30 * left));
        const aim = clamp((roadCentre(game.z + 40) - game.x) * 1.5, -30, 30);
        game.drift += (aim - game.drift) * Math.min(1, 5 * dt);
        game.push = 0;
        game.x += game.drift * dt;
        game.z += game.speed * dt;
        game.distance += game.speed * dt;
        engine(dt);
        truckIn(dt);
        if (left <= 0 || game.speed < 0.5) { game.speed = 0; game.drift = 0; cut.phase = 'arrive'; }
        break;
      }

      case 'arrive':
        engine(dt);
        if (truckIn(dt)) { cut.phase = 'talk'; narrate(RESCUE_SCRIPT); }
        break;

      case 'talk':
        engine(dt);
        if (!quiet()) break;
        // Out of the car and round the back of the truck to the far door:
        // she is driving, so the near door is hers.
        cut.walker = {
          x: game.x + 5, z: game.z, t: 0, leg: 0,
          legs: [[cut.truck.x + 13, TRACK_Z - 7], [cut.truck.x + 13, TRACK_Z + 7], [cut.truck.x + 2, TRACK_Z + 6]],
        };
        cut.phase = 'board';
        say('door');
        break;

      case 'board': {
        const w = cut.walker;
        const [tx, tz] = w.legs[w.leg];
        const dx = tx - w.x;
        const dz = tz - w.z;
        const d = Math.hypot(dx, dz);
        const step = WALK_SPEED * dt;
        if (d <= step) { w.x = tx; w.z = tz; w.leg++; } else { w.x += (dx / d) * step; w.z += (dz / d) * step; }
        w.t += dt;
        if (w.leg >= w.legs.length) { cut.walker = null; cut.phase = 'depart'; say('door'); }
        break;
      }

      case 'depart': {
        const truck = cut.truck;
        truck.speed = Math.min(TRUCK_TOP, truck.speed + 26 * dt);
        truck.x -= truck.speed * dt;
        truck.y = desertY(truck.x, truck.z);
        truckEngine(dt, truck.speed);
        if (truck.x < -FLAT_HALF - 120) startDirt();
        break;
      }

      default:
        throw new Error(`unknown rescue phase: ${cut.phase}`);
    }
  }

  // The truck's engine, the same stream of one-shots as the car's.
  function truckEngine(dt, speed) {
    game.engineIn -= dt;
    if (game.engineIn <= 0) {
      game.engineIn = Math.max(0.1, 0.28 - 0.15 * (speed / TRUCK_TOP));
      game.engineFlip = !game.engineFlip;
      say(game.engineFlip ? 'engineLow' : 'engineHigh');
    }
  }

  // --- the dirt road ---------------------------------------------------------

  function startDirt() {
    game.dz = 0;
    game.script = [];
    game.caption = null;
    game.cut = { phase: 'drive', t: 0, speed: 0, said: 0, rest: 0, truck: { x: 0, y: 0 } };
    go('dirt');
  }

  function dirtRoad(dt, frame) {
    const cut = game.cut;
    cut.t += dt;
    stepCaption(dt, frame);

    if (cut.phase === 'drive') {
      const left = Math.max(0, DIRT_LENGTH - game.dz);
      cut.speed = Math.min(DIRT_SPEED, cut.speed + 18 * dt, Math.sqrt(2 * 12 * left));
      game.dz += cut.speed * dt;
      cut.truck.x = Math.sin(game.dz * 0.05) * 1.6;
      truckEngine(dt, cut.speed);
      while (cut.said < DIRT_SCRIPT.length && game.dz >= DIRT_SCRIPT[cut.said].at) {
        narrate([DIRT_SCRIPT[cut.said]]);
        cut.said++;
      }
      if (left <= 0.5) { cut.phase = 'stopped'; cut.speed = 0; }
      return;
    }

    // Stopped at the edge of town. Let her finish, then a beat, then out.
    if (!quiet()) return;
    cut.rest += dt;
    if (cut.rest >= 0.8) arriveTown();
  }

  function arriveTown() {
    game.town = town.create(width, height, { court, say, random: rng(seed ^ 0x7ef1a5) });
    game.cut = null;
    go('town');
  }

  function pause(from) {
    game.pausedFrom = from;
    game.cursor = 0;
    say('select');
    go('paused');
  }

  // --- the step --------------------------------------------------------------

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
        if (choice === 'scores') { game.board = table.table(GAME); go('scores'); }
        else { game.cursor = 0; go('cars'); }
        break;
      }

      case 'cars': {
        if (any.pressed.up) { game.car = (game.car + CARS.length - 1) % CARS.length; say('move'); }
        if (any.pressed.down) { game.car = (game.car + 1) % CARS.length; say('move'); }
        if (any.pressed.b) { say('back'); game.cursor = 0; go('menu'); break; }
        if (!confirmed(any)) break;
        say('select');
        resetRun();
        go('play');
        break;
      }

      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); game.cursor = 0; go('menu'); }
        break;

      case 'play':
        if (any.pressed.start) { pause('play'); break; }
        running(dt, any);
        break;

      case 'rescue':
        if (any.pressed.start) { pause('rescue'); break; }
        rescuing(dt, any);
        break;

      case 'dirt':
        if (any.pressed.start) { pause('dirt'); break; }
        dirtRoad(dt, any);
        break;

      case 'town':
        // START pauses unless the town is using it to turn a page.
        if (any.pressed.start && !game.town.busy()) { pause('town'); break; }
        game.town.update(dt, any);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go(game.pausedFrom); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go(game.pausedFrom);
        else if (choice === 'restart') { resetRun(); go('play'); }
        else { game.cursor = 0; resetRun(); go('menu'); }
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

  // --- drawing ---------------------------------------------------------------

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

  const rect = (x, y, w, h, fill) =>
    ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });

  // The chase camera. It sits behind the car but aims at a point up the road
  // rather than at the car, so a corner opens up before you are in it -- aiming
  // at the car means staring at sand for the first half of every bend.
  function chaseCamera() {
    const ahead = game.z + 110;
    const back = 42 + game.speed * 0.17;
    const cx = game.x * 0.88 + roadCentre(game.z) * 0.12;
    const cy = 12 + game.speed * 0.022;
    const cz = game.z - back;
    const tx = roadCentre(ahead) * 0.35 + game.x * 0.65;
    const dx = tx - cx;
    const dz = ahead - cz;
    const dy = 4.0 - cy;
    return {
      x: cx, y: cy, z: cz,
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
      fov: 1.06, near: 0.6,
    };
  }

  // The rescue, once the car has stopped: a camera planted behind and to the
  // right of it, looking across at the track. It is aimed at the truck's
  // stop until the truck leaves, and then it follows the truck out, which
  // pans it left towards the hills without anything having to move it.
  function watchCamera() {
    const cut = game.cut;
    const cx = game.x + 24;
    const cy = 11;
    const cz = game.z - 38;
    const tx = cut.phase === 'depart' ? cut.truck.x : cut.truck.stopX;
    const tz = TRACK_Z;
    const ty = (cut.phase === 'depart' ? cut.truck.y : 0) + 3;
    const dx = tx - cx;
    const dz = tz - cz;
    return {
      x: cx, y: cy, z: cz,
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(ty - cy, Math.hypot(dx, dz)),
      fov: 1.06, near: 0.6,
    };
  }

  // Behind the truck on the dirt road, aimed up the track.
  function dirtCamera() {
    const speed = game.cut.speed;
    const back = 40 + speed * 0.17;
    const cy = 11 + speed * 0.02;
    return {
      x: 0, y: cy, z: game.dz - back,
      yaw: 0,
      pitch: Math.atan2(4 - cy, 110 + back),
      fov: 1.06, near: 0.6,
    };
  }

  // The car lot: same road, same desert, standing still, seen from the same
  // place you will see it from at speed.
  const SHOW_Z = 260;
  function lotCamera() {
    const cz = SHOW_Z - 32;
    const cx = roadCentre(SHOW_Z);
    const dx = roadCentre(SHOW_Z + 90) - cx;
    return {
      x: cx, y: 9.5, z: cz,
      yaw: Math.atan2(dx, 90),
      pitch: Math.atan2(-3.5, 60),
      fov: 1.06, near: 0.6,
    };
  }

  // How far along the run the picture is, for everything that changes with it.
  // The car lot is the start, whatever the last run got to.
  const progress = () => (game.screen === 'cars' ? 0 : clamp(game.z / RUN, 0, 1));

  // The desert, laid down tile by tile. Nothing here is generated: every mesh
  // was built once and this is only deciding where to put the copies.
  function scenery3d(models, camera) {
    const camZ = camera.z;
    // Carried along with the camera, so it stays on the horizon however far you
    // drive. It is further off than any ground tile, so the depth buffer puts
    // every dune in front of it without anything having to be sorted. It sinks
    // as the run goes on: what you set off towards is mostly gone by the line,
    // and the wall across it takes the rest.
    const sunY = SUN_HIGH + (SUN_LOW - SUN_HIGH) * progress();
    models.push({
      mesh: WORLD.sun, position: [camera.x, camera.y + sunY, camZ + 2600],
      ramp: 'sun', ambient: 0.5, twoSided: true,
    });
    for (const z of tiles(camZ, GROUND_TILE)) {
      models.push({ mesh: WORLD.ground, position: [0, 0, z], ramp: 'sand', ambient: 0.44 });
    }
    // The fence, then the wall, by sector. A tile past the line is the pen's
    // side, which is more wall. Nothing before the start.
    for (const z of tiles(camZ, SIDE_TILE)) {
      if (z < 0) continue;
      const sector = Math.floor(z / LEG) + 1;
      if (sector === 1) continue;
      if (sector < SECTORS) models.push({ mesh: WORLD.fence, position: [0, 0, z], ramp: 'bark', ambient: 0.3 });
      else if (z === CROSSING_TILE) models.push({ mesh: WORLD.wallGap, position: [0, 0, z], ramp: 'stone', ambient: 0.3 });
      else models.push({ mesh: WORLD.wall, position: [0, 0, z], ramp: 'stone', ambient: 0.3 });
    }
    if (Math.abs(TRACK_Z - camZ) < SEE_AHEAD) models.push({ mesh: WORLD.crossing, position: [0, 0, 0], ramp: 'bark', ambient: 0.5 });
    for (const z of tiles(camZ, ROAD_PERIOD)) {
      models.push({ mesh: WORLD.road, position: [0, 0, z], ramp: 'stone', ambient: 0.5, bias: ROAD_BIAS });
      models.push({ mesh: WORLD.edges, position: [0, 0, z], ramp: 'cream', ambient: 0.6 });
      models.push({ mesh: WORLD.dashes, position: [0, 0, z], ramp: 'sun', ambient: 0.6 });
      models.push({ mesh: WORLD.posts[0], position: [0, 0, z], ramp: 'cream', ambient: 1, twoSided: true });
      models.push({ mesh: WORLD.posts[1], position: [0, 0, z], ramp: 'ember', ambient: 1, twoSided: true });
      models.push({ mesh: scenery.mesas, position: [0, 0, z], ramp: 'violet', ambient: 0.5 });
      models.push({ mesh: scenery.rocks, position: [0, 0, z], ramp: 'bark', ambient: 0.3 });
      models.push({ mesh: scenery.cacti, position: [0, 0, z], ramp: 'moss', ambient: 0.25 });
    }
  }

  function vehicle(models, parts, ramp, x, z, yaw, y = 0) {
    models.push({ mesh: parts[0], position: [x, y, z], yaw, ramp, ambient: 0.18 });
    models.push({ mesh: parts[1], position: [x, y, z], yaw, ramp: 'stone', ambient: 0.05 });
    models.push({ mesh: parts[2], position: [x, y, z], yaw, ramp: 'ember', ambient: 1 });
  }

  function truck3d(models, x, y, z, yaw) {
    vehicle(models, [WORLD.truckBody, WORLD.truckTrim, WORLD.truckLamps], 'moss', x, z, yaw, y);
    models.push({ mesh: WORLD.truckLoad, position: [x, y, z], yaw, ramp: 'bark', ambient: 0.35 });
  }

  function world() {
    const models = [];
    const at = stage();
    const camera = at === 'cars' ? lotCamera()
      : at === 'rescue' && game.cut.phase !== 'brake' ? watchCamera()
      : chaseCamera();
    scenery3d(models, camera);

    if (game.screen === 'cars') {
      // The one you are on is always the one in the middle, with the other two
      // parked further up the road behind it: the lot rearranges itself rather
      // than a highlight sliding along a row, so what fills the screen and what
      // the read-out is describing are the same car without anything having to
      // point at it.
      CARS.forEach((car, i) => {
        const slot = ((i - game.car + CARS.length + 1) % CARS.length) - 1;
        const x = roadCentre(SHOW_Z) + slot * 22;
        const z = SHOW_Z + (slot === 0 ? 0 : 50);
        const yaw = slot === 0 ? Math.sin(game.elapsed * 1.1) * 0.42 : 0;
        vehicle(models, [WORLD.bodies[i], WORLD.trims[i], WORLD.lamps[i]], car.ramp, x, z, yaw);
      });
      return { background: PALETTE.rose, camera, light: { x: -0.45, y: 0.78, z: -0.45 }, ambient: 0.42, models };
    }

    // The checkpoint gantry, and the line painted under it.
    if (game.legEnd - game.z < SEE_AHEAD && game.legEnd - game.z > -60) {
      const gz = game.legEnd;
      models.push({ mesh: WORLD.gate, position: [roadCentre(gz), 0, gz], yaw: roadAim(gz), ramp: 'cream', ambient: 0.3 });
      models.push({ mesh: WORLD.stripe[0], position: [roadCentre(gz), 0, gz], yaw: roadAim(gz), ramp: 'ember', ambient: 0.6 });
      models.push({ mesh: WORLD.stripe[1], position: [roadCentre(gz), 0, gz], yaw: roadAim(gz), ramp: 'cream', ambient: 0.6 });
    }

    // The wall across the world at the line, and the pen behind it: its back
    // wall, two floodlights, and the cruisers waiting across the road. All of
    // it is in view from half a sector out, through the gap, which is the
    // point of putting it there rather than on the score board.
    const toLine = RUN - game.z;
    if (toLine < SEE_AHEAD + 100 && toLine > -PEN_DEPTH - 200) {
      models.push({ mesh: WORLD.line, position: [0, 0, RUN], ramp: 'stone', ambient: 0.35 });
      models.push({ mesh: WORLD.pen, position: [0, 0, RUN + PEN_DEPTH], ramp: 'stone', ambient: 0.35 });
      const penGate = RUN + PEN_DEPTH - 40;
      models.push({ mesh: WORLD.gate, position: [roadCentre(penGate), 0, penGate], yaw: roadAim(penGate), ramp: 'cream', ambient: 0.3 });
      for (const side of [-1, 1]) {
        const mx = LINE_CENTRE + side * 44;
        const mz = RUN + PEN_DEPTH - 24;
        models.push({ mesh: WORLD.mast, position: [mx, 0, mz], ramp: 'stone', ambient: 0.3 });
        models.push({ mesh: WORLD.flood, position: [mx, 0, mz], ramp: 'sun', ambient: 1 });
      }
      const pz = RUN + PARKED_Z;
      const blue = Math.floor(game.elapsed * 6) % 2 === 0;
      for (const slot of PARKED) {
        const px = roadCentre(pz) + slot.dx;
        vehicle(models, [WORLD.copBody, WORLD.copTrim, WORLD.copLamps], 'sky', px, pz, slot.yaw);
        models.push({
          mesh: WORLD.copLight, position: [px, FLOOR + COP_BODY.h + COP_BODY.roof + 0.9, pz],
          yaw: slot.yaw, ramp: blue ? 'sky' : 'ember', ambient: 1,
        });
      }
    }

    for (const sign of SIGNS) {
      if (sign.z < game.z - 40 || sign.z > game.z + SEE_AHEAD) continue;
      models.push({ mesh: WORLD.sign, position: [signX(sign), 0, sign.z], ramp: sign.tone, ambient: 0.35 });
    }

    for (const item of game.pickups) {
      if (item.taken || item.z < game.z - 40) continue;
      if (item.kind === 'can') models.push({ mesh: WORLD.can, position: [item.x, 0, item.z], ramp: 'sun', ambient: 0.2 });
      else models.push({ mesh: WORLD.tyre, position: [item.x, 0, item.z], ramp: 'stone', ambient: 0.05 });
    }

    for (const cop of game.cops) {
      const yaw = cop.wrecked > 0 ? cop.spin : Math.atan2(cop.drift, Math.max(8, cop.speed));
      vehicle(models, [WORLD.copBody, WORLD.copTrim, WORLD.copLamps], 'sky', cop.x, cop.z, yaw);
      // The bar flashes on the run clock, so both cruisers and both colours
      // stay in step -- a row of them out of phase reads as fairy lights.
      const blue = Math.floor(game.elapsed * 6) % 2 === 0;
      models.push({
        mesh: WORLD.copLight, position: [cop.x, FLOOR + COP_BODY.h + COP_BODY.roof + 0.9, cop.z],
        yaw, ramp: blue ? 'sky' : 'ember', ambient: 1,
      });
    }

    const car = spec();
    vehicle(models, [WORLD.bodies[game.car], WORLD.trims[game.car], WORLD.lamps[game.car]], car.ramp,
      game.x, game.z, Math.atan2(game.drift + game.push, Math.max(10, game.speed)));

    // The rescue: her truck, and you between the two of them.
    if (at === 'rescue') {
      const { truck, walker } = game.cut;
      truck3d(models, truck.x, truck.y, truck.z, -Math.PI / 2);
      if (walker) {
        const [tx, tz] = walker.legs[walker.leg] ?? [walker.x, walker.z + 1];
        const yaw = Math.atan2(tx - walker.x, tz - walker.z);
        const bob = Math.abs(Math.sin(walker.t * 9)) * 0.18;
        models.push({ mesh: WORLD.walker, position: [walker.x, bob, walker.z], yaw, ramp: 'sky', ambient: 0.3 });
        models.push({ mesh: WORLD.walkerHead, position: [walker.x, bob, walker.z], yaw, ramp: 'bark', ambient: 0.35 });
      }
    }

    // Dusk for the last sector. One flat colour is the whole sky, so the change
    // is a cut at the gate rather than a fade -- which is how a checkpoint
    // already treats everything else.
    const sky = at !== 'cars' && game.sector >= DUSK_SECTOR ? PALETTE.violet : PALETTE.rose;
    return { background: sky, camera, light: { x: -0.45, y: 0.78, z: -0.45 }, ambient: 0.42, models };
  }

  // The dirt road: the dunes again in scrub green, a straight track with
  // posts, and the town once it is in range. The truck bounces a little in
  // proportion to its speed, which is most of what says "dirt".
  function dirtWorld() {
    const cut = game.cut;
    const camera = dirtCamera();
    const models = [];
    for (const z of tiles(camera.z, GROUND_TILE)) {
      models.push({ mesh: WORLD.ground, position: [0, 0, z], ramp: 'rough', ambient: 0.4 });
    }
    for (const z of tiles(camera.z, ROAD_PERIOD)) {
      models.push({ mesh: DIRT.track, position: [0, 0, z], ramp: 'bark', ambient: 0.5 });
      models.push({ mesh: DIRT.posts, position: [0, 0, z], ramp: 'bark', ambient: 0.35 });
      models.push({ mesh: scrub.mesas, position: [0, 0, z], ramp: 'violet', ambient: 0.5 });
      models.push({ mesh: scrub.rocks, position: [0, 0, z], ramp: 'bark', ambient: 0.3 });
      models.push({ mesh: scrub.cacti, position: [0, 0, z], ramp: 'moss', ambient: 0.25 });
    }
    if (DIRT_LENGTH - game.dz < SEE_AHEAD + 200) {
      models.push({ mesh: DIRT.walls, position: [0, 0, DIRT_LENGTH], ramp: 'cream', ambient: 0.4 });
      models.push({ mesh: DIRT.wood, position: [0, 0, DIRT_LENGTH], ramp: 'bark', ambient: 0.35 });
      models.push({ mesh: DIRT.lights, position: [0, 0, DIRT_LENGTH], ramp: 'sun', ambient: 1 });
      models.push({ mesh: DIRT.tank, position: [0, 0, DIRT_LENGTH], ramp: 'stone', ambient: 0.35 });
      models.push({ mesh: DIRT.steeple, position: [0, 0, DIRT_LENGTH], ramp: 'ember', ambient: 0.4 });
      models.push({ mesh: WORLD.sign, position: [TOWN_SIGN.x, 0, TOWN_SIGN.z], ramp: 'bark', ambient: 0.35 });
    }
    const bob = Math.abs(Math.sin(game.dz * 0.9)) * 0.3 * (cut.speed / DIRT_SPEED);
    truck3d(models, cut.truck.x, bob, game.dz, Math.sin(game.dz * 0.05 + 1.5) * 0.04);
    return { background: PALETTE.violet, camera, light: { x: -0.45, y: 0.78, z: -0.45 }, ambient: 0.42, models };
  }

  // The words on the boards and the beams, as 2D text pinned to a 3D point.
  // A label switches on at SIGN_FAR at scale 1 and doubles inside SIGN_NEAR,
  // which is as close to perspective as a bitmap font gets; it is skipped
  // whenever it would land on the dashboard or hang off the picture.
  function labeller(view) {
    const labels = [];
    const top = court.y + 44 + 8;
    const bottom = court.y + court.h - (stage() === 'play' ? 52 : CAPTION_H) - 8;
    const put = (x, y, z, body, fill, nearOnly = false) => {
      const p = scene3d.project(view, target, x, y, z);
      if (!p) return;
      let scale = p.distance < SIGN_NEAR ? 2 : p.distance < SIGN_FAR && !nearOnly ? 1 : 0;
      // A near sign at the edge of the picture gets the small text rather
      // than none: the board is half in frame and half of the words is worse.
      for (; scale > (nearOnly ? 1 : 0); scale--) {
        const w = body.length * FONT.width * scale;
        const h = FONT.height * scale;
        if (p.x - w / 2 < court.x + 4 || p.x + w / 2 > court.x + court.w - 4) continue;
        if (p.y - h / 2 < top || p.y + h / 2 > bottom) continue;
        labels.push(text(body, p.x, p.y - h / 2, { scale, fill }));
        return;
      }
    };
    return { labels, put };
  }

  function signLabels(view) {
    const { labels, put } = labeller(view);
    for (const sign of SIGNS) {
      if (sign.z < game.z || sign.z > game.z + SIGN_FAR) continue;
      put(signX(sign), SIGN_Y, sign.z, sign.text, sign.tone === 'bark' ? PALETTE.sun : PALETTE.cream);
    }
    // Ink on the cream beam, and only at scale 2: a one-pixel ink stroke is
    // what the flicker rule is about, and at scale 2 there are none.
    for (let n = 1; n <= SECTORS; n++) {
      const gz = n * LEG;
      if (gz < game.z || gz > game.z + SIGN_NEAR) continue;
      put(roadCentre(gz), 19.5, gz, n === SECTORS ? 'WELCOME' : 'CHECKPOINT', PALETTE.ink, true);
    }
    const penGate = RUN + PEN_DEPTH - 40;
    if (penGate >= game.z && penGate <= game.z + SIGN_NEAR) put(roadCentre(penGate), 19.5, penGate, 'PROCESSING', PALETTE.ink, true);
    return labels;
  }

  function dirtLabels(view) {
    const { labels, put } = labeller(view);
    if (TOWN_SIGN.z >= game.dz && TOWN_SIGN.z <= game.dz + SIGN_FAR) put(TOWN_SIGN.x, SIGN_Y, TOWN_SIGN.z, 'REFUGIO', PALETTE.cream);
    return labels;
  }

  // --- screens ---------------------------------------------------------------

  function menuList(items, cursor, top) {
    return items.map((item, i) => centred(`${i === cursor ? '▶ ' : '  '}${item.label}`, top + i * 44, {
      scale: 2, fill: i === cursor ? PALETTE.sun : PALETTE.cream,
    }));
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: [
        rect(mid.x - 210, court.y + 158, 420, 5, PALETTE.ember),
        rect(mid.x - 210, court.y + 170, 420, 3, PALETTE.bark),
      ] }],
      text: [
        centred('BORDER', court.y + 58, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        centred('PATROL', court.y + 118, { scale: 2, font: HEAVY, fill: PALETTE.ember }),
        ...menuList(MENU, game.cursor, court.y + 228),
        centred(`${SECTORS} SECTORS  ·  DON'T GET CAUGHT`, court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  function carsScreen() {
    const car = CARS[game.car];
    const panel = { x: mid.x - 250, y: court.y + court.h - 140, w: 500, h: 140 };

    // A flat plate under the read-out. There is no alpha on a poster, and a
    // number over a dune is a number nobody can read.
    const shapes = [
      rect(court.x + 24, court.y + 84, court.w - 48, 4, PALETTE.ember),
      rect(panel.x, panel.y, panel.w, panel.h, PALETTE.ink),
      rect(panel.x, panel.y, panel.w, 4, PALETTE.ember),
    ];
    const labels = [
      centred('PICK YOUR CAR', court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.cream }),
      centred('U D PICK  ·  A DRIVE  ·  B BACK', court.y + 106, { scale: 2, fill: PALETTE.cream }),
      centred(car.name, panel.y + 24, { scale: 1, font: HEAVY, fill: PALETTE[car.ramp] }),
      centred(car.line, panel.y + 58, { scale: 2, fill: PALETTE.bark }),
    ];

    // Three meters across the bottom of the plate. The scales are the widest
    // any car reaches, not zero-based, so the differences are the point.
    const bars = [
      ['SPEED', car.top / 80, PALETTE.sun],
      ['GRIP', car.grip / 46, PALETTE.moss],
      ['WEIGHT', car.mass / 1.6, PALETTE.ember],
    ];
    const bw = 130;
    bars.forEach(([label, value, fill], i) => {
      const x = mid.x - 215 + i * (bw + 20);
      shapes.push(rect(x, panel.y + 84, bw, 16, PALETTE.stoneDim));
      shapes.push(rect(x, panel.y + 84, Math.max(4, bw * value), 16, fill));
      labels.push(text(label, x + bw / 2, panel.y + 116, { scale: 2, fill: PALETTE.bark }));
    });

    return { underlay: true, layers: [{ flat: true, shapes }], text: labels };
  }

  function scoresScreen() {
    // Eight rows at 32 apart, not 34: at 34 the last of them ran into the line
    // telling you how to leave.
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 200, court.y + 124 + i * 32, { anchor: 'start', fill: PALETTE.bark }),
      text(row.name, mid.x - 70, court.y + 124 + i * 32, { anchor: 'start', fill: PALETTE.cream }),
      text(row.score === null ? '   --' : String(row.score).padStart(6, ' '), mid.x + 200, court.y + 124 + i * 32,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();

    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 116, court.w - 120, 4, PALETTE.ember)] }],
      text: [
        centred('LONGEST RUNS', court.y + 68, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        centred('B TO GO BACK', court.y + court.h - 26, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  // Speed, fuel and body, which are the only three things you can do anything
  // about. Every bar is at least three pixels tall: a one-pixel ink run lands
  // in a single interlaced field and strobes.
  function hud() {
    const shapes = [];
    const labels = [];
    const car = spec();

    // Two flat bands, top and bottom. A read-out over the sky or over the road
    // is a read-out you cannot read -- there is no alpha to fall back on, and a
    // dashboard framing the picture is what an arcade cabinet did anyway.
    const topH = 44;
    const bottom = court.y + court.h - 52;
    shapes.push(rect(court.x, court.y, court.w, topH, PALETTE.ink));
    shapes.push(rect(court.x, court.y + topH - 3, court.w, 3, PALETTE.ember));
    shapes.push(rect(court.x, bottom, court.w, 52, PALETTE.ink));
    shapes.push(rect(court.x, bottom, court.w, 3, PALETTE.ember));

    const toGate = Math.max(0, Math.round(game.legEnd - game.z));
    labels.push(text(`${game.score}`, court.x + 12, court.y + 6, { anchor: 'start', fill: PALETTE.sun }));
    labels.push(centred(`SECTOR ${game.sector}/${SECTORS}  ·  ${toGate} M`, court.y + 22, { fill: PALETTE.cream }));
    labels.push(text(`${game.wrecks} DOWN`, court.x + court.w - 12, court.y + 6, { anchor: 'end', fill: PALETTE.bark }));

    // Bars, never thinner than three pixels: a one-pixel horizontal run lands
    // in a single interlaced field and strobes at 30 Hz.
    const meter = (x, y, w, value, fill) => {
      shapes.push(rect(x, y, w, 16, PALETTE.stoneDim));
      shapes.push(rect(x, y, Math.max(4, w * clamp(value, 0, 1)), 16, fill));
    };

    const fuel = game.fuel / car.tank;
    labels.push(text('FUEL', court.x + 12, bottom + 12, { anchor: 'start', fill: PALETTE.bark }));
    meter(court.x + 84, bottom + 18, 120, fuel, fuel < 0.22 ? PALETTE.ember : PALETTE.moss);

    labels.push(text('BODY', court.x + court.w - 12, bottom + 12, { anchor: 'end', fill: PALETTE.bark }));
    meter(court.x + court.w - 204, bottom + 18, 120, game.body,
      game.body < 0.3 ? PALETTE.ember : PALETTE.sky);

    labels.push(centred(`${Math.round(game.speed * 1.6)} MPH`, bottom + 26, { scale: 1, font: HEAVY, fill: PALETTE.cream }));

    // One plate, one thing to say. Being pulled over outranks everything,
    // because it is the one with a clock on it: the bar under the words is how
    // long you have left to get moving.
    const pulled = game.screen === 'play' && game.pinned > 0.2;
    const shout = pulled ? ['PULL OVER', PALETTE.ember]
      : game.fuel <= 0 ? ['OUT OF GAS', PALETTE.ember]
      : game.messageFor > 0 ? [game.message, PALETTE.sun] : null;
    if (shout) {
      const w = shout[0].length * HEAVY.width + 40;
      const h = pulled ? 56 : 44;
      shapes.push(rect(mid.x - w / 2, court.y + 128, w, h, PALETTE.ink));
      labels.push(centred(shout[0], court.y + 150, { scale: 1, font: HEAVY, fill: shout[1] }));
      if (pulled) {
        shapes.push(rect(mid.x - w / 2 + 12, court.y + 172, w - 24, 6, PALETTE.stoneDim));
        shapes.push(rect(mid.x - w / 2 + 12, court.y + 172, Math.max(4, (w - 24) * (game.pinned / PIN_TIME)), 6, PALETTE.ember));
      }
    }

    return { shapes, labels };
  }

  function playScreen() {
    const { shapes, labels } = hud();
    return { underlay: true, layers: [{ flat: true, shapes }], text: labels };
  }

  // The cut: the top band as it was, and a taller bottom band that is the
  // caption plate -- empty between captions, which is a letterbox, which is
  // what says "you are watching now".
  function cutHud() {
    const shapes = [];
    const labels = [];
    const topH = 44;
    const bottom = court.y + court.h - CAPTION_H;
    shapes.push(rect(court.x, court.y, court.w, topH, PALETTE.ink));
    shapes.push(rect(court.x, court.y + topH - 3, court.w, 3, PALETTE.ember));
    shapes.push(rect(court.x, bottom, court.w, CAPTION_H, PALETTE.ink));
    shapes.push(rect(court.x, bottom, court.w, 3, PALETTE.ember));

    labels.push(text(`${game.score}`, court.x + 12, court.y + 6, { anchor: 'start', fill: PALETTE.sun }));
    const line = stage() === 'dirt'
      ? `REFUGIO  ·  ${Math.max(0, Math.round(DIRT_LENGTH - game.dz))} M`
      : `SECTOR ${game.sector}/${SECTORS}  ·  ${Math.max(0, Math.round(game.legEnd - game.z))} M`;
    labels.push(centred(line, court.y + 22, { fill: PALETTE.cream }));
    labels.push(text(`${game.wrecks} DOWN`, court.x + court.w - 12, court.y + 6, { anchor: 'end', fill: PALETTE.bark }));

    const cap = game.caption;
    if (cap) {
      labels.push(text(cap.who, court.x + 32, bottom + 10, { anchor: 'start', fill: PALETTE.sun }));
      let budget = Math.floor(cap.reveal);
      cap.lines.forEach((body, i) => {
        labels.push(text(body.slice(0, Math.max(0, budget)), court.x + 32, bottom + 42 + i * 30, { anchor: 'start' }));
        budget -= body.length + 1;
      });
    }
    return { shapes, labels };
  }

  function cutScreen() {
    const { shapes, labels } = cutHud();
    return { underlay: true, layers: [{ flat: true, shapes }], text: labels };
  }

  function townScreen() {
    return game.town.parts();
  }

  function pausedScreen() {
    if (game.pausedFrom === 'town') return townPausedScreen();
    const { shapes } = game.pausedFrom === 'play' ? hud() : cutHud();
    // One plate for the whole menu, not just the headline: sun-coloured text on
    // bleached sand is text nobody can read, and there is no drop shadow on a
    // poster. The road behind it stays visible either side, dithered.
    const plate = { x: mid.x - 190, y: court.y + 72, w: 380, h: 254 };
    return {
      underlay: true,
      layers: [
        { flat: true, shapes, alpha: 0.25 },
        { flat: true, shapes: [
          rect(plate.x, plate.y, plate.w, plate.h, PALETTE.ink),
          rect(plate.x, plate.y, plate.w, 4, PALETTE.ember),
          rect(plate.x, plate.y + plate.h - 4, plate.w, 4, PALETTE.ember),
        ] },
      ],
      text: [
        centred('PAUSED', court.y + 116, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(PAUSE_MENU, game.cursor, court.y + 200),
      ],
    };
  }

  // The town, faded under the same plate. Everything it drew goes into one
  // flat layer: the dither breaks the outlines up anyway, and a scratch copy
  // per inked layer is not worth it for a pause.
  function townPausedScreen() {
    const built = game.town.parts();
    const plate = { x: mid.x - 190, y: court.y + 72, w: 380, h: 254 };
    return {
      layers: [
        { flat: true, shapes: built.layers.flatMap((layer) => layer.shapes), alpha: 0.25 },
        { flat: true, shapes: [
          rect(plate.x, plate.y, plate.w, plate.h, PALETTE.ink),
          rect(plate.x, plate.y, plate.w, 4, PALETTE.ember),
          rect(plate.x, plate.y + plate.h - 4, plate.w, 4, PALETTE.ember),
        ] },
      ],
      text: [
        centred('PAUSED', court.y + 116, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(PAUSE_MENU, game.cursor, court.y + 200),
      ],
    };
  }

  // There is no ending that is not a failure any more: the run that goes well
  // becomes something else. These are the three that do not.
  const ENDINGS = {
    busted: ['BUSTED', PALETTE.ember, null],
    wrecked: ['WRECKED', PALETTE.ember, null],
    dry: ['OUT OF GAS', PALETTE.ember, null],
  };

  function overScreen() {
    const [headline, colour, line] = ENDINGS[game.ending] ?? ['RUN OVER', PALETTE.ember, null];
    const body = [
      centred(headline, court.y + 76, { scale: 2, font: HEAVY, fill: colour }),
      centred(`${game.score}`, court.y + 146, { scale: 3, font: HEAVY, fill: PALETTE.sun }),
    ];
    if (line) body.push(centred(line, court.y + 200, { scale: 2, fill: PALETTE.cream }));
    body.push(centred(`${Math.round(game.distance)} M  ·  ${game.wrecks} WRECKED  ·  SECTOR ${game.sector}`,
      court.y + (line ? 230 : 200), { scale: 2, fill: PALETTE.bark }));

    if (game.placing > 0) {
      const letters = game.initials.map((i) => scores.ALPHABET[i]);
      body.push(centred(`RANK ${game.placing}`, court.y + 266, { scale: 2, fill: PALETTE.moss }));
      letters.forEach((letter, i) => {
        body.push(text(letter, mid.x + (i - 1) * 52, court.y + 300,
          { scale: 2, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
      });
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    }

    const carets = game.placing > 0
      ? [rect(mid.x + (game.slot - 1) * 52 - 16, court.y + 372, 32, 6, PALETTE.sun)]
      : [];
    return { layers: [{ flat: true, shapes: carets }], text: body };
  }

  const SCREENS = {
    menu: menuScreen, cars: carsScreen, scores: scoresScreen,
    play: playScreen, rescue: cutScreen, dirt: cutScreen, town: townScreen,
    paused: pausedScreen, over: overScreen,
  };

  function scene() {
    const built = SCREENS[game.screen]();
    let underlay = null;
    let labels = built.text;
    if (built.underlay) {
      const at = stage();
      const view = at === 'dirt' ? dirtWorld() : world();
      underlay = scene3d.render(view, target).canvas;
      if (at === 'play' || at === 'rescue') labels = labels.concat(signLabels(view));
      if (at === 'dirt') labels = labels.concat(dirtLabels(view));
    }

    return {
      title: `Border Patrol (${game.screen})`,
      width,
      height,
      background: PALETTE.ink,
      underlay,
      matte: court,
      matteColour: PALETTE.ink,
      font: FONT,
      layers: built.layers,
      text: labels,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    // Three themes, and never the same one twice: "patrol" is what plays
    // while nobody is driving, "chase" is what plays while somebody is, and
    // "refugio" is the town's, from the dirt road on. The rescue itself has
    // nothing under it: the chase theme stops when the car does, and the
    // silence is the point.
    music() {
      const at = stage();
      if (at === 'rescue') return null;
      if (at === 'dirt' || at === 'town') return 'refugio';
      return game.screen === 'play' ? 'chase' : 'patrol';
    },
    // The town, for a test that has to walk it: its door table and centreOf.
    town: () => game.town,
    state() {
      return {
        screen: game.screen, stage: stage(), exit: game.exit, cursor: game.cursor,
        phase: game.cut ? game.cut.phase : null,
        caption: game.caption ? game.caption.lines.join(' ') : null,
        dz: game.dz,
        truck: game.cut && game.cut.truck ? { x: game.cut.truck.x, z: game.cut.truck.z } : null,
        town: game.town ? game.town.state() : null,
        car: CARS[game.car].id,
        x: game.x, z: game.z, speed: game.speed, drift: game.drift,
        fuel: game.fuel, body: game.body, pinned: game.pinned,
        distance: game.distance, sector: game.sector, toGate: game.legEnd - game.z,
        score: game.score, wrecks: game.wrecks, cans: game.cans, spares: game.spares,
        ending: game.ending, placing: game.placing,
        offRoad: offRoad(game.x, game.z) === 1,
        cops: game.cops.map((cop) => ({
          x: cop.x, z: cop.z, speed: cop.speed, wrecked: cop.wrecked > 0, lunging: cop.lunge > 0,
        })),
        pickups: game.pickups.filter((item) => !item.taken).map((item) => ({ kind: item.kind, x: item.x, z: item.z })),
      };
    },
  };
}

// Box art: a road running to a low sun, which is the only picture this game has
// ever needed. The road is a stack of rectangles rather than a tapered chain,
// because a chain is a swept disc and the wide end of one bulges out of the
// card the selector draws it in -- nothing clips an emblem but the emblem.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const horizon = y + h * 0.44;
  const shapes = [
    r(x, y, w, h * 0.44, PALETTE.rose),
    { type: 'disc', x: Math.round(x + w * 0.66), y: Math.round(horizon), r: Math.round(h * 0.22), fill: PALETTE.sun },
    r(x, horizon, w, h * 0.56, PALETTE.sand),
  ];

  const bands = 5;
  const centre = x + w * 0.46;
  for (let i = 0; i < bands; i++) {
    const band = (h * 0.56) / bands;
    const wide = w * (0.08 + (i / (bands - 1)) * 0.6);
    shapes.push(r(centre - wide / 2, horizon + i * band, wide, band + 1, PALETTE.stone));
  }
  shapes.push(r(centre - w * 0.11, y + h * 0.74, w * 0.22, h * 0.13, PALETTE.ember));
  shapes.push(r(centre - w * 0.06, y + h * 0.66, w * 0.12, h * 0.1, PALETTE.ember));
  return shapes;
}

module.exports = {
  title: 'BORDER PATROL',
  blurb: 'RUN FOR THE LINE',
  meta: {
    players: [1],
    rating: '13',
    audio: '8-bit',
    graphics: '3d-low',
    content: ['police pursuit', 'border and detention themes'],
  },
  accent: 'ember',
  emblem,
  create, CARS, MENU, PAUSE_MENU, LEG, SECTORS, RUN, SIGNS, SIGN_W, SIDE_TILE, FENCE_X, WALL_X, PIN_TIME,
  RESCUE_Z, RESCUE_STOP, TRACK_Z, TRACK_HALF, TRACK_GAP, DIRT_LENGTH, RESCUE_SCRIPT, DIRT_SCRIPT, CAPTION_WRAP,
  roadCentre, desertY, offRoad, ROAD_HALF, VERGE, FLAT_HALF, ROAD_PERIOD, GROUND_TILE,
  town,
};

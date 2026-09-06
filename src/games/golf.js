'use strict';
// One hole of golf, par 4, rendered by the software rasteriser in gfx/scene3d.js.
//
// The shape of it is the same as pong's: a state machine with its own menu,
// pause menu, high score table and game over screen. What is different is that
// scene() renders 3D into a target it owns and hands the result to the 2D
// pipeline as an underlay, so the swing meter, the score and the menus are
// ordinary 2D layers drawn over the top -- and the framebuffer, the preview and
// the invariant checks all carry on seeing an ordinary scene.
//
// The course is built from the primitives in gfx/mesh.js and *one* height
// function. The mesh the player looks at and the ground the ball rolls on are
// the same surface sampled twice; there is no second copy of the terrain to
// disagree with the first.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const scene3d = require('../gfx/scene3d');
const mesh = require('../gfx/mesh');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz'));

const GAME = 'golf';
const PAR = 4;
const MAX_STROKES = 12; // a hole has to end even if the player can't finish it

// --- the hole ---------------------------------------------------------------
// One place where the course is described, used by the meshes and the physics.

const COURSE = {
  length: 380,
  halfWidth: 90,
  tee: { x: 0, z: 6 },
  hole: { x: 12, z: 330 },
  greenRadius: 26,
  cupRadius: 1.5,
  bunker: { x: -16, z: 276, r: 15 },
  water: { x: 26, z: 214, r: 17 },
  fairwayHalf: 26,
};

const BALL_R = 0.55;
// Drawn bigger than life so it can be seen at 200 yards, the way a sports
// broadcast does. Physics uses BALL_R; only the model is exaggerated, so the
// drawn sphere has to be lifted by the difference or it sits half in the ground.
const BALL_DRAW = BALL_R * 1.9;
const GRAVITY = 34;
const AIR_DRAG = 0.22;
const BOUNCE = 0.34;
// Deceleration while rolling, in units per second squared. These have to beat
// the steepest slope on the course or a ball will roll for ever: the height
// function's gradient tops out around 0.13, so gravity can push a rolling ball
// at about 4.4, and the first version's fairway figure of 1.5 lost that
// argument -- a drive rolled 200 yards and off the end of the hole.
const ROLL_FRICTION = { fairway: 11, rough: 20, green: 4.5, sand: 30 };
const ROLL_TIMEOUT = 14; // seconds; a backstop, not a mechanic
const REST_SPEED = 0.9;
const CAPTURE_SPEED = 16; // faster than this and the ball rides straight over

// The ground.
//
// Two meshes describe the same surface at different resolutions -- a coarse
// rough grid and finer discs for the green and the bunker on top of it -- and
// the first two attempts at this both failed the same way: a fine mesh built
// from the analytic height sank underneath the coarse one, because a coarse
// grid interpolates straight across anything it doesn't have a vertex on.
//
// So nothing is defined against the analytic surface. `roughAt` is the height
// the coarse mesh actually produces, and everything else -- the fairway, the
// green, the bunker, the physics -- is defined relative to that. The ball then
// rolls on exactly the ground that is drawn, which is the point.

const ROUGH = { cols: 44, rows: 52, width: COURSE.halfWidth * 2, depth: COURSE.length + 60, z0: -30 };

// Smooth rolling, gentle on purpose: a green that rolls a foot either way is
// interesting, one that rolls ten is a pinball table.
function contour(x, z) {
  return Math.sin(x * 0.021) * 2.6 + Math.cos(z * 0.017) * 3.2 + Math.sin((x + z) * 0.009) * 2.0;
}

// contour(), sampled and interpolated the way the rough mesh's triangles do.
function roughAt(x, z) {
  const gx = ((x + ROUGH.width / 2) / ROUGH.width) * ROUGH.cols;
  const gz = ((z - ROUGH.z0) / ROUGH.depth) * ROUGH.rows;
  const cx = Math.max(0, Math.min(ROUGH.cols - 1, Math.floor(gx)));
  const cz = Math.max(0, Math.min(ROUGH.rows - 1, Math.floor(gz)));
  const tx = Math.max(0, Math.min(1, gx - cx));
  const tz = Math.max(0, Math.min(1, gz - cz));
  const px = (i) => -ROUGH.width / 2 + (i / ROUGH.cols) * ROUGH.width;
  const pz = (j) => ROUGH.z0 + (j / ROUGH.rows) * ROUGH.depth;
  const h00 = contour(px(cx), pz(cz)), h10 = contour(px(cx + 1), pz(cz));
  const h01 = contour(px(cx), pz(cz + 1)), h11 = contour(px(cx + 1), pz(cz + 1));
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

// The green is a level shelf: dead flat where you putt, banking down to meet the
// rough at its own rim so it doesn't end in a step.
//
// Flat means flat in world terms, not "follows the ground" -- the rough under
// the green rolls through about two units, so the shelf is however tall it needs
// to be at each point to reach one fixed height. That height has to clear the
// highest rough anywhere under the disc, or the green would sink into the coarse
// mesh drawn beneath it, so it is measured rather than guessed.
const GREEN_FLAT = COURSE.greenRadius * 0.72; // the putting surface; the rest is bank
const GREEN_CLEARANCE = 0.6;

const GREEN_LEVEL = (() => {
  let highest = -Infinity;
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    for (let r = 0; r <= COURSE.greenRadius; r += 0.5) {
      const h = roughAt(COURSE.hole.x + Math.cos(a) * r, COURSE.hole.z + Math.sin(a) * r);
      if (h > highest) highest = h;
    }
  }
  return highest + GREEN_CLEARANCE;
})();

const smoothstep = (t) => t * t * (3 - 2 * t);

function shelf(x, z) {
  const g = Math.hypot(x - COURSE.hole.x, z - COURSE.hole.z);
  if (g >= COURSE.greenRadius) return 0;
  const lift = GREEN_LEVEL - roughAt(x, z); // whatever it takes to be level here
  if (g <= GREEN_FLAT) return lift;
  // The bank. Smooth rather than a crease, so a ball running off the edge is
  // not launched by a sudden change of slope.
  return lift * smoothstep((COURSE.greenRadius - g) / (COURSE.greenRadius - GREEN_FLAT));
}

// Hollows stay shallower than the lift the sand and water are drawn at, so they
// can never sink below the rough. A fairway bunker is a scrape anyway; what
// makes it cost you a stroke is the sand, not the depth.
const BUNKER_DIP = 0.2;
const WATER_DIP = 0.3;
const DECAL_LIFT = 0.4;

function hollow(x, z) {
  let d = 0;
  const b = Math.hypot(x - COURSE.bunker.x, z - COURSE.bunker.z);
  if (b < COURSE.bunker.r) d += BUNKER_DIP * (1 - b / COURSE.bunker.r);
  const w = Math.hypot(x - COURSE.water.x, z - COURSE.water.z);
  if (w < COURSE.water.r) d += WATER_DIP * (1 - w / COURSE.water.r);
  return d;
}

// The surface everything agrees on.
const height = (x, z) => roughAt(x, z) + shelf(x, z) - hollow(x, z);

// The pond's surface: a flat plane a little above the ground around it.
const WATER_Y = () => roughAt(COURSE.water.x, COURSE.water.z) + 0.25;

const distanceTo = (x, z, spot) => Math.hypot(x - spot.x, z - spot.z);
const onGreen = (x, z) => distanceTo(x, z, COURSE.hole) < COURSE.greenRadius;
const inBunker = (x, z) => distanceTo(x, z, COURSE.bunker) < COURSE.bunker.r * 0.92;
const inWater = (x, z) => distanceTo(x, z, COURSE.water) < COURSE.water.r * 0.92;
const onFairway = (x, z) => Math.abs(x - fairwayCentre(z)) < COURSE.fairwayHalf && z > 0 && z < COURSE.length;
const outOfBounds = (x, z) => Math.abs(x) > COURSE.halfWidth || z < -30 || z > COURSE.length + 30;

// A gentle dogleg, so the hole isn't a corridor.
const fairwayCentre = (z) => Math.sin(z * 0.0085) * 16;

function surfaceAt(x, z) {
  if (inWater(x, z)) return 'water';
  if (inBunker(x, z)) return 'sand';
  if (onGreen(x, z)) return 'green';
  if (onFairway(x, z)) return 'fairway';
  return 'rough';
}

// Downhill direction, sampled off the same height function the mesh used.
function slope(x, z) {
  const d = 1.2;
  return {
    x: -(height(x + d, z) - height(x - d, z)) / (2 * d),
    z: -(height(x, z + d) - height(x, z - d)) / (2 * d),
  };
}

// --- clubs ------------------------------------------------------------------

const CLUBS = [
  { id: 'driver', name: 'DRIVER', speed: 104, loft: 0.30, sway: 0.115 },
  { id: 'iron', name: '5 IRON', speed: 84, loft: 0.44, sway: 0.085 },
  { id: 'wedge', name: 'WEDGE', speed: 58, loft: 0.80, sway: 0.065 },
  { id: 'putter', name: 'PUTTER', speed: 26, loft: 0.0, sway: 0.030 },
];

const MENU = [
  { id: 'play', label: 'PLAY THE HOLE' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'RESTART HOLE' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

// Swing meter. Up for power, back down for accuracy -- the three-click swing,
// which is the only control scheme that has ever worked with two buttons.
const METER_RATE = 1.45;    // sweeps per second going up
const METER_RETURN = 1.9;   // and coming back

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

// --- the course, built once -------------------------------------------------

function buildCourse() {
  const rough = mesh.grid(ROUGH.width, ROUGH.depth, ROUGH.cols, ROUGH.rows,
    (x, z) => contour(x, z + ROUGH.z0));

  // The fairway is a separate strip laid a hair above the rough, following the
  // dogleg. A decal, in effect -- cutting it out of the rough would mean
  // arbitrary polygons, and the primitives don't do those.
  const fairwayCols = 10, fairwayRows = 46;
  const fb = mesh.builder();
  const index = [];
  for (let r = 0; r <= fairwayRows; r++) {
    const z = (r / fairwayRows) * COURSE.length;
    for (let c = 0; c <= fairwayCols; c++) {
      const t = c / fairwayCols - 0.5;
      const x = fairwayCentre(z) + t * COURSE.fairwayHalf * 2;
      index.push(fb.vertex(x, height(x, z) + 0.15, z));
    }
  }
  const at = (c, r) => index[r * (fairwayCols + 1) + c];
  for (let r = 0; r < fairwayRows; r++) {
    for (let c = 0; c < fairwayCols; c++) fb.quad(at(c, r), at(c, r + 1), at(c + 1, r + 1), at(c + 1, r));
  }
  const fairway = fb.done();

  // Mowing stripes: two triangles per quad, quads in row-major order, so the
  // band alternates every couple of rows down the hole.
  const stripes = new Int8Array(fairway.count);
  for (let r = 0; r < fairwayRows; r++) {
    const band = Math.floor(r / 2) % 2 ? 0 : -1;
    for (let c = 0; c < fairwayCols; c++) {
      const q = (r * fairwayCols + c) * 2;
      stripes[q] = band;
      stripes[q + 1] = band;
    }
  }

  // The green is a disc that follows the same height function as everything
  // else, so a putt rolls over the surface that is drawn.
  const greenGrid = (radius, spot, lift, rings = 9, segments = 20) => {
    const b = mesh.builder();
    const centre = b.vertex(0, height(spot.x, spot.z) + lift, 0);
    let previous = null;
    for (let r = 1; r <= rings; r++) {
      const rad = (r / rings) * radius;
      const ring = [];
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        ring.push(b.vertex(x, height(spot.x + x, spot.z + z) + lift, z));
      }
      if (previous === null) {
        for (let s = 0; s < segments; s++) b.triangle(centre, ring[(s + 1) % segments], ring[s]);
      } else {
        for (let s = 0; s < segments; s++) {
          const t = (s + 1) % segments;
          b.quad(previous[s], previous[t], ring[t], ring[s]);
        }
      }
      previous = ring;
    }
    return b.done();
  };

  return {
    rough,
    fairway,
    stripes,
    green: greenGrid(COURSE.greenRadius, COURSE.hole, DECAL_LIFT),
    sand: greenGrid(COURSE.bunker.r, COURSE.bunker, DECAL_LIFT),
    water: mesh.disc(COURSE.water.r, 18, 0),
    cup: mesh.cylinder(COURSE.cupRadius, 0.6, 10),
    pole: mesh.cylinder(0.16, 14, 5),
    flag: mesh.blade([[0, 14, 0], [0, 10.4, 0], [5.4, 12.6, 0]]),
    ball: mesh.sphere(BALL_DRAW, 7, 10),
    trunk: mesh.cylinder(1.1, 7, 6),
    canopy: mesh.cone(5.2, 12, 8),
    marker: mesh.box(1.1, 0.55, 1.1),
  };
}

// Scenery, placed once from a seeded generator so the hole is the same hole
// every time it is played.
function plantTrees(random) {
  const trees = [];
  for (let i = 0; i < 26; i++) {
    const z = 20 + random() * (COURSE.length - 10);
    const side = random() < 0.5 ? -1 : 1;
    const x = fairwayCentre(z) + side * (COURSE.fairwayHalf + 8 + random() * 44);
    if (Math.abs(x) > COURSE.halfWidth - 6) continue;
    if (distanceTo(x, z, COURSE.hole) < COURSE.greenRadius + 10) continue;
    if (distanceTo(x, z, COURSE.water) < COURSE.water.r + 6) continue;
    trees.push({ x, z, scale: 0.75 + random() * 0.5 });
  }
  return trees;
}

function create(width = 720, height3 = 480, options = {}) {
  const court = picture(width, height3);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const table = options.scores ?? scores;
  const random = rng(options.seed ?? 0x474f4c46);

  const course = buildCourse();
  const trees = plantTrees(random);
  const target = scene3d.target(width, height3);

  const sounds = [];
  const say = (name) => sounds.push(name);

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    cursor: 0,
    board: table.table(GAME, { lower: true }),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,

    strokes: 0,
    holed: false,
    penalty: 0,
    club: 0,
    aim: 0,
    swing: 'aim',      // aim -> power -> accuracy -> flying -> rest
    meter: 0,
    power: 0,
    accuracy: 0,
    settle: 0,         // how long the ball has been still
    rolledFor: 0,

    ball: { x: COURSE.tee.x, y: 0, z: COURSE.tee.z, vx: 0, vy: 0, vz: 0, rolling: false, resting: true },
    lastSafe: { x: COURSE.tee.x, z: COURSE.tee.z },
    camera: { yaw: 0, distance: 26, height: 11 },
    message: '',
    messageFor: 0,
  };
  game.ball.y = height(game.ball.x, game.ball.z) + BALL_R;

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };
  const club = () => CLUBS[game.club];

  const announce = (text, seconds = 2.2) => { game.message = text; game.messageFor = seconds; };

  function resetHole() {
    game.strokes = 0;
    game.holed = false;
    game.penalty = 0;
    game.club = 0;
    game.swing = 'aim';
    game.meter = 0;
    game.message = '';
    game.messageFor = 0;
    game.ball = {
      x: COURSE.tee.x, y: height(COURSE.tee.x, COURSE.tee.z) + BALL_R, z: COURSE.tee.z,
      vx: 0, vy: 0, vz: 0, rolling: false, resting: true,
    };
    game.lastSafe = { x: COURSE.tee.x, z: COURSE.tee.z };
    aimAtHole();
  }

  // Point the shot at the pin to start with, so the first thing a player does
  // is adjust rather than search.
  function aimAtHole() {
    const dx = COURSE.hole.x - game.ball.x;
    const dz = COURSE.hole.z - game.ball.z;
    game.aim = Math.atan2(dx, dz);
    game.camera.yaw = game.aim;
  }

  function strike() {
    const c = club();
    const power = clamp(game.power, 0.05, 1);
    const speed = c.speed * (0.28 + 0.72 * power);
    // Accuracy is how far from the centre the second press landed: it bends the
    // shot left or right, and the bigger the club the more it costs you.
    const bend = game.accuracy * c.sway;
    const angle = game.aim + bend;

    const flat = Math.cos(c.loft) * speed;
    game.ball.vx = Math.sin(angle) * flat;
    game.ball.vz = Math.cos(angle) * flat;
    game.ball.vy = Math.sin(c.loft) * speed;
    game.ball.resting = false;
    game.ball.rolling = false;
    game.settle = 0;
    game.strokes++;
    game.rolledFor = 0;
    game.swing = 'flying';

    say(c.id === 'putter' ? 'putt' : c.id === 'wedge' ? 'chip' : 'drive');
    if (Math.abs(game.accuracy) < 0.06) announce('PURE', 1.4);
  }

  function penalise(reason) {
    game.penalty++;
    game.strokes++;
    game.ball.x = game.lastSafe.x;
    game.ball.z = game.lastSafe.z;
    game.ball.y = height(game.ball.x, game.ball.z) + BALL_R;
    game.ball.vx = game.ball.vy = game.ball.vz = 0;
    game.ball.resting = true;
    game.ball.rolling = false;
    announce(reason);
    settleShot();
  }

  function settleShot() {
    game.swing = 'aim';
    game.meter = 0;
    aimAtHole();
    // A ball on the green wants the putter; anywhere else, whatever suits.
    const surface = surfaceAt(game.ball.x, game.ball.z);
    if (surface === 'green') game.club = CLUBS.findIndex((c) => c.id === 'putter');
    else if (surface === 'sand') game.club = CLUBS.findIndex((c) => c.id === 'wedge');
    else {
      const left = distanceTo(game.ball.x, game.ball.z, COURSE.hole);
      game.club = left > 190 ? 0 : left > 90 ? 1 : 2;
    }
    if (game.strokes >= MAX_STROKES && !game.holed) finish();
  }

  function finish() {
    // The ball is down or the hole has been given up on, so the swing state
    // machine has to come back to rest too -- holing out reaches here straight
    // from mid-flight, without going through settleShot().
    game.swing = 'aim';
    game.meter = 0;
    game.placing = table.placing(GAME, game.strokes, { lower: true });
    game.initials = [0, 0, 0];
    game.slot = 0;
    go('over');
  }

  // --- physics --------------------------------------------------------------

  function stepBall(dt) {
    const b = game.ball;
    if (b.resting) return;

    // Gravity always. `rolling` is whether the ball is *touching* this step,
    // worked out below -- not a mode that switches physics off. Treating it as
    // a mode meant a ball rolling over the crest of a hill left the surface,
    // and with neither gravity to bring it back nor contact to slow it down it
    // drifted for ever: a drive rolled the length of the hole and out.
    b.vy -= GRAVITY * dt;
    if (!b.rolling) {
      const drag = 1 - AIR_DRAG * dt;
      b.vx *= drag; b.vz *= drag; b.vy *= drag;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    if (outOfBounds(b.x, b.z)) { say('splash'); penalise('OUT OF BOUNDS  +1'); return; }

    const ground = height(b.x, b.z) + BALL_R;

    if (inWater(b.x, b.z) && b.y < WATER_Y() + 1.2) {
      say('splash');
      penalise('IN THE WATER  +1');
      return;
    }

    if (b.y > ground) { b.rolling = false; return; } // in the air

    // Touching.
    b.y = ground;
    const surface = surfaceAt(b.x, b.z);

    if (!b.rolling && b.vy < -3) {
      const restitution = surface === 'sand' ? 0.08 : surface === 'rough' ? 0.2 : BOUNCE;
      b.vy = -b.vy * restitution;
      const grip = surface === 'sand' ? 0.35 : surface === 'rough' ? 0.62 : 0.82;
      b.vx *= grip; b.vz *= grip;
      if (b.vy < 3) { b.rolling = true; b.vy = 0; }
      say('bounce');
    } else {
      b.rolling = true;
      b.vy = 0;
    }

    if (b.rolling) {
      // Gravity along the surface, which is what a slope actually does to a
      // ball -- so how much it borrows follows from the same height function
      // that drew the ground, rather than from a number picked to feel right.
      const s = slope(b.x, b.z);
      b.vx += s.x * GRAVITY * dt;
      b.vz += s.z * GRAVITY * dt;

      const speed = Math.hypot(b.vx, b.vz);
      const friction = ROLL_FRICTION[surface] ?? ROLL_FRICTION.rough;
      const slowed = Math.max(0, speed - friction * dt * (1 + speed * 0.015));
      if (speed > 0) { b.vx = (b.vx / speed) * slowed; b.vz = (b.vz / speed) * slowed; }

      // In the cup: near enough, and slow enough not to lip out.
      if (distanceTo(b.x, b.z, COURSE.hole) < COURSE.cupRadius && slowed < CAPTURE_SPEED) {
        game.holed = true;
        b.resting = true;
        b.vx = b.vz = 0;
        say('holed');
        announce(scoreName(game.strokes), 3);
        finish();
        return;
      }

      // Backstop: a ball that has been rolling this long has found somewhere
      // the friction and the slope agree, and waiting longer won't settle it.
      game.rolledFor += dt;
      if (slowed < REST_SPEED || game.rolledFor > ROLL_TIMEOUT) {
        game.settle += dt;
        if (game.settle > 0.25) {
          b.vx = b.vz = 0;
          b.resting = true;
          if (surfaceAt(b.x, b.z) !== 'water') game.lastSafe = { x: b.x, z: b.z };
          settleShot();
        }
      } else {
        game.settle = 0;
      }
    }
  }

  const scoreName = (strokes) => {
    const d = strokes - PAR;
    if (strokes === 1) return 'HOLE IN ONE';
    if (d <= -3) return 'ALBATROSS';
    if (d === -2) return 'EAGLE';
    if (d === -1) return 'BIRDIE';
    if (d === 0) return 'PAR';
    if (d === 1) return 'BOGEY';
    if (d === 2) return 'DOUBLE BOGEY';
    return `${d} OVER`;
  };

  // --- the step -------------------------------------------------------------

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
    game.board = table.record(GAME, game.initials.map((i) => scores.ALPHABET[i]).join(''), game.strokes, { lower: true });
    game.placing = 0;
    say('select');
    go('scores');
  }

  function playing(dt, frame) {
    if (game.messageFor > 0) game.messageFor -= dt;

    switch (game.swing) {
      case 'aim': {
        const fine = frame.b ? 0.35 : 1;
        if (frame.left) game.aim -= 0.9 * dt * fine;
        if (frame.right) game.aim += 0.9 * dt * fine;
        if (frame.pressed.up) { game.club = (game.club + CLUBS.length - 1) % CLUBS.length; say('move'); }
        if (frame.pressed.down) { game.club = (game.club + 1) % CLUBS.length; say('move'); }
        game.camera.yaw = game.aim;
        if (confirmed(frame)) { game.swing = 'power'; game.meter = 0; say('move'); }
        break;
      }
      case 'power': {
        game.meter += METER_RATE * dt;
        if (game.meter >= 1) { game.meter = 1; game.power = 1; game.swing = 'accuracy'; say('move'); break; }
        if (confirmed(frame)) { game.power = game.meter; game.swing = 'accuracy'; say('move'); }
        break;
      }
      case 'accuracy': {
        game.meter -= METER_RETURN * dt;
        if (game.meter <= -0.35) { game.meter = -0.35; game.accuracy = -1; strike(); break; }
        // Zero is the sweet spot; the meter passing it is the window.
        if (confirmed(frame)) { game.accuracy = clamp(game.meter / 0.35, -1, 1); strike(); }
        break;
      }
      case 'flying': {
        // Several small steps: a ball doing 100 units a second would otherwise
        // step straight through the ground between frames.
        const steps = 4;
        for (let i = 0; i < steps && !game.ball.resting; i++) stepBall(dt / steps);
        break;
      }
      default:
        throw new Error(`unknown swing phase: ${game.swing}`);
    }
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
        if (choice === 'scores') { game.board = table.table(GAME, { lower: true }); go('scores'); }
        else { resetHole(); go('play'); }
        break;
      }

      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); game.cursor = 0; go('menu'); }
        break;

      case 'play':
        if (any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        playing(dt, any);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('play');
        else if (choice === 'restart') { resetHole(); go('play'); }
        else { game.cursor = 0; go('menu'); }
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

  // The camera sits behind the ball on the aim line while a shot is being set
  // up, and swings round to trail the ball once it is moving.
  function cameraFor() {
    const b = game.ball;
    const flying = !b.resting && (Math.abs(b.vx) + Math.abs(b.vz)) > 1;
    const yaw = flying ? Math.atan2(b.vx, b.vz) : game.camera.yaw;
    const back = game.camera.distance + (flying ? 10 : 0);
    const x = b.x - Math.sin(yaw) * back;
    const z = b.z - Math.cos(yaw) * back;
    const ground = height(x, z);
    const y = Math.max(ground + 4, b.y + game.camera.height);
    // Look at the ball, a touch above it.
    const dy = (b.y + 2.5) - y;
    const flat = Math.hypot(b.x - x, b.z - z) || 1;
    return { x, y, z, yaw, pitch: Math.atan2(dy, flat), fov: 1.05, near: 0.6 };
  }

  function world() {
    const models = [
      { mesh: course.rough, position: [0, 0, -30], ramp: 'rough' },
      { mesh: course.fairway, position: [0, 0, 0], ramp: 'turf', bias: course.stripes },
      { mesh: course.green, position: [COURSE.hole.x, 0, COURSE.hole.z], ramp: 'moss' },
      { mesh: course.sand, position: [COURSE.bunker.x, 0, COURSE.bunker.z], ramp: 'sand' },
      { mesh: course.water, position: [COURSE.water.x, WATER_Y(), COURSE.water.z], ramp: 'water' },
      { mesh: course.cup, position: [COURSE.hole.x, height(COURSE.hole.x, COURSE.hole.z) - 0.4, COURSE.hole.z], ramp: 'bark' },
      { mesh: course.pole, position: [COURSE.hole.x, height(COURSE.hole.x, COURSE.hole.z) + 0.2, COURSE.hole.z], ramp: 'cream' },
      { mesh: course.flag, position: [COURSE.hole.x, height(COURSE.hole.x, COURSE.hole.z) + 0.2, COURSE.hole.z], ramp: 'ember', twoSided: true },
      // Either side of the ball, not on top of it.
      { mesh: course.marker, position: [COURSE.tee.x - 4, height(COURSE.tee.x - 4, COURSE.tee.z) + 0.2, COURSE.tee.z], ramp: 'cream' },
      { mesh: course.marker, position: [COURSE.tee.x + 4, height(COURSE.tee.x + 4, COURSE.tee.z) + 0.2, COURSE.tee.z], ramp: 'cream' },
    ];

    for (const tree of trees) {
      const base = height(tree.x, tree.z);
      models.push({ mesh: course.trunk, position: [tree.x, base, tree.z], scale: tree.scale, ramp: 'bark' });
      models.push({ mesh: course.canopy, position: [tree.x, base + 6 * tree.scale, tree.z], scale: tree.scale, ramp: 'leaf' });
    }

    if (!game.holed) {
      models.push({
        mesh: course.ball,
        position: [game.ball.x, game.ball.y + (BALL_DRAW - BALL_R), game.ball.z],
        ramp: 'cream',
        // Low, so the ball uses the whole ramp and reads as round. At the
        // scene's ambient it could only reach cream's top two steps, which are
        // the same colour to look at.
        ambient: 0.2,
      });
    }

    return {
      background: PALETTE.sky,
      camera: cameraFor(),
      light: { x: -0.45, y: 0.8, z: -0.4 },
      ambient: 0.42,
      models,
    };
  }

  // --- screens --------------------------------------------------------------

  function menuList(items, cursor, top) {
    return items.map((item, i) => centred(`${i === cursor ? '▶ ' : '  '}${item.label}`, top + i * 44, {
      scale: 2, fill: i === cursor ? PALETTE.sun : PALETTE.cream,
    }));
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(mid.x - 170, court.y + 132, 340, 5, PALETTE.bark)] }],
      text: [
        centred('GOLF', court.y + 76, { scale: 3, font: HEAVY, fill: PALETTE.moss }),
        ...menuList(MENU, game.cursor, court.y + 210),
        centred(`ONE HOLE  ·  PAR ${PAR}`, court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  function scoresScreen() {
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 180, court.y + 130 + i * 34, { anchor: 'start', fill: PALETTE.bark }),
      text(row.name, mid.x - 60, court.y + 130 + i * 34, { anchor: 'start', fill: PALETTE.cream }),
      text(row.score === null ? '  --' : String(row.score).padStart(4, ' '), mid.x + 170, court.y + 130 + i * 34,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();

    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 116, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('BEST ROUNDS', court.y + 68, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        centred('FEWEST STROKES WINS   ·   B TO GO BACK', court.y + court.h - 26, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  // The heads-up display over the 3D: strokes, club, distance, and the meter.
  function hud() {
    const shapes = [];
    const labels = [
      text(`STROKE ${game.strokes + (game.swing === 'flying' ? 0 : 1)}`, court.x + 16, court.y + 12, { anchor: 'start' }),
      text(`PAR ${PAR}`, court.x + 16, court.y + 44, { anchor: 'start', fill: PALETTE.bark }),
    ];

    const left = Math.round(distanceTo(game.ball.x, game.ball.z, COURSE.hole));
    labels.push(text(`${left} YDS`, court.x + court.w - 16, court.y + 12, { anchor: 'end', fill: PALETTE.sun }));
    labels.push(text(surfaceAt(game.ball.x, game.ball.z).toUpperCase(), court.x + court.w - 16, court.y + 44,
      { anchor: 'end', fill: PALETTE.bark }));

    if (game.swing !== 'flying') {
      labels.push(centred(club().name, court.y + court.h - 96, { scale: 2, fill: PALETTE.cream }));

      // The meter. Left of centre is the backswing, the notch is the sweet spot.
      const w = 340, h = 20;
      const x = mid.x - w / 2;
      const y = court.y + court.h - 62;
      const zero = x + w * 0.26;

      shapes.push(rect(x, y, w, h, PALETTE.ink));
      shapes.push(rect(x, y, w, 3, PALETTE.bark));
      shapes.push(rect(x, y + h - 3, w, 3, PALETTE.bark));
      shapes.push(rect(zero - 2, y - 5, 4, h + 10, PALETTE.cream));

      const fill = clamp(game.meter, 0, 1) * (x + w - zero);
      if (fill > 0) shapes.push(rect(zero, y + 3, fill, h - 6, game.meter > 0.9 ? PALETTE.ember : PALETTE.sun));
      if (game.meter < 0) shapes.push(rect(zero + (game.meter / 0.35) * (zero - x), y + 3, Math.abs(game.meter / 0.35) * (zero - x), h - 6, PALETTE.ember));

      const marker = zero + (game.meter >= 0 ? game.meter * (x + w - zero) : (game.meter / 0.35) * (zero - x));
      shapes.push(rect(marker - 2, y - 7, 5, h + 14, PALETTE.cream));

      // 40 characters is what fits across the picture at this size; the aim
      // and club hints are abbreviated rather than allowed to run off the tube.
      const prompt = game.swing === 'aim' ? 'A SWING  ·  L R AIM  ·  U D CLUB'
        : game.swing === 'power' ? 'A TO SET THE POWER'
          : 'A ON THE MARK';
      labels.push(centred(prompt, court.y + court.h - 22, { scale: 2, fill: PALETTE.bark }));
    }

    if (game.messageFor > 0) {
      labels.push(centred(game.message, court.y + 120, { scale: 2, font: HEAVY, fill: PALETTE.sun }));
    }

    return { shapes, labels };
  }

  function playScreen() {
    const { shapes, labels } = hud();
    return { underlay: true, layers: [{ flat: true, shapes }], text: labels };
  }

  function pausedScreen() {
    const { shapes } = hud();
    return {
      underlay: true,
      layers: [{ flat: true, shapes, alpha: 0.25 }],
      text: [
        centred('PAUSED', court.y + 96, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(PAUSE_MENU, game.cursor, court.y + 210),
      ],
    };
  }

  function overScreen() {
    const body = [
      centred(game.holed ? scoreName(game.strokes) : 'PICKED UP', court.y + 80,
        { scale: 2, font: HEAVY, fill: game.holed && game.strokes <= PAR ? PALETTE.sun : PALETTE.ember }),
      centred(`${game.strokes} STROKES   PAR ${PAR}`, court.y + 152, { scale: 2, font: HEAVY }),
    ];
    if (game.penalty) body.push(centred(`${game.penalty} PENALTY`, court.y + 206, { scale: 2, fill: PALETTE.ember }));

    if (game.placing > 0) {
      const letters = game.initials.map((i) => scores.ALPHABET[i]);
      body.push(centred(`BEST ROUND  RANK ${game.placing}`, court.y + 250, { scale: 2, fill: PALETTE.moss }));
      letters.forEach((letter, i) => {
        body.push(text(letter, mid.x + (i - 1) * 52, court.y + 288,
          { scale: 2, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
      });
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    }

    const carets = game.placing > 0
      ? [rect(mid.x + (game.slot - 1) * 52 - 16, court.y + 360, 32, 6, PALETTE.sun)]
      : [];
    return { layers: [{ flat: true, shapes: carets }], text: body };
  }

  const SCREENS = {
    menu: menuScreen, scores: scoresScreen, play: playScreen,
    paused: pausedScreen, over: overScreen,
  };

  function scene() {
    const built = SCREENS[game.screen]();
    // Only the screens that show the course pay for rendering it.
    const underlay = built.underlay ? scene3d.render(world(), target).canvas : null;

    return {
      title: `Golf (${game.screen})`,
      width,
      height: height3,
      background: PALETTE.ink,
      underlay,
      matte: court,
      matteColour: PALETTE.ink,
      font: FONT,
      layers: built.layers,
      text: built.text,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    music() { return game.screen === 'play' ? null : 'links'; },
    state() {
      return {
        screen: game.screen, exit: game.exit, cursor: game.cursor,
        strokes: game.strokes, holed: game.holed, penalty: game.penalty,
        placing: game.placing, swing: game.swing, meter: game.meter,
        club: CLUBS[game.club].id, aim: game.aim,
        ball: { ...game.ball },
        surface: surfaceAt(game.ball.x, game.ball.z),
        toHole: distanceTo(game.ball.x, game.ball.z, COURSE.hole),
      };
    },
    course: COURSE,
    height,
  };
}

function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  return [
    r(x, y + h * 0.55, w, h * 0.45, PALETTE.turf),
    r(x, y + h * 0.55, w, 3, PALETTE.turfLit),
    r(x + w * 0.62, y + h * 0.12, 4, h * 0.5, PALETTE.cream),
    { type: 'chain', points: [
      { x: Math.round(x + w * 0.62), y: Math.round(y + h * 0.2), r: 6 },
      { x: Math.round(x + w * 0.82), y: Math.round(y + h * 0.26), r: 3 },
    ], fill: PALETTE.ember },
    { type: 'disc', x: Math.round(x + w * 0.26), y: Math.round(y + h * 0.74), r: 6, fill: PALETTE.cream },
  ];
}

module.exports = {
  title: 'GOLF',
  blurb: 'ONE HOLE  PAR 4',
  meta: {
    players: [1],
    rating: 'pg',
    audio: '8-bit',
    graphics: '3d-low',
  },
  accent: 'moss',
  lowerIsBetter: true,
  emblem,
  create, COURSE, CLUBS, PAR, MENU, PAUSE_MENU, height, roughAt, surfaceAt,
  GREEN_LEVEL, GREEN_FLAT,
};

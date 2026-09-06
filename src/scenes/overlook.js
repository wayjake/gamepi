'use strict';
// "Overlook" -- the first scene of Emberfall.
//
// Composed in a virtual 720x480 and mapped uniformly into whatever picture
// rectangle the safe area allows, so the composition survives recalibration on
// a different tube. Everything outside that rectangle is matte: the art ends on
// a deliberate black edge rather than running off into whatever the CRT crops.

const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const raster = require('../gfx/raster');
const { marks } = require('../gfx/scene');
const { sway, hop, pulse, cycle } = require('../gfx/motion');

const DESIGN = { w: 720, h: 480 };
const HORIZON = 288;
const INK = 7;      // outline weight, in design units
const MARK = 3.5;   // ink-only stroke radius; stays >= 2px tall on a 480i field

// Maps design coordinates into the picture rectangle. Uniform scale, centred,
// so circles stay round however the safe area is shaped.
function view(pic) {
  const s = Math.min(pic.w / DESIGN.w, pic.h / DESIGN.h);
  const ox = pic.x + (pic.w - DESIGN.w * s) / 2;
  const oy = pic.y + (pic.h - DESIGN.h * s) / 2;
  return {
    s,
    x: (v) => ox + v * s,
    y: (v) => oy + v * s,
    r: (v) => v * s,
    point: (p) => ({ x: ox + p.x * s, y: oy + p.y * s, r: p.r * s }),
  };
}

// Seeded, so the ground texture is identical between renders and a PNG diff
// means something.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Haring's ground: dashes and dots, shortening and thinning toward the horizon
// so the field recedes without any perspective maths.
function groundTexture() {
  const random = rng(0x5eed1);
  const out = [];
  for (let y = HORIZON + 18; y < DESIGN.h - 6; y += 22) {
    const depth = (y - HORIZON) / (DESIGN.h - HORIZON); // 0 at horizon, 1 near
    const step = 46 + (1 - depth) * 34;
    for (let x = 6 + random() * step; x < DESIGN.w - 6; x += step * (0.7 + random() * 0.7)) {
      const dash = random() < 0.62;
      const len = dash ? (10 + random() * 26) * (0.45 + depth * 0.75) : 0;
      const r = MARK * (0.55 + depth * 0.6);
      out.push([
        { x, y: y + (random() - 0.5) * 9, r },
        { x: x + len, y: y + (random() - 0.5) * 9, r },
      ]);
    }
  }
  return out;
}

// A blob figure: a body chain plus limbs, all one fill, so the ink pass welds
// them into a single silhouette wherever they overlap and leaves a black
// channel wherever they merely come close.
//
// Motion is applied to the control points, never to pixels. `swing` and `lift`
// are scaled by each point's distance along its limb, so a limb bends from the
// shoulder rather than sliding sideways as a rigid stick.
function figure({
  x, y, scale = 1, fill, flip = 1,
  bob = 0, breath = 1, squash = 1, swing = 0, lift = 0, step = 0,
}) {
  const p = (dx, dy, r, k = 0, kick = 1) => ({
    x: x + (dx + swing * k * kick) * scale * flip,
    y: y + (dy + lift * k * kick) * scale * squash + bob,
    r: r * scale * (1 + (breath - 1) * (1 - Math.abs(k))),
  });

  // Each control point carries how far along its limb it sits (0 at the joint,
  // 1 at the tip), which is what makes the motion taper.
  return [
    { type: 'chain', fill, points: [p(-4, -150, 44), p(-8, -124, 49), p(6, -80, 49), p(2, -28, 38), p(-4, 24, 32), p(-6, 44, 29)] },
    { type: 'chain', fill, points: [p(-42, -84, 22, 0), p(-106, -114, 19, 0.3), p(-146, -178, 15, 0.75), p(-160, -210, 17, 1)] },
    { type: 'chain', fill, points: [p(46, -84, 22, 0), p(118, -64, 19, 0.3), p(174, -104, 14, 0.75), p(196, -148, 16, 1)] },
    { type: 'chain', fill, points: [p(-26, 34, 26, 0), p(-40, 104, 20, 0.4, -step), p(-36, 150, 16, 1, -step)] },
    { type: 'chain', fill, points: [p(26, 34, 26, 0), p(38, 104, 20, 0.4, step), p(32, 150, 16, 1, step)] },
  ];
}

const eyes = ({ x, y, scale = 1, flip = 1, spread = 21, r = 10 }) => [
  { type: 'disc', x: x - spread * scale * flip, y, r: r * scale },
  { type: 'disc', x: x + spread * scale * flip, y, r: r * scale },
];

// A banana tree: a pseudostem and a fan of paddle leaves, each leaf a chain
// that swells in the middle and tapers to the tip. Everything is a function of
// four parameters so one prop covers the whole life cycle -- `trunk` and
// `leaves` are 0..1 growth (a sprout is trunk 0 with small leaves), `angle` is
// the lean from vertical in radians (positive falls to the left), and `alpha`
// hands the fade to the renderer's dither.
const TRUNK_HEIGHT = 135;
const LEAVES = [ // dx: reach, rise: how high the arc lifts, droop: how far the tip hangs
  { dx: -76, rise: 34, droop: 58, phase: 0.00, back: true },
  { dx: -44, rise: 66, droop: 10, phase: 0.31 },
  { dx: 6, rise: 82, droop: -8, phase: 0.62, back: true },
  { dx: 50, rise: 62, droop: 14, phase: 0.17 },
  { dx: 74, rise: 30, droop: 60, phase: 0.48, back: true },
];

function bananaTree({ x, y, t, trunk = 1, leaves = 1, angle = 0, alpha = 1 }) {
  if (alpha <= 0 || (trunk <= 0 && leaves <= 0)) return [];

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Local space has the base at the origin and up as -y; rotate about the base
  // for the fall, then place.
  const p = (lx, ly, r) => ({ x: x + lx * cos + ly * sin, y: y - lx * sin + ly * cos, r });

  const height = TRUNK_HEIGHT * trunk;
  const girth = 15 * (0.45 + 0.55 * trunk);
  const stem = trunk > 0.02 ? {
    type: 'chain', fill: PALETTE.bark,
    points: [p(0, 0, girth), p(3, -height * 0.4, girth * 0.9), p(-2, -height * 0.8, girth * 0.78), p(0, -height, girth * 0.7)],
  } : null;

  // Leaves flutter at the tip while standing; a fallen tree lies still.
  const life = Math.max(0, cos);
  const back = [];
  const front = [];
  const ribs = [];
  for (const leaf of LEAVES) {
    const flutter = sway(t, 1.9, 5, leaf.phase) * life;
    const dx = leaf.dx * leaves;
    const rise = leaf.rise * leaves;
    const droop = (leaf.droop + flutter) * leaves;
    const at = (s, r) => p(dx * s, -height - rise * 4 * s * (1 - s) + droop * s * s, r);
    const blade = (s) => (3 + 15 * Math.sin(Math.PI * s) ** 0.8) * Math.max(leaves, 0.3);
    (leaf.back ? back : front).push({
      type: 'chain', fill: PALETTE.moss,
      points: [at(0, blade(0)), at(0.28, blade(0.28)), at(0.55, blade(0.55)), at(0.8, blade(0.8)), at(1, blade(1))],
    });
    ribs.push([at(0.3, MARK), at(0.55, MARK), at(0.78, MARK)]);
  }

  // Midribs are ink over green; on a sprout they would swallow the leaf, so
  // they dither in as the leaves reach size.
  const ribAlpha = Math.min(alpha, Math.max(0, (leaves - 0.55) / 0.2));
  // Back and front leaves are separate layers so the front ones keep an ink
  // edge where they cross the ones behind, instead of welding into one mass.
  return [
    { shapes: [stem], alpha },
    { shapes: back, alpha },
    { shapes: front, alpha },
    { inkOnly: true, shapes: marks(ribs), alpha: ribAlpha },
  ];
}

// The tree's life, on a loop. It stands, falls, fades, and a sprout grows back
// in its place. `t = 0` is a full-grown tree at the start of its standing
// spell, so the first fall lands about fifteen seconds in.
const LIFE = { stand: 15, fall: 1.4, rest: 0.8, fade: 2.0, bare: 0.5, sprout: 1.3, grow: 4.0 };
const LIFE_PERIOD = Object.values(LIFE).reduce((a, b) => a + b, 0);
const FALLEN = (80 / 180) * Math.PI;

const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) ** 3;
const overshoot = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;

function treeLife(t) {
  let u = cycle(t, LIFE_PERIOD) * LIFE_PERIOD;
  const state = { trunk: 1, leaves: 1, angle: 0, alpha: 1 };
  const phase = (name) => {
    if (u >= LIFE[name]) { u -= LIFE[name]; return null; }
    return u / LIFE[name];
  };
  let k;
  if ((k = phase('stand')) !== null) return state;
  if ((k = phase('fall')) !== null) {
    // Gravity, then one bounce off the ground.
    state.angle = FALLEN * (k < 0.72 ? (k / 0.72) ** 2.5 : 1 - 0.09 * Math.sin(Math.PI * (k - 0.72) / 0.28));
    return state;
  }
  state.angle = FALLEN;
  if ((k = phase('rest')) !== null) return state;
  if ((k = phase('fade')) !== null) { state.alpha = 1 - smooth(k); return state; }
  state.angle = 0;
  if ((k = phase('bare')) !== null) { state.alpha = 0; return state; }
  if ((k = phase('sprout')) !== null) {
    // Dithers in over the first quarter second rather than popping whole.
    state.trunk = 0;
    state.leaves = 0.3 * overshoot(k);
    state.alpha = Math.min(1, k / 0.25);
    return state;
  }
  k = phase('grow') ?? 1;
  state.trunk = easeOut(k);
  state.leaves = 0.3 + 0.7 * easeOut(k);
  return state;
}

// Maps a design-space shape into view coordinates.
const place = (v) => (shape) => {
  switch (shape.type) {
    case 'chain': return { ...shape, points: shape.points.map(v.point) };
    case 'disc': return { ...shape, x: v.x(shape.x), y: v.y(shape.y), r: v.r(shape.r) };
    case 'rect': return { ...shape, x: v.x(shape.x), y: v.y(shape.y), w: v.r(shape.w), h: v.r(shape.h) };
    default: throw new Error(`cannot place ${shape.type}`);
  }
};

module.exports = function overlook(width = 720, height = 480, t = 0) {
  const pic = picture(width, height);
  const v = view(pic);
  const to = place(v);

  // The hero sways and waves; the companion hops beside it, squashing as it
  // lands. Both are pure functions of t, so frame n always looks the same.
  const heroBob = sway(t, 2.6, 5);
  const hero = {
    x: 318, y: 292, scale: 1, fill: PALETTE.sky,
    bob: heroBob,
    breath: pulse(t, 2.6, 0.035),
    swing: sway(t, 1.9, 15),
    lift: sway(t, 1.9, -11, 0.25),
    step: sway(t, 2.6, 0.35),
  };

  const bounce = hop(t, 0.62, 30);
  const companion = {
    x: 572, y: 374, scale: 0.46, fill: PALETTE.ember, flip: -1,
    bob: -bounce,
    // Squat on the ground, stretch at the top of the arc.
    squash: 1 + (bounce / 30) * 0.16 - 0.08,
    swing: sway(t, 0.62, 20, 0.25),
    lift: sway(t, 0.62, -16, 0.25),
  };

  return {
    title: 'Overlook',
    width,
    height,
    ink: v.r(INK),
    background: PALETTE.ink,
    matte: pic,
    layers: [
      { // flat bands, drawn past the picture edge so the matte trims them clean
        flat: true,
        shapes: [
          { type: 'rect', x: pic.x, y: pic.y, w: pic.w, h: v.y(HORIZON) - pic.y, fill: PALETTE.sun },
          { type: 'rect', x: pic.x, y: v.y(HORIZON), w: pic.w, h: pic.y + pic.h - v.y(HORIZON), fill: PALETTE.rose },
        ],
      },
      { // the horizon, as heavy as any outline
        inkOnly: true,
        shapes: [{ type: 'rect', x: pic.x, y: v.y(HORIZON) - v.r(4), w: pic.w, h: v.r(8) }],
      },
      { inkOnly: true, shapes: marks(groundTexture()).map(to) },
      { // energy radiating off the figure, behind it
        inkOnly: true,
        shapes: marks(raster.rays({
          cx: hero.x - 6, cy: 154 + heroBob, inner: 74, outer: 118 + sway(t, 1.3, 9),
          count: 9, fromDeg: -158 + sway(t, 5.2, 5), toDeg: -22 + sway(t, 5.2, 5),
          weight: MARK, bow: 13,
        })).map(to),
      },
      ...bananaTree({ x: 182, y: 446, t, ...treeLife(t) })
        .map((layer) => ({ ...layer, shapes: layer.shapes.map((shape) => shape && to(shape)) })),
      { shapes: [...figure(companion), ...figure(hero)].map(to) },
      { inkOnly: true, shapes: eyes({ x: hero.x - 4, y: 168 + heroBob }).map(to) },
      { inkOnly: true, shapes: eyes({ x: companion.x + 2, y: 341 - bounce, scale: 0.46 }).map(to) },
    ],
  };
};

// Frames worth checking: mid-fall, resting, mid-fade, bare ground, the sprout
// dithering in, the tree half grown, and the midribs mid-dither.
module.exports.moments = [0, 15.7, 16.8, 18.2, 19.4, 19.75, 20.1, 21.8, 22.5];

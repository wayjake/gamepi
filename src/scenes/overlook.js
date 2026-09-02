'use strict';
// "Overlook" -- the first scene of Emberfall.
//
// Composed for a 720x480 composite field on a CRT: flat bands of colour, a
// heavy ink frame sitting inside the overscan margin, and figures built from
// capsule chains so every edge is a bold round-capped outline.

const { PALETTE } = require('../gfx/palette');
const raster = require('../gfx/raster');
const { marks } = require('../gfx/scene');

const INK = 7;          // outline weight
const MARK = 3.5;       // ink-only stroke radius; >= 2px tall survives 480i
const HORIZON = 288;

// A seeded generator, so the ground texture is identical between renders and
// PNG diffs mean something.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Haring's ground: dashes and dots, thinning and shortening toward the horizon
// so the field reads as receding without any perspective maths.
function groundTexture(width, height) {
  const random = rng(0x5eed1);
  const out = [];
  for (let y = HORIZON + 18; y < height - 10; y += 22) {
    const depth = (y - HORIZON) / (height - HORIZON); // 0 at horizon, 1 near
    const step = 46 + (1 - depth) * 34;
    for (let x = 14 + random() * step; x < width - 14; x += step * (0.7 + random() * 0.7)) {
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

// A blob figure: one body chain plus limbs, all in the same fill, so the ink
// pass welds them into a single silhouette wherever they overlap.
function figure({ x, y, scale = 1, fill, flip = 1 }) {
  const p = (dx, dy, r) => ({ x: x + dx * scale * flip, y: y + dy * scale, r: r * scale });
  return [
    { // body: head down through the trunk
      type: 'chain',
      fill,
      points: [p(-4, -150, 44), p(-8, -124, 49), p(6, -80, 49), p(2, -28, 38), p(-4, 24, 32), p(-6, 44, 29)],
    },
    { // left arm, thrown up and back
      type: 'chain',
      fill,
      points: [p(-42, -84, 22), p(-106, -114, 19), p(-146, -178, 15), p(-160, -210, 17)],
    },
    { // right arm, reaching out and up
      type: 'chain',
      fill,
      points: [p(46, -84, 22), p(118, -64, 19), p(174, -104, 14), p(196, -148, 16)],
    },
    { // legs: the drips of the drawing, kept apart so ink runs between them
      type: 'chain',
      fill,
      points: [p(-26, 34, 26), p(-40, 104, 20), p(-36, 150, 16)],
    },
    {
      type: 'chain',
      fill,
      points: [p(26, 34, 26), p(38, 104, 20), p(32, 150, 16)],
    },
  ];
}

const eyes = ({ x, y, scale = 1, flip = 1, spread = 22, r = 10 }) => [
  { type: 'disc', x: x - spread * scale * flip, y: y, r: r * scale },
  { type: 'disc', x: x + spread * scale * flip, y: y, r: r * scale },
];

// Four bars rather than a hollow rect, so the renderer only needs 'rect'.
const framePieces = (width, height, insetX, insetY, weight) => {
  const w = width - insetX * 2;
  const h = height - insetY * 2;
  return [
    { type: 'rect', x: insetX, y: insetY, w, h: weight },
    { type: 'rect', x: insetX, y: insetY + h - weight, w, h: weight },
    { type: 'rect', x: insetX, y: insetY, w: weight, h },
    { type: 'rect', x: insetX + w - weight, y: insetY, w: weight, h },
  ];
};

module.exports = function overlook(width = 720, height = 480) {
  const hero = { x: 318, y: 292, scale: 1, fill: PALETTE.sky };
  const companion = { x: 572, y: 374, scale: 0.46, fill: PALETTE.ember, flip: -1 };

  return {
    title: 'Overlook',
    width,
    height,
    ink: INK,
    background: PALETTE.sun,
    layers: [
      { // flat bands, bled off every edge so overscan has nothing to crop
        flat: true,
        shapes: [
          { type: 'rect', x: 0, y: 0, w: width, h: HORIZON, fill: PALETTE.sun },
          { type: 'rect', x: 0, y: HORIZON, w: width, h: height - HORIZON, fill: PALETTE.rose },
        ],
      },
      { // the horizon, as heavy as any outline
        inkOnly: true,
        shapes: [{ type: 'rect', x: 0, y: HORIZON - 4, w: width, h: 8 }],
      },
      { inkOnly: true, shapes: marks(groundTexture(width, height)) },
      { // energy radiating off the figure, drawn behind it
        inkOnly: true,
        shapes: marks(raster.rays({
          cx: hero.x - 6, cy: 154, inner: 74, outer: 118,
          count: 9, fromDeg: -158, toDeg: -22, weight: MARK, bow: 13,
        })),
      },
      { shapes: [...figure(companion), ...figure(hero)] },
      { inkOnly: true, shapes: [...eyes({ x: hero.x - 4, y: 168, spread: 21, r: 10 })] },
      { inkOnly: true, shapes: [...eyes({ x: companion.x + 2, y: 341, spread: 21, r: 10, scale: 0.46 })] },
      { // the frame, sitting inside the overscan margin so a CRT can't crop it
        inkOnly: true,
        shapes: framePieces(width, height, 24, 20, 9),
      },
    ],
  };
};

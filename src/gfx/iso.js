'use strict';
// Isometric ground, painted straight into pixels.
//
// A 2:1 diamond is not a rect, a disc or a chain, and drawing one out of
// scanline rects would put a few thousand shapes through the renderer a frame.
// So the ground of an isometric game goes the way the 3D side goes: rasterised
// here into a canvas the game owns, handed to gfx/scene.js as `underlay`, and
// the sprites, text and matte draw over it as they would over a flat colour.
//
// Tiles partition the plane exactly. With an even tile width, a tile height of
// half that, and centres on the lattice, no pixel centre ever lands on an edge
// (the edge equation comes out a half-integer), so a strict inequality gives
// every pixel to exactly one tile: no seams, no double-painting, and a field of
// one colour is a field of one colour rather than a mesh of hairlines.

const { Canvas } = require('../canvas');

// A grid of cols x rows tiles whose bounding box has its top-left at (x, y).
// Tile (0, 0) is the topmost diamond; c runs down-right, r runs down-left.
function grid({ cols, rows, tileW, x = 0, y = 0 }) {
  if (tileW % 4) throw new Error(`isometric tile width must be a multiple of 4, got ${tileW}`);
  const hw = tileW / 2;
  const hh = tileW / 4;
  const width = (cols + rows) * hw;
  const height = (cols + rows) * hh;
  const ox = x + rows * hw;   // centre of tile (0, 0)
  const oy = y + hh;

  return {
    cols, rows, hw, hh, tw: tileW, th: tileW / 2, width, height, x, y, ox, oy,
    inside: (c, r) => c >= 0 && r >= 0 && c < cols && r < rows,
    centre: (c, r) => ({ x: ox + (c - r) * hw, y: oy + (c + r) * hh }),
    // The tile under a pixel, or null.
    tile(px, py) {
      const u = (px + 0.5 - ox) / hw;
      const v = (py + 0.5 - oy) / hh;
      const c = Math.floor((u + v) / 2 + 0.5);
      const r = Math.floor((v - u) / 2 + 0.5);
      return c >= 0 && r >= 0 && c < cols && r < rows ? { c, r } : null;
    },
  };
}

// A filled diamond centred on (cx, cy) with half-extents hw, hh.
function fill(canvas, cx, cy, hw, hh, colour) {
  if (hw <= 0 || hh <= 0) return;
  const px = canvas.px;
  const width = canvas.width;
  const y0 = Math.max(0, Math.floor(cy - hh));
  const y1 = Math.min(canvas.height - 1, Math.ceil(cy + hh));
  for (let y = y0; y <= y1; y++) {
    const dy = Math.abs(y + 0.5 - cy);
    const reach = (1 - dy / hh) * hw;
    if (reach <= 0) continue;
    const from = Math.max(0, Math.floor(cx - reach - 0.5) + 1);
    const to = Math.min(width - 1, Math.ceil(cx + reach - 0.5) - 1);
    const row = y * width;
    for (let x = from; x <= to; x++) px[row + x] = colour;
  }
}

// The same diamond as a closed chain, for drawing one through the renderer --
// a cursor over a tile, say -- with the stroke radius `r`.
function outline(cx, cy, hw, hh, r, fillColour) {
  const p = (x, y) => ({ x: Math.round(x), y: Math.round(y), r });
  return {
    type: 'chain',
    points: [p(cx, cy - hh), p(cx + hw, cy), p(cx, cy + hh), p(cx - hw, cy), p(cx, cy - hh)],
    fill: fillColour,
  };
}

const target = (width, height) => new Canvas(width, height);

module.exports = { grid, fill, outline, target };

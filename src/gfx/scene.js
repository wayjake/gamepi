'use strict';
// Renders a scene description into a Canvas.
//
// The whole look comes from one rule: within a layer, every shape is drawn
// twice -- all of them in ink at radius+weight first, then all of them in their
// own colour at true radius. Shapes that overlap merge into one coloured mass;
// shapes that come close but don't touch keep a black channel between them.
// That is exactly how the limbs read in the reference drawing, and it falls out
// of the ordering rather than needing any outline tracing.

const { Canvas, textWidth } = require('../canvas');
const { PALETTE } = require('./palette');
const raster = require('./raster');

function draw(canvas, shape, color, grow) {
  switch (shape.type) {
    case 'rect':
      raster.rect(canvas, shape.x - grow, shape.y - grow, shape.w + grow * 2, shape.h + grow * 2, color);
      break;
    case 'disc':
      raster.disc(canvas, shape.x, shape.y, shape.r + grow, color);
      break;
    case 'chain':
      raster.chain(canvas, shape.points, color, grow);
      break;
    default:
      throw new Error(`unknown shape type: ${shape.type}`);
  }
}

function render(scene, { width = scene.width, height = scene.height } = {}) {
  const canvas = new Canvas(width, height);
  canvas.clear(scene.background ?? PALETTE.cream);

  for (const layer of scene.layers) {
    const shapes = layer.shapes.filter(Boolean);

    if (layer.flat) {
      for (const shape of shapes) draw(canvas, shape, shape.fill, 0);
    } else if (layer.inkOnly) {
      for (const shape of shapes) draw(canvas, shape, layer.fill ?? PALETTE.ink, 0);
    } else {
      const weight = layer.ink ?? scene.ink ?? 6;
      for (const shape of shapes) draw(canvas, shape, PALETTE.ink, weight);
      for (const shape of shapes) draw(canvas, shape, shape.fill, 0);
    }
  }

  // Text sits above the artwork but below the matte, so a label that strays
  // into the border is cropped like anything else.
  for (const label of scene.text ?? []) {
    const scale = label.scale ?? 2;
    const w = textWidth(scene.font, label.text, scale);
    const h = scene.font.height * scale;
    const x = label.anchor === 'end' ? label.x - w : label.anchor === 'middle' ? label.x - w / 2 : label.x;
    const y = label.baseline === 'bottom' ? label.y - h : label.y;
    canvas.drawText(scene.font, label.text, Math.round(x), Math.round(y), scale, label.fill ?? PALETTE.cream);
  }

  // The matte: everything outside the picture rectangle is painted flat, so the
  // art ends on a deliberate edge rather than running off into whatever the
  // tube happens to crop.
  if (scene.matte) {
    const { x, y, w, h } = scene.matte;
    const colour = scene.matteColour ?? PALETTE.ink;
    raster.rect(canvas, 0, 0, width, y, colour);
    raster.rect(canvas, 0, y + h, width, height - y - h, colour);
    raster.rect(canvas, 0, y, x, h, colour);
    raster.rect(canvas, x + w, y, width - x - w, h, colour);
  }
  return canvas;
}

// Turns a list of chain point-arrays into ink-only shapes (rays, texture).
const marks = (chains, r) => chains.map((points) => ({
  type: 'chain',
  points: r === undefined ? points : points.map((p) => ({ ...p, r })),
}));

module.exports = { render, draw, marks };

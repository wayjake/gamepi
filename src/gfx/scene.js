'use strict';
// Renders a scene description into a Canvas.
//
// The whole look comes from one rule: within a layer, every shape is drawn
// twice -- all of them in ink at radius+weight first, then all of them in their
// own colour at true radius. Shapes that overlap merge into one coloured mass;
// shapes that come close but don't touch keep a black channel between them.
// That is exactly how the limbs read in the reference drawing, and it falls out
// of the ordering rather than needing any outline tracing.

const { Canvas } = require('../canvas');
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
  return canvas;
}

// Turns a list of chain point-arrays into ink-only shapes (rays, texture).
const marks = (chains, r) => chains.map((points) => ({
  type: 'chain',
  points: r === undefined ? points : points.map((p) => ({ ...p, r })),
}));

module.exports = { render, draw, marks };

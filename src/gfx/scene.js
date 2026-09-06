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

// Ordered dither, for fading a layer in or out. There is no alpha on a flat
// poster -- every pixel is one palette colour -- so a fade is a stipple, the
// way it was done on the consoles this look comes from, and composite video on
// a CRT blurs it into a real mid-tone. Thresholds are a 4x4 Bayer matrix laid
// over 2x2 pixel cells rather than single pixels: a cell spans both fields of
// an interlaced frame, so a half-faded shape shimmers instead of strobing.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const UNPAINTED = 0xffffffff; // never a colour: colours are 24-bit
let scratch = null;

function paintLayer(canvas, layer, scene) {
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

function renderLayer(canvas, layer, scene) {
  const alpha = layer.alpha ?? 1;
  if (alpha <= 0) return;
  const level = Math.round(alpha * 16);
  if (level <= 0) return;
  if (level >= 16) return paintLayer(canvas, layer, scene);

  // Paint the layer on its own, then copy across only the pixels whose cell
  // passes the threshold. The scratch canvas is kept between frames.
  if (!scratch || scratch.width !== canvas.width || scratch.height !== canvas.height) {
    scratch = new Canvas(canvas.width, canvas.height);
  }
  scratch.clear(UNPAINTED);
  paintLayer(scratch, layer, scene);

  const src = scratch.px;
  const dst = canvas.px;
  const width = canvas.width;
  for (let y = 0; y < canvas.height; y++) {
    const rowBits = ((y >> 1) & 3) << 2;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const c = src[row + x];
      if (c !== UNPAINTED && BAYER[rowBits | ((x >> 1) & 3)] < level) dst[row + x] = c;
    }
  }
}

function render(scene, { width = scene.width, height = scene.height } = {}) {
  const canvas = new Canvas(width, height);

  // A scene may start from a picture instead of a colour. That is how the 3D
  // renderer joins in: gfx/scene3d.js rasterises into its own canvas, hands it
  // over as the underlay, and the layers, text and matte below go on top of it
  // exactly as they would over a flat background. Everything downstream --
  // the framebuffer, the preview, the invariant checks -- sees an ordinary
  // scene and needs to know nothing about any of it.
  if (scene.underlay) canvas.px.set(scene.underlay.px);
  else canvas.clear(scene.background ?? PALETTE.cream);

  for (const layer of scene.layers) renderLayer(canvas, layer, scene);

  // Text sits above the artwork but below the matte, so a label that strays
  // into the border is cropped like anything else.
  for (const label of scene.text ?? []) {
    const scale = label.scale ?? 2;
    // A label may bring its own font. A scene with one voice sets scene.font
    // and forgets about it; a menu that wants a heading twice the size of its
    // body text would otherwise need two passes.
    const font = label.font ?? scene.font;
    const w = textWidth(font, label.text, scale);
    const h = font.height * scale;
    const x = label.anchor === 'end' ? label.x - w : label.anchor === 'middle' ? label.x - w / 2 : label.x;
    const y = label.baseline === 'bottom' ? label.y - h : label.y;
    canvas.drawText(font, label.text, Math.round(x), Math.round(y), scale, label.fill ?? PALETTE.cream);
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

module.exports = { render, draw, marks, BAYER };

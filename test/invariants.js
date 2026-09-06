'use strict';
// The rules every drawn frame has to obey, in one place.
//
// They started out inline in scene.test.js, which was fine while scenes were
// the only thing that drew. Games draw too, and a game that quietly broke the
// flicker rule would be worse than a scene that did -- you look at a scene, you
// stare at a game. Same checks, both directories.

const assert = require('node:assert');
const { PALETTE, luma } = require('../src/gfx/palette');
const sceneRenderer = require('../src/gfx/scene');

const Y_MIN = 16;
const Y_MAX = 235;

// A long horizontal ink run only one pixel tall lands in a single field of an
// interlaced signal, so it strobes at 30 Hz. The apex of a curve is unavoidably
// one pixel tall, but it is also only a few pixels wide -- what matters is a
// *run*, so only flag those.
const MIN_FLICKER_LENGTH = 8;

function ntscLegal(where = 'palette') {
  for (const [name, rgb] of Object.entries(PALETTE)) {
    const channels = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
    for (const c of channels) {
      assert.ok(c >= Y_MIN && c <= Y_MAX, `${where}: ${name}: channel ${c} outside ${Y_MIN}..${Y_MAX}`);
    }
    const y = luma(...channels);
    assert.ok(y >= Y_MIN - 0.5 && y <= Y_MAX + 0.5, `${where}: ${name}: luma ${y.toFixed(1)} outside range`);
  }
}

function paletteOnly(canvas, where) {
  const allowed = new Set(Object.values(PALETTE));
  const seen = new Set(canvas.px);
  for (const colour of seen) {
    assert.ok(allowed.has(colour), `${where}: stray colour #${colour.toString(16).padStart(6, '0')}`);
  }
  return seen;
}

function noFlicker(canvas, where) {
  const { width, height } = canvas;
  const at = (x, y) => canvas.px[y * width + x];
  const offenders = [];

  for (let y = 1; y < height - 1; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const thin = at(x, y) === PALETTE.ink
        && at(x, y - 1) !== PALETTE.ink
        && at(x, y + 1) !== PALETTE.ink;
      if (thin) {
        run++;
      } else {
        if (run >= MIN_FLICKER_LENGTH) offenders.push(`${run}px at y=${y}`);
        run = 0;
      }
    }
    if (run >= MIN_FLICKER_LENGTH) offenders.push(`${run}px at y=${y}`);
  }
  assert.deepStrictEqual(offenders, [],
    `${where}: 1px-tall ink runs will flicker on an interlaced field: ${offenders.slice(0, 5).join(', ')}`);
}

// Renders again with a sentinel matte colour. Checking against the real one
// proves nothing -- it's the same ink the outlines use, and the background
// behind it, so a matte that never got painted looks identical. The sentinel
// makes "was the matte applied" observable.
function insideMatte(scene, where) {
  if (!scene.matte) return;
  const sentinel = 0x2b8a3f;
  const marked = sceneRenderer.render({ ...scene, matteColour: sentinel });
  const { x, y, w, h } = scene.matte;
  const { width, height } = marked;

  let strays = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const outside = px < x || px >= x + w || py < y || py >= y + h;
      if (outside && marked.px[py * width + px] !== sentinel) strays++;
    }
  }
  assert.strictEqual(strays, 0, `${where}: ${strays} painted pixels outside the picture rectangle`);
}

// Something has to be drawn inside the picture. Scenes check a fixed point near
// the top, which suits a full-bleed illustration; a game screen is mostly empty
// court, so count instead.
function pictureNotEmpty(canvas, rect, where, least = 400) {
  let painted = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (canvas.px[y * canvas.width + x] !== PALETTE.ink) painted++;
    }
  }
  assert.ok(painted >= least, `${where}: only ${painted} non-ink pixels inside the picture`);
}

// Everything at once, for a frame that came from anywhere.
function legalFrame(scene, canvas, where, { least } = {}) {
  paletteOnly(canvas, where);
  noFlicker(canvas, where);
  insideMatte(scene, where);
  if (scene.matte) pictureNotEmpty(canvas, scene.matte, where, least);
}

module.exports = {
  ntscLegal, paletteOnly, noFlicker, insideMatte, pictureNotEmpty, legalFrame,
  MIN_FLICKER_LENGTH, Y_MIN, Y_MAX,
};

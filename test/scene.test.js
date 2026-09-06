'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PALETTE } = require('../src/gfx/palette');
const sceneRenderer = require('../src/gfx/scene');
const png = require('../src/gfx/png');
const invariants = require('./invariants');

const SCENES = path.join(__dirname, '..', 'src', 'scenes');

test('every palette colour is legal for composite video', () => {
  invariants.ntscLegal();
});

for (const file of fs.readdirSync(SCENES).filter((f) => f.endsWith('.js'))) {
  const build = require(path.join(SCENES, file));

  test(`${file}: animates, and each frame is reproducible`, () => {
    const frame = (t) => png.encode(sceneRenderer.render(build(720, 480, t)));

    // Frame n must always draw the same picture: the stage derives t from the
    // frame counter precisely so playback can be reproduced and diffed.
    assert.ok(frame(0.7).equals(frame(0.7)), 'the same t renders differently twice');

    // And something has to actually move, unless the scene says it is a still
    // on purpose -- the calibration ruler would be useless if it drifted.
    const still = frame(0);
    const moved = [0.2, 0.4, 0.6, 0.8].map(frame);
    if (build(720, 480, 0).still) {
      assert.ok(moved.every((f) => f.equals(still)), 'a scene marked still is moving');
    } else {
      assert.ok(moved.some((f) => !f.equals(still)), 'nothing in the scene responds to t');
    }
  });

  test(`${file}: renders deterministically`, () => {
    // Textures use a seeded generator; an unseeded Math.random would make
    // every render different and every visual comparison meaningless.
    const a = png.encode(sceneRenderer.render(build(720, 480)));
    const b = png.encode(sceneRenderer.render(build(720, 480)));
    assert.ok(a.equals(b), 'two renders of the same scene differ');
  });

  // A scene may name the moments worth checking -- mid-fall, mid-fade, and so
  // on -- since t = 0 rarely exercises everything it can draw.
  const moments = build.moments ?? [0];

  test(`${file}: paints only palette colours`, () => {
    for (const t of moments) {
      const canvas = sceneRenderer.render(build(720, 480, t));
      const seen = invariants.paletteOnly(canvas, `${file} at t=${t}`);
      assert.ok(seen.size >= 3, `flat scene: only ${seen.size} colours used at t=${t}`);
    }
  });

  for (const t of moments) test(`${file}: keeps every painted pixel inside the safe area at t=${t}`, () => {
    const scene = build(720, 480, t);
    const canvas = sceneRenderer.render(scene);
    const where = `${file} at t=${t}`;

    invariants.insideMatte(scene, where);
    if (scene.matte) {
      // A scene is a full-bleed illustration, so the top of the picture is a
      // fair place to ask whether anything got drawn at all.
      const { x, y, w } = scene.matte;
      const at = (px, py) => canvas.px[py * canvas.width + px];
      assert.notStrictEqual(at(Math.round(x + w / 2), Math.round(y + 8)), PALETTE.ink, 'picture area is empty');
    }
    invariants.noFlicker(canvas, where);
  });
}

test('a layer with alpha dithers in proportion, in cells two pixels tall', () => {
  const rect = { type: 'rect', x: 100, y: 100, w: 64, h: 64, fill: PALETTE.ink };
  const at = (alpha) => sceneRenderer.render({
    width: 320, height: 240, background: PALETTE.cream,
    layers: [{ flat: true, alpha, shapes: [rect] }],
  });
  const inked = (canvas) => canvas.px.reduce((n, c) => n + (c === PALETTE.ink ? 1 : 0), 0);

  assert.strictEqual(inked(at(0)), 0, 'alpha 0 painted something');
  assert.strictEqual(inked(at(1)), 64 * 64, 'alpha 1 dithered a solid layer');
  assert.strictEqual(inked(at(0.5)), 64 * 64 / 2, 'alpha 0.5 is not half the pixels');
  assert.strictEqual(inked(at(0.25)), 64 * 64 / 4, 'alpha 0.25 is not a quarter of the pixels');

  // Every dithered pixel needs a painted neighbour above or below it: a lone
  // scanline of stipple sits in one field of the interlaced signal and flickers.
  const half = at(0.5);
  for (let y = 100; y < 164; y++) {
    for (let x = 100; x < 164; x++) {
      if (half.px[y * 320 + x] !== PALETTE.ink) continue;
      const pair = half.px[(y - 1) * 320 + x] === PALETTE.ink || half.px[(y + 1) * 320 + x] === PALETTE.ink;
      assert.ok(pair, `single-field pixel at ${x},${y}`);
    }
  }
});

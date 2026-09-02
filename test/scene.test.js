'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PALETTE, luma } = require('../src/gfx/palette');
const sceneRenderer = require('../src/gfx/scene');
const png = require('../src/gfx/png');

const SCENES = path.join(__dirname, '..', 'src', 'scenes');
const Y_MIN = 16;
const Y_MAX = 235;

test('every palette colour is legal for composite video', () => {
  for (const [name, rgb] of Object.entries(PALETTE)) {
    const channels = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
    for (const c of channels) {
      assert.ok(c >= Y_MIN && c <= Y_MAX, `${name}: channel ${c} outside ${Y_MIN}..${Y_MAX}`);
    }
    const y = luma(...channels);
    assert.ok(y >= Y_MIN - 0.5 && y <= Y_MAX + 0.5, `${name}: luma ${y.toFixed(1)} outside range`);
  }
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

  test(`${file}: paints only palette colours`, () => {
    const canvas = sceneRenderer.render(build(720, 480));
    const allowed = new Set(Object.values(PALETTE));
    const seen = new Set(canvas.px);
    for (const colour of seen) {
      assert.ok(allowed.has(colour), `stray colour #${colour.toString(16).padStart(6, '0')} in the render`);
    }
    assert.ok(seen.size >= 3, `flat scene: only ${seen.size} colours used`);
  });

  test(`${file}: keeps every painted pixel inside the safe area`, () => {
    const scene = build(720, 480);
    const canvas = sceneRenderer.render(scene);
    const at = (x, y) => canvas.px[y * canvas.width + x];

    if (scene.matte) {
      // Render again with a sentinel matte colour. Checking against the real
      // one proves nothing -- it's the same ink the outlines use, and the
      // background behind it, so a matte that never got painted looks
      // identical. The sentinel makes "was the matte applied" observable.
      const sentinel = 0x2b8a3f;
      const marked = sceneRenderer.render({ ...build(720, 480), matteColour: sentinel });
      const { x, y, w, h } = scene.matte;

      let strays = 0;
      for (let py = 0; py < 480; py++) {
        for (let px = 0; px < 720; px++) {
          const outside = px < x || px >= x + w || py < y || py >= y + h;
          if (outside && marked.px[py * 720 + px] !== sentinel) strays++;
        }
      }
      assert.strictEqual(strays, 0, `${strays} painted pixels outside the picture rectangle`);
      assert.notStrictEqual(at(Math.round(x + w / 2), Math.round(y + 8)), PALETTE.ink, 'picture area is empty');
    }

    // A long horizontal ink run only one pixel tall lands in a single field of
    // an interlaced signal, so it strobes at 30 Hz. The apex of a curve is
    // unavoidably one pixel tall, but it is also only a few pixels wide -- what
    // matters is a *run*, so only flag those.
    const MIN_FLICKER_LENGTH = 8;
    const offenders = [];
    for (let y = 1; y < 479; y++) {
      let run = 0;
      for (let x = 0; x < 720; x++) {
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
    assert.deepStrictEqual(offenders, [], `1px-tall ink runs will flicker on an interlaced field: ${offenders.slice(0, 5).join(', ')}`);
  });
}

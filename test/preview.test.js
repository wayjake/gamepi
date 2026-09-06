'use strict';

const test = require('node:test');
const assert = require('node:assert');

const preview = require('../src/preview');
const stage = require('../src/gfx/stage');
const framebuffer = require('../src/framebuffer');
const sceneRenderer = require('../src/gfx/scene');
const { Canvas } = require('../src/canvas');
const { PALETTE } = require('../src/gfx/palette');

const build = require('../src/scenes/overlook');
const WIDTH = 720;
const HEIGHT = 480;

// A writer that keeps what it was handed, so the loop can be watched without a
// framebuffer under it. Same shape as framebuffer.open()'s return value --
// which is the whole point of the seam.
function recorder() {
  const frames = [];
  return {
    frames,
    fb: { width: WIDTH, height: HEIGHT },
    present(canvas) {
      frames.push(Uint32Array.from(canvas.px));
      return { pack: 0, write: 0 };
    },
    close() { this.closed = true; },
  };
}

const ran = (opts) => new Promise((resolve) => {
  const writer = recorder();
  const show = stage.run(build, { ...opts, writer, report: false, onStop: () => resolve({ writer, show }) });
});

test('the stage draws to whatever writer it is handed, and never opens /dev/fb0', async () => {
  const { writer } = await ran({ fps: 30, seconds: 3 / 30 });
  assert.equal(writer.frames.length, 3);
  assert.ok(writer.closed, 'the stage closes its writer when it stops');
});

// The reason for deriving t from the frame counter is that frame n is always
// the same picture. A preview that scrubs has to keep that promise, or it is
// showing something the Pi would never show.
test('a frame off the stage is the frame the scene builds at that instant', async () => {
  const { writer } = await ran({ fps: 30, seconds: 3 / 30 });
  for (let n = 0; n < writer.frames.length; n++) {
    const expected = sceneRenderer.render(build(WIDTH, HEIGHT, n / 30));
    assert.deepEqual(writer.frames[n], expected.px, `frame ${n}`);
  }
});

test('seeking while paused draws that frame and nothing else', async () => {
  const writer = recorder();
  const show = stage.run(build, { fps: 30, writer, report: false });
  show.pause();
  const before = writer.frames.length;

  show.seek(30 * 15.7); // one of the moments the scene asks the tests to check
  assert.equal(writer.frames.length, before + 1);
  assert.equal(show.state().at, 15.7);
  assert.deepEqual(writer.frames.at(-1), sceneRenderer.render(build(WIDTH, HEIGHT, 15.7)).px);

  show.stop();
  assert.equal(writer.frames.length, before + 1, 'stopping draws nothing');
});

test('the preview sends the 16-bit pixels the display controller would read', async () => {
  const view = preview.open({ port: 0, width: WIDTH, height: HEIGHT });
  await view.listening;
  try {
    const res = await fetch(`${view.url()}stream`);
    const reader = res.body.getReader();

    const canvas = sceneRenderer.render(build(WIDTH, HEIGHT, 0));
    view.writer.present(canvas);

    // The header says how long the payload is, so read until there is that much.
    const want = preview.HEADER + WIDTH * HEIGHT * 2;
    let got = Buffer.alloc(0);
    while (got.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      got = Buffer.concat([got, Buffer.from(value)]);
    }
    assert.ok(got.length >= want, 'a whole frame arrived');

    assert.equal(got.readUInt16LE(0), WIDTH);
    assert.equal(got.readUInt16LE(2), HEIGHT);
    assert.equal(got.readUInt32LE(4), 0, 'frames are numbered from zero');

    const fb = { width: WIDTH, height: HEIGHT, bpp: 16, stride: WIDTH * 2 };
    assert.deepEqual(
      got.subarray(preview.HEADER, want),
      framebuffer.pack(canvas, fb),
      'the wire carries exactly what framebuffer.js would have packed'
    );

    await reader.cancel();
  } finally {
    view.shutdown();
  }
});

test('the preview answers for its state and refuses controls it does not have', async () => {
  const seen = [];
  const view = preview.open({
    port: 0,
    snapshot: () => ({ scene: 'overlook', at: 1.5 }),
    onControl: (msg) => {
      if (msg.action !== 'seek') throw new Error(`unknown action: ${msg.action}`);
      seen.push(msg);
      return { ok: msg.action };
    },
  });
  await view.listening;
  try {
    const state = await (await fetch(`${view.url()}state`)).json();
    assert.deepEqual(state, { scene: 'overlook', at: 1.5 });

    const post = (body) => fetch(`${view.url()}control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    assert.deepEqual(await (await post({ action: 'seek', at: 2 })).json(), { ok: 'seek' });
    assert.deepEqual(seen, [{ action: 'seek', at: 2 }]);

    const bad = await post({ action: 'boom' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'unknown action: boom' });
    assert.deepEqual(seen, [{ action: 'seek', at: 2 }], 'a refused control changes nothing');

    assert.equal((await fetch(`${view.url()}nope`)).status, 404);
  } finally {
    view.shutdown();
  }
});

// Nothing in the preview may invent a colour: it packs and the browser expands
// by bit replication, so the trip has to land back on the palette entry it
// started from, near enough that the look is the look.
test('palette colours survive the trip to the browser', () => {
  const fb = { width: 8, height: 1, bpp: 16, stride: 16 };
  const canvas = new Canvas(8, 1);
  const names = Object.keys(PALETTE).slice(0, 8);
  names.forEach((name, i) => { canvas.px[i] = PALETTE[name]; });

  const packed = framebuffer.pack(canvas, fb);
  names.forEach((name, i) => {
    const w = packed.readUInt16LE(i * 2);
    const r5 = (w >> 11) & 31, g6 = (w >> 5) & 63, b5 = w & 31;
    const back = [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)];
    const want = [(PALETTE[name] >> 16) & 0xff, (PALETTE[name] >> 8) & 0xff, PALETTE[name] & 0xff];
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(back[c] - want[c]) <= 8, `${name} channel ${c}: ${back[c]} vs ${want[c]}`);
    }
  });
});

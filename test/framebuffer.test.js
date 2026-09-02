'use strict';

const test = require('node:test');
const assert = require('node:assert');

const framebuffer = require('../src/framebuffer');
const { Canvas } = require('../src/canvas');
const { PALETTE } = require('../src/gfx/palette');

// The 16bpp path is a hand-optimised loop kept deliberately separate from the
// general packer, so it needs proving against it rather than trusting it.
test('the fast RGB565 path matches the general packer', () => {
  const fb = { width: 64, height: 48, bpp: 16, stride: 128, path: '/dev/null' };
  const canvas = new Canvas(fb.width, fb.height);

  // Long flat runs (which the previous-pixel check short-circuits) plus noise
  // (which it can't), so both halves of the loop are exercised.
  const colours = Object.values(PALETTE);
  for (let i = 0; i < canvas.px.length; i++) {
    canvas.px[i] = i % 7 === 0 ? (i * 2654435761) & 0xffffff : colours[(i / 90 | 0) % colours.length];
  }

  const general = Buffer.alloc(fb.stride * fb.height);
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      const rgb = canvas.px[y * fb.width + x];
      const packed = ((rgb >> 8) & 0xf800) | ((rgb >> 5) & 0x07e0) | ((rgb >> 3) & 0x001f);
      general.writeUInt16LE(packed, y * fb.stride + x * 2);
    }
  }

  const fast = Buffer.alloc(fb.stride * fb.height);
  framebuffer.packRGB565(canvas.px, new Uint16Array(fast.buffer, fast.byteOffset, fb.width * fb.height));

  assert.ok(fast.equals(general), 'fast RGB565 packing differs from the reference conversion');
});

test('RGB565 loses only the low bits of each channel', () => {
  const out = new Uint16Array(1);
  for (const rgb of Object.values(PALETTE)) {
    framebuffer.packRGB565(Uint32Array.of(rgb), out);
    const v = out[0];
    const back = [((v >> 11) & 0x1f) << 3, ((v >> 5) & 0x3f) << 2, (v & 0x1f) << 3];
    const want = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
    back.forEach((c, i) => assert.ok(
      Math.abs(c - want[i]) <= 8,
      `#${rgb.toString(16)}: channel ${i} became ${c}, expected within 8 of ${want[i]}`
    ));
  }
});

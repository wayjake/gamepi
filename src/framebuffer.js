'use strict';
// Writes a Canvas straight to a Linux framebuffer device (/dev/fb0).
// Geometry comes from sysfs at runtime -- never hardcode it, the composite
// mode the Pi lands in depends on sdtv_mode and the attached TV.

const fs = require('fs');
const os = require('os');

function info(device = 'fb0') {
  const sysfs = `/sys/class/graphics/${device}`;
  const read = (name) => fs.readFileSync(`${sysfs}/${name}`, 'utf8').trim();
  const [width, height] = read('virtual_size').split(',').map(Number);
  return {
    device,
    path: `/dev/${device}`,
    width,
    height,
    bpp: Number(read('bits_per_pixel')),
    stride: Number(read('stride')),
  };
}

// Packs the canvas into the framebuffer's native pixel layout.
//
// This runs 345,600 times a frame at 720x480, so it is written for speed
// rather than elegance: a caller-supplied buffer to avoid re-zeroing 691 KB
// every frame, a typed-array view instead of per-pixel writeUInt16LE, and a
// small direct-mapped cache for the colour conversion -- flat art uses a
// handful of distinct colours, so nearly every pixel is a cache hit.
if (os.endianness() !== 'LE') {
  throw new Error('framebuffer packing assumes a little-endian host');
}

const CACHE_BITS = 8;
const CACHE_SIZE = 1 << CACHE_BITS;
const cacheKey = new Int32Array(CACHE_SIZE).fill(-1);
const cacheValue = new Uint16Array(CACHE_SIZE);

const to565 = (rgb) => (((rgb >> 8) & 0xf800) | ((rgb >> 5) & 0x07e0) | ((rgb >> 3) & 0x001f));

// The hot path, deliberately alone in its own function.
//
// It used to be a branch inside pack(), sharing the body with the 24- and
// 32-bit cases. Those branches never ran, so V8 had no type feedback for them
// and kept bailing out of the optimised code with "insufficient type feedback
// for generic keyed access" -- which showed up as pack costing 6.1 ms/frame for
// the first seventeen seconds and 3.6 ms/frame thereafter. Two typed arrays in,
// nothing polymorphic, nothing dead.
//
// Flat art runs in long stretches of one colour, so the previous-pixel check
// carries most pixels; the table catches the rest.
function packRGB565(px, out) {
  let previous = -1;
  let previous565 = 0;

  for (let i = 0; i < px.length; i++) {
    const rgb = px[i];
    if (rgb !== previous) {
      previous = rgb;
      const slot = ((rgb >> 16) ^ (rgb >> 8) ^ rgb) & (CACHE_SIZE - 1);
      if (cacheKey[slot] !== rgb) {
        cacheKey[slot] = rgb;
        cacheValue[slot] = to565(rgb);
      }
      previous565 = cacheValue[slot];
    }
    out[i] = previous565;
  }
}

const canFastPack = (canvas, fb) =>
  fb.bpp === 16 && fb.stride === fb.width * 2
  && canvas.width === fb.width && canvas.height === fb.height;


function pack(canvas, fb, into = null) {
  const buf = into ?? Buffer.alloc(fb.stride * fb.height);
  const rows = Math.min(canvas.height, fb.height);
  const cols = Math.min(canvas.width, fb.width);

  if (canFastPack(canvas, fb)) {
    packRGB565(canvas.px, new Uint16Array(buf.buffer, buf.byteOffset, fb.width * fb.height));
    return buf;
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const rgb = canvas.px[y * canvas.width + x];
      const r = (rgb >> 16) & 0xff;
      const g = (rgb >> 8) & 0xff;
      const b = rgb & 0xff;

      switch (fb.bpp) {
        case 32: {
          const o = y * fb.stride + x * 4;
          buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = 0xff;
          break;
        }
        case 24: {
          const o = y * fb.stride + x * 3;
          buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
          break;
        }
        case 16: {
          buf.writeUInt16LE(to565(rgb), y * fb.stride + x * 2);
          break;
        }
        default:
          throw new Error(`unsupported framebuffer depth: ${fb.bpp}bpp`);
      }
    }
  }
  return buf;
}

function write(canvas, fb = info()) {
  const buf = pack(canvas, fb);
  const fd = fs.openSync(fb.path, 'w');
  try {
    fs.writeSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return fb;
}

// For animation: holds the fd and the packing buffer open across frames.
function open(fb = info()) {
  const fd = fs.openSync(fb.path, 'w');
  const buf = Buffer.alloc(fb.stride * fb.height);
  // Made once, not per frame: creating the view inside the hot path was part of
  // what kept V8 from settling on optimised code for it.
  const view = new Uint16Array(buf.buffer, buf.byteOffset, fb.width * fb.height);

  // Run the packer a few times before the first real frame. It is a tight loop
  // over a third of a million pixels, and V8 needs a little history before it
  // will compile it properly -- without this the first several seconds of every
  // animation are measurably slower than the rest. Nothing reaches the screen
  // until present() writes, so scribbling in the buffer here is free.
  if (canFastPack({ width: fb.width, height: fb.height }, fb)) {
    const warmup = new Uint32Array(fb.width * fb.height);
    for (let i = 0; i < warmup.length; i++) warmup[i] = (i * 2654435761) & 0xffffff;
    for (let i = 0; i < 4; i++) packRGB565(warmup, view);
  }

  return {
    fb,
    // Returns how long each half took. The two are worth separating: packing
    // is CPU, while the write goes to memory the display controller is reading
    // out 60 times a second, so they fail in different ways.
    present(canvas) {
      const a = performance.now();
      if (canFastPack(canvas, fb)) packRGB565(canvas.px, view);
      else pack(canvas, fb, buf);
      const b = performance.now();
      fs.writeSync(fd, buf, 0, buf.length, 0);
      return { pack: b - a, write: performance.now() - b };
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

module.exports = { info, pack, packRGB565, write, open };

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
const slotOf = (rgb) => ((rgb >> 16) ^ (rgb >> 8) ^ rgb) & (CACHE_SIZE - 1);

const to565 = (rgb) => (((rgb >> 8) & 0xf800) | ((rgb >> 5) & 0x07e0) | ((rgb >> 3) & 0x001f));

function pack(canvas, fb, into = null) {
  const buf = into ?? Buffer.alloc(fb.stride * fb.height);
  const rows = Math.min(canvas.height, fb.height);
  const cols = Math.min(canvas.width, fb.width);

  // The common case on this Pi: 16bpp with no row padding, so the whole frame
  // is one contiguous run of pixels.
  if (fb.bpp === 16 && fb.stride === fb.width * 2 && cols === fb.width && rows === fb.height) {
    const out = new Uint16Array(buf.buffer, buf.byteOffset, fb.width * fb.height);
    const px = canvas.px;
    for (let i = 0; i < px.length; i++) {
      const rgb = px[i];
      const slot = slotOf(rgb);
      if (cacheKey[slot] !== rgb) {
        cacheKey[slot] = rgb;
        cacheValue[slot] = to565(rgb);
      }
      out[i] = cacheValue[slot];
    }
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
  return {
    fb,
    present(canvas) {
      pack(canvas, fb, buf);
      fs.writeSync(fd, buf, 0, buf.length, 0);
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

module.exports = { info, pack, write, open };

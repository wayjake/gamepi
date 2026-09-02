'use strict';
// Writes a Canvas straight to a Linux framebuffer device (/dev/fb0).
// Geometry comes from sysfs at runtime -- never hardcode it, the composite
// mode the Pi lands in depends on sdtv_mode and the attached TV.

const fs = require('fs');

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
function pack(canvas, fb) {
  const buf = Buffer.alloc(fb.stride * fb.height);
  const rows = Math.min(canvas.height, fb.height);
  const cols = Math.min(canvas.width, fb.width);

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
        case 16: { // RGB565
          const o = y * fb.stride + x * 2;
          buf.writeUInt16LE(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3), o);
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

module.exports = { info, pack, write };

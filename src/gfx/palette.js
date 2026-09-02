'use strict';
// Colours, kept legal for composite video.
//
// A CRT fed composite doesn't get RGB -- it gets luma plus a chroma subcarrier,
// and oversaturated colour makes that subcarrier overshoot, which shows up as
// edges that bleed and buzz. So every colour goes through ntscSafe: clamp luma
// into broadcast range, then desaturate just far enough that the RGB it decodes
// back to stays in range too.

const Y_MIN = 16;
const Y_MAX = 235;

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pack = (r, g, b) => ((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0;
const unpack = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

function ntscSafe(rgb) {
  const [r, g, b] = unpack(rgb);
  const y = luma(r, g, b);
  const target = clamp(y, Y_MIN, Y_MAX);

  // Pull saturation in until every channel lands inside broadcast range.
  for (let s = 1; s > 0; s -= 0.02) {
    const out = [r, g, b].map((c) => target + (c - y) * s);
    if (out.every((c) => c >= Y_MIN - 0.5 && c <= Y_MAX + 0.5)) return pack(...out);
  }
  return pack(target, target, target);
}

// Poster paint: a few loud, flat colours that hold their edges on a CRT.
const PALETTE = {
  ink: 0x101010,
  sun: 0xf2c216,     // yellow sky
  rose: 0xee5fa7,    // pink ground
  sky: 0x6fb3de,     // the blue of the drawing
  ember: 0xe8412f,
  moss: 0x3fb56b,
  violet: 0x9a6fd4,
  cream: 0xf0e8d4,
};

for (const name of Object.keys(PALETTE)) PALETTE[name] = ntscSafe(PALETTE[name]);

module.exports = { PALETTE, ntscSafe, luma };

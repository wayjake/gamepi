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
  bark: 0x8f5a2c,    // banana-tree trunk
  cream: 0xf0e8d4,
};

for (const name of Object.keys(PALETTE)) PALETTE[name] = ntscSafe(PALETTE[name]);

// Shading ramps, for the 3D side.
//
// A lit surface and a shaded one are different colours, and the rule is that
// every painted pixel is a palette entry -- so the shades *are* palette
// entries, generated here and run through ntscSafe like everything else rather
// than computed per pixel at render time. The renderer picks a step by index,
// which is also why it can stay fast: no colour arithmetic in the inner loop.
//
// Three steps is enough for the poster look and few enough to stay flat. More
// steps start to read as a gradient, which is the opposite of the house style.
const STEPS = ['Dim', '', 'Lit'];
const FACTORS = [0.66, 1, 1.28];

const scale = (rgb, k) => pack(...unpack(rgb).map((c) => clamp(c * k, 0, 255)));

// Surfaces a mesh can be made of. `moss` and `bark` are already in the palette
// above; these are the ones only the 3D scenes need.
const SURFACES = {
  turf: 0x46b26b,   // fairway
  rough: 0x2f7f4e,  // longer grass either side of it
  sand: 0xd8b46d,   // bunker
  water: 0x3f7fc4,
  leaf: 0x4f9c4a,
  stone: 0x9aa0a6,
};

const RAMP = {};
for (const [name, base] of Object.entries(SURFACES)) {
  RAMP[name] = FACTORS.map((k) => ntscSafe(scale(base, k)));
  RAMP[name].forEach((colour, i) => { PALETTE[`${name}${STEPS[i]}`] = colour; });
}

// Ramps for colours that were already in the palette, so a 3D model can be
// made of the same paint as a 2D scene.
for (const name of ['moss', 'bark', 'sun', 'ember', 'sky', 'cream', 'rose', 'violet']) {
  RAMP[name] = FACTORS.map((k) => ntscSafe(scale(PALETTE[name], k)));
  RAMP[name].forEach((colour, i) => { PALETTE[`${name}${STEPS[i]}`] = colour; });
}

// Shadow theatre, for src/games/tallow.js.
//
// Every other game here is the poster look: ink grown under a flat fill. That
// one is fill only -- a lit linen sheet with cut-paper silhouettes on it, and
// value doing the work an outline usually does. It needs two colours the
// poster palette cannot supply.
//
// `shade` is what a puppet takes *out* of the light, and it is deliberately not
// `ink`: ink is an outline colour, and an outline is the one thing that look
// may not have. `soot` is the room around the sheet, so the matte reads as the
// edge of a lamp rather than as a letterbox.
//
// The lamp is a five-step ramp rather than the three the 3D side uses. Three
// steps are flat on purpose, which is right for a poster and wrong for a light
// source: a lamp behind cloth is a gradient, and the scene renderer's ordered
// dither blends the joins into one on a CRT.
const LAMP_BASE = 0xe8d8b4;
const LAMP_FACTORS = [0.38, 0.55, 0.75, 1, 1.14];
const LAMP = LAMP_FACTORS.map((k) => ntscSafe(scale(LAMP_BASE, k)));
LAMP.forEach((colour, i) => { PALETTE[`lamp${i}`] = colour; });

PALETTE.linen = LAMP[3];          // the sheet at its own brightness
PALETTE.shade = ntscSafe(0x16121a);
PALETTE.soot = ntscSafe(0x2a2018);


// Washes, for src/games/halcyon.js.
//
// The poster palette is nine flat colours that hold an edge; a sky is the one
// thing it cannot draw, because a sky is a gradient and every ramp here is
// three steps of one hue. These are five steps that change hue as they climb
// -- indigo to plum to amber, or black-green to pale cyan -- which is what a
// sky actually does and what no amount of scaling one base colour will give
// you. The scene renderer's ordered dither blends the joins on a CRT, the same
// trick the lamp in tallow.js uses.
//
// One wash per piece: it is the whole of that piece's identity on screen, and
// the visualiser draws sky, hills, sun and every part's marks out of these five
// and nothing else.
const WASHES = {
  dawn: [0x241f33, 0x4a3352, 0x8f4f58, 0xd4894b, 0xf2d69c],
  frost: [0x151d2b, 0x1f3a50, 0x2f6a78, 0x62a8ac, 0xcfe4dc],
  harvest: [0x201a18, 0x4a2b22, 0x8a4a26, 0xc9853a, 0xecd3a0],
};

const WASH = {};
for (const [name, steps] of Object.entries(WASHES)) {
  WASH[name] = steps.map((rgb, i) => {
    const colour = ntscSafe(rgb);
    PALETTE[`${name}${i}`] = colour;
    return colour;
  });
}

// Lambert term (0..1) to a step. Flat, deliberately: the bands are the look.
const SHADE_STEPS = FACTORS.length;
const step = (light) => Math.min(SHADE_STEPS - 1, Math.max(0, Math.round(light * (SHADE_STEPS - 1))));

module.exports = { PALETTE, RAMP, LAMP, WASH, ntscSafe, luma, step, SHADE_STEPS };

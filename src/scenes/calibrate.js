'use strict';
// Overscan ruler. Every CRT crops a different amount off a composite signal,
// and rarely the same amount on each axis, so this measures the two separately.
//
//   scripts/pi-run.sh src/render.js --scene calibrate
//
// Read it like this: along the TOP, each numbered block hangs from its own
// inset -- report the first number whose block is completely visible. Down the
// LEFT, each block starts at its own inset -- same reading. Those two numbers
// go into src/gfx/safearea.js. The unlabelled ticks on the right and bottom
// edges mirror the same insets, so a picture that sits off-centre shows up as
// the ticks disappearing on one side before the other.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const psf = require('../psf');

const STEPS = [8, 16, 24, 32, 40, 48, 56, 64];
const SWATCHES = [PALETTE.cream, PALETTE.sun, PALETTE.sky, PALETTE.ember];
const BLOCK = 34;
const TICK = 5;

module.exports = function calibrate(width = 720, height = 480) {
  const font = psf.load(path.join(__dirname, '..', '..', 'assets', 'Lat15-TerminusBold16.psf.gz'));

  const blocks = [];
  const ticks = [];
  const labels = [];

  STEPS.forEach((inset, i) => {
    const fill = SWATCHES[i % SWATCHES.length];

    // Vertical ruler: blocks hang from the top, each at its own inset.
    const tx = 84 + i * 78;
    blocks.push({ type: 'rect', x: tx, y: inset, w: 70, h: BLOCK, fill });
    labels.push({ text: String(inset), x: tx + 35, y: inset + 1, scale: 2, anchor: 'middle', fill: PALETTE.ink });
    ticks.push({ type: 'rect', x: tx, y: height - inset - TICK, w: 70, h: TICK, fill });

    // Horizontal ruler: blocks start from the left, each at its own inset.
    const ly = 140 + i * 40;
    blocks.push({ type: 'rect', x: inset, y: ly, w: 74, h: BLOCK, fill });
    labels.push({ text: String(inset), x: inset + 6, y: ly + 1, scale: 2, fill: PALETTE.ink });
    ticks.push({ type: 'rect', x: width - inset - TICK, y: ly, w: TICK, h: BLOCK, fill });
  });

  return {
    title: 'Calibrate',
    width,
    height,
    background: PALETTE.ink,
    font,
    layers: [{ flat: true, shapes: [...ticks, ...blocks] }, {
      flat: true,
      shapes: [ // centre crosshair -- shows whether the picture is centred at all
        { type: 'rect', x: width / 2 - 2, y: height / 2 - 46, w: 4, h: 92, fill: PALETTE.cream },
        { type: 'rect', x: width / 2 - 46, y: height / 2 - 2, w: 92, h: 4, fill: PALETTE.cream },
      ],
    }],
    text: labels,
  };
};

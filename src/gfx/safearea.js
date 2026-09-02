'use strict';
// How much of the framebuffer a CRT actually shows.
//
// Composite sets have no fixed overscan -- every tube crops a different amount,
// and it is never symmetric. Rather than guess, render src/scenes/calibrate.js,
// photograph the screen, and set the innermost ruler mark that was fully
// visible here. Every scene derives its picture rectangle from this, so one
// measurement fixes the whole project.
//
// Measured on: (uncalibrated -- conservative default)

const inset = {
  x: Number(process.env.GAMEPI_INSET_X ?? 56),
  y: Number(process.env.GAMEPI_INSET_Y ?? 36),
};

// The rectangle a scene may draw in. Everything outside it is matte.
function picture(width, height) {
  return {
    x: inset.x,
    y: inset.y,
    w: width - inset.x * 2,
    h: height - inset.y * 2,
  };
}

module.exports = { inset, picture };

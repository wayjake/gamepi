'use strict';
// A tiny RGB canvas plus PSF text drawing. Output-agnostic: render here, then
// hand the canvas to a writer (framebuffer.js on the Pi, preview.js locally).

const psf = require('./psf');

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Uint32Array(width * height); // 0xRRGGBB
  }

  clear(color = 0x000000) {
    this.px.fill(color >>> 0);
  }

  setPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = color >>> 0;
  }

  fillRect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.setPixel(x + dx, y + dy, color);
    }
  }

  // Draws `text` with its top-left at (x, y), each font pixel blown up to
  // scale x scale. Returns the width in pixels that was drawn.
  drawText(font, text, x, y, scale, color) {
    let penX = x;
    for (const ch of text) {
      const glyph = psf.glyphIndex(font, ch.codePointAt(0));
      for (let row = 0; row < font.height; row++) {
        for (let col = 0; col < font.width; col++) {
          if (!psf.glyphPixel(font, glyph, col, row)) continue;
          this.fillRect(penX + col * scale, y + row * scale, scale, scale, color);
        }
      }
      penX += font.width * scale;
    }
    return penX - x;
  }
}

const textWidth = (font, text, scale) => [...text].length * font.width * scale;

module.exports = { Canvas, textWidth };

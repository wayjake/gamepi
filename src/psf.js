'use strict';
// Minimal PSF1/PSF2 console-font reader. No dependencies.
// Console fonts live in /usr/share/consolefonts on Raspberry Pi OS; we vendor
// one into assets/ so the repo runs the same locally and on the Pi.

const fs = require('fs');
const zlib = require('zlib');

const PSF1_MAGIC = 0x0436;
const PSF1_MODE512 = 0x01;
const PSF1_MODEHASTAB = 0x02;
const PSF1_MODEHASSEQ = 0x04;

const PSF2_MAGIC = 0x864ab572;
const PSF2_HAS_UNICODE_TABLE = 0x01;

function load(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);

  if (buf.length >= 4 && buf.readUInt16LE(0) === PSF1_MAGIC) return parsePsf1(buf);
  if (buf.length >= 32 && buf.readUInt32LE(0) === PSF2_MAGIC) return parsePsf2(buf);
  throw new Error(`${file}: not a PSF1 or PSF2 font`);
}

function parsePsf1(buf) {
  const mode = buf[2];
  const charsize = buf[3];
  const count = mode & PSF1_MODE512 ? 512 : 256;
  const font = {
    width: 8,
    height: charsize,
    bytesPerRow: 1,
    glyphSize: charsize,
    count,
    glyphs: buf.subarray(4, 4 + count * charsize),
    map: new Map(),
  };
  if (mode & (PSF1_MODEHASTAB | PSF1_MODEHASSEQ)) {
    readUnicodeTable16(buf.subarray(4 + count * charsize), font.map);
  }
  return font;
}

function parsePsf2(buf) {
  const headerSize = buf.readUInt32LE(8);
  const flags = buf.readUInt32LE(12);
  const count = buf.readUInt32LE(16);
  const glyphSize = buf.readUInt32LE(20);
  const height = buf.readUInt32LE(24);
  const width = buf.readUInt32LE(28);
  const font = {
    width,
    height,
    bytesPerRow: Math.ceil(width / 8),
    glyphSize,
    count,
    glyphs: buf.subarray(headerSize, headerSize + count * glyphSize),
    map: new Map(),
  };
  if (flags & PSF2_HAS_UNICODE_TABLE) {
    readUnicodeTableUtf8(buf.subarray(headerSize + count * glyphSize), font.map);
  }
  return font;
}

// PSF1: per glyph, a run of uint16LE codepoints terminated by 0xFFFF.
function readUnicodeTable16(tab, map) {
  let glyph = 0;
  for (let i = 0; i + 1 < tab.length; i += 2) {
    const v = tab.readUInt16LE(i);
    if (v === 0xffff) { glyph++; continue; }
    if (v === 0xfffe) continue; // start of a sequence; we only index single chars
    if (!map.has(v)) map.set(v, glyph);
  }
}

// PSF2: per glyph, UTF-8 encoded codepoints, 0xFE starts sequences, 0xFF ends the glyph.
function readUnicodeTableUtf8(tab, map) {
  let glyph = 0;
  let start = 0;
  let inSequence = false;
  const flush = (end) => {
    if (!inSequence && end > start) {
      for (const ch of tab.subarray(start, end).toString('utf8')) {
        const cp = ch.codePointAt(0);
        if (!map.has(cp)) map.set(cp, glyph);
      }
    }
  };
  for (let i = 0; i < tab.length; i++) {
    if (tab[i] === 0xfe) { flush(i); inSequence = true; start = i + 1; }
    else if (tab[i] === 0xff) { flush(i); glyph++; inSequence = false; start = i + 1; }
  }
}

// Returns the glyph index for a codepoint, falling back to '?' then glyph 0.
function glyphIndex(font, cp) {
  if (font.map.size) {
    const i = font.map.get(cp);
    if (i !== undefined) return i;
    return font.map.get(0x3f) ?? 0;
  }
  return cp < font.count ? cp : 0x3f;
}

// Is the pixel at (col,row) of this glyph set?
function glyphPixel(font, index, col, row) {
  const byte = font.glyphs[index * font.glyphSize + row * font.bytesPerRow + (col >> 3)];
  return (byte >> (7 - (col & 7))) & 1;
}

module.exports = { load, glyphIndex, glyphPixel };

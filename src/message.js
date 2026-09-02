#!/usr/bin/env node
'use strict';
// Draw a centred message on the Pi's composite (RCA) output.
//
//   node src/message.js "HELLO WORLD"
//   node src/message.js --preview "HELLO"     # ASCII preview, no framebuffer
//   echo "piped text" | node src/message.js
//
// Options: --scale N | --fg #rrggbb | --bg #rrggbb | --safe 0.9 | --size WxH | --info

const path = require('path');
const { Canvas, textWidth } = require('./canvas');
const framebuffer = require('./framebuffer');
const psf = require('./psf');

const FONT = path.join(__dirname, '..', 'assets', 'Lat15-TerminusBold16.psf.gz');

function parseArgs(argv) {
  const opts = { scale: 0, fg: 0xffffff, bg: 0x000000, safe: 0.9, preview: false, info: false, size: null };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => argv[++i];
    switch (a) {
      case '--scale': opts.scale = Number(value()); break;
      case '--fg': opts.fg = color(value()); break;
      case '--bg': opts.bg = color(value()); break;
      case '--safe': opts.safe = Number(value()); break;
      case '--size': opts.size = value().split('x').map(Number); break;
      case '--preview': opts.preview = true; break;
      case '--info': opts.info = true; break;
      case '-h': case '--help': usage(0); break;
      default:
        if (a.startsWith('--')) usage(1, `unknown option: ${a}`);
        words.push(a);
    }
  }
  opts.text = words.join(' ');
  return opts;
}

const color = (s) => parseInt(s.replace(/^#/, ''), 16) >>> 0;

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('usage: message.js [--scale N] [--fg #rrggbb] [--bg #rrggbb] [--safe 0.9]');
  console.error('                  [--size WxH] [--preview] [--info] "text"');
  process.exit(code);
}

// Largest integer scale where every line fits the safe area, capped so tall
// messages still fit vertically. 1 is the floor -- we always draw something.
function fitScale(font, lines, w, h) {
  const widest = Math.max(...lines.map((l) => [...l].length), 1);
  const byWidth = Math.floor(w / (widest * font.width));
  const byHeight = Math.floor(h / (lines.length * font.height));
  return Math.max(1, Math.min(byWidth, byHeight));
}

function render(font, lines, width, height, opts) {
  const canvas = new Canvas(width, height);
  canvas.clear(opts.bg);

  // CRTs overscan: keep everything inside the safe area or the edges get cropped.
  const safeW = Math.floor(width * opts.safe);
  const safeH = Math.floor(height * opts.safe);
  const scale = opts.scale > 0 ? opts.scale : fitScale(font, lines, safeW, safeH);

  const lineHeight = font.height * scale;
  const blockHeight = lineHeight * lines.length;
  let y = Math.round((height - blockHeight) / 2);

  for (const line of lines) {
    const x = Math.round((width - textWidth(font, line, scale)) / 2);
    canvas.drawText(font, line, x, y, scale, opts.fg);
    y += lineHeight;
  }
  return { canvas, scale };
}

function previewToStdout(canvas) {
  // Two vertical pixels per character cell using half-block glyphs.
  const step = Math.max(1, Math.ceil(canvas.width / 160));
  let out = '';
  for (let y = 0; y < canvas.height; y += step * 2) {
    for (let x = 0; x < canvas.width; x += step) {
      const top = canvas.px[y * canvas.width + x];
      const bottom = canvas.px[Math.min(y + step, canvas.height - 1) * canvas.width + x];
      out += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    out += '\n';
  }
  process.stdout.write(out);
}

function readStdin() {
  try {
    return require('fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.info) {
    console.log(JSON.stringify(framebuffer.info(), null, 2));
    return;
  }

  let text = opts.text;
  if (!text && !process.stdin.isTTY) text = readStdin().trimEnd();
  if (!text) usage(1, 'no message given');
  const lines = text.replace(/\\n/g, '\n').split('\n');

  const font = psf.load(FONT);

  if (opts.preview) {
    const [w, h] = opts.size || [720, 480];
    const { canvas, scale } = render(font, lines, w, h, opts);
    previewToStdout(canvas);
    console.log(`# preview ${w}x${h}, scale ${scale}x`);
    return;
  }

  let fb;
  try {
    fb = framebuffer.info();
  } catch (err) {
    console.error('no framebuffer at /dev/fb0 -- is the composite output enabled and a TV connected?');
    console.error(`(${err.message})`);
    console.error('run with --preview to render to this terminal instead.');
    process.exit(1);
  }

  const { canvas, scale } = render(font, lines, fb.width, fb.height, opts);
  framebuffer.write(canvas, fb);
  console.log(`drew ${lines.length} line(s) at ${scale}x on ${fb.path} (${fb.width}x${fb.height} ${fb.bpp}bpp)`);
}

main();

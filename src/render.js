#!/usr/bin/env node
'use strict';
// Render a scene to the Pi's framebuffer, or to a PNG for looking at here.
//
//   node src/render.js --png out.png          # render at 720x480 and write a file
//   scripts/pi-run.sh src/render.js           # draw one frame on the CRT
//   scripts/pi-run.sh src/render.js --animate # run the frame loop, Ctrl-C to stop
//   node src/render.js --at 1.5 --png out.png # a single frame from partway in

const fs = require('fs');
const path = require('path');

const scenes = path.join(__dirname, 'scenes');
const sceneRenderer = require('./gfx/scene');
const framebuffer = require('./framebuffer');
const stage = require('./gfx/stage');
const png = require('./gfx/png');

function parseArgs(argv) {
  const opts = { scene: 'overlook', png: null, size: null, animate: false, fps: 30, seconds: Infinity, at: 0 };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    switch (argv[i]) {
      case '--scene': opts.scene = value(); break;
      case '--png': opts.png = value(); break;
      case '--size': opts.size = value().split('x').map(Number); break;
      case '--animate': opts.animate = true; break;
      case '--fps': opts.fps = Number(value()); break;
      case '--seconds': opts.seconds = Number(value()); break;
      case '--at': opts.at = Number(value()); break;
      case '-h': case '--help': usage(0); break;
      default: usage(1, `unknown option: ${argv[i]}`);
    }
  }
  return opts;
}

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('usage: render.js [--scene name] [--png file] [--size WxH] [--at seconds]');
  console.error('                 [--animate] [--fps N] [--seconds N]');
  console.error(`scenes: ${fs.readdirSync(scenes).map((f) => f.replace(/\.js$/, '')).join(', ')}`);
  process.exit(code);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const build = require(path.join(scenes, opts.scene));

  if (opts.animate) {
    console.error(`animating ${opts.scene} at ${opts.fps} fps -- Ctrl-C to stop`);
    stage.run(build, {
      fps: opts.fps,
      seconds: opts.seconds,
      onStop: (reason, frames) => console.error(`${reason} after ${frames} frames`),
    });
    return;
  }

  let width;
  let height;
  let fb = null;
  if (opts.size) {
    [width, height] = opts.size;
  } else if (opts.png) {
    [width, height] = [720, 480];
  } else {
    fb = framebuffer.info();
    [width, height] = [fb.width, fb.height];
  }

  const t0 = Date.now();
  const scene = build(width, height, opts.at);
  const canvas = sceneRenderer.render(scene);
  console.error(`${scene.title}: ${width}x${height} in ${Date.now() - t0}ms`);

  if (opts.png) {
    fs.writeFileSync(opts.png, png.encode(canvas));
    console.error(`wrote ${opts.png}`);
  } else {
    framebuffer.write(canvas, fb);
    console.error(`drew on ${fb.path} (${fb.bpp}bpp)`);
  }
}

main();

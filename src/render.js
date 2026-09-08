#!/usr/bin/env node
'use strict';
// Render a scene to the Pi's framebuffer, or to a PNG for looking at here.
//
//   node src/render.js --png out.png          # render at 720x480 and write a file
//   scripts/pi-run.sh src/render.js           # draw one frame on the CRT
//   scripts/pi-run.sh src/render.js --animate # run the frame loop, Ctrl-C to stop
//   node src/render.js --at 1.5 --png out.png # a single frame from partway in
//   node src/render.js --serve                # watch it move in a browser, no Pi

const fs = require('fs');
const path = require('path');

const scenes = path.join(__dirname, 'scenes');
const sceneRenderer = require('./gfx/scene');
const framebuffer = require('./framebuffer');
const stage = require('./gfx/stage');
const png = require('./gfx/png');
const preview = require('./preview');
const safearea = require('./gfx/safearea');

function parseArgs(argv) {
  const opts = { scene: 'overlook', png: null, size: null, animate: false, fps: 30, seconds: Infinity, at: 0, serve: false, port: 7480, host: '127.0.0.1', open: true };
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
      case '--serve': opts.serve = true; break;
      case '--port': opts.port = Number(value()); break;
      case '--lan': opts.host = '0.0.0.0'; break;
      case '--host': opts.host = value(); break;
      case '--no-open': opts.open = false; break;
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
  console.error('                 [--serve] [--lan] [--port N] [--no-open]');
  console.error(`scenes: ${fs.readdirSync(scenes).map((f) => f.replace(/\.js$/, '')).join(', ')}`);
  process.exit(code);
}

// Every path that wants a real framebuffer comes through here, so the advice
// about what to do on a machine that hasn't got one is in one place.
function noFramebuffer(err) {
  console.error('no framebuffer at /dev/fb0 -- is the composite output enabled and a TV connected?');
  console.error(`(${err.message})`);
  console.error('run with --serve to watch it in a browser here instead, or --png for a still.');
  process.exit(1);
}

// The dev-machine loop: the same stage that drives the CRT, writing to a
// browser instead of /dev/fb0. Scenes are swapped by stopping the loop and
// starting another against the same server, which is why the preview writer's
// close() is a no-op -- see src/preview.js.
async function serve(opts) {
  const [width, height] = opts.size ?? [720, 480];
  const names = fs.readdirSync(scenes).map((f) => f.replace(/\.js$/, '')).sort();
  if (!names.includes(opts.scene)) usage(1, `unknown scene: ${opts.scene}`);

  let name = opts.scene;
  let fps = opts.fps;
  let show = null;

  const snapshot = () => ({
    scene: name, scenes: names, fps, width, height,
    picture: safearea.picture(width, height),
    moments: require(path.join(scenes, name)).moments ?? [],
    ...(show ? show.state() : { frame: 0, paused: false, at: 0 }),
  });

  const view = preview.open({
    port: opts.port,
    host: opts.host,
    width,
    height,
    clock: () => (show ? show.state().at : 0),
    snapshot,
    onControl: (msg) => {
      if (!show) return snapshot();
      switch (msg.action) {
        case 'play': show.resume(); break;
        case 'pause': show.pause(); break;
        case 'step': show.pause(); show.seek(show.state().frame + (msg.by ?? 1)); break;
        case 'seek': show.seek(Number(msg.at) * fps); break;
        case 'fps': start(name, show.state().at, Number(msg.fps)); break;
        case 'scene':
          if (!names.includes(msg.name)) throw new Error(`unknown scene: ${msg.name}`);
          start(msg.name, show.state().at);
          break;
        default: throw new Error(`unknown action: ${msg.action}`);
      }
      return snapshot();
    },
  });

  // Keeps t across a scene change, so you can line two scenes up at the same
  // instant rather than hunting for it again.
  function start(next, at = 0, rate = fps) {
    const wasPaused = show?.state().paused ?? false;
    if (show) show.stop();
    name = next;
    fps = rate;
    show = stage.run(require(path.join(scenes, name)), { fps, writer: view.writer, report: false });
    if (wasPaused) show.pause();
    show.seek(Math.round(at * fps));
  }

  await view.listening;
  start(opts.scene);
  console.error(`preview: ${view.url()}  (${width}x${height}, RGB565, Ctrl-C to stop)`);
  for (const url of view.urls()) console.error(`         ${url}   on this network`);
  if (opts.open && process.platform === 'darwin') {
    require('child_process').spawn('open', [view.url()], { stdio: 'ignore', detached: true }).unref();
  }
  process.on('SIGINT', () => { view.shutdown(); process.exit(0); });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.serve) {
    return serve(opts).catch((err) => {
      console.error(err.code === 'EADDRINUSE'
        ? `port ${opts.port} is busy -- pass --port N`
        : err.message);
      process.exit(1);
    });
  }

  const build = require(path.join(scenes, opts.scene));

  if (opts.animate) {
    console.error(`animating ${opts.scene} at ${opts.fps} fps -- Ctrl-C to stop`);
    try {
      framebuffer.info();
    } catch (err) {
      noFramebuffer(err);
    }
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
    try {
      fb = framebuffer.info();
    } catch (err) {
      noFramebuffer(err);
    }
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

#!/usr/bin/env node
'use strict';
// Run a game: on the Pi's CRT with a gamepad, or in a browser here.
//
//   node src/game.js --serve             # play it on this machine, no Pi
//   scripts/pi-run.sh src/game.js        # play it on the TV
//   node src/game.js --pad-test          # print what the gamepad actually sends
//   node src/game.js --list              # the shelf: every game and its manifest
//
// The frame loop is the same stage.js that draws scenes. A game is wrapped in a
// build(width, height, t) so the stage never learns what it is driving: each
// frame it advances the game by one fixed step, drains the sounds that step
// produced, and hands back a scene description. Audio rides the same clock --
// one block of samples per video frame -- which is why nothing has to be
// synchronised afterwards.

const fs = require('fs');
const path = require('path');

const games = path.join(__dirname, 'games');
const framebuffer = require('./framebuffer');
const shellLib = require('./shell');
const preview = require('./preview');
const stage = require('./gfx/stage');
const safearea = require('./gfx/safearea');
const input = require('./input');
const manifest = require('./manifest');
const joystick = require('./joystick');
const mixerLib = require('./audio/mixer');
const sfx = require('./audio/sfx');
const song = require('./audio/song');
const synth = require('./audio/synth');
const speaker = require('./audio/speaker');

function parseArgs(argv) {
  const opts = {
    game: null, fps: 30, serve: false, port: 7480, host: '127.0.0.1', open: true,
    device: null, pads: ['/dev/input/js0', '/dev/input/js1'], padTest: false,
    mute: false, seed: null, list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    switch (argv[i]) {
      case '--game': opts.game = value(); break;
      case '--fps': opts.fps = Number(value()); break;
      case '--serve': opts.serve = true; break;
      case '--port': opts.port = Number(value()); break;
      // Off the loopback, so a phone on the same wifi can play it -- and, with
      // the phone mirrored to a television, so can a room.
      case '--lan': opts.host = '0.0.0.0'; break;
      case '--host': opts.host = value(); break;
      case '--no-open': opts.open = false; break;
      case '--device': opts.device = value(); break;
      case '--pad': opts.pads = [value(), ...opts.pads.slice(1)]; break;
      case '--pad2': opts.pads = [opts.pads[0], value()]; break;
      case '--pad-test': opts.padTest = true; break;
      case '--list': opts.list = true; break;
      case '--mute': opts.mute = true; break;
      case '--seed': opts.seed = Number(value()); break;
      case '-h': case '--help': usage(0); break;
      default: usage(1, `unknown option: ${argv[i]}`);
    }
  }
  return opts;
}

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('usage: game.js [--serve] [--lan] [--port N] [--no-open] [--fps N] [--game name]');
  console.error('               [--pad /dev/input/js0] [--pad2 ...] [--pad-test] [--mute] [--seed N]');
  console.error('       game.js --list');
  console.error(`games: ${fs.readdirSync(games).map((f) => f.replace(/\.js$/, '')).join(', ')}`);
  process.exit(code);
}

// Everything audible, rendered once. Themes go through the same score pipeline
// play.js uses, then back to floats so the mixer can loop one under whatever is
// on screen. The names are what a game's music() returns.
const TRACKS = {
  attract: 'pong', links: 'links', voyage: 'rimward',
  // Border Patrol: the menu, the chase, and the dirt road and town after it.
  // See music() in src/games/border.js.
  patrol: 'patrol', chase: 'chase', refugio: 'refugio',
  // City of Angels: a title theme, one per region, and one shared by all three
  // bosses. See music() in src/games/angels.js for which plays when.
  angels: 'angels', skidrow: 'skidrow', venice: 'venice', hollywood: 'hollywood', showdown: 'showdown',
  // Meadowlark: the title theme and one per season. See music() in
  // src/games/meadowlark.js.
  meadow: 'meadow', sprout: 'sprout', haze: 'haze', gleaning: 'gleaning', hearth: 'hearth',
  // Tomo: the title, the hatching, the room, the pantry, the pastimes, and
  // one per minigame. See music() in src/games/tomo.js.
  tomo: 'tomo', hatch: 'hatch', nook: 'nook', pantry: 'pantry', study: 'study',
  juggle: 'juggle', orchard: 'orchard', echo: 'echo',
  // Kingpin: the title and daytime theme, the night theme, and what plays
  // once the heat is on. See music() in src/games/kingpin.js.
  vice: 'vice', neon: 'neon', dragnet: 'dragnet',
  // Timmy Tough Knuckles: the title, one per stage (the field and the courts
  // share one), and what plays under every boss. See music() in
  // src/games/knuckles.js.
  recess: 'recess', homeroom: 'homeroom', gymclass: 'gymclass', fieldday: 'fieldday',
  assembly: 'assembly', detention: 'detention',
  // Tallow: the title theme, and the two halves of a performance -- the mixer
  // has one bed, so a room warming up is a change of track rather than a layer
  // coming in. See music() in src/games/tallow.js.
  tallow: 'tallow', lamplight: 'lamplight', warmth: 'warmth',
};

function loadAudio(mute) {
  if (mute) return { sounds: {}, tracks: {} };
  const tracks = {};
  for (const [name, file] of Object.entries(TRACKS)) {
    tracks[name] = mixerLib.fromPcm(song.render(require(`./music/${file}`)).pcm);
  }
  return { sounds: sfx.all(), tracks };
}

// Wraps a game as a scene builder. The stage calls this once a frame and has no
// idea it isn't a scene.
function driver(game, { fps, pads, mixer, sounds, tracks, sink }) {
  const step = 1 / fps;
  let playing = null;
  let streaming = null;
  let owed = 0; // fractional samples, so a non-integer block size can't drift

  return () => {
    game.update(step, { p1: pads.p1.read(), p2: pads.p2.read() });

    for (const name of game.drain()) mixer.play(sounds[name]);

    // A game may bring its own instrument instead of naming a track. halcyon
    // does: audio/rack.js renders one block per video frame, so what plays is
    // decided in the same frame the picture is, and the parts can be switched
    // in and out of it while it runs. Everything else names a track and never
    // learns this exists.
    const source = game.stream ? game.stream() : null;
    if (source !== streaming) {
      streaming = source;
      mixer.live(source);
    }

    const wanted = source ? null : game.music();
    if (wanted !== playing) {
      playing = wanted;
      mixer.music(wanted ? tracks[wanted] ?? null : null);
    }

    if (sink) {
      const exact = synth.SAMPLE_RATE / fps + owed;
      const frames = Math.floor(exact);
      owed = exact - frames;
      sink(mixer.pull(frames));
    }

    return game.scene();
  };
}

// The shell, with an optional shortcut straight into one game.
function boot(opts, width, height) {
  const machine = shellLib.create(width, height, opts.seed === null ? {} : { seed: opts.seed });
  if (opts.game) machine.launch(opts.game);
  return machine;
}

// --- the Pi ------------------------------------------------------------------

function onPi(opts) {
  let fb;
  try {
    fb = framebuffer.info();
  } catch (err) {
    console.error('no framebuffer at /dev/fb0 -- is the composite output enabled and a TV connected?');
    console.error(`(${err.message})`);
    console.error('run with --serve to play it in a browser here instead.');
    process.exit(1);
  }

  const game = boot(opts, fb.width, fb.height);
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const sticks = opts.pads.map((device, i) => joystick.open({
    device,
    pad: i === 0 ? pads.p1 : pads.p2,
    // Pad 2 is optional -- most of the time there isn't one, and saying so once
    // a second would be noise.
    onError: i === 0 ? (err) => warnOnce(`pad 1 (${device}): ${err.code ?? err.message}`) : () => {},
  }));

  const audio = loadAudio(opts.mute);
  const mixer = mixerLib.create();
  const out = opts.mute ? null : speaker.open({ device: opts.device });
  if (!opts.mute && !out) console.error('no aplay found -- running silent');

  const build = driver(game, { fps: opts.fps, pads, mixer, ...audio, sink: out ? (b) => out.write(b) : null });

  console.error(`gamePi on ${fb.path} at ${opts.fps} fps -- Ctrl-C to stop`);
  stage.run(build, {
    fps: opts.fps,
    onStop: (reason, frames) => {
      for (const stick of sticks) stick.close();
      out?.close();
      console.error(`${reason} after ${frames} frames${out?.dropped ? `, ${out.dropped} audio blocks dropped` : ''}`);
    },
  });
}

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

// --- this machine ------------------------------------------------------------

async function serve(opts) {
  const [width, height] = [720, 480];
  const game = boot(opts, width, height);
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };

  const audio = loadAudio(opts.mute);
  const mixer = mixerLib.create();

  let show = null;
  const view = preview.open({
    port: opts.port,
    host: opts.host,
    width,
    height,
    clock: () => (show ? show.state().at : 0),
    // The shell's own state goes in first: `game` below must survive it, since
    // it is null at the selector and the page uses it to decide that this is a
    // machine rather than a scene.
    snapshot: () => ({
      ...game.state(),
      ...(show ? show.state() : { frame: 0, paused: false, at: 0, fps: opts.fps }),
      game: game.state().game ?? 'gamepi',
      scene: 'gamepi', scenes: ['gamepi'], moments: [],
      width, height, picture: safearea.picture(width, height),
      buttons: input.BUTTONS,
    }),
    // A game is driven by its pad, not by a scrubber: there is no frame to seek
    // back to, because the state that produced it is gone. Pause and resume are
    // the two that still mean something.
    onControl: (msg) => {
      if (!show) return {};
      switch (msg.action) {
        case 'play': show.resume(); break;
        case 'pause': show.pause(); break;
        default: throw new Error(`unknown action: ${msg.action}`);
      }
      return {};
    },
    onInput: (pad, button, down) => pads[pad]?.set(button, down) ?? false,
  });

  const build = driver(game, { fps: opts.fps, pads, mixer, ...audio, sink: (b) => view.writer.sound(b) });

  await view.listening;
  show = stage.run(build, { fps: opts.fps, writer: view.writer, report: false });

  console.error(`gamePi: ${view.url()}  (Ctrl-C to stop)`);
  for (const url of view.urls()) console.error(`        ${url}?play   on this network -- phone, touchscreen pad`);
  if (view.urls().length) console.error('        add ?pad to use a phone as the controller only, ?tv for a screen with no controls');
  if (opts.open && process.platform === 'darwin') {
    require('child_process').spawn('open', [view.url()], { stdio: 'ignore', detached: true }).unref();
  }
  process.on('SIGINT', () => { view.shutdown(); process.exit(0); });
}

// --- finding out what a pad sends -------------------------------------------

function padTest(opts) {
  const pad = new input.Pad('p1');
  const device = opts.pads[0];
  const stick = joystick.open({
    device,
    pad,
    onError: (err) => console.error(`${device}: ${err.code ?? err.message}`),
    onEvent: ({ kind, number, value, synthetic }) => {
      if (synthetic) return;
      const held = [...pad.held].join(' ') || '-';
      console.log(`${kind.padEnd(6)} ${String(number).padStart(2)}  value ${String(value).padStart(6)}   held: ${held}`);
    },
  });

  console.error(`reading ${device} (${stick.name ?? 'no name'}) as ${stick.profile} -- press things, Ctrl-C to stop.`);
  console.error(`buttons: ${JSON.stringify(stick.map.buttons)}`);
  console.error(`if START and SELECT are on the wrong buttons, try the other profile:`);
  console.error(`  GAMEPI_PAD_PROFILE=${stick.profile === 'xpad' ? 'dinput' : 'xpad'} node src/game.js`);
  console.error('or move one button at a time with');
  console.error(`  GAMEPI_PAD_MAP='${JSON.stringify({ buttons: { 4: 'start' } })}' node src/game.js\n`);
}

// --- the shelf ---------------------------------------------------------------
//
// What the selector knows about each game, in a form you can read without a
// television. Every line comes from the game's own `meta` (see src/manifest.js).
function listGames() {
  const catalogue = shellLib.list();
  const width = Math.max(...catalogue.map((entry) => entry.title.length));
  for (const entry of catalogue) {
    console.log(`${entry.id.padEnd(12)}${entry.title.padEnd(width + 2)}${manifest.summary(entry.meta)}`);
    const why = entry.meta.content.join(', ');
    console.log(`${''.padEnd(12)}${entry.blurb}${why ? `  --  ${why}` : ''}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.game && !fs.existsSync(path.join(games, `${opts.game}.js`))) usage(1, `unknown game: ${opts.game}`);

  if (opts.list) return listGames();
  if (opts.padTest) return padTest(opts);
  if (opts.serve) {
    return serve(opts).catch((err) => {
      console.error(err.code === 'EADDRINUSE' ? `port ${opts.port} is busy -- pass --port N` : err.message);
      process.exit(1);
    });
  }
  return onPi(opts);
}

main();

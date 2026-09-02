#!/usr/bin/env node
'use strict';
// Render a score and play it, or write it to a WAV.
//
//   node src/play.js                       # play twice through
//   node src/play.js --loops 0             # loop until Ctrl-C
//   node src/play.js --wav emberfall.wav   # write a file instead
//   node src/play.js --bpm 160 --track emberfall
//
// On the Pi this pipes S16_LE stereo into aplay, which lands on the bcm2835
// Headphones card -- the analogue side of the same 3.5 mm jack carrying video.
// On macOS it falls back to writing a temp WAV and handing it to afplay.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const song = require('./audio/song');
const synth = require('./audio/synth');

function parseArgs(argv) {
  const opts = { track: 'emberfall', loops: 2, bpm: null, wav: null, device: null, info: false };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    switch (argv[i]) {
      case '--track': opts.track = value(); break;
      case '--loops': opts.loops = Number(value()); break;
      case '--bpm': opts.bpm = Number(value()); break;
      case '--wav': opts.wav = value(); break;
      case '--device': opts.device = value(); break;
      case '--info': opts.info = true; break;
      case '-h': case '--help': usage(0); break;
      default: usage(1, `unknown option: ${argv[i]}`);
    }
  }
  return opts;
}

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('usage: play.js [--track name] [--loops N (0 = forever)] [--bpm N]');
  console.error('               [--wav file] [--device alsa-device] [--info]');
  console.error(`tracks: ${fs.readdirSync(path.join(__dirname, 'music')).map((f) => f.replace(/\.js$/, '')).join(', ')}`);
  process.exit(code);
}

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const score = require(path.join(__dirname, 'music', opts.track));

  const t0 = Date.now();
  const { pcm, duration, bars, notes, bpm } = song.render(score, { bpm: opts.bpm || score.bpm });
  console.error(
    `${score.title}: ${bars} bars, ${notes} notes, ${duration.toFixed(1)}s at ${bpm} bpm ` +
    `(rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );

  if (opts.info) return;

  if (opts.wav) {
    fs.writeFileSync(opts.wav, Buffer.concat([synth.wavHeader(pcm.length), pcm]));
    console.error(`wrote ${opts.wav} (${(pcm.length / 1e6).toFixed(1)} MB)`);
    return;
  }

  if (has('aplay')) {
    const args = ['-q', '-f', 'S16_LE', '-c', '2', '-r', String(synth.SAMPLE_RATE)];
    if (opts.device) args.push('-D', opts.device);
    play(spawn('aplay', [...args, '-'], { stdio: ['pipe', 'inherit', 'inherit'] }), pcm, opts.loops);
  } else if (has('afplay')) {
    // No streaming stdin on afplay, so render the loops to a temp file.
    const file = path.join(os.tmpdir(), `${score.title.toLowerCase()}-${process.pid}.wav`);
    const body = Buffer.concat(Array.from({ length: Math.max(1, opts.loops) }, () => pcm));
    fs.writeFileSync(file, Buffer.concat([synth.wavHeader(body.length), body]));
    const child = spawn('afplay', [file], { stdio: 'inherit' });
    child.on('exit', () => fs.unlinkSync(file));
  } else {
    console.error('no aplay or afplay found -- use --wav to write a file instead');
    process.exit(1);
  }
}

// Writes the loop into the player's stdin one pass at a time, respecting
// backpressure, so we never buffer the whole playback in memory.
function play(child, pcm, loops) {
  let played = 0;
  const pump = () => {
    while (loops === 0 || played < loops) {
      played++;
      if (!child.stdin.write(pcm)) {
        child.stdin.once('drain', pump);
        return;
      }
    }
    child.stdin.end();
  };
  child.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
  });
  process.on('SIGINT', () => { child.kill('SIGTERM'); process.exit(0); });
  pump();
}

main();

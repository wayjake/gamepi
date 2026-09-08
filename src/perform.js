#!/usr/bin/env node
'use strict';
// Render a piece: to a file, to the speakers, or to eight files.
//
//   node src/perform.js --info                        # the arrangement, on paper
//   node src/perform.js --from 3:20 --for 40          # audition one section
//   node src/perform.js --wav sundial.wav             # the whole ten minutes
//   node src/perform.js --mp3 sundial.mp3
//   node src/perform.js --stems out/                  # one file per part
//   node src/perform.js --without beat,arp            # the ambient mix
//   node src/perform.js --bench                       # can the Pi keep up?
//
// play.js is the same idea for a score: render, then hand it to aplay or
// afplay. The difference is that a piece is rendered live rather than in one
// go, block by block through audio/rack.js, exactly as the game plays it -- so
// what comes out of this file is sample for sample what comes out of the
// television, and a bug you can hear here is a bug there.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const tone = require('./audio/tone');
const synth = require('./audio/synth');
const pieceLib = require('./audio/piece');
const rackLib = require('./audio/rack');

const PIECES = path.join(__dirname, 'music', 'pieces');
const RATE = tone.SAMPLE_RATE;
const BLOCK = 1470; // one video frame at 30 fps, which is how the game asks

// "3:20", "200", "3m" -> seconds
function seconds(text) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(text));
  if (!m) throw new Error(`not a time: ${text}`);
  return (Number(m[1] ?? 0) * 60) + Number(m[2]);
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function parseArgs(argv) {
  const opts = {
    piece: 'sundial', from: 0, span: null, wav: null, mp3: null, stems: null,
    only: null, without: null, info: false, bench: false, device: null, fps: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    switch (argv[i]) {
      case '--piece': opts.piece = value(); break;
      case '--from': opts.from = seconds(value()); break;
      case '--for': case '--dur': opts.span = seconds(value()); break;
      case '--wav': opts.wav = value(); break;
      case '--mp3': opts.mp3 = value(); break;
      case '--stems': opts.stems = value(); break;
      case '--only': opts.only = value().split(','); break;
      case '--without': opts.without = value().split(','); break;
      case '--info': opts.info = true; break;
      case '--bench': opts.bench = true; break;
      case '--device': opts.device = value(); break;
      case '--fps': opts.fps = Number(value()); break;
      case '-h': case '--help': usage(0); break;
      default: usage(1, `unknown option: ${argv[i]}`);
    }
  }
  return opts;
}

function usage(code, msg) {
  if (msg) console.error(msg);
  console.error('usage: perform.js [--piece name] [--from m:ss] [--for secs]');
  console.error('                  [--wav file] [--mp3 file] [--stems dir]');
  console.error('                  [--only pad,bass] [--without beat] [--info] [--bench]');
  console.error(`pieces: ${fs.readdirSync(PIECES).map((f) => f.replace(/\.js$/, '')).join(', ')}`);
  process.exit(code);
}

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

// --- the arrangement, written out --------------------------------------------

function describe(piece) {
  console.log(`${piece.title} -- ${piece.subtitle ?? ''}`);
  console.log(`${clock(piece.duration)}, ${piece.timeline.bars.length} bars, ${piece.key} ${piece.mode}`);
  console.log('');
  for (const movement of piece.movements) {
    console.log(`${movement.name}   ${movement.bpm} bpm   ${clock(movement.start)} - ${clock(movement.end)}`);
    let at = movement.start;
    for (const section of movement.sections) {
      const length = (section.bars * 4 * 60) / movement.bpm;
      const parts = pieceLib.STEMS.filter((s) => section.parts[s]);
      console.log(
        `  ${clock(at).padStart(5)}  ${(section.name ?? '').padEnd(20)}` +
        `${String(section.bars).padStart(3)} bars  ${section.chords.join(' ').padEnd(28)}  ${parts.join(' ')}`
      );
      at += length;
    }
    console.log('');
  }
  let notes = 0;
  const perStem = {};
  for (let i = 0; i < piece.timeline.bars.length; i++) {
    for (const event of pieceLib.barEvents(piece, i)) {
      notes++;
      perStem[event.stem] = (perStem[event.stem] ?? 0) + 1;
    }
  }
  console.log(`${notes} notes: ${Object.entries(perStem).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// --- rendering ---------------------------------------------------------------

// Runs the rack exactly as game.js does -- advance one frame, pull one block --
// and returns interleaved S16_LE.
function render(piece, opts, { levels = null, onFrame = null } = {}) {
  const rig = rackLib.open(piece, { seed: piece.seed, fps: opts.fps });
  if (levels) for (const [name, level] of Object.entries(levels)) rig.set(name, level);
  if (opts.from) rig.seek(opts.from);

  const from = opts.from;
  const until = Math.min(piece.duration, opts.span ? from + opts.span : piece.duration);
  const tail = 3; // let the room and the echo finish rather than cutting them
  const frames = Math.ceil(((until - from) + tail) * opts.fps);
  const step = 1 / opts.fps;

  const out = Buffer.alloc(frames * BLOCK * 4);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  let cursor = 0;
  let peak = 0;
  let sum = 0;

  for (let f = 0; f < frames; f++) {
    rig.advance(step);
    left.fill(0);
    right.fill(0);
    rig.pull(left, right, BLOCK);
    if (onFrame) onFrame(rig, f);
    for (let i = 0; i < BLOCK; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      sum += l * l + r * r;
      out.writeInt16LE(Math.round(l * 32767), cursor);
      out.writeInt16LE(Math.round(r * 32767), cursor + 2);
      cursor += 4;
    }
  }

  const samples = frames * BLOCK * 2;
  return { pcm: out, peak, rms: Math.sqrt(sum / samples), seconds: (until - from) + tail };
}

// Which faders to open, from --only / --without.
function faders(piece, opts) {
  const levels = {};
  for (const stem of piece.stems) {
    const on = (!opts.only || opts.only.includes(stem)) && (!opts.without || !opts.without.includes(stem));
    levels[stem] = on ? 1 : 0;
  }
  return levels;
}

function writeWav(file, pcm) {
  fs.writeFileSync(file, Buffer.concat([synth.wavHeader(pcm.length), pcm]));
  return fs.statSync(file).size;
}

function writeMp3(file, wav, piece) {
  const encoder = has('lame')
    ? { cmd: 'lame', args: ['-V2', '--quiet', '--tt', piece.title, '--ta', 'gamePi', '--tl', 'HALCYON', '-', file] }
    : has('ffmpeg')
      ? { cmd: 'ffmpeg', args: ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-q:a', '2',
          '-metadata', `title=${piece.title}`, '-metadata', 'artist=gamePi', '-metadata', 'album=HALCYON', file] }
      : null;
  if (!encoder) {
    console.error('no mp3 encoder found. install one (brew install lame) or use --wav.');
    process.exit(1);
  }
  const result = spawnSync(encoder.cmd, encoder.args, { input: wav, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) {
    console.error(`${encoder.cmd} exited with ${result.status}`);
    process.exit(1);
  }
  console.error(`wrote ${file} via ${encoder.cmd} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const file = path.join(PIECES, `${opts.piece}.js`);
  if (!fs.existsSync(file)) usage(1, `unknown piece: ${opts.piece}`);
  const piece = pieceLib.load(require(file));

  if (opts.info) return describe(piece);

  // --bench answers the only question that matters on the Pi: is one video
  // frame of this cheaper than one video frame? Reported as a multiple of real
  // time, so 8x here means about 2x on a Pi 4 and the answer is yes.
  if (opts.bench) {
    const span = { ...opts, span: opts.span ?? 20 };
    const t0 = Date.now();
    const { peak, rms } = render(piece, span, { levels: faders(piece, opts) });
    const wall = (Date.now() - t0) / 1000;
    const audio = span.span + 3;
    console.log(`${piece.title}: ${audio.toFixed(0)}s of audio in ${wall.toFixed(2)}s -- ${(audio / wall).toFixed(1)}x real time`);
    console.log(`per frame: ${((wall / (audio * opts.fps)) * 1000).toFixed(2)} ms of a ${(1000 / opts.fps).toFixed(1)} ms budget`);
    console.log(`peak ${peak.toFixed(3)}, rms ${rms.toFixed(3)}`);
    return;
  }

  // One file per stem, for anybody who wants to take this into a real desk.
  if (opts.stems) {
    fs.mkdirSync(opts.stems, { recursive: true });
    for (const stem of piece.stems) {
      const levels = {};
      for (const name of piece.stems) levels[name] = name === stem ? 1 : 0;
      const { pcm, peak } = render(piece, opts, { levels });
      const out = path.join(opts.stems, `${piece.title.toLowerCase()}-${stem}.wav`);
      const size = writeWav(out, pcm);
      console.error(`${out}  peak ${peak.toFixed(2)}  ${(size / 1e6).toFixed(1)} MB`);
    }
    return;
  }

  const t0 = Date.now();
  const { pcm, peak, rms, seconds: length } = render(piece, opts, { levels: faders(piece, opts) });
  console.error(
    `${piece.title}: ${clock(length)} rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
    `-- peak ${peak.toFixed(3)}, rms ${rms.toFixed(3)}`
  );

  if (opts.mp3) return writeMp3(opts.mp3, Buffer.concat([synth.wavHeader(pcm.length), pcm]), piece);
  if (opts.wav) {
    const size = writeWav(opts.wav, pcm);
    console.error(`wrote ${opts.wav} (${(size / 1e6).toFixed(1)} MB)`);
    return;
  }

  if (has('aplay')) {
    const args = ['-q', '-f', 'S16_LE', '-c', '2', '-r', String(RATE)];
    if (opts.device) args.push('-D', opts.device);
    const child = spawn('aplay', [...args, '-'], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
    child.stdin.end(pcm);
    process.on('SIGINT', () => { child.kill('SIGTERM'); process.exit(0); });
  } else if (has('afplay')) {
    const temp = path.join(os.tmpdir(), `${piece.title.toLowerCase()}-${process.pid}.wav`);
    writeWav(temp, pcm);
    const child = spawn('afplay', [temp], { stdio: 'inherit' });
    child.on('exit', () => fs.unlinkSync(temp));
    process.on('SIGINT', () => { child.kill('SIGTERM'); });
  } else {
    console.error('no aplay or afplay found -- use --wav to write a file instead');
    process.exit(1);
  }
}

main();

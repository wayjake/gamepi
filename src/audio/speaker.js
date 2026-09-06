'use strict';
// Streams the mixer's blocks to ALSA on the Pi.
//
// play.js renders a whole track and hands it over; a game can't, because what
// happens next hasn't been decided yet. So this holds one aplay open and feeds
// it a block per video frame, which also means the two share a clock -- audio
// is produced by the same loop that draws, at exactly one block per frame.
//
// aplay applies backpressure when it can't keep up. Queueing behind that just
// converts a shortfall into ever-growing latency, so past a threshold blocks
// are dropped instead: a click now beats a soundtrack that drifts a second
// behind the picture and stays there. It is the same choice stage.js makes
// when it reports lateness rather than trying to catch up.

const { spawn, spawnSync } = require('child_process');
const synth = require('./synth');

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

// About a third of a second of slack before we start dropping.
const MAX_QUEUED = synth.SAMPLE_RATE / 3 * 4;

function open({ device = null, prime = 0.15 } = {}) {
  if (!has('aplay')) return null;

  const args = ['-q', '-f', 'S16_LE', '-c', '2', '-r', String(synth.SAMPLE_RATE)];
  if (device) args.push('-D', device);
  const child = spawn('aplay', [...args, '-'], { stdio: ['pipe', 'inherit', 'inherit'] });

  let dropped = 0;
  child.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
  });

  // A little silence up front. Without it the first blocks arrive one frame at
  // a time into an empty buffer and ALSA underruns before the game has drawn
  // its second frame.
  if (prime > 0) child.stdin.write(Buffer.alloc(Math.round(prime * synth.SAMPLE_RATE) * 4));

  return {
    kind: 'aplay',
    write(block) {
      if (child.stdin.destroyed) return false;
      if (child.stdin.writableLength > MAX_QUEUED) { dropped++; return false; }
      child.stdin.write(block);
      return true;
    },
    get dropped() { return dropped; },
    close() {
      child.stdin.end();
      child.kill('SIGTERM');
    },
  };
}

module.exports = { open, MAX_QUEUED };

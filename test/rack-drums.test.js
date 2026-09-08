'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pieceLib = require('../src/audio/piece');
const rackLib = require('../src/audio/rack');
const { SAMPLE_RATE } = require('../src/audio/tone');

const BLOCK = 1470;
const piece = pieceLib.load({
  title: 'KIT TEST', key: 'C', mode: 'ionian', seed: 4871,
  movements: [80, 90, 70].map((bpm) => ({
    name: 'KIT', bpm,
    sections: [{ bars: 4, chords: ['C'], parts: {
      beat: { pattern: 'kit', steps: ['----------------'] },
    } }],
  })),
});

// Schedule isolated hits through the public rack, including its bus and tape.
function render(events, seed = 4871) {
  const rig = rackLib.open(piece, { seed, space: 0, tape: 0 });
  const samples = new Float32Array(SAMPLE_RATE * 2);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  for (let f = 0; f < 60; f++) {
    const start = rig.at;
    rig.advance(1 / 30);
    for (const event of events) {
      if (event.at >= start && event.at < rig.at) {
        rig.due.push({ stem: 'beat', vel: 0.8, tone: 0.5, ...event });
      }
    }
    left.fill(0);
    right.fill(0);
    rig.pull(left, right, BLOCK);
    for (let i = 0; i < BLOCK; i++) samples[f * BLOCK + i] = (left[i] + right[i]) * 0.5;
  }
  return samples;
}

function energy(samples, from, to) {
  let sum = 0;
  for (let i = Math.round(from * SAMPLE_RATE); i < Math.round(to * SAMPLE_RATE); i++) sum += samples[i] ** 2;
  return sum;
}

function brightness(samples) {
  let difference = 0;
  let sum = 0;
  for (let i = 1; i < samples.length; i++) {
    difference += (samples[i] - samples[i - 1]) ** 2;
    sum += samples[i] ** 2;
  }
  return difference / sum;
}

test('each drum has a finite attack and decays to silence', () => {
  for (const voice of ['K', 'S', 't', 'h', 'H', 'r', 'p', 'c']) {
    const samples = render([{ voice, at: 0.1 }]);
    let peak = 0;
    for (const sample of samples) {
      assert.ok(Number.isFinite(sample), `${voice}: non-finite sample`);
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(peak > 0.015 && peak < 0.9, `${voice}: peak ${peak}`);
    assert.ok(energy(samples, 1.7, 2) < energy(samples, 0.1, 0.4) * 0.0001,
      `${voice}: ringing after the hit has finished`);
  }
});

test('drum openness and velocity change timbre as well as volume', () => {
  const hit = { voice: 'S', at: 0.1 };
  const dark = render([{ ...hit, tone: 0.1 }]);
  const open = render([{ ...hit, tone: 0.9 }]);
  assert.ok(brightness(open) > brightness(dark) * 1.1, 'openness has no audible spectral effect');
  const soft = render([{ ...hit, vel: 0.3 }]);
  const hard = render([{ ...hit, vel: 0.9 }]);
  assert.ok(energy(hard, 0.1, 0.4) > energy(soft, 0.1, 0.4) * 3, 'accents lost their dynamics');
  assert.ok(brightness(hard) > brightness(soft) * 1.05, 'velocity only changes the volume');
});

test('closing a hat chokes its open tail only after the closing hit', () => {
  const open = { voice: 'H', at: 0.1 };
  const ringing = render([open]);
  // Both onsets fall inside the same block, exercising the sample offsets.
  const closed = render([open, { voice: 'h', at: 0.12 }]);
  const beforeClose = Math.floor(0.12 * SAMPLE_RATE);
  assert.deepEqual(closed.subarray(0, beforeClose), ringing.subarray(0, beforeClose));
  assert.ok(energy(closed, 0.25, 0.5) < energy(ringing, 0.25, 0.5) * 0.08,
    'the open hat continues under the closed hat');
});

test('drum variation remains repeatable for a fixed seed', () => {
  const hits = ['K', 'h', 'S', 'H', 'r', 'h'].map((voice, i) => ({ voice, at: 0.1 + i * 0.15 }));
  const first = render(hits);
  assert.deepEqual(first, render(hits));
  assert.notDeepEqual(first, render(hits, 9281));
});

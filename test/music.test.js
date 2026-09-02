'use strict';
// Renders each score and checks that the pitches coming out of the synth are
// the ones the score asked for.
//
// This guards the pipeline -- note name to frequency to oscillator to mix --
// not the music. A wrong note in a score is still a wrong note here, because
// the expected pitch is read from that same score; only ears catch those.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const song = require('../src/audio/song');
const synth = require('../src/audio/synth');

const MUSIC = path.join(__dirname, '..', 'src', 'music');
const tracks = fs.readdirSync(MUSIC).filter((f) => f.endsWith('.js'));

// Normalised autocorrelation with two corrections that square waves need:
// an octave check (plain autocorrelation peaks just as hard at multiples of
// the period, reporting subharmonics), and parabolic interpolation around the
// winning lag (integer lags alone are ~35 cents coarse up at D6).
function detectPitch(samples, rate, minHz = 200, maxHz = 1600) {
  const minLag = Math.floor(rate / maxHz);
  const maxLag = Math.ceil(rate / minHz);

  const r = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i + lag < samples.length; i++) {
      sum += samples[i] * samples[i + lag];
      energyA += samples[i] * samples[i];
      energyB += samples[i + lag] * samples[i + lag];
    }
    r.push(sum / (Math.sqrt(energyA * energyB) || 1));
  }

  let peak = r.indexOf(Math.max(...r));
  for (const divisor of [4, 3, 2]) {
    const candidate = Math.round((peak + minLag) / divisor) - minLag;
    if (candidate >= 0 && r[candidate] >= r[peak] * 0.85) { peak = candidate; break; }
  }

  // Parabolic fit through the peak and its neighbours.
  let offset = 0;
  if (peak > 0 && peak < r.length - 1) {
    const [a, b, c] = [r[peak - 1], r[peak], r[peak + 1]];
    const denom = a - 2 * b + c;
    if (denom !== 0) offset = (0.5 * (a - c)) / denom;
  }
  return rate / (minLag + peak + offset);
}

for (const file of tracks) {
  const score = require(path.join(MUSIC, file));

  test(`${score.title}: score is well formed`, () => {
    assert.ok(song.validate(score) > 0);
  });

  test(`${score.title}: rendered lead matches the written pitches`, () => {
    const { events, duration } = song.schedule(score, score.bpm);
    const lead = events.filter((e) => e.vibrato); // only the lead carries vibrato
    assert.ok(lead.length > 0, 'no lead notes scheduled');

    // Render the lead alone so nothing else muddies the pitch detection.
    const frames = Math.ceil((duration + 0.25) * synth.SAMPLE_RATE);
    const inner = {
      left: new Float32Array(frames * synth.OVERSAMPLE),
      right: new Float32Array(frames * synth.OVERSAMPLE),
    };
    for (const e of lead) synth.renderNote(inner, { ...e, pan: 0, vibrato: null });
    const mix = synth.downsample(inner, frames);

    for (const note of lead) {
      const at = Math.floor((note.start + 0.03) * synth.SAMPLE_RATE);
      const window = mix.left.subarray(at, at + 2048);
      const detected = detectPitch(window, synth.SAMPLE_RATE);
      const cents = 1200 * Math.log2(detected / note.freq);
      assert.ok(
        Math.abs(cents) < 30,
        `note at ${note.start.toFixed(2)}s: wrote ${note.freq.toFixed(1)} Hz, heard ${detected.toFixed(1)} Hz (${cents.toFixed(0)} cents off)`
      );
    }
  });

  test(`${score.title}: mix is loud but never clips`, () => {
    const { pcm } = song.render(score);
    let peak = 0;
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const v = Math.abs(pcm.readInt16LE(i)) / 32767;
      peak = Math.max(peak, v);
      energy += v * v;
    }
    const rms = Math.sqrt(energy / (pcm.length / 2));
    assert.ok(peak > 0.7 && peak <= 1, `peak ${peak.toFixed(3)} outside 0.7..1`);
    assert.ok(rms > 0.05, `mix is too quiet: rms ${rms.toFixed(3)}`);
  });
}

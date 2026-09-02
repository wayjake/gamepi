'use strict';
// A small NES-flavoured synthesiser: two pulse channels, a quantised triangle,
// and an LFSR noise channel. Everything is rendered at OVERSAMPLE x the output
// rate and averaged down -- raw square waves at 44.1 kHz alias badly on high
// notes, and the real hardware had an analogue filter doing much the same job.

const SAMPLE_RATE = 44100;
const OVERSAMPLE = 4;
const INNER_RATE = SAMPLE_RATE * OVERSAMPLE;

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "A4" -> 440, "Bb3" -> 233.08, "C#5" -> 554.37
function noteToFreq(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const [, letter, accidental, octave] = m;
  const semitone = SEMITONES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return 440 * 2 ** ((semitone - 9) / 12 + (Number(octave) - 4));
}

const pulse = (phase, duty) => (phase % 1 < duty ? 1 : -1);

// The NES triangle steps through 16 levels; that stair-stepping is a big part
// of why its bass sounds the way it does, so keep it rather than using a real
// triangle wave.
function triangle(phase) {
  const t = phase % 1;
  const ramp = t < 0.5 ? t * 2 : 2 - t * 2; // 0..1..0
  return (Math.floor(ramp * 15.999) / 7.5) - 1;
}

// 15-bit LFSR, as on the NES. `short` taps bit 6 instead of bit 1, giving the
// metallic tone the hardware used for some percussion.
class Noise {
  constructor(short = false) {
    this.reg = 1;
    this.tap = short ? 6 : 1;
    this.level = 1;
  }
  step() {
    const feedback = (this.reg & 1) ^ ((this.reg >> this.tap) & 1);
    this.reg = (this.reg >> 1) | (feedback << 14);
    this.level = this.reg & 1 ? 1 : -1;
    return this.level;
  }
}

// Linear ADSR. `gate` is how long the key is held; the release tail runs past
// it, which is why voices are rendered with a little slack after their note.
// Release always starts from the level the envelope had actually reached at
// the gate -- percussion is gated part-way down its decay, and releasing from
// `sustain` instead would chop the tail off.
function envelope(env, t, gate) {
  const { attack = 0.005, decay = 0.05, sustain = 0.7, release = 0.06 } = env;
  if (t < 0) return 0;

  const level = (x) => {
    if (x < attack) return x / attack;
    if (x < attack + decay) return 1 - (1 - sustain) * ((x - attack) / decay);
    return sustain;
  };

  if (t < gate) return level(t);
  const r = (t - gate) / release;
  return r >= 1 ? 0 : level(gate) * (1 - r);
}

// Renders one note into an oversampled stereo pair of Float32Arrays.
function renderNote(out, opts) {
  const {
    freq, start, duration, gate = duration * 0.9,
    wave = 'pulse', duty = 0.5, volume = 0.25, pan = 0,
    env = {}, vibrato = null,
  } = opts;

  const first = Math.floor(start * INNER_RATE);
  const last = Math.min(out.left.length, Math.ceil((start + duration + (env.release ?? 0.06)) * INNER_RATE));
  const gainL = volume * Math.min(1, 1 - pan);
  const gainR = volume * Math.min(1, 1 + pan);

  const noise = wave === 'noise' ? new Noise(opts.short) : null;
  let phase = 0;
  let noiseAcc = 0;
  const noiseStep = freq / INNER_RATE;

  for (let i = first; i < last; i++) {
    const t = i / INNER_RATE - start;
    const amp = envelope(env, t, gate);
    if (amp <= 0) continue;

    let sample;
    if (noise) {
      noiseAcc += noiseStep;
      while (noiseAcc >= 1) { noise.step(); noiseAcc -= 1; }
      sample = noise.level;
    } else {
      let f = freq;
      if (vibrato && t > vibrato.delay) {
        f *= 1 + vibrato.depth * Math.sin(2 * Math.PI * vibrato.rate * (t - vibrato.delay));
      }
      phase += f / INNER_RATE;
      sample = wave === 'triangle' ? triangle(phase) : pulse(phase, duty);
    }

    out.left[i] += sample * amp * gainL;
    out.right[i] += sample * amp * gainR;
  }
}

// Averages the oversampled buffers down to SAMPLE_RATE.
function downsample(inner, frames) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let l = 0;
    let r = 0;
    for (let k = 0; k < OVERSAMPLE; k++) {
      l += inner.left[i * OVERSAMPLE + k];
      r += inner.right[i * OVERSAMPLE + k];
    }
    left[i] = l / OVERSAMPLE;
    right[i] = r / OVERSAMPLE;
  }
  return { left, right };
}

// Scales the mix so its loudest sample sits at `peak`, then packs to S16_LE.
function toPcm(mix, peak = 0.8) {
  let loudest = 0;
  for (let i = 0; i < mix.left.length; i++) {
    loudest = Math.max(loudest, Math.abs(mix.left[i]), Math.abs(mix.right[i]));
  }
  const gain = loudest > 0 ? peak / loudest : 1;

  const buf = Buffer.alloc(mix.left.length * 4);
  for (let i = 0; i < mix.left.length; i++) {
    const l = Math.round(Math.max(-1, Math.min(1, mix.left[i] * gain)) * 32767);
    const r = Math.round(Math.max(-1, Math.min(1, mix.right[i] * gain)) * 32767);
    buf.writeInt16LE(l, i * 4);
    buf.writeInt16LE(r, i * 4 + 2);
  }
  return buf;
}

function wavHeader(pcmBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcmBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);      // fmt chunk size
  h.writeUInt16LE(1, 20);       // PCM
  h.writeUInt16LE(2, 22);       // stereo
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 4, 28); // byte rate
  h.writeUInt16LE(4, 32);       // block align
  h.writeUInt16LE(16, 34);      // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(pcmBytes, 40);
  return h;
}

module.exports = {
  SAMPLE_RATE, OVERSAMPLE, INNER_RATE,
  noteToFreq, renderNote, downsample, toPcm, wavHeader,
};

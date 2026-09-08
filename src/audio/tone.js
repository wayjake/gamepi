'use strict';
// The analogue half of the sound.
//
// audio/synth.js is the console's own voice: two pulses, a stepped triangle and
// an LFSR, no filter, everything hard-edged on purpose. It is right for a game
// that wants to sound like a cartridge and wrong for a record. This file is the
// other instrument -- band-limited oscillators, a resonant filter, and the
// delay lines that space and movement are built out of.
//
// Three rules hold the whole file together:
//
//  - **Nothing allocates in a block.** Every object here owns its buffers from
//    construction, the same rule framebuffer.open() and scene3d.target() work
//    to. A ten minute piece is eighteen thousand blocks; a Float32Array per
//    block is eighteen thousand collections.
//  - **Coefficients move at control rate, samples move at sample rate.** A
//    filter sweep recomputed per sample spends more time in Math.tan than in
//    the filter. CONTROL is 32 samples -- 0.73 ms, far below anything an ear
//    hears as a step, and thirty-two times less trigonometry.
//  - **Noise is seeded.** Same rule as every scene: hiss, grain and the drums'
//    snare all come out of Rng, so a piece rendered twice is the same file
//    twice. Math.random would make the WAV unreproducible and the tests
//    meaningless.

const SAMPLE_RATE = 44100;
const CONTROL = 32; // samples between coefficient updates

// --- numbers ----------------------------------------------------------------

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, k) => a + (b - a) * k;

// MIDI note to hertz. 69 is A4. Melodies here are written in scale degrees and
// resolved to MIDI numbers, so this is the only place pitch becomes frequency.
const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);

// A Padé approximation of tanh, accurate to about 0.2% over the range a mix
// reaches and roughly ten times faster. It is used per sample on every stem, so
// the real thing is not affordable; it also flattens out past |x| ~ 3 instead
// of asymptoting, which is a nicer saturation curve than the real one anyway.
function softclip(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// xorshift32. Small, fast, and good enough for noise -- the ear cannot hear the
// difference between this and a Mersenne twister, and one of them costs nothing.
class Rng {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  // -1..1, which is what a noise generator actually wants.
  bipolar() {
    return this.next() * 2 - 1;
  }
  range(lo, hi) {
    return lo + this.next() * (hi - lo);
  }
  int(n) {
    return Math.floor(this.next() * n) % n;
  }
  pick(list) {
    return list[this.int(list.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

// --- oscillators -------------------------------------------------------------
//
// A naive sawtooth at 44.1 kHz folds every harmonic above Nyquist back down the
// spectrum, and on a sustained chord that is not subtle -- it is the metallic
// ring that makes cheap software synths sound cheap. PolyBLEP fixes it for a
// fraction of the cost of oversampling: the discontinuity at the wrap is
// smeared over one sample either side with the polynomial that a band-limited
// step would have had there. It is not perfect above about 5 kHz and it does
// not have to be; nothing here plays a saw that high.

function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

const sawAt = (phase, dt) => 2 * phase - 1 - polyBlep(phase, dt);

function pulseAt(phase, dt, width) {
  // Two saws a width apart. Both edges need correcting or the narrow settings
  // alias worse than the plain saw did.
  const other = phase + (1 - width);
  const wrapped = other >= 1 ? other - 1 : other;
  return sawAt(phase, dt) - sawAt(wrapped, dt) + (2 * width - 1);
}

// Naive is fine here: a triangle's harmonics fall off as 1/n^2, so what folds
// back is 30 dB down and buried. It is also the shape most of the warmth in
// this palette comes from, so it gets used a lot and wants to be cheap.
function triAt(phase) {
  const t = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return t * 2 - 1;
}

const sinAt = (phase) => Math.sin(phase * TAU);

// --- filters -----------------------------------------------------------------

// Topology-preserving-transform state variable filter (Zavalishin). Chosen over
// the usual Chamberlin SVF because it stays stable with the cutoff swept right
// up to Nyquist, which is exactly what a filter envelope does, and because all
// three outputs come out of one pass.
class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 0;
    this.lp = 0; this.bp = 0; this.hp = 0;
  }
  set(cutoffHz, q, rate = SAMPLE_RATE) {
    const fc = clamp(cutoffHz, 12, rate * 0.47);
    const g = Math.tan((Math.PI * fc) / rate);
    const k = 1 / clamp(q, 0.4, 12);
    const a1 = 1 / (1 + g * (g + k));
    this.k = k;
    this.a1 = a1;
    this.a2 = g * a1;
    this.a3 = g * this.a2;
  }
  step(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
    return v2;
  }
  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }
}

// One pole, for the places a 12 dB slope is more than the job needs: damping in
// a reverb tail, taking the fizz off a delay repeat, smoothing a control value.
class OnePole {
  constructor(coefficient = 0.5) {
    this.a = coefficient;
    this.z = 0;
  }
  set(cutoffHz, rate = SAMPLE_RATE) {
    this.a = 1 - Math.exp((-TAU * clamp(cutoffHz, 1, rate * 0.49)) / rate);
  }
  step(x) {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  reset(value = 0) {
    this.z = value;
  }
}

// --- envelopes ---------------------------------------------------------------

// ADSR with exponential segments, stepped one sample at a time.
//
// Linear attacks click and linear decays sound synthetic; every analogue
// envelope is a capacitor charging towards a rail, and the difference is
// audible on a soft pad in a way it is not on a square-wave blip. Each segment
// is a one-pole approach to a target, with the coefficient chosen so that the
// segment gets 99% of the way there in the time asked for.
class Adsr {
  constructor() {
    this.value = 0;
    this.stage = 0; // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
    this.sustain = 0.7;
    this.ka = 0; this.kd = 0; this.kr = 0;
    this.hold = 0; // samples left before release
  }
  // Times in seconds. `gate` is how long the key is held down.
  set(attack, decay, sustain, release, rate = SAMPLE_RATE) {
    const coef = (seconds) => 1 - Math.exp(-4.6 / Math.max(1, seconds * rate));
    this.ka = coef(attack);
    this.kd = coef(decay);
    this.kr = coef(release);
    this.sustain = sustain;
  }
  trigger(gateSamples) {
    this.stage = 1;
    this.hold = gateSamples;
  }
  release() {
    this.stage = 4;
    this.hold = 0;
  }
  step() {
    switch (this.stage) {
      case 1:
        // Aim just past 1 so the attack arrives instead of creeping up to it.
        // 1.02 gets there at 0.85 of the time asked for; the 1.08 this started
        // out as got there at 0.56, which made every slow pad half as slow.
        this.value += this.ka * (1.02 - this.value);
        if (this.value >= 1) { this.value = 1; this.stage = 2; }
        break;
      case 2:
        this.value += this.kd * (this.sustain - this.value);
        if (Math.abs(this.value - this.sustain) < 0.001) this.stage = 3;
        break;
      case 3:
        break;
      case 4:
        this.value += this.kr * (0 - this.value);
        if (this.value < 0.0002) { this.value = 0; this.stage = 0; }
        break;
      default:
        this.value = 0;
    }
    if (this.stage > 0 && this.stage < 4) {
      if (this.hold > 0) {
        this.hold--;
        if (this.hold === 0) this.release();
      }
    }
    return this.value;
  }
  get done() {
    return this.stage === 0;
  }
}

// --- delay lines -------------------------------------------------------------

// A circular buffer with a fractional read. Everything with a sense of space in
// this rig is one of these: chorus, tape wow, the echo, and every comb and
// allpass in the reverb.
class Delay {
  constructor(maxSamples) {
    this.buf = new Float32Array(Math.max(4, Math.ceil(maxSamples)));
    this.pos = 0;
  }
  write(x) {
    this.buf[this.pos] = x;
    this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1;
  }
  // `samples` back from the write head, linearly interpolated. Linear is enough:
  // the modulation depths here are a few samples, and the alternative costs four
  // multiplies per read on a line that is read three times per sample.
  read(samples) {
    const n = this.buf.length;
    const d = clamp(samples, 1, n - 2);
    const back = this.pos - d;
    const idx = back >= 0 ? back : back + n;
    const i0 = idx | 0;
    const frac = idx - i0;
    const i1 = i0 + 1 === n ? 0 : i0 + 1;
    return this.buf[i0] + (this.buf[i1] - this.buf[i0]) * frac;
  }
  clear() {
    this.buf.fill(0);
    this.pos = 0;
  }
}

// A Schroeder comb with a one-pole in the feedback path -- the damping is what
// turns a metallic ring into a room, because real rooms lose treble faster than
// bass.
class Comb {
  constructor(samples) {
    this.buf = new Float32Array(Math.ceil(samples));
    this.pos = 0;
    this.store = 0;
    this.feedback = 0.84;
    this.damp = 0.35;
  }
  step(x) {
    const out = this.buf[this.pos];
    this.store = out * (1 - this.damp) + this.store * this.damp;
    this.buf[this.pos] = x + this.store * this.feedback;
    this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1;
    return out;
  }
  clear() {
    this.buf.fill(0);
    this.store = 0;
  }
}

// A Schroeder allpass: flat magnitude, scrambled phase. Combs make the tail,
// allpasses make it dense enough to stop sounding like four echoes.
class Allpass {
  constructor(samples) {
    this.buf = new Float32Array(Math.ceil(samples));
    this.pos = 0;
    this.gain = 0.5;
  }
  step(x) {
    const stored = this.buf[this.pos];
    const out = -x + stored;
    this.buf[this.pos] = x + stored * this.gain;
    this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1;
    return out;
  }
  clear() {
    this.buf.fill(0);
  }
}

module.exports = {
  SAMPLE_RATE, CONTROL, TAU,
  clamp, lerp, mtof, softclip, Rng,
  polyBlep, sawAt, pulseAt, triAt, sinAt,
  Svf, OnePole, Adsr, Delay, Comb, Allpass,
};

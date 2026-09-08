'use strict';
// The rig a piece is played on: eight stems, two sends and a tape machine.
//
// audio/mixer.js streams pre-rendered buffers -- one looping bed plus one-shots
// -- which is everything a game needs and nothing a ten minute piece can use. A
// piece is eighteen thousand blocks long, its parts have to be muted and
// unmuted while it runs, and half a gigabyte of pre-rendered float is not a
// plan. So the rack renders live: one block per video frame, straight from the
// notes.
//
// Two clocks, one timeline, and they never have to agree with each other:
//
//  - advance(dt) walks the piece's bars at video rate. It queues the notes that
//    start inside this frame and moves the meters the picture is drawn from.
//  - pull(left, right, frames) renders the audio for that same frame, placing
//    each queued note at its own offset inside the block.
//
// The split is what lets the game be tested and played silently: nothing is
// pulled when there is no sink, the meters still move, and the visual still
// breathes. It is also why `--mute` costs nothing but the sequencer.
//
// The sound is deliberately not the console's. audio/synth.js is hard-edged
// four-channel chip; this is detuned analogue -- band-limited saws through a
// resonant filter, a two-operator electric piano, dusty drums run through a
// sample-rate crusher, noise weather, and the whole mix through a modulated
// delay line so it wanders the way a tape does. Warmth here is not a metaphor:
// it is the wow, the saturation and the top end being quietly taken away.

const tone = require('./tone');
const pieceLib = require('./piece');

const {
  SAMPLE_RATE, CONTROL, clamp, mtof, softclip, Rng,
  sawAt, pulseAt, triAt, sinAt, Svf, OnePole, Adsr, Delay, Comb, Allpass,
} = tone;

// A block is one video frame of audio. 30 fps at 44.1 kHz is 1470 samples; the
// ceiling is generous so a slower frame rate, or a preview catching up, cannot
// run off the end of a bus.
const MAX_BLOCK = 8192;

// --- patches -----------------------------------------------------------------
//
// One per stem. `waves` are the oscillators (cents of detune, level, and how
// many octaves off the note), `filter` is where the movement comes from, and
// `send` is how much of the stem reaches the echo and the room.

const PATCHES = {
  pad: {
    mode: 'analog', voices: 8, gain: 0.12, lowcut: 52,
    waves: [
      { type: 'saw', cents: -7, level: 1 },
      { type: 'saw', cents: 8, level: 1 },
      { type: 'tri', cents: 3, octave: -1, level: 0.7 },
    ],
    filter: { base: 330, env: 2.1, tone: 1.7, q: 0.9 },
    fenv: { a: 1.4, d: 3.0, s: 0.55, r: 2.4 },
    amp: { a: 1.15, d: 1.8, s: 0.85, r: 2.6 },
    vibrato: { rate: 0.23, depth: 0.0016, delay: 0 },
    spread: 0.55, drive: 1.05,
    send: { verb: 0.58, echo: 0.16 },
  },
  bass: {
    mode: 'analog', voices: 3, gain: 0.30, lowcut: 26,
    waves: [
      { type: 'sine', cents: 0, level: 1 },
      { type: 'tri', cents: 0, level: 0.5 },
      { type: 'saw', cents: 4, level: 0.16 },
    ],
    filter: { base: 140, env: 1.55, tone: 1.2, q: 0.95 },
    fenv: { a: 0.006, d: 0.22, s: 0.28, r: 0.12 },
    amp: { a: 0.008, d: 0.2, s: 0.82, r: 0.14 },
    spread: 0, drive: 1.55,
    send: { verb: 0.05, echo: 0.0 },
  },
  // Two operators: a sine carrier bent by a sine two octaves up, with the bend
  // dying away over the first second. That decay *is* the tine -- an electric
  // piano is bright for a tenth of a second and a flute after that.
  keys: {
    mode: 'fm', voices: 6, gain: 0.50, lowcut: 140,
    ratio: 2.0, index: 3.4, indexDecay: 0.42, feedbackRatio: 1,
    filter: { base: 2300, env: 1.2, tone: 1.55, q: 0.75 },
    fenv: { a: 0.002, d: 0.9, s: 0.2, r: 0.4 },
    amp: { a: 0.003, d: 1.3, s: 0.16, r: 0.6 },
    spread: 0.4, drive: 1.15,
    send: { verb: 0.4, echo: 0.28 },
  },
  lead: {
    mode: 'analog', voices: 3, gain: 0.28, lowcut: 120,
    waves: [
      { type: 'saw', cents: -6, level: 1 },
      { type: 'saw', cents: 7, level: 0.9 },
      { type: 'tri', cents: 0, octave: 1, level: 0.22 },
    ],
    filter: { base: 520, env: 1.9, tone: 1.85, q: 1.75 },
    fenv: { a: 0.09, d: 0.7, s: 0.55, r: 0.5 },
    amp: { a: 0.07, d: 0.6, s: 0.75, r: 0.45 },
    vibrato: { rate: 5.1, depth: 0.0038, delay: 0.32 },
    glide: 0.055,
    spread: 0.25, drive: 1.25,
    send: { verb: 0.32, echo: 0.38 },
  },
  arp: {
    mode: 'analog', voices: 6, gain: 0.42, lowcut: 170,
    waves: [
      { type: 'tri', cents: 0, level: 1 },
      { type: 'pulse', cents: 6, level: 0.55, width: 0.3 },
    ],
    filter: { base: 760, env: 2.45, tone: 1.95, q: 1.55 },
    fenv: { a: 0.002, d: 0.16, s: 0.05, r: 0.1 },
    amp: { a: 0.002, d: 0.24, s: 0.02, r: 0.14 },
    spread: 0.7, drive: 1.1,
    send: { verb: 0.28, echo: 0.5 },
  },
  choir: {
    mode: 'analog', voices: 6, gain: 0.18, lowcut: 95,
    waves: [
      { type: 'tri', cents: -5, level: 1 },
      { type: 'tri', cents: 6, level: 1 },
      { type: 'sine', cents: 0, octave: 1, level: 0.3 },
    ],
    filter: { base: 820, env: 1.35, tone: 1.25, q: 0.9 },
    // Two resonant peaks over the low-pass. Not a real formant filter, but two
    // bandpasses in the right places is the difference between a synth pad and
    // something with a throat.
    formant: { one: 640, two: 1180, mix: 0.55, q: 3.6 },
    fenv: { a: 1.0, d: 1.6, s: 0.6, r: 1.6 },
    amp: { a: 0.95, d: 1.4, s: 0.8, r: 1.7 },
    vibrato: { rate: 4.4, depth: 0.0035, delay: 0.7 },
    spread: 0.6, drive: 1.0,
    send: { verb: 0.62, echo: 0.12 },
  },
  beat: {
    mode: 'drum', voices: 12, gain: 0.56, lowcut: 30,
    // Band-limit before the 22 kHz / twelve-bit stage so cymbal noise does not
    // fold into the midrange. A little room sits behind the dry attacks.
    crush: { hold: 2, bits: 12 },
    room: 0.22,
    drive: 1.18, spread: 0.5,
    send: { verb: 0.09, echo: 0.035 },
  },
  haze: {
    mode: 'air', voices: 5, gain: 0.23, lowcut: 240,
    spread: 0.9, drive: 1.0,
    hiss: 0.028, crackle: 0.22,
    send: { verb: 0.32, echo: 0.14 },
  },
};

// Each body has three independently damped, inharmonic modes. The tuple is
// [frequency ratio, level, decay seconds]; the noise supplies skin and wires.
const KIT = {
  K: { freq: 58, modes: [[1, 1.2, 0.14], [1.59, 0.3, 0.045], [2.14, 0.16, 0.018]], bend: 0.75, fall: 0.009, noise: 0.32, noiseDecay: 0.008, band: 2200, q: 0.8, level: 1, pan: 0 },
  S: { freq: 184, modes: [[1, 0.72, 0.065], [1.47, 0.4, 0.042], [2.19, 0.22, 0.022]], bend: 0.1, fall: 0.007, noise: 1.65, noiseDecay: 0.095, band: 1900, q: 0.8, wire: 0.55, level: 0.84, pan: -0.08 },
  t: { freq: 132, modes: [[1, 0.95, 0.16], [1.6, 0.42, 0.085], [2.18, 0.2, 0.038]], bend: 0.18, fall: 0.014, noise: 0.3, noiseDecay: 0.012, band: 1400, q: 0.8, level: 0.75, pan: 0.25 },
  h: { freq: 3760, modes: [[1, 0.12, 0.009], [1.342, 0.09, 0.012], [1.923, 0.06, 0.006]], noise: 1.4, noiseDecay: 0.025, band: 6200, q: 0.8, wire: 0.2, level: 0.48, pan: 0.28 },
  H: { freq: 3760, modes: [[1, 0.14, 0.05], [1.342, 0.1, 0.08], [1.923, 0.08, 0.036]], noise: 1.25, noiseDecay: 0.18, band: 5700, q: 0.8, wire: 0.3, level: 0.43, pan: 0.3 },
  r: { freq: 480, modes: [[1, 0.65, 0.018], [1.73, 0.5, 0.012], [2.71, 0.28, 0.008]], bend: 0.08, fall: 0.003, noise: 0.5, noiseDecay: 0.012, band: 2300, q: 1.1, level: 0.6, pan: -0.3 },
  p: { freq: 320, modes: [[1, 0.8, 0.075], [1.51, 0.36, 0.04], [2.37, 0.18, 0.018]], bend: 0.12, fall: 0.008, noise: 0.45, noiseDecay: 0.025, band: 1600, q: 1, level: 0.48, pan: 0.35 },
  c: { freq: 0, modes: [], noise: 1.8, noiseDecay: 0.05, band: 1450, q: 0.8, wire: 0.5, flam: true, level: 0.6, pan: -0.35 },
};

// --- one voice ---------------------------------------------------------------
//
// Allocated once per stem at construction and reused for ever after: a voice
// that has finished is idle, not garbage. Same rule as the packing buffer in
// framebuffer.open().

const MAX_WAVES = 3;

class Voice {
  constructor(patch, rng) {
    this.patch = patch;
    this.rng = rng;
    this.mode = patch.mode;
    // Rendering one hit must not advance another hit's noise sequence.
    this.drumNoise = patch.mode === 'drum' ? new Rng(Math.floor(rng.next() * 4294967296)) : null;
    this.active = false;
    this.from = 0;      // where in the block this voice starts
    this.age = 0;       // samples since the note began
    this.midi = 0;
    this.freq = 220;
    this.target = 220;  // where a glide is heading
    this.vel = 0;
    this.tone = 0.5;
    this.gainL = 0.5;
    this.gainR = 0.5;

    this.phase = new Float64Array(MAX_WAVES);
    this.inc = new Float64Array(MAX_WAVES);
    this.type = new Int32Array(MAX_WAVES);
    this.level = new Float32Array(MAX_WAVES);
    this.ratio = new Float64Array(MAX_WAVES);
    this.width = new Float32Array(MAX_WAVES);
    this.waves = 0;

    this.amp = new Adsr();
    this.fenv = new Adsr();
    this.svf = new Svf();
    this.bp1 = new Svf();
    this.bp2 = new Svf();
    this.modPhase = 0;
    this.lfo = 0;

    // Drums and weather.
    this.kit = null;
    this.noiseEnv = 0;
    this.noiseDecay = 0;
    this.modeDecay = new Float64Array(MAX_WAVES);
    this.attack = 0;
    this.attackDecay = 0;
    this.chokeAt = Infinity;
    this.bend = 0;
    this.fall = 0;
    this.hold = 0;
    this.holdValueL = 0;
    this.holdValueR = 0;
  }

  // A note. `gate` is how long it is held in seconds; the envelope's release
  // runs on past it, which is why a voice is not free the moment its bar ends.
  noteOn(event, freq) {
    const p = this.patch;
    this.active = true;
    this.age = 0;
    this.midi = event.midi ?? 60;
    this.vel = event.vel ?? 0.8;
    this.tone = event.tone ?? 0.5;
    this.target = freq;

    const spread = p.spread ?? 0;
    // Panned by pitch, not at random: a chord laid out left to right by note is
    // an ensemble, the same thing scattered is a mess.
    const place = spread === 0 ? 0 : clamp(((this.midi % 12) / 11 - 0.5) * 2 * spread, -1, 1);
    this.gainL = Math.sqrt(clamp(0.5 - place * 0.5, 0, 1)) * 1.35;
    this.gainR = Math.sqrt(clamp(0.5 + place * 0.5, 0, 1)) * 1.35;

    const gateSamples = Math.max(8, Math.round((event.gate ?? 0.2) * SAMPLE_RATE));

    if (this.mode === 'drum') {
      const kit = KIT[event.voice] ?? KIT.h;
      this.kit = kit;
      const strength = clamp(this.vel, 0, 1);
      const colour = clamp(this.tone, 0, 1);
      const pitch = this.rng.range(0.988, 1.012) * (0.99 + strength * 0.02);
      const decay = this.rng.range(0.94, 1.06) * (0.78 + strength * 0.22);
      this.waves = kit.modes.length;
      for (let i = 0; i < this.waves; i++) {
        const [ratio, level, seconds] = kit.modes[i];
        this.phase[i] = i === 0 ? 0 : this.rng.range(0, 0.12);
        this.inc[i] = kit.freq * ratio * pitch / SAMPLE_RATE;
        this.level[i] = level * (i === 0 ? 1 : 0.55 + strength * 0.45);
        this.modeDecay[i] = Math.exp(-1 / (seconds * decay * SAMPLE_RATE));
      }
      this.noiseEnv = 1;
      this.noiseDecay = Math.exp(-1 / (kit.noiseDecay * decay * SAMPLE_RATE));
      this.attack = 1;
      this.attackDecay = Math.exp(-1 / (0.0006 * SAMPLE_RATE));
      this.chokeAt = Infinity;
      this.bend = (kit.bend ?? 0) * (0.75 + strength * 0.25);
      this.fall = kit.fall ? Math.exp(-1 / (kit.fall * SAMPLE_RATE)) : 0;
      this.gainL = Math.sqrt(clamp(0.5 - (kit.pan ?? 0) * 0.5, 0, 1)) * 1.35;
      this.gainR = Math.sqrt(clamp(0.5 + (kit.pan ?? 0) * 0.5, 0, 1)) * 1.35;
      if (kit.band) {
        const brightness = 0.72 + colour * 0.4 + strength * 0.16;
        this.bp1.set(kit.band * brightness, kit.q ?? 1.2);
        this.bp1.reset();
        this.bp2.set(Math.min(9500, kit.band * 2.1) * brightness, 0.8);
        this.bp2.reset();
      }
      return;
    }

    if (this.mode === 'air') {
      this.kit = event.voice === 'grain' ? 'grain' : 'swell';
      const centre = mtof(this.midi) * (this.kit === 'grain' ? 2 : 1.5);
      this.bp1.set(clamp(centre, 90, 9000), this.kit === 'grain' ? 5.5 : 1.5);
      this.bp1.reset();
      this.bp2.set(clamp(centre * 1.5, 90, 11000), 2.2);
      this.bp2.reset();
      this.amp.set(this.kit === 'grain' ? 0.004 : 1.6, 0.4, 0.75, this.kit === 'grain' ? 0.09 : 2.2);
      this.amp.value = 0;
      this.amp.trigger(gateSamples);
      // Weather is placed across the picture and stays where it was put.
      const place = this.rng.range(-0.9, 0.9) * (p.spread ?? 0);
      this.gainL = Math.sqrt(clamp(0.5 - place * 0.5, 0, 1)) * 1.35;
      this.gainR = Math.sqrt(clamp(0.5 + place * 0.5, 0, 1)) * 1.35;
      return;
    }

    // Pitched: glide from wherever the voice was, or straight to the note.
    const glide = p.glide ?? 0;
    this.freq = glide > 0 && this.freqWas ? this.freqWas : freq;
    this.freqWas = freq;
    this.glideK = glide > 0 ? 1 - Math.exp(-1 / (glide * SAMPLE_RATE / CONTROL)) : 1;

    if (this.mode === 'fm') {
      this.waves = 2;
      this.phase[0] = 0;
      this.phase[1] = 0;
      this.modIndex = p.index;
      this.modDecay = Math.exp(-CONTROL / (p.indexDecay * SAMPLE_RATE));
    } else {
      const waves = p.waves;
      this.waves = waves.length;
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        // A fixed start phase per oscillator would make every note begin with
        // the same transient; a seeded one keeps them from all clicking at once
        // without making the render unrepeatable.
        this.phase[i] = this.rng.next();
        this.type[i] = w.type === 'saw' ? 0 : w.type === 'tri' ? 1 : w.type === 'pulse' ? 2 : 3;
        this.level[i] = w.level;
        this.ratio[i] = 2 ** ((w.cents ?? 0) / 1200 + (w.octave ?? 0));
        this.width[i] = w.width ?? 0.5;
      }
    }

    this.amp.set(p.amp.a, p.amp.d, p.amp.s, p.amp.r);
    this.fenv.set(p.fenv.a, p.fenv.d, p.fenv.s, p.fenv.r);
    this.amp.value = 0;
    this.fenv.value = 0;
    this.amp.trigger(gateSamples);
    this.fenv.trigger(gateSamples);
    this.svf.reset();
    this.modPhase = this.rng.next();
  }
}

// --- rendering one voice -----------------------------------------------------
//
// Three separate functions rather than one with a switch in it, for the same
// reason packRGB565 is its own function: the inner loops stay monomorphic, and
// a shared body would be megamorphic on every field it touched.

function renderAnalog(v, outL, outR, frames, drift) {
  const p = v.patch;
  const n = v.waves;
  const f = p.filter;
  const vib = p.vibrato;
  const formant = p.formant;

  for (let i = v.from; i < frames; i += CONTROL) {
    const upto = Math.min(i + CONTROL, frames);
    const chunk = upto - i;

    // Control rate: glide, vibrato, the filter.
    v.freq += (v.target - v.freq) * v.glideK;
    let freq = v.freq * drift;
    if (vib) {
      const seconds = v.age / SAMPLE_RATE;
      if (seconds > vib.delay) {
        v.modPhase += (vib.rate * chunk) / SAMPLE_RATE;
        freq *= 1 + vib.depth * sinAt(v.modPhase % 1);
      }
    }
    for (let k = 0; k < n; k++) v.inc[k] = (freq * v.ratio[k]) / SAMPLE_RATE;

    const fe = v.fenv.value;
    const cut = f.base * 2 ** (f.env * fe + f.tone * (v.tone - 0.4) * 2 + (v.midi - 60) / 24);
    v.svf.set(cut, f.q);
    if (formant) {
      v.bp1.set(formant.one, formant.q);
      v.bp2.set(formant.two, formant.q * 0.7);
    }

    const drive = p.drive ?? 1;
    for (let j = 0; j < chunk; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) {
        let ph = v.phase[k] + v.inc[k];
        if (ph >= 1) ph -= 1;
        v.phase[k] = ph;
        const inc = v.inc[k];
        switch (v.type[k]) {
          case 0: s += v.level[k] * sawAt(ph, inc); break;
          case 1: s += v.level[k] * triAt(ph); break;
          case 2: s += v.level[k] * pulseAt(ph, inc, v.width[k]); break;
          default: s += v.level[k] * sinAt(ph);
        }
      }

      let filtered = v.svf.step(s);
      if (formant) {
        v.bp1.step(s);
        v.bp2.step(s);
        filtered += (v.bp1.bp * formant.mix + v.bp2.bp * formant.mix * 0.6);
      }

      const a = v.amp.step();
      v.fenv.step();
      const out = softclip(filtered * drive) * a * v.vel;
      const at = i + j;
      outL[at] += out * v.gainL;
      outR[at] += out * v.gainR;
      v.age++;
    }

    if (v.amp.done) { v.active = false; return; }
  }
}

function renderFm(v, outL, outR, frames, drift) {
  const p = v.patch;
  const f = p.filter;

  for (let i = v.from; i < frames; i += CONTROL) {
    const upto = Math.min(i + CONTROL, frames);
    const chunk = upto - i;

    v.freq += (v.target - v.freq) * v.glideK;
    const carrier = (v.freq * drift) / SAMPLE_RATE;
    const modulator = carrier * p.ratio;
    v.modIndex *= v.modDecay;
    const index = v.modIndex * (0.5 + v.tone);

    const fe = v.fenv.value;
    v.svf.set(f.base * 2 ** (f.env * fe + f.tone * (v.tone - 0.4) * 2 + (v.midi - 60) / 20), f.q);
    const drive = p.drive ?? 1;

    for (let j = 0; j < chunk; j++) {
      let mp = v.phase[1] + modulator;
      if (mp >= 1) mp -= 1;
      v.phase[1] = mp;
      const mod = sinAt(mp) * index;

      let cp = v.phase[0] + carrier;
      if (cp >= 1) cp -= 1;
      v.phase[0] = cp;
      const s = Math.sin((cp + mod) * tone.TAU);

      const a = v.amp.step();
      v.fenv.step();
      const out = softclip(v.svf.step(s) * drive) * a * v.vel;
      const at = i + j;
      outL[at] += out * v.gainL;
      outR[at] += out * v.gainR;
      v.age++;
    }

    if (v.amp.done) { v.active = false; return; }
  }
}

function renderDrum(v, outL, outR, frames) {
  const kit = v.kit;
  const rng = v.drumNoise;
  const noiseLevel = kit.noise * (0.55 + clamp(v.vel, 0, 1) * 0.45);

  for (let i = v.from; i < frames; i++) {
    let s = 0;
    let bodyLevel = 0;
    const choke = i >= v.chokeAt ? 0.982 : 1;
    for (let k = 0; k < v.waves; k++) {
      let ph = v.phase[k] + v.inc[k] * (1 + v.bend);
      if (ph >= 1) ph -= 1;
      v.phase[k] = ph;
      s += sinAt(ph) * v.level[k];
      v.level[k] *= v.modeDecay[k] * choke;
      bodyLevel += v.level[k];
    }
    v.bend *= v.fall;

    // Several hands arrive a few milliseconds apart, followed by one tail.
    if (kit.flam && (v.age === 485 || v.age === 1014)) v.noiseEnv = 0.85;

    if (v.noiseEnv > 0.0002) {
      const noise = rng.bipolar();
      v.bp1.step(noise);
      v.bp2.step(noise);
      s += (v.bp1.bp + v.bp2.bp * (kit.wire ?? 0.12)) * v.noiseEnv * noiseLevel;
      v.noiseEnv *= v.noiseDecay * choke;
    }

    v.attack *= v.attackDecay;
    const out = s * (1 - v.attack) * v.vel * kit.level;
    outL[i] += out * v.gainL;
    outR[i] += out * v.gainR;
    v.age++;

    if (bodyLevel < 0.0004 && v.noiseEnv < 0.0004) { v.active = false; return; }
  }
  v.chokeAt -= frames;
}

// Weather: a bandpassed noise cloud that sweeps, or a short grain of one.
function renderAir(v, outL, outR, frames) {
  const rng = v.rng;
  const swell = v.kit === 'swell';

  for (let i = v.from; i < frames; i += CONTROL) {
    const upto = Math.min(i + CONTROL, frames);
    const chunk = upto - i;

    if (swell) {
      // The filter opens as the swell arrives and closes as it goes, which is
      // what makes it read as approaching rather than as a fade.
      const a = v.amp.value;
      const centre = clamp(mtof(v.midi) * (1.2 + a * 5.5), 90, 9500);
      v.bp1.set(centre, 1.4);
      v.bp2.set(centre * 1.48, 2.0);
    }

    for (let j = 0; j < chunk; j++) {
      const noise = rng.bipolar();
      v.bp1.step(noise);
      v.bp2.step(noise);
      const s = v.bp1.bp * 1.6 + v.bp2.bp * 0.7;
      const a = v.amp.step();
      const out = s * a * v.vel;
      const at = i + j;
      outL[at] += out * v.gainL;
      outR[at] += out * v.gainR;
      v.age++;
    }

    if (v.amp.done) { v.active = false; return; }
  }
}

// --- one stem ----------------------------------------------------------------

class Stem {
  constructor(name, patch, seed) {
    this.name = name;
    this.patch = patch;
    this.rng = new Rng(seed);
    this.pool = [];
    for (let i = 0; i < patch.voices; i++) this.pool.push(new Voice(patch, this.rng));
    this.left = new Float32Array(MAX_BLOCK);
    this.right = new Float32Array(MAX_BLOCK);
    this.gain = 0;        // where the fader is
    this.target = 0;      // where it is heading
    this.crushCount = 0;
    this.crushL = 0;
    this.crushR = 0;
    if (patch.crush) {
      this.crushFilterL = new Svf();
      this.crushFilterR = new Svf();
      this.crushFilterL.set(8800, 0.707);
      this.crushFilterR.set(8800, 0.707);
    }
    if (patch.room) {
      this.room = new Delay(SAMPLE_RATE * 0.06);
      this.roomLow = new OnePole();
      this.roomHigh = new OnePole();
      this.roomLow.set(5800);
      this.roomHigh.set(600);
    }
    this.hiss = new OnePole();
    this.hiss.set(4200);
    this.lowcutL = new OnePole();
    this.lowcutR = new OnePole();
    if (patch.lowcut) {
      this.lowcutL.set(patch.lowcut);
      this.lowcutR.set(patch.lowcut);
    }
    this.crackle = 0;
  }

  // Newest wins when every voice is busy, exactly as the mixer does with its
  // one-shots: during a run of sixteenths the note being played matters more
  // than the tail of the one before it.
  take() {
    let oldest = null;
    for (const voice of this.pool) {
      if (!voice.active) return voice;
      if (!oldest || voice.age > oldest.age) oldest = voice;
    }
    return oldest;
  }
}

// --- the rack ----------------------------------------------------------------

function open(piece, options = {}) {
  const seed = options.seed ?? 1234;
  const rate = options.rate ?? SAMPLE_RATE;
  const stems = {};
  for (const name of piece.stems) stems[name] = new Stem(name, PATCHES[name], seed + pieceLib.STEMS.indexOf(name) * 7717);

  // Two sends, shared. A reverb per stem would be eight reverbs, and they would
  // all be the same room.
  const echoTime = clamp((60 / piece.movements[0].bpm) * 0.75, 0.08, 1.2);
  const echo = {
    left: new Delay(rate * 1.5), right: new Delay(rate * 1.5),
    time: echoTime * rate, feedback: 0.42,
    dampL: new OnePole(), dampR: new OnePole(),
  };
  echo.dampL.set(3600);
  echo.dampR.set(3600);

  // Freeverb's tunings, which are prime-ish lengths chosen so the combs do not
  // reinforce each other into a ring. The right channel is offset by 23 samples
  // -- that alone is the stereo.
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491];
  const ALLPASS = [556, 441, 341, 225];
  const verb = {
    combL: COMBS.map((n) => new Comb(n)),
    combR: COMBS.map((n) => new Comb(n + 23)),
    apL: ALLPASS.map((n) => new Allpass(n)),
    apR: ALLPASS.map((n) => new Allpass(n + 23)),
    preL: new OnePole(), preR: new OnePole(),
  };
  verb.preL.set(6800);
  verb.preR.set(6800);
  for (const c of [...verb.combL, ...verb.combR]) { c.feedback = 0.855; c.damp = 0.34; }

  const sendL = new Float32Array(MAX_BLOCK);
  const sendR = new Float32Array(MAX_BLOCK);
  const echoL = new Float32Array(MAX_BLOCK);
  const echoR = new Float32Array(MAX_BLOCK);
  const busL = new Float32Array(MAX_BLOCK);
  const busR = new Float32Array(MAX_BLOCK);

  // The tape. A modulated delay of a few milliseconds is a pitch wobble, and
  // two of them at incommensurate rates never repeat -- one slow enough to hear
  // as drift, one fast enough to hear as flutter. It is the single thing that
  // most makes this not sound like a computer.
  const wowL = new Delay(rate * 0.05);
  const wowR = new Delay(rate * 0.05);
  const airL = new OnePole();
  const airR = new OnePole();
  airL.set(options.air ?? 15000);
  airR.set(options.air ?? 15000);
  // And a high-pass, as `x` minus a very low low-pass. Nothing below about 30 Hz
  // is a note here -- it is the sum of eight sub oscillators' offsets, and on a
  // television speaker it is nothing at all while still eating headroom.
  const subL = new OnePole();
  const subR = new OnePole();
  subL.set(32);
  subR.set(32);

  const noise = new Rng(seed ^ 0x5bf03635);

  const rig = {
    piece,
    at: 0,                 // seconds into the piece
    bar: 0,                // the next bar whose notes have not been queued
    done: false,
    running: true,
    due: [],               // notes starting inside this frame
    fired: [],             // and the same list, for the picture to read
    frameLength: 1 / (options.fps ?? 30),
    levels: {},            // what the listener has each fader at, 0..1
    scored: new Set(),     // what the arrangement is asking for right now
    meters: {},            // what each stem is doing, 0..1, for the visual
    hits: {},              // and a spike on every onset
    voicesUsed: 0,
    wowPhase: noise.next(),
    flutterPhase: noise.next(),
    tape: options.tape ?? 1,
    // The master fader. `output` is where it is being asked to go and `level`
    // is where it has got to; pull() slews between them over FADE seconds, so
    // stopping the tape lets the room ring out instead of cutting it.
    output: options.output ?? 1,
    level: options.output ?? 1,
    space: options.space ?? 1,
    brightness: options.brightness ?? 0.5,
    drift: 2 ** ((piece.drift ?? 0) / 1200),
  };

  for (const name of piece.stems) {
    rig.levels[name] = 1;
    rig.meters[name] = 0;
    rig.hits[name] = 0;
  }

  // --- the sequencer ---------------------------------------------------------

  // Notes still sounding, per stem, so a meter can hold up under a four second
  // pad instead of spiking and dropping.
  const sounding = {};
  for (const name of piece.stems) sounding[name] = [];

  function queueTo(until) {
    const bars = piece.timeline.bars;
    // From one bar back, always. Swing pushes the last sixteenth of a bar past
    // the bar line, so a bar is not finished with at the moment the next one
    // starts, and a cursor that only ever went forwards dropped those notes.
    let i = Math.max(0, rig.bar - 1);
    while (i < bars.length && bars[i].start < until) {
      for (const event of pieceLib.barEvents(piece, i)) {
        if (event.at >= rig.at && event.at < until) rig.due.push(event);
      }
      i++;
    }
    while (rig.bar + 1 < bars.length && bars[rig.bar + 1].start <= until) rig.bar++;
  }

  // Meters. Not the output level -- the *musical* level: what is sounding, how
  // hard it was struck and how long ago. It is computed here rather than from
  // the rendered block so that the picture moves identically whether or not
  // anybody is listening, which is what makes a game test meaningful and what
  // lets --mute cost nothing.
  function meter(dt) {
    for (const name of piece.stems) {
      const live = sounding[name];
      let target = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const note = live[i];
        if (rig.at >= note.until) { live.splice(i, 1); continue; }
        const age = rig.at - note.at;
        const attack = note.attack;
        const shape = age < attack ? age / attack : 1;
        const left = note.until - rig.at;
        const fade = left < 0.35 ? left / 0.35 : 1;
        target += note.vel * shape * fade;
      }
      target = Math.min(1, target * 0.62);
      const on = rig.levels[name] > 0 ? 1 : 0;
      target *= on;

      const now = rig.meters[name];
      // Up quickly, down slowly: an ear's own ballistics, and a picture that
      // followed the fall as fast as the rise would strobe.
      const k = target > now ? 1 - Math.exp(-dt / 0.035) : 1 - Math.exp(-dt / 0.28);
      const level = now + (target - now) * k;
      // Snapped rather than left to approach zero for ever: a part that has
      // been switched off has to read as off, in state() and in the rack's
      // bar, not as a thousandth of a bar that never quite goes away.
      rig.meters[name] = level < 0.002 ? 0 : level;
      rig.hits[name] *= Math.exp(-dt / 0.09);
    }
  }

  function advance(dt) {
    if (!rig.running || rig.done) { meter(dt); return rig.fired; }
    rig.frameLength = dt;
    const until = rig.at + dt;
    rig.due.length = 0;
    rig.fired.length = 0;
    queueTo(until);

    for (const event of rig.due) {
      const stem = event.stem;
      if (!sounding[stem]) continue;
      const patch = PATCHES[stem];
      sounding[stem].push({
        at: event.at,
        until: event.at + Math.max(event.gate ?? 0.05, 0.06) + (patch.amp ? patch.amp.r : 0.2),
        vel: event.vel ?? 0.7,
        attack: Math.max(0.01, patch.amp ? patch.amp.a : 0.01),
      });
      if (rig.levels[stem] > 0) rig.hits[stem] = Math.min(1, rig.hits[stem] + (event.vel ?? 0.7));
      rig.fired.push(event);
    }

    rig.at = until;
    rig.scored = pieceLib.scoredAt(piece, Math.min(rig.at, piece.duration - 0.001));
    if (rig.at >= piece.duration) { rig.at = piece.duration; rig.done = true; }
    meter(dt);
    return rig.fired;
  }

  // --- the renderer ----------------------------------------------------------

  const FADE = 0.5; // seconds for the master fader to travel end to end

  function pull(accL, accR, frames) {
    const n = Math.min(frames, MAX_BLOCK);

    const reach = n / (FADE * rate);
    const move = clamp(rig.output - rig.level, -reach, reach);
    const outFrom = rig.level;
    const outSlew = move / n;
    rig.level = outFrom + move;
    // Faded all the way out and asked to stay there: nothing is triggered and
    // nothing is rendered, which is what makes a paused piece free.
    if (outFrom < 0.0004 && rig.output < 0.0004) { rig.due.length = 0; return; }

    // Place this frame's notes inside the block. The offset is proportional
    // rather than absolute, so a block that is not exactly dt long -- the
    // fractional-sample accounting in game.js guarantees some are not -- still
    // puts every note where it belongs to within a sample.
    const span = Math.max(1e-6, rig.frameLength);
    for (const event of rig.due) {
      const stem = stems[event.stem];
      if (!stem) continue;
      if (rig.levels[event.stem] <= 0 && stem.gain < 0.001) continue;
      const offset = clamp(Math.floor(((event.at - (rig.at - span)) / span) * n), 0, n - 1);
      if (event.stem === 'beat' && (event.voice === 'h' || event.voice === 'H')) {
        for (const sounding of stem.pool) {
          if (sounding.active && (sounding.kit === KIT.H || sounding.kit === KIT.h)) {
            sounding.chokeAt = Math.min(sounding.chokeAt, offset);
          }
        }
      }
      const voice = stem.take();
      voice.noteOn(event, mtof(event.midi ?? 60));
      voice.from = offset;
    }
    rig.due.length = 0;

    busL.fill(0, 0, n);
    busR.fill(0, 0, n);
    sendL.fill(0, 0, n);
    sendR.fill(0, 0, n);
    echoL.fill(0, 0, n);
    echoR.fill(0, 0, n);
    let used = 0;

    for (const name of piece.stems) {
      const stem = stems[name];
      stem.target = rig.levels[name];
      const idle = stem.gain < 0.0005 && stem.target < 0.0005;
      let any = false;
      for (const voice of stem.pool) if (voice.active) { any = true; break; }
      if (idle && !any) continue;

      stem.left.fill(0, 0, n);
      stem.right.fill(0, 0, n);

      for (const voice of stem.pool) {
        if (!voice.active) continue;
        used++;
        switch (voice.mode) {
          case 'analog': renderAnalog(voice, stem.left, stem.right, n, rig.drift); break;
          case 'fm': renderFm(voice, stem.left, stem.right, n, rig.drift); break;
          case 'drum': renderDrum(voice, stem.left, stem.right, n); break;
          default: renderAir(voice, stem.left, stem.right, n);
        }
        voice.from = 0;
      }

      // The tape underneath the weather: hiss always, and the occasional pop of
      // a worn record. It belongs to `haze` so that switching that stem off
      // switches the room off with it.
      if (name === 'haze' && stem.patch.hiss) {
        const level = stem.patch.hiss;
        for (let i = 0; i < n; i++) {
          const h = stem.hiss.step(noise.bipolar()) * level;
          if (stem.crackle > 0.0001) stem.crackle *= 0.86;
          if (noise.next() < 0.00004) stem.crackle = noise.range(0.15, 0.55);
          const pop = stem.crackle * noise.bipolar() * stem.patch.crackle;
          stem.left[i] += h + pop;
          stem.right[i] += h * 0.8 + pop * 0.6;
        }
      }

      const patch = stem.patch;
      const gain = patch.gain;
      const crush = patch.crush;
      const verbSend = (patch.send.verb ?? 0) * rig.space;
      const echoSend = (patch.send.echo ?? 0) * rig.space;

      // The fader is ramped across the block rather than stepped at its start:
      // a stem switched off between two blocks is a click, and the whole point
      // of the thing is that parts come and go while it plays.
      const from = stem.gain;
      const to = stem.target;
      const slew = (to - from) / n;

      if (crush) {
        // Sample-rate reduction, then a quantiser. Done on the stem rather than
        // per voice so the whole kit crushes together, which is what a sampler
        // did and why it glues.
        const q = 2 ** (crush.bits - 1);
        for (let i = 0; i < n; i++) {
          const l = stem.crushFilterL.step(stem.left[i]);
          const r = stem.crushFilterR.step(stem.right[i]);
          if (stem.crushCount === 0) {
            stem.crushL = Math.round(l * q) / q;
            stem.crushR = Math.round(r * q) / q;
          }
          stem.crushCount = (stem.crushCount + 1) % crush.hold;
          stem.left[i] = stem.crushL;
          stem.right[i] = stem.crushR;
        }
      }

      if (patch.lowcut) {
        for (let i = 0; i < n; i++) {
          const l = stem.left[i];
          const r = stem.right[i];
          stem.left[i] = l - stem.lowcutL.step(l);
          stem.right[i] = r - stem.lowcutR.step(r);
        }
      }

      if (patch.room) {
        const wet = patch.room * rig.space;
        for (let i = 0; i < n; i++) {
          const input = stem.roomLow.step((stem.left[i] + stem.right[i]) * 0.5);
          stem.room.write(input - stem.roomHigh.step(input));
          stem.left[i] += wet * (stem.room.read(0.011 * rate) * 0.55 + stem.room.read(0.027 * rate) * 0.3 + stem.room.read(0.043 * rate) * 0.15);
          stem.right[i] += wet * (stem.room.read(0.017 * rate) * 0.55 + stem.room.read(0.033 * rate) * 0.3 + stem.room.read(0.049 * rate) * 0.15);
        }
      }

      const drive = patch.drive ?? 1;
      for (let i = 0; i < n; i++) {
        const fader = from + slew * i;
        const l = softclip(stem.left[i] * drive) * gain * fader;
        const r = softclip(stem.right[i] * drive) * gain * fader;
        busL[i] += l;
        busR[i] += r;
        sendL[i] += l * verbSend;
        sendR[i] += r * verbSend;
        // Summed here and written into the line below: the delay's write head
        // moves one sample per write, so feeding it once per stem would run it
        // eight times too fast.
        echoL[i] += l * echoSend;
        echoR[i] += r * echoSend;
      }
      stem.gain = to;
    }
    rig.voicesUsed = used;

    // The echo, ping-ponged: what went in on the left comes back on the right.
    for (let i = 0; i < n; i++) {
      const l = echo.left.read(echo.time);
      const r = echo.right.read(echo.time);
      echo.left.write(echoL[i] + echo.dampL.step(r) * echo.feedback);
      echo.right.write(echoR[i] + echo.dampR.step(l) * echo.feedback);
      busL[i] += l * 0.55 * rig.space;
      busR[i] += r * 0.55 * rig.space;
      sendL[i] += l * 0.18;
      sendR[i] += r * 0.18;
    }

    // The room.
    for (let i = 0; i < n; i++) {
      const inL = verb.preL.step(sendL[i]) * 0.28;
      const inR = verb.preR.step(sendR[i]) * 0.28;
      let l = 0;
      let r = 0;
      for (let k = 0; k < verb.combL.length; k++) {
        l += verb.combL[k].step(inL);
        r += verb.combR[k].step(inR);
      }
      for (let k = 0; k < verb.apL.length; k++) {
        l = verb.apL[k].step(l);
        r = verb.apR[k].step(r);
      }
      busL[i] += l * 0.34;
      busR[i] += r * 0.34;
    }

    // The tape machine: wow, flutter, top end gone, and a little saturation.
    const wowRate = 0.31;
    const flutterRate = 6.3;
    const depth = 0.0028 * rig.tape;
    for (let i = 0; i < n; i++) {
      rig.wowPhase += wowRate / rate;
      if (rig.wowPhase >= 1) rig.wowPhase -= 1;
      rig.flutterPhase += flutterRate / rate;
      if (rig.flutterPhase >= 1) rig.flutterPhase -= 1;
      const wobble = sinAt(rig.wowPhase) * depth + sinAt(rig.flutterPhase) * depth * 0.16;

      wowL.write(busL[i]);
      wowR.write(busR[i]);
      const base = 0.012 * rate;
      // The two heads wander apart as well as together, which widens the image
      // exactly as a worn tape does.
      const l = wowL.read(base * (1 + wobble));
      const r = wowR.read(base * (1 - wobble * 0.8));

      const hpL = l - subL.step(l);
      const hpR = r - subR.step(r);
      const fader = (outFrom + outSlew * i) * 0.92;
      accL[i] += softclip(airL.step(hpL) * 1.15) * fader;
      accR[i] += softclip(airR.step(hpR) * 1.15) * fader;
    }
  }

  // --- the desk --------------------------------------------------------------

  rig.advance = advance;
  rig.pull = pull;

  rig.set = (name, level) => {
    if (rig.levels[name] === undefined) return false;
    rig.levels[name] = clamp(level, 0, 1);
    return true;
  };
  rig.toggle = (name) => {
    if (rig.levels[name] === undefined) return false;
    rig.levels[name] = rig.levels[name] > 0 ? 0 : 1;
    return rig.levels[name] > 0;
  };
  rig.seek = (seconds) => {
    rig.at = clamp(seconds, 0, piece.duration);
    rig.bar = pieceLib.barAt(piece, rig.at);
    rig.done = rig.at >= piece.duration;
    rig.due.length = 0;
    for (const name of piece.stems) sounding[name].length = 0;
    for (const stem of Object.values(stems)) for (const voice of stem.pool) voice.active = false;
  };
  // Which movement is playing, and how far through it and the whole piece we
  // are. The HUD is drawn from this and nothing else.
  rig.where = () => {
    const movements = piece.movements;
    let index = 0;
    for (let i = 0; i < movements.length; i++) if (rig.at >= movements[i].start) index = i;
    const movement = movements[index];
    const bar = piece.timeline.bars[Math.min(rig.bar, piece.timeline.bars.length - 1)];
    return {
      index,
      name: movement.name,
      section: bar.sectionRef.name ?? '',
      chord: bar.chord.name,
      through: clamp((rig.at - movement.start) / (movement.end - movement.start), 0, 1),
      whole: clamp(rig.at / piece.duration, 0, 1),
    };
  };

  return rig;
}

module.exports = { open, PATCHES, KIT, MAX_BLOCK, SAMPLE_RATE };

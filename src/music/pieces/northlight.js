'use strict';
// NORTHLIGHT -- ten minutes, three movements, D dorian.
//
// Sundial is a day. This one is a machine left running in a cold building, and
// everything about it is a degree colder: dorian rather than aeolian, so the
// sixth is natural and the chords never quite resolve into sadness; a tempo
// that goes *up* in the middle rather than opening out; and the tune given to
// the sequencer instead of to the lead, which is the difference between a
// melody and a readout.
//
// The structure is a palindrome the piece never tells you about: movement III
// plays II's sections in reverse order over I's harmony, at I's tempo minus
// fourteen. Nobody will hear that. They will hear that it comes back.

const A = ['Dm9', 'Cmaj9', 'Am7', 'Em7'];
const B = ['Bm7b5', 'Cmaj7', 'Dm9', 'Am7'];
const C = ['Dm9', 'Dm9', 'Am7', 'Am7'];

const CLOCK = ['h-h-h-h-h-h-h-h-', 'h-h-hHh-h-h-hHh-'];
const PULSE = ['K---S---K---S---', 'K---S---K-K-S---'];
const TIGHT = ['K-hhr-K-S-h-K-hh', 'K-hhr-K-S-hK--hr'];
const SPARSE = ['K-------S-------', 'K-----K-S-------'];

module.exports = {
  title: 'NORTHLIGHT',
  subtitle: 'A MACHINE LEFT RUNNING',
  seed: 90211,
  key: 'D',
  mode: 'dorian',
  drift: 4,
  colour: 'frost',
  taster: 268,       // the middle of MACHINE ROOM, where all eight are on

  motifs: {
    // The cipher: steps up, steps down, and one leap it never explains.
    A: {
      bars: [
        [[0, 2], [1, 2], [2, 2], [1, 2], [4, 4], [null, 4]],
        [[3, 2], [2, 2], [1, 2], [0, 2], [-2, 8]],
        [[4, 2], [5, 2], [6, 2], [5, 2], [7, 4], [null, 4]],
        [[6, 4], [4, 4], [2, 4], [0, 4]],
      ],
    },
    B: {
      bars: [
        [[7, 4], [3, 2], [5, 2], [0, 8]],
        [[2, 2], [6, 2], [4, 4], [1, 4], [null, 4]],
      ],
    },
    C: {
      bars: [
        [[0, 2], [2, 2], [4, 2], [6, 2], [4, 2], [2, 2], [0, 4]],
        [[-3, 4], [0, 2], [2, 2], [4, 8]],
      ],
    },
  },

  movements: [
    {
      name: 'I. COLD START',
      bpm: 84,
      swing: 0.06,
      sections: [
        {
          name: 'STANDING BY',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.35, 0.7], open: [0.1, 0.3] },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: 0.55, open: [0.2, 0.45] },
          },
        },
        {
          name: 'FIRST CYCLE',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.7, open: [0.3, 0.46] },
            arp: { pattern: 'run', octave: 4, every: 2, span: 4, dir: 'up', gate: 0.5, vel: [0.3, 0.55], open: [0.4, 0.6] },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.78, open: 0.2 },
            beat: { pattern: 'kit', steps: CLOCK, vel: [0.35, 0.6], open: [0.3, 0.5] },
            haze: { pattern: 'grain', octave: 5, density: 0.35 },
          },
        },
        {
          name: 'THE READOUT',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.72, open: 0.46 },
            // The tune is the sequencer's, not the lead's. It is a readout.
            arp: { motif: 'A', octave: 5, vel: 0.6, open: [0.5, 0.72] },
            bass: { pattern: 'roots', octave: 2, vel: 0.85, lift: 0.4, open: 0.32 },
            beat: { pattern: 'kit', steps: PULSE, vel: 0.85, ghost: 0.25, open: 0.5 },
            keys: { pattern: 'chime', octave: 5, density: 0.45, vel: 0.6, open: 0.58 },
            haze: { pattern: 'grain', octave: 6, density: 0.4 },
          },
        },
        {
          name: 'DAYLIGHT AT THE WINDOW',
          bars: 16,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.8, open: [0.46, 0.7] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, vel: [0.3, 0.68], open: [0.32, 0.55] },
            bass: { pattern: 'dub', octave: 2, vel: 0.88, open: 0.4 },
            beat: { pattern: 'kit', steps: TIGHT, vel: 0.9, ghost: 0.3, open: 0.56 },
            lead: { motif: 'B', octave: 5, vel: 0.76, open: [0.45, 0.66], transform: { ornament: 0.2 } },
            arp: { pattern: 'run', octave: 5, every: 1, span: 5, dir: 'updown', gate: 0.38, drop: 0.25, vel: 0.48, open: 0.7 },
          },
        },
        {
          name: 'SHUTTING DOWN',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.8, 0.5], open: [0.62, 0.24] },
            arp: { pattern: 'run', octave: 4, every: 2, span: 4, dir: 'down', gate: 0.45, drop: [0.1, 0.6], vel: [0.5, 0.3], open: [0.6, 0.35] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.8, 0.55], open: 0.2 },
            beat: { pattern: 'kit', steps: SPARSE, vel: [0.7, 0.3], open: [0.45, 0.25] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.5, 0.75], open: [0.35, 0.55] },
          },
        },
      ],
    },

    {
      name: 'II. MACHINE ROOM',
      bpm: 104,
      swing: 0.0,   // no swing at all in the middle. It is the point.
      sections: [
        {
          name: 'SPIN UP',
          bars: 8,
          chords: C,
          parts: {
            arp: { pattern: 'run', octave: 4, every: 1, span: 4, dir: 'up', gate: 0.3, drop: [0.6, 0.05], vel: [0.3, 0.55], open: [0.3, 0.66] },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.75, open: 0.22 },
            haze: { pattern: 'grain', octave: 6, density: [0.2, 0.6] },
          },
        },
        {
          name: 'LOAD',
          bars: 16,
          chords: B,
          parts: {
            beat: { pattern: 'kit', steps: TIGHT, vel: 0.95, ghost: 0.35, open: [0.45, 0.66] },
            bass: { pattern: 'dub', octave: 2, vel: 0.92, open: [0.34, 0.48] },
            arp: { pattern: 'run', octave: 5, every: 1, span: 5, dir: 'updown', gate: 0.32, vel: 0.55, open: 0.72 },
            keys: { pattern: 'stab', octave: 4, notes: 3, vel: [0.5, 0.72], open: 0.56 },
            pad: { pattern: 'breathe', octave: 3, notes: 3, vel: 0.6, open: [0.34, 0.5] },
          },
        },
        {
          name: 'THE LONG RUN',
          bars: 24,
          chords: A,
          parts: {
            beat: { pattern: 'kit', steps: TIGHT, vel: 0.95, ghost: 0.4, open: 0.64 },
            bass: { pattern: 'walk', octave: 2, vel: 0.88, open: 0.44 },
            arp: { motif: 'A', octave: 5, vel: 0.62, open: [0.55, 0.78], transform: { steps: 2, ornament: 0.15 } },
            keys: { motif: 'C', octave: 5, vel: 0.6, open: 0.6, transform: { retro: true, thin: 0.15 } },
            lead: { motif: 'A', octave: 5, vel: 0.7, open: 0.68, transform: { steps: -4, thin: 0.35 } },
            haze: { pattern: 'grain', octave: 6, density: 0.6 },
            pad: { pattern: 'breathe', octave: 3, notes: 3, vel: 0.55, open: 0.48 },
          },
        },
        {
          name: 'OVERHEAD LIGHTS',
          bars: 24,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.82, open: [0.5, 0.76] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.4, 0.82], open: [0.38, 0.6] },
            bass: { pattern: 'dub', octave: 2, vel: 0.9, open: 0.46 },
            beat: { pattern: 'kit', steps: PULSE, vel: 0.9, ghost: 0.3, open: 0.55 },
            lead: { motif: 'B', octave: 5, vel: 0.74, open: 0.66, transform: { ornament: 0.28 } },
            arp: { pattern: 'scatter', octave: 5, every: 1, span: 6, density: [0.4, 0.7], vel: 0.48, open: 0.74 },
          },
        },
        {
          name: 'POWERING OFF',
          bars: 16,
          chords: C,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.8, 0.5], open: [0.7, 0.2] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, vel: [0.75, 0.3], open: [0.55, 0.28] },
            beat: { pattern: 'kit', steps: CLOCK, vel: [0.7, 0.25], open: [0.5, 0.2] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.78, 0.5], open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.5, 0.8], open: [0.4, 0.55] },
          },
        },
      ],
    },

    {
      name: 'III. NORTHLIGHT',
      bpm: 70,
      swing: 0.14,
      sections: [
        {
          name: 'AFTER HOURS',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.45, 0.72], open: [0.12, 0.3] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: [0.25, 0.6], open: [0.28, 0.48] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.6, open: 0.4 },
          },
        },
        {
          name: 'THE CIPHER AGAIN',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.74, open: 0.44 },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.8, open: 0.24 },
            lead: { motif: 'A', octave: 5, vel: 0.74, open: [0.42, 0.62], transform: { stretch: 2 } },
            keys: { pattern: 'chime', octave: 4, density: 0.45, vel: 0.62, open: 0.55 },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: 0.58, open: 0.45 },
            haze: { pattern: 'grain', octave: 5, density: 0.35 },
          },
        },
        {
          name: 'EVERYTHING WARM',
          bars: 16,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.84, open: [0.48, 0.72] },
            bass: { pattern: 'roots', octave: 2, vel: 0.88, lift: 0.45, open: [0.3, 0.44] },
            keys: { motif: 'C', octave: 4, vel: 0.68, open: 0.6, transform: { stretch: 2 } },
            beat: { pattern: 'kit', steps: SPARSE, vel: [0.5, 0.85], ghost: 0.3, open: [0.35, 0.55] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.5, 0.85], open: [0.4, 0.6] },
            arp: { pattern: 'scatter', octave: 5, every: 2, span: 5, density: [0.25, 0.55], vel: 0.45, open: 0.64 },
            lead: { motif: 'B', octave: 5, vel: 0.7, open: 0.6, transform: { stretch: 2, ornament: 0.25 } },
            haze: { pattern: 'grain', octave: 6, density: 0.45 },
          },
        },
        {
          name: 'ONE LIGHT LEFT',
          bars: 10,
          chords: C,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.8, 0.55], open: [0.6, 0.28] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 4, vel: [0.7, 0.35], open: [0.5, 0.28] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.78, 0.5], open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.65, open: 0.42 },
          },
        },
        {
          name: 'OFF',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.6, 0.24], open: [0.26, 0.08] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.65, 0.28], open: [0.42, 0.18] },
          },
        },
      ],
    },
  ],
};

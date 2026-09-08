'use strict';
// HARVEST -- ten minutes, three movements, G mixolydian.
//
// The slow one. Mixolydian rather than a minor mode, so it is major with the
// seventh flattened, which is the sound of something being over without being
// sad about it -- the chord you expect to lift never quite does.
//
// It is also the piece with the least in it. Sundial builds and Northlight
// runs; this one holds still and lets the room do the work, so the parts that
// carry it are the pad, the choir and the weather, and the drums are a rumour
// until the second movement. Switching the beat off here barely changes it,
// which is a thing worth being able to hear.

const A = ['Gsus2', 'F6', 'Cadd9', 'Dm7'];
const B = ['Em7', 'Cadd9', 'G', 'F'];
const C = ['G5', 'F', 'G5', 'Dm7'];

const FIELD = ['K-----h-S-----h-', 'K-----h-S---K-h-'];
const GLEAN = ['K--h--K-S-h---h-', 'K--h--K-S-h-K---'];
const BELL = ['--p---p---p---p-', '--p---p---p-p---'];
const LAST = ['K---------------', 'K-------K-------'];

module.exports = {
  title: 'HARVEST',
  subtitle: 'THE LAST WARM WEEK',
  seed: 31771,
  key: 'G',
  mode: 'mixolydian',
  drift: -11,       // the flattest of the three. It should sound like a copy.
  colour: 'harvest',
  taster: 330,      // THE WHOLE FIELD, where everything is finally in

  motifs: {
    // A hymn: four bars, all steps, no leap bigger than a third, and it ends
    // where it started. Written to survive being played at half speed.
    A: {
      bars: [
        [[0, 4], [2, 4], [4, 6], [null, 2]],
        [[3, 4], [2, 4], [0, 8]],
        [[4, 4], [6, 4], [7, 6], [null, 2]],
        [[6, 4], [4, 4], [2, 4], [0, 4]],
      ],
    },
    B: {
      bars: [
        [[7, 6], [6, 2], [4, 8]],
        [[2, 4], [4, 4], [3, 4], [2, 4]],
      ],
    },
    C: {
      bars: [
        [[0, 8], [4, 4], [2, 4]],
        [[-1, 4], [2, 4], [4, 4], [6, 4]],
      ],
    },
  },

  movements: [
    {
      name: 'I. STUBBLE',
      bpm: 60,
      swing: 0.14,
      sections: [
        {
          name: 'NOTHING YET',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.35, 0.7], open: [0.1, 0.28] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.5, 0.7], open: [0.2, 0.42] },
          },
        },
        {
          name: 'A LONG WAY OFF',
          bars: 12,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: 0.72, open: [0.3, 0.44] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: [0.25, 0.6], open: [0.28, 0.48] },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.78, open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: 0.55, open: 0.4 },
          },
        },
        {
          name: 'THE HYMN',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.76, open: 0.46 },
            bass: { pattern: 'roots', octave: 2, vel: 0.82, lift: 0.3, open: 0.3 },
            lead: { motif: 'A', octave: 5, vel: 0.74, open: [0.4, 0.6], transform: { ornament: 0.15 } },
            keys: { pattern: 'chime', octave: 4, density: [0.35, 0.6], vel: 0.62, open: 0.55 },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: 0.6, open: 0.46 },
            beat: { pattern: 'kit', steps: BELL, vel: [0.4, 0.6], open: 0.5 },
            haze: { pattern: 'grain', octave: 5, density: 0.3 },
          },
        },
        {
          name: 'CLOUD OVER',
          bars: 8,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: [0.76, 0.86], open: [0.46, 0.66] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.5, 0.82], open: [0.4, 0.6] },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.84, open: 0.26 },
            lead: { motif: 'B', octave: 5, vel: 0.76, open: 0.6 },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: 0.6, open: 0.5 },
          },
        },
        {
          name: 'AND OFF AGAIN',
          bars: 6,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 6, vel: [0.8, 0.5], open: [0.4, 0.18] },
            haze: { pattern: 'swells', every: 3, octave: 3, vel: 0.6, open: 0.36 },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 4, vel: [0.6, 0.3], open: 0.4 },
          },
        },
      ],
    },

    {
      name: 'II. THE WHOLE FIELD',
      bpm: 76,
      swing: 0.2,
      sections: [
        {
          name: 'SETTING OUT',
          bars: 8,
          chords: A,
          parts: {
            beat: { pattern: 'kit', steps: FIELD, vel: [0.5, 0.8], open: [0.35, 0.55] },
            bass: { pattern: 'roots', octave: 2, vel: 0.85, lift: 0.35, open: 0.32 },
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.7, open: 0.44 },
            haze: { pattern: 'grain', octave: 5, density: 0.4 },
          },
        },
        {
          name: 'WORK',
          bars: 16,
          chords: A,
          parts: {
            beat: { pattern: 'kit', steps: GLEAN, vel: 0.92, ghost: 0.35, open: [0.42, 0.62] },
            bass: { pattern: 'dub', octave: 2, vel: 0.9, open: [0.32, 0.46] },
            keys: { pattern: 'chime', octave: 4, density: 0.6, vel: 0.68, open: 0.6 },
            arp: { pattern: 'run', octave: 4, every: 2, span: 5, dir: 'updown', gate: 0.5, vel: [0.35, 0.58], open: [0.45, 0.68] },
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.74, open: 0.5 },
            lead: { motif: 'A', octave: 5, vel: 0.76, open: 0.6, transform: { steps: 2, ornament: 0.2 } },
          },
        },
        {
          name: 'EVERYONE OUT',
          bars: 16,
          chords: B,
          parts: {
            beat: { pattern: 'kit', steps: GLEAN, vel: 0.95, ghost: 0.4, open: 0.64 },
            bass: { pattern: 'walk', octave: 2, vel: 0.9, open: 0.44 },
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.84, open: [0.5, 0.74] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.5, 0.85], open: [0.4, 0.62] },
            keys: { motif: 'C', octave: 5, vel: 0.66, open: 0.6 },
            arp: { pattern: 'scatter', octave: 5, every: 1, span: 6, density: [0.4, 0.68], vel: 0.5, open: 0.72 },
            lead: { motif: 'B', octave: 5, vel: 0.74, open: 0.66, transform: { ornament: 0.3 } },
            haze: { pattern: 'grain', octave: 6, density: 0.5 },
          },
        },
        {
          name: 'THE LIGHT GOING',
          bars: 15,
          chords: A,
          parts: {
            beat: { pattern: 'kit', steps: FIELD, vel: [0.9, 0.5], open: [0.55, 0.3] },
            bass: { pattern: 'roots', octave: 2, vel: [0.88, 0.62], lift: 0.2, open: [0.42, 0.26] },
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.84, 0.6], open: [0.64, 0.3] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, vel: [0.8, 0.45], open: [0.58, 0.34] },
            lead: { motif: 'A', octave: 5, vel: [0.76, 0.5], open: [0.6, 0.4], transform: { thin: 0.3 } },
            haze: { pattern: 'grain', octave: 5, density: [0.5, 0.3] },
          },
        },
        {
          name: 'HOME',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.7, 0.55], open: [0.36, 0.22] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: 0.7, open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.55, 0.75], open: 0.42 },
            beat: { pattern: 'kit', steps: LAST, vel: [0.5, 0.25], open: 0.3 },
          },
        },
      ],
    },

    {
      name: 'III. WHAT IS LEFT',
      bpm: 54,
      swing: 0.08,
      sections: [
        {
          name: 'FROST COMING',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.4, 0.72], open: [0.1, 0.3] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 4, vel: [0.2, 0.55], open: [0.26, 0.46] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.62, open: 0.4 },
          },
        },
        {
          name: 'THE HYMN, SLOWER',
          bars: 12,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.76, open: 0.44 },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.8, open: 0.22 },
            lead: { motif: 'A', octave: 5, vel: 0.72, open: [0.4, 0.58], transform: { stretch: 2 } },
            choir: { motif: 'A', octave: 4, vel: 0.55, open: 0.44, transform: { stretch: 2, steps: -2 } },
            keys: { pattern: 'chime', octave: 4, density: 0.4, vel: 0.6, open: 0.54 },
            haze: { pattern: 'grain', octave: 5, density: 0.3 },
          },
        },
        {
          name: 'ALL OF IT AT ONCE',
          bars: 13,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.86, open: [0.46, 0.74] },
            bass: { pattern: 'roots', octave: 2, vel: 0.88, lift: 0.4, open: [0.3, 0.44] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.55, 0.88], open: [0.42, 0.64] },
            keys: { motif: 'C', octave: 5, vel: 0.66, open: 0.6, transform: { stretch: 2 } },
            beat: { pattern: 'kit', steps: BELL, vel: [0.4, 0.7], ghost: 0.25, open: 0.5 },
            arp: { pattern: 'scatter', octave: 5, every: 2, span: 5, density: [0.25, 0.5], vel: 0.44, open: 0.62 },
            lead: { motif: 'B', octave: 5, vel: 0.7, open: 0.62, transform: { stretch: 2 } },
            haze: { pattern: 'grain', octave: 6, density: 0.45 },
          },
        },
        {
          name: 'PUTTING IT AWAY',
          bars: 8,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.82, 0.55], open: [0.6, 0.28] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 4, vel: [0.72, 0.35], open: [0.5, 0.28] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.78, 0.5], open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.66, open: 0.42 },
          },
        },
        {
          name: 'NEXT YEAR',
          bars: 4,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 4, vel: [0.6, 0.22], open: [0.26, 0.08] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.6, 0.25], open: [0.4, 0.16] },
          },
        },
      ],
    },
  ],
};

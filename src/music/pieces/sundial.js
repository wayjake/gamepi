'use strict';
// SUNDIAL -- ten minutes, three movements, F aeolian.
//
// The shape is a day: light arriving, a long middle where the thing actually
// moves, and light going. Movement I builds one part at a time over an
// unhurried 72 and never gets loud. II is faster (88), the only place the
// drums lead, and it takes the tune apart -- same six notes, a fourth down,
// half of them missing. III is slower than either (63), plays I's tune at half
// speed over II's harmony, and takes the parts away in the order they arrived.
//
// The chords are the two cycles below and nothing else, which is deliberate:
// what changes across the piece is register, tempo, who is playing and how far
// the filters are open, not the harmony. Ten minutes of chord changes is a
// medley; ten minutes of one chord cycle seen from three distances is a piece.

const A = ['Fm9', 'Dbmaj9', 'Abmaj9', 'Ebadd9'];       // i - VI - III - VII
const B = ['Bbm11', 'Fm9', 'Dbmaj9', 'C7sus4'];        // iv - i - VI - v
const C = ['Fm9', 'Fm9', 'Dbmaj9', 'Dbmaj9'];          // the slow one

// Drum lines. Sixteen steps a bar: K kick, S snare, h closed hat, H open,
// r rim, t tom, p perc, c clap. Written as pairs so a bar is never quite the
// bar before it.
const HEART = ['K--h--K-S-h---h-', 'K--h--K-S-h--K-h'];
const CARRY = ['K-h-r-K-S-h-K-h-', 'K-h-r-K-S-hK--hr'];
const HALF  = ['K-------S-----h-', 'K-----K-S---h---'];
const BROOM = ['h-h-h-h-h-h-h-h-', 'h-h-h-hHh-h-h-hH'];

module.exports = {
  title: 'SUNDIAL',
  subtitle: 'A DAY, TAKEN APART',
  seed: 4871,
  key: 'F',
  mode: 'aeolian',
  drift: -7,          // cents flat. Tape that has been round the spool a while.
  colour: 'dawn',
  taster: 120,        // OPEN, where the desk preview tells the truth.

  motifs: {
    // The tune. Two bars of question, two of answer, and the answer ends a
    // step lower than it started, which is why it can be repeated for ever.
    A: {
      bars: [
        [[4, 4], [3, 2], [2, 2], [0, 4], [null, 4]],
        [[2, 4], [4, 4], [3, 6], [null, 2]],
        [[7, 4], [6, 2], [4, 2], [3, 4], [2, 4]],
        [[0, 6], [2, 4], [-1, 6]],
      ],
    },
    // The counter-line: higher, later, and it only ever appears over B.
    B: {
      bars: [
        [[null, 2], [4, 2], [5, 2], [7, 6], [null, 4]],
        [[6, 4], [4, 4], [2, 8]],
      ],
    },
    // The bell figure. Written for the electric piano and stolen by the choir
    // in the third movement.
    C: {
      bars: [
        [[0, 2], [2, 2], [4, 2], [7, 2], [4, 4], [2, 4]],
        [[-1, 2], [2, 2], [4, 2], [6, 2], [4, 8]],
      ],
    },
  },

  movements: [
    // --- I ------------------------------------------------------------------
    {
      name: 'I. FIRST LIGHT',
      bpm: 72,
      swing: 0.12,
      sections: [
        {
          name: 'HAZE',
          bars: 8,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.4, 0.72], open: [0.18, 0.4] },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: 0.5, open: [0.25, 0.5] },
          },
        },
        {
          name: 'THE LONG FIELD',
          bars: 12,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: 0.75, open: [0.4, 0.5] },
            bass: { pattern: 'roots', octave: 2, vel: 0.8, open: [0.24, 0.34] },
            keys: { motif: 'C', octave: 4, vel: [0.5, 0.72], open: [0.42, 0.6] },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: 0.45 },
          },
        },
        {
          name: 'CARRIAGE',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.72, open: 0.48 },
            bass: { pattern: 'dub', octave: 2, vel: 0.85, open: 0.36 },
            keys: { pattern: 'chime', octave: 4, slots: [0, 3, 7, 10, 14], density: [0.35, 0.62], vel: 0.64, open: 0.58 },
            beat: { pattern: 'kit', steps: HEART, vel: [0.68, 0.88], ghost: 0.35, open: [0.35, 0.55] },
            lead: { motif: 'A', octave: 5, vel: 0.74, open: [0.42, 0.6], transform: { ornament: 0.18 } },
            haze: { pattern: 'grain', octave: 5, density: 0.4 },
          },
        },
        {
          name: 'OPEN',
          bars: 12,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.78, open: [0.5, 0.68] },
            bass: { pattern: 'dub', octave: 2, vel: 0.88, open: 0.42 },
            keys: { pattern: 'chime', octave: 5, slots: [0, 5, 7, 11, 14], density: 0.46, vel: 0.58, open: 0.64 },
            beat: { pattern: 'kit', steps: CARRY, vel: 0.88, ghost: 0.42, open: 0.62 },
            arp: { pattern: 'run', octave: 5, every: 2, span: 5, dir: 'updown', drop: 0.16, vel: [0.36, 0.56], open: [0.52, 0.74] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, vel: [0.28, 0.58], open: [0.35, 0.56] },
            lead: { motif: 'B', octave: 5, vel: 0.74, open: 0.62, transform: { thin: 0.12 } },
            haze: { pattern: 'grain', octave: 5, density: 0.44 },
          },
        },
        {
          name: 'DUSTFALL',
          bars: 12,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.78, 0.5], open: [0.6, 0.26] },
            bass: { pattern: 'roots', octave: 2, vel: [0.85, 0.6], lift: 0.2, open: [0.4, 0.24] },
            keys: { pattern: 'chime', octave: 4, density: [0.5, 0.2], vel: 0.55, open: 0.5 },
            beat: { pattern: 'kit', steps: HALF, vel: [0.8, 0.45], open: [0.5, 0.3] },
            haze: { pattern: 'swells', every: 4, octave: 4, vel: [0.5, 0.7], open: [0.4, 0.6] },
          },
        },
      ],
    },

    // --- II -----------------------------------------------------------------
    {
      name: 'II. LONG DIVISION',
      bpm: 88,
      swing: 0.18,
      sections: [
        {
          name: 'COUNTING',
          bars: 8,
          chords: B,
          parts: {
            beat: { pattern: 'kit', steps: BROOM, vel: [0.4, 0.75], open: [0.3, 0.6] },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.7, open: 0.22 },
            haze: { pattern: 'grain', octave: 6, density: [0.3, 0.7] },
          },
        },
        {
          name: 'MACHINERY',
          bars: 16,
          chords: B,
          parts: {
            beat: { pattern: 'kit', steps: CARRY, vel: 0.88, ghost: 0.45, open: [0.45, 0.66] },
            bass: { pattern: 'dub', octave: 2, vel: 0.84, open: [0.32, 0.46] },
            arp: { pattern: 'run', octave: 5, every: 1, span: 5, dir: 'up', gate: 0.38, drop: [0.45, 0.18], vel: 0.5, open: [0.46, 0.76] },
            pad: { pattern: 'breathe', octave: 3, notes: 3, vel: 0.6, open: [0.35, 0.5] },
            keys: { pattern: 'stab', octave: 4, notes: 3, vel: [0.5, 0.7], open: 0.55 },
          },
        },
        {
          name: 'A FOURTH DOWN',
          bars: 16,
          chords: A,
          parts: {
            beat: { pattern: 'kit', steps: CARRY, vel: 0.86, ghost: 0.4, open: 0.64 },
            bass: { pattern: 'walk', octave: 2, vel: 0.8, open: 0.42 },
            // The tune again, three scale steps down, an octave up and with a
            // fifth of it thrown away. Same notes, and you would not swear to it.
            lead: { motif: 'A', octave: 5, vel: 0.72, open: [0.5, 0.72], transform: { steps: -3, thin: 0.28, ornament: 0.24 } },
            arp: { pattern: 'scatter', octave: 5, every: 1, span: 6, density: [0.35, 0.58], vel: 0.46, open: 0.74 },
            keys: { motif: 'C', octave: 5, vel: 0.56, open: 0.62, transform: { retro: true, thin: 0.12 } },
            haze: { pattern: 'grain', octave: 6, density: 0.5 },
          },
        },
        {
          name: 'THE WIDE PART',
          bars: 16,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.8, open: [0.5, 0.74] },
            choir: { pattern: 'oohs', octave: 4, notes: 4, vel: [0.45, 0.8], open: [0.4, 0.62] },
            bass: { pattern: 'dub', octave: 2, vel: 0.84, open: 0.46 },
            beat: { pattern: 'kit', steps: HEART, vel: 0.84, ghost: 0.36, open: 0.56 },
            lead: { motif: 'B', octave: 5, vel: 0.68, open: 0.66, transform: { ornament: 0.3, thin: 0.1 } },
            arp: { pattern: 'run', octave: 5, every: 2, span: 6, dir: 'updown', drop: 0.12, vel: 0.46, open: 0.72 },
          },
        },
        {
          name: 'STOPPING DOWN',
          bars: 16,
          chords: A,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.8, 0.55], open: [0.7, 0.24] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, vel: [0.75, 0.35], open: [0.6, 0.3] },
            beat: { pattern: 'kit', steps: HALF, vel: [0.85, 0.3], open: [0.5, 0.25] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.8, 0.55], open: 0.22 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.5, 0.8], open: [0.4, 0.55] },
          },
        },
      ],
    },

    // --- III ----------------------------------------------------------------
    {
      name: 'III. LONG LIGHT',
      bpm: 63,
      swing: 0.1,
      sections: [
        {
          name: 'EMBERS',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.5, 0.75], open: [0.14, 0.32] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.65, open: [0.3, 0.5] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: [0.2, 0.55], open: [0.28, 0.48] },
          },
        },
        {
          name: 'HALF SPEED',
          bars: 12,
          chords: C,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.72, open: 0.42 },
            bass: { pattern: 'hold', octave: 2, hold: 2, vel: 0.82, open: 0.26 },
            // The first movement's tune, each bar of it laid over two. It is
            // the only thing in the piece that is slower than it was written.
            lead: { motif: 'A', octave: 5, vel: 0.72, open: [0.42, 0.6], transform: { stretch: 2 } },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 2, vel: 0.6, open: 0.46 },
            haze: { pattern: 'grain', octave: 5, density: 0.35 },
          },
        },
        {
          name: 'EVERYTHING AT ONCE',
          bars: 16,
          chords: B,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 2, vel: 0.82, open: [0.45, 0.7] },
            bass: { pattern: 'roots', octave: 2, vel: 0.8, lift: 0.35, open: [0.3, 0.44] },
            keys: { pattern: 'chime', octave: 4, slots: [0, 3, 7, 12], density: 0.48, vel: 0.62, open: 0.62 },
            beat: { pattern: 'kit', steps: HALF, vel: [0.52, 0.78], ghost: 0.36, open: [0.4, 0.62] },
            choir: { motif: 'C', octave: 4, vel: 0.58, open: 0.52, transform: { stretch: 2 } },
            arp: { pattern: 'scatter', octave: 5, every: 2, span: 5, density: [0.24, 0.5], vel: 0.42, open: 0.68 },
            lead: { motif: 'A', octave: 5, vel: 0.64, open: 0.62, transform: { stretch: 2, thin: 0.34 } },
            haze: { pattern: 'grain', octave: 6, density: 0.42 },
          },
        },
        {
          name: 'ONE AT A TIME',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'wash', octave: 3, hold: 4, vel: [0.8, 0.6], open: [0.6, 0.3] },
            choir: { pattern: 'oohs', octave: 4, notes: 3, hold: 4, vel: [0.7, 0.4], open: [0.5, 0.3] },
            bass: { pattern: 'hold', octave: 2, hold: 4, vel: [0.8, 0.5], open: 0.2 },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: 0.7, open: 0.45 },
          },
        },
        {
          name: 'GONE',
          bars: 8,
          chords: C,
          parts: {
            pad: { pattern: 'drone', octave: 2, hold: 8, vel: [0.65, 0.28], open: [0.28, 0.1] },
            haze: { pattern: 'swells', every: 4, octave: 3, vel: [0.7, 0.3], open: [0.45, 0.2] },
          },
        },
      ],
    },
  ],
};

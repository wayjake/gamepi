'use strict';
// "Vice" -- the title and daytime theme for src/games/kingpin.js.
//
// The brief was an eighties cop show, and an eighties cop show is a synth
// arpeggio that never stops, a bass that pulses on every eighth, and one long
// melody line held over the top of both. The arpeggio and the bass come free
// from the chord list -- song.js derives them -- so the score is only the line.
//
// D minor, because every one of those themes was in D minor. The progression is
// i-VI-III-VII and then i-VI-iv-V, which is the same four bars twice with a
// different door at the end: bar 8 leans on A major, so the loop turns over as
// a cadence rather than a repeat.
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Vice',
  bpm: 118,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['D5', 8], ['F5', 4], ['A5', 4]],                     //  1  the shape of it
    [['Bb5', 6], ['A5', 2], ['F5', 8]],                    //  2
    [['C5', 4], ['D5', 4], ['F5', 8]],                     //  3
    [['E5', 6], ['D5', 2], ['C5', 8]],                     //  4  settles

    [['D5', 4], ['F5', 4], ['A5', 4], ['D6', 4]],          //  5  an octave up
    [['C6', 6], ['Bb5', 2], ['A5', 8]],                    //  6
    [['G5', 4], ['Bb5', 4], ['D6', 4], ['C6', 4]],         //  7  over the minor iv
    [['C#6', 6], ['E5', 2], ['A5', 8]],                    //  8  the dominant, once
  ],

  chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],

  // Gated eighties drums: kick and snare square on the beat, hats on the
  // eighths, and a fill only where the loop turns over.
  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-hSS-S-',
  ],
};

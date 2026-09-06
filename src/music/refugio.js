'use strict';
// "Refugio" -- the town theme for src/games/border.js.
//
// The first thing you hear after the chase, on the dirt road out and in the
// town at the end of it. Everything about the run was minor, fast and refused
// to resolve; this is the opposite on purpose -- F major at a walking pace, a
// tune that lands on the tonic every fourth bar, and a bass that walks rather
// than pushes. A norteño waltz would be the honest choice, but the score
// contract is 4/4, so it borrows the feel instead: the bass on one and three,
// the accompaniment answering on two and four.
//
// F major, 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js
// asserts it). Bar 8 sits on F for most of a bar so the loop breathes.

module.exports = {
  title: 'Refugio',
  bpm: 96,
  bassOctave: 2,
  arpOctave: 4,

  //        A: the tune, twice, the second time reaching higher
  lead: [
    [['A4', 4], ['C5', 4], ['F5', 6], ['E5', 2]],                    //  1  up to the roof
    [['D5', 4], ['F5', 4], ['D5', 4], ['C5', 4]],                    //  2  and down again
    [['E5', 4], ['G5', 4], ['E5', 4], ['D5', 4]],                    //  3  the dominant, gently
    [['C5', 8], [null, 4], ['A4', 4]],                               //  4  home, and a breath

    //      B: the same shape a third up, and the resolution
    [['D5', 4], ['F5', 4], ['A5', 6], ['G5', 2]],                    //  5
    [['F5', 4], ['D5', 4], ['Bb4', 4], ['D5', 4]],                   //  6
    [['C5', 4], ['E5', 4], ['G5', 4], ['E5', 4]],                    //  7
    [['F5', 10], [null, 6]],                                         //  8  and rests on it
  ],

  chords: ['F', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C', 'F'],

  // Brushes: a kick on one and three, the snare only on four, and hats on the
  // offbeats. It should feel like somebody keeping time on the dashboard.
  drums: [
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h-S-hh',
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h-S-h-',
    'K-h---h-K-h---h-',
  ],
};

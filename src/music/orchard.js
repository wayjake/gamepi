'use strict';
// "Orchard" -- fruit falling, for Tomo's catching minigame.
//
// F major, skipping: pairs of eighths that land on a longer note, so it
// reads as a hop-hop-step. The chord changes every bar and the drums push
// with a kick on every beat and a hat between, which is a countdown before
// the screen has said so.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Orchard',
  bpm: 120,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['F5', 2], ['G5', 2], ['A5', 4], ['C6', 2], ['A5', 2], ['F5', 4]],   //  1  hop hop step
    [['D5', 2], ['F5', 2], ['Bb5', 4], ['D6', 2], ['Bb5', 2], ['F5', 4]], //  2  on the fourth
    [['E5', 2], ['G5', 2], ['C6', 4], ['G5', 2], ['E5', 2], ['C5', 4]],   //  3  on the fifth
    [['A5', 2], ['G5', 2], ['F5', 4], ['C5', 8]],                         //  4  and down
    [['D5', 2], ['F5', 2], ['A5', 4], ['D6', 2], ['A5', 2], ['F5', 4]],   //  5  the minor
    [['Bb5', 2], ['A5', 2], ['G5', 4], ['F5', 2], ['G5', 2], ['A5', 4]],  //  6
    [['G5', 2], ['A5', 2], ['Bb5', 4], ['D6', 2], ['Bb5', 2], ['G5', 4]], //  7  the top
    [['G5', 4], ['E5', 4], ['C5', 4], [null, 4]],                         //  8  turn round
  ],

  chords: ['F', 'Bb', 'C', 'F', 'Dm', 'Bb', 'Gm', 'C'],

  drums: [
    'K-h-K-h-K-h-K-h-',
    'K-h-K-h-K-h-K-h-',
    'K-h-K-h-K-h-K-h-',
    'K-h-K-h-S---S---',
    'K-h-K-h-K-h-K-h-',
    'K-h-K-h-K-h-K-h-',
    'K-h-K-h-K-h-K-h-',
    'K-h-S---S---S---',
  ],
};

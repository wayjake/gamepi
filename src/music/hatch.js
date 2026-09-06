'use strict';
// "Hatch" -- Tomo's character creation and hatching.
//
// C major, quick and sparkly, up in the sixth octave where the pulse wave
// glitters: something is about to happen and nobody knows what. The hats
// run on every eighth so it fidgets, and the last bar holds a high C.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Hatch',
  bpm: 124,
  bassOctave: 3,
  arpOctave: 5,

  lead: [
    [['C6', 2], ['E6', 2], ['G6', 4], ['E6', 2], ['C6', 2], ['G5', 4]],   //  1  up the triad
    [['A5', 2], ['C6', 2], ['E6', 4], ['C6', 2], ['A5', 2], ['E5', 4]],   //  2  the relative minor
    [['F5', 2], ['A5', 2], ['C6', 4], ['A5', 2], ['F5', 2], ['C5', 4]],   //  3  subdominant
    [['G5', 4], ['E5', 4], ['C5', 8]],                                    //  4  settle
    [['C6', 2], ['E6', 2], ['G6', 4], ['E6', 2], ['C6', 2], ['G5', 4]],   //  5  again
    [['A5', 2], ['C6', 2], ['E6', 4], ['C6', 2], ['A5', 2], ['E5', 4]],   //  6
    [['F5', 2], ['A5', 2], ['C6', 2], ['E6', 2], ['D6', 4], ['C6', 4]],   //  7  reaching
    [['C6', 12], [null, 4]],                                              //  8  a held high C
  ],

  chords: ['C', 'Am', 'F', 'C', 'C', 'Am', 'F', 'C'],

  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-------S-------',
  ],
};

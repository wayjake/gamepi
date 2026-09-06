'use strict';
// "Sprout" -- spring on the farm in src/games/meadowlark.js.
//
// C major, quick, and skipping: the lead opens each phrase with two sixteenths
// before it lands, which is what makes it sound like something coming up out
// of the ground rather than being laid on top of it. The hats run straight
// through; the whole season is in a hurry.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Sprout',
  bpm: 116,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['E5', 2], ['G5', 2], ['C6', 4], ['G5', 4], ['E5', 4]],   //  1  up and over
    [['A5', 4], ['C6', 2], ['B5', 2], ['A5', 4], ['E5', 4]],   //  2  the relative minor, briefly
    [['F5', 2], ['A5', 2], ['C6', 4], ['A5', 4], ['F5', 4]],   //  3  the same skip, on F
    [['G5', 4], ['E5', 4], ['C5', 8]],                          //  4  and down to rest
    [['D5', 2], ['F5', 2], ['A5', 4], ['F5', 4], ['D5', 4]],   //  5  the answer
    [['C5', 4], ['A5', 4], ['F5', 8]],                          //  6
    [['E5', 2], ['G5', 2], ['E5', 4], ['C5', 4], ['A4', 4]],   //  7  falling
    [['C5', 12], [null, 4]],                                    //  8  home
  ],

  chords: ['C', 'Am', 'F', 'C', 'Dm', 'F', 'Am', 'C'],

  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-hhK-K-S---',
  ],
};

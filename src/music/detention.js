'use strict';
// "Detention" -- what plays under every boss in src/games/knuckles.js.
//
// One theme for all five, the same way City of Angels does it: the boss is
// the same event happening in a different room. A minor at 168, a stuttered
// root that keeps kicking the lead up an octave, and the A major in bar 8 to
// throw it back to the start.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Detention',
  bpm: 168,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 2], ['A4', 2], ['C5', 4], ['E5', 4], ['A5', 4]],  //  1  kicked up
    [['G5', 4], ['E5', 4], ['C5', 8]],                        //  2
    [['D5', 2], ['D5', 2], ['F5', 4], ['A5', 4], ['D6', 4]],  //  3  kicked higher
    [['C6', 4], ['A5', 4], ['E5', 8]],                        //  4
    [['F5', 4], ['A5', 4], ['C6', 4], ['F5', 4]],             //  5
    [['E5', 4], ['G5', 4], ['C6', 4], ['G5', 4]],             //  6
    [['D5', 4], ['F5', 4], ['A5', 4], ['D6', 4]],             //  7
    [['C#5', 4], ['E5', 4], ['A5', 4], ['E5', 4]],            //  8  thrown back
  ],

  chords: ['Am', 'C', 'Dm', 'Am', 'F', 'C', 'Dm', 'A'],

  drums: [
    'K-K-h-K-S---h-K-',
    'K-K-h---S---h-h-',
    'K-K-h-K-S---h-K-',
    'K-K-h---S-h-hhh-',
    'K-K-h-K-S---h-K-',
    'K-K-h---S---h-h-',
    'K-K-h-K-S---h-K-',
    'K-K-h---SSh-hSSS',
  ],
};

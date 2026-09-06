'use strict';
// "Gym Class" -- the gym, stage two of src/games/knuckles.js.
//
// D minor at 160, and the kick never stops: it is a dodgeball game, and you
// are the target. The lead is a two-note stutter that keeps trying to climb
// out and gets sent back to the baseline.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Gym Class',
  bpm: 160,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 2], ['D5', 2], ['F5', 4], ['A5', 4], ['F5', 4]],  //  1  the stutter
    [['G5', 4], ['F5', 4], ['D5', 8]],                        //  2
    [['Bb4', 4], ['D5', 4], ['F5', 4], ['Bb5', 4]],           //  3  climbing
    [['A5', 6], ['G5', 6], ['E5', 4]],                        //  4  sent back
    [['D5', 2], ['D5', 2], ['F5', 4], ['A5', 4], ['D6', 4]],  //  5  the stutter, higher
    [['C6', 4], ['A5', 4], ['F5', 8]],                        //  6
    [['G5', 4], ['Bb5', 4], ['D6', 4], ['Bb5', 4]],           //  7
    [['A5', 4], ['C#5', 4], ['E5', 4], ['A4', 4]],            //  8  A major: round again
  ],

  chords: ['Dm', 'Gm', 'Bb', 'C', 'Dm', 'F', 'Gm', 'A'],

  drums: [
    'K-K-S-K-K-K-S-h-',
    'K-K-S-K-K-K-S-hh',
    'K-K-S-K-K-K-S-h-',
    'K-K-S-K-K-K-SSSh',
    'K-K-S-K-K-K-S-h-',
    'K-K-S-K-K-K-S-hh',
    'K-K-S-K-K-K-S-h-',
    'K-K-S-K-KKSSSSSS',
  ],
};

'use strict';
// "Hearth" -- winter on the farm in src/games/meadowlark.js.
//
// A minor, slow, and mostly space. The lead is long notes with a step between
// them and a whole bar of rest in the middle; the drums are a single soft hat
// on the downbeat, with the snare turning up only at the end of each half.
// After three seasons of a full kit the quiet is the point: nothing is growing,
// and the music says so.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Hearth',
  bpm: 78,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['E5', 8], ['A4', 8]],                 //  1  a fifth, falling
    [['C5', 6], ['D5', 2], ['E5', 8]],      //  2  climbing back
    [['F5', 8], ['E5', 4], ['D5', 4]],      //  3  the sixth, and down
    [['C5', 12], [null, 4]],                //  4  rest
    [['E5', 4], ['G5', 4], ['C6', 8]],      //  5  the one bright bar
    [['A5', 8], ['F5', 8]],                 //  6
    [['D5', 4], ['F5', 4], ['E5', 8]],      //  7  leaning on the fifth
    [['A4', 16]],                           //  8  and settling
  ],

  chords: ['Am', 'F', 'Dm', 'Am', 'C', 'F', 'Dm', 'Am'],

  drums: [
    'h---------------',
    'h---------------',
    'h---------------',
    'h-------S-------',
    'h---------------',
    'h---------------',
    'h---------------',
    'h-------S---h---',
  ],
};

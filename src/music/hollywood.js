'use strict';
// "Hollywood" -- the theme for the third region of src/games/angels.js.
//
// A minor with the major third dropped in twice (bars 4 and 8), which is the
// cheapest trick there is for making something sound expensive and false at the
// same time. Faster than the other two region themes and with a hat on every
// offbeat, so the place reads as busy rather than dangerous.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Hollywood',
  bpm: 124,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['E5', 4], ['A5', 4], ['E5', 4], ['C5', 4]],   //  1  the marquee
    [['F5', 6], ['A5', 4], ['C6', 6]],              //  2  the top of the track
    [['G5', 4], ['E5', 4], ['C5', 8]],              //  3
    [['C#5', 4], ['E5', 4], ['A5', 8]],             //  4  major, and it means nothing

    [['D5', 4], ['F5', 4], ['A5', 4], ['F5', 4]],   //  5
    [['Bb4', 4], ['D5', 4], ['F5', 8]],             //  6
    [['E5', 6], ['C5', 4], ['A4', 6]],              //  7  down to the pavement
    [['E5', 8], ['A4', 8]],                         //  8
  ],

  chords: ['Am', 'F', 'C', 'A', 'Dm', 'Bb', 'Am', 'A'],

  drums: [
    'K---h-h-S---h-h-',
    'K---h-h-S---h-h-',
    'K---h-h-S---h-h-',
    'K-K-h-h-S-h-h-h-',
    'K---h-h-S---h-h-',
    'K---h-h-S---h-h-',
    'K---h-h-S---h-h-',
    'K-K-h-h-S-h-h-h-',
  ],
};

'use strict';
// "Venice" -- the theme for the second region of src/games/angels.js.
//
// The one major-key track in the game. F, an open lead in fourths and fifths,
// and a straight hat part: after twenty minutes of D minor the ear reads this
// as daylight, which is the whole job. Bar 8 is a single held F, so the loop
// has somewhere to breathe before it comes round.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Venice',
  bpm: 104,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['C5', 4], ['F5', 4], ['A5', 8]],          //  1  straight up the chord
    [['G5', 4], ['E5', 4], ['C5', 8]],          //  2  and back
    [['D5', 6], ['F5', 4], ['A5', 6]],          //  3
    [['Bb4', 4], ['D5', 4], ['F5', 8]],         //  4

    [['A4', 4], ['C5', 4], ['F5', 8]],          //  5  the opening, lower
    [['D5', 4], ['F5', 4], ['Bb5', 8]],         //  6  the high point of the loop
    [['A5', 4], ['G5', 4], ['E5', 8]],          //  7  coming down
    [['F5', 16]],                               //  8  and holding
  ],

  chords: ['F', 'C', 'Dm', 'Bb', 'F', 'Bb', 'C', 'F'],

  drums: [
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K-K-h---S---hhh-',
  ],
};

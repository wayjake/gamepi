'use strict';
// "Field Day" -- the soccer field and the basketball courts, stages three and
// four of src/games/knuckles.js.
//
// F major at 150 and outdoors: the only stage theme in a major key, because
// the sky is in it. The lead runs up the chord in bar 1 and spends the rest
// of the loop coming back down in different ways.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Field Day',
  bpm: 150,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['F5', 4], ['A5', 4], ['C6', 4], ['A5', 4]],         //  1  up the chord
    [['G5', 6], ['E5', 6], ['C5', 4]],                    //  2  and down
    [['D5', 4], ['F5', 4], ['A5', 8]],                    //  3
    [['Bb5', 4], ['A5', 4], ['F5', 8]],                   //  4
    [['F5', 4], ['G5', 4], ['A5', 4], ['C6', 4]],         //  5  a walk up
    [['E5', 4], ['G5', 4], ['C6', 8]],                    //  6
    [['D6', 4], ['Bb5', 4], ['G5', 4], ['D5', 4]],        //  7  the long way down
    [['E5', 6], ['G5', 6], ['C5', 4]],                    //  8  round again
  ],

  chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Gm', 'C'],

  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-SSh-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-KhSSSS',
  ],
};

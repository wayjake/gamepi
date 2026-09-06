'use strict';
// "Meadow" -- the title theme for src/games/meadowlark.js.
//
// F major at a walking pace, with the lead sitting on the chord tones and
// stepping between them the way a folk tune does. The drums are brushed: a
// kick and a snare a bar apart, a hat where the bar breathes. Bar 8 holds the
// tonic and then rests, so the loop has a moment of silence to come round in.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Meadow',
  bpm: 96,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['F5', 4], ['A5', 4], ['G5', 4], ['F5', 4]],     //  1  the tune, stated
    [['D5', 6], ['F5', 2], ['D5', 8]],                //  2  down to the sixth
    [['E5', 4], ['G5', 4], ['C5', 8]],                //  3  the dominant
    [['A4', 4], ['C5', 4], ['F5', 8]],                //  4  and home
    [['D5', 4], ['F5', 4], ['A5', 8]],                //  5  the same shape, minor
    [['Bb5', 4], ['A5', 4], ['F5', 8]],               //  6  the high point
    [['G5', 6], ['E5', 2], ['C5', 8]],                //  7  coming down
    [['F5', 12], [null, 4]],                          //  8  and a breath
  ],

  chords: ['F', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C', 'F'],

  drums: [
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h-h-',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S-------',
  ],
};

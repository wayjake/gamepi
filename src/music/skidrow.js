'use strict';
// "Skid Row" -- the theme for the first region of src/games/angels.js.
//
// D minor, and a bar that will not sit still: the kick lands twice before the
// snare every bar, which is what makes it feel like it is walking faster than
// you are. The lead is nearly all steps of a second or a third -- it never gets
// far from where it started, and that is the point of the place it is under.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Skid Row',
  bpm: 116,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 4], ['D5', 2], ['F5', 4], ['E5', 6]],   //  1
    [['D5', 4], ['A4', 4], ['D5', 8]],              //  2
    [['Bb4', 4], ['D5', 4], ['F5', 8]],             //  3  the flat side
    [['C5', 4], ['E5', 4], ['G5', 4], ['E5', 4]],   //  4

    [['D5', 6], ['F5', 2], ['A5', 8]],              //  5  it finally gets up
    [['G5', 4], ['Bb5', 4], ['A5', 8]],             //  6  and hangs there
    [['F5', 4], ['D5', 4], ['Bb4', 8]],             //  7
    [['C#5', 4], ['E5', 4], ['A4', 8]],             //  8  the dominant, turning over
  ],

  chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Gm', 'Bb', 'A'],

  drums: [
    'K---h-K-S---h---',
    'K---h-K-S---h-h-',
    'K---h-K-S---h---',
    'K---h-K-S-h-h-h-',
    'K---h-K-S---h---',
    'K---h-K-S---h-h-',
    'K---h-K-S---h---',
    'K---h-K-S-h-h-h-',
  ],
};

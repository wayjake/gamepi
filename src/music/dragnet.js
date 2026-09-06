'use strict';
// "Dragnet" -- what plays in src/games/kingpin.js once the heat is on.
//
// Same instruments as "Vice", forty beats a minute faster and a fourth up, so
// the ear reads it as the same show with the sirens going. The lead runs in
// sixteenths through the chord and never holds anything longer than a beat --
// a chase theme that breathes is not a chase theme.
//
// A minor, 4/4; every bar sums to 16 (src/audio/song.js asserts it). Bar 8
// lands on A major, which is wrong for the key and right for the mood.

module.exports = {
  title: 'Dragnet',
  bpm: 160,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['A4', 2], ['C5', 2], ['E5', 2], ['A5', 2], ['E5', 2], ['C5', 2], ['A4', 2], ['C5', 2]],  //  1
    [['E5', 2], ['A5', 2], ['C6', 2], ['A5', 2], ['E5', 2], ['C5', 2], ['E5', 4]],             //  2
    [['D5', 2], ['F5', 2], ['A5', 2], ['D6', 2], ['A5', 2], ['F5', 2], ['D5', 2], ['F5', 2]],  //  3  over Dm
    [['A5', 2], ['D6', 2], ['A5', 2], ['F5', 2], ['D5', 2], ['F5', 2], ['A5', 4]],             //  4

    [['F5', 2], ['A5', 2], ['C6', 2], ['A5', 2], ['C6', 2], ['A5', 2], ['F5', 2], ['A5', 2]],  //  5  over F
    [['C6', 4], ['A5', 4], ['F5', 4], ['E5', 4]],                                              //  6  falls
    [['A5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['A4', 2], ['C5', 2], ['E5', 2], ['G5', 2]],  //  7
    [['A5', 4], ['C#6', 4], ['E6', 4], ['E5', 4]],                                             //  8  the major, sharp
  ],

  chords: ['Am', 'Am', 'Dm', 'Dm', 'F', 'F', 'Am', 'A'],

  // Four on the floor, hats on every eighth, and the kick doubled into beat
  // three so it pushes.
  drums: [
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-h-S-hh',
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-h-S-h-',
    'K-h-S-hKK-hSS-Sh',
  ],
};

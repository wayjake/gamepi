'use strict';
// "Gleaning" -- autumn on the farm in src/games/meadowlark.js.
//
// D minor, slower, and warmer than that sounds: the lead leans on the sixth
// and the seventh (Bb, C) rather than the fifth, which is what gives a minor
// tune its harvest-supper colour instead of its graveyard one. Bar 6 climbs to
// a high D over G minor and bar 7 comes home through the A major, the only
// dominant the chord table has.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Gleaning',
  bpm: 100,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 4], ['F5', 4], ['A5', 6], ['G5', 2]],     //  1  up the triad, with a turn
    [['F5', 4], ['D5', 4], ['Bb4', 8]],               //  2  down onto the sixth
    [['C5', 4], ['A4', 4], ['F5', 8]],                //  3  the relative major
    [['E5', 4], ['G5', 4], ['C5', 8]],                //  4
    [['D5', 4], ['A5', 4], ['F5', 4], ['D5', 4]],     //  5  the opening, wider
    [['G5', 4], ['Bb5', 4], ['D6', 8]],               //  6  the top of the loop
    [['C#5', 4], ['E5', 4], ['A5', 8]],               //  7  the dominant
    [['D5', 16]],                                     //  8  home, and held
  ],

  chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Gm', 'A', 'Dm'],

  drums: [
    'K---h-S---K-h---',
    'K---h-S---K-h---',
    'K---h-S---K-h---',
    'K---h-S---K-hh--',
    'K---h-S---K-h---',
    'K---h-S---K-h---',
    'K---h-S---K-h---',
    'K---h-S-----h---',
  ],
};

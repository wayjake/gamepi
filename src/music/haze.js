'use strict';
// "Haze" -- summer on the farm in src/games/meadowlark.js.
//
// A minor at the fastest tempo of the four, with hats on every eighth: heat
// shimmer. The lead climbs a little further each phrase until bar 6 tops out
// on a high C, then the last bar turns the A minor into an A major -- the one
// bright chord the synth's chord table has -- so the loop lands in sunshine
// before it starts again.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Haze',
  bpm: 124,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 4], ['C5', 4], ['E5', 4], ['D5', 4]],                          //  1  up the chord
    [['C5', 6], ['A4', 2], ['C5', 8]],                                     //  2  and back
    [['E5', 4], ['G5', 4], ['E5', 4], ['C5', 4]],                          //  3  higher
    [['D5', 4], ['F5', 4], ['A5', 8]],                                     //  4  higher still
    [['E5', 2], ['A5', 2], ['E5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],    //  5  the shimmer
    [['F5', 4], ['A5', 4], ['C6', 8]],                                     //  6  the top
    [['A5', 4], ['F5', 4], ['D5', 4], ['E5', 4]],                          //  7  coming down
    [['C#5', 8], ['E5', 8]],                                               //  8  the major third
  ],

  chords: ['Am', 'F', 'C', 'Dm', 'Am', 'F', 'Dm', 'A'],

  drums: [
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-hhSShh',
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-hhS-hh',
    'K-hhS-hhK-K-S---',
  ],
};

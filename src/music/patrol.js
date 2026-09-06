'use strict';
// "Patrol" -- the menu theme for src/games/border.js.
//
// The one that plays while nobody is driving: the title card, the car lot and
// the score board. Every cop show of the era opened the same way -- a minor-key
// stab figure over a walking bass, stated twice, answered a fourth up, and back
// round without ever arriving anywhere. That refusal to resolve is the whole
// trick; it is why a title sequence can loop for a minute and not nag.
//
// D minor, 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js
// asserts it). Bar 7 turns to A major, whose C# leans back into bar 1.

module.exports = {
  title: 'Patrol',
  bpm: 108,
  bassOctave: 3,
  arpOctave: 4,

  //        A: the stab figure, stated and answered
  lead: [
    [['D5', 2], [null, 2], ['D5', 2], ['F5', 2], ['E5', 4], ['D5', 4]],   //  1  the hook
    [['F5', 2], [null, 2], ['F5', 2], ['A5', 2], ['G5', 4], ['F5', 4]],   //  2  same shape, up a third
    [['E5', 2], [null, 2], ['E5', 2], ['G5', 2], ['F5', 4], ['E5', 4]],   //  3  leans on C
    [['D5', 8], [null, 8]],                                               //  4  and lets it hang

    //      B: a fourth up, then the turnaround
    [['G5', 2], [null, 2], ['G5', 2], ['Bb5', 2], ['A5', 4], ['G5', 4]],  //  5
    [['F5', 4], ['D5', 4], ['F5', 4], ['A5', 4]],                         //  6  walks it back down
    [['E5', 4], ['C#5', 4], ['E5', 6], [null, 2]],                        //  7  A major arrives
    [['A4', 6], ['C#5', 6], ['E5', 4]],                                   //  8  and points at bar 1
  ],

  chords: ['Dm', 'Bb', 'C', 'Dm', 'Gm', 'Bb', 'A', 'A'],

  // Backbeat, hats on the offbeats, and a kick that pushes the second half of
  // the bar. Bar 8 gets the only fill, to mark the seam.
  drums: [
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhS-hS',
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhS-hh',
    'K-hhS-hhK-KhSSSS',
  ],
};

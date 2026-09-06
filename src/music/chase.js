'use strict';
// "Chase" -- what plays while you are actually driving, in src/games/border.js.
//
// Deliberately not the menu theme. "Patrol" sits still and waits; this one has
// somewhere to be. Faster, a key up, and the lead runs in sixteenths through
// the chord rather than stabbing at it, so the ear reads it as motion. The
// blips over the top -- engine, ramming, sirens -- all sit low and short, so
// there is room under this for them without it having to duck.
//
// A minor, 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js
// asserts it). Bar 8 falls back to the A it started on, no fanfare.

module.exports = {
  title: 'Chase',
  bpm: 154,
  bassOctave: 3,
  arpOctave: 4,

  //        A: the run, up and back down the chord
  lead: [
    [['A4', 2], ['C5', 2], ['E5', 2], ['A5', 2], ['E5', 2], ['C5', 2], ['A4', 4]],  //  1
    [['B4', 2], ['C5', 2], ['E5', 2], ['B4', 2], ['A4', 8]],                        //  2  and breathes
    [['F5', 2], ['E5', 2], ['C5', 2], ['A4', 2], ['C5', 2], ['E5', 2], ['F5', 4]],  //  3  over F
    [['E5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['E5', 8]],                        //  4  over C

    //      B: the same idea, higher, then home
    [['A5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['E5', 2], ['G5', 2], ['A5', 4]],  //  5
    [['D5', 2], ['F5', 2], ['A5', 2], ['D6', 2], ['A5', 2], ['F5', 2], ['D5', 4]],  //  6  the top of it
    [['C6', 4], ['A5', 4], ['F5', 4], ['E5', 4]],                                   //  7  falls
    [['E5', 2], ['D5', 2], ['C5', 2], ['B4', 2], ['A4', 8]],                        //  8  lands on A
  ],

  chords: ['Am', 'Am', 'F', 'C', 'Am', 'Dm', 'F', 'C'],

  // Four on the floor with the hats on the eighths -- it is a car chase, and a
  // car chase does not swing. Bar 8 pushes into the loop rather than resting.
  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-hh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-KhSSSh',
  ],
};

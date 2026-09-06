'use strict';
// "Attract" -- the boot and menu loop for src/games/pong.js.
//
// A menu theme has a job the overworld theme doesn't: it plays while nothing is
// happening, on repeat, possibly for a long time. So it stays out of the way --
// eight bars, no climb to a climax, and it ends where it started so the seam
// doesn't announce itself.
//
// A minor, 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js
// asserts it). The turnaround is the one bit of movement: bar 8 goes to A
// major, whose C# leans back into bar 1.

module.exports = {
  title: 'Attract',
  bpm: 150,
  bassOctave: 3,
  arpOctave: 4,

  //        A: the figure, stated twice
  lead: [
    [['A4', 4], ['C5', 4], ['E5', 4], ['C5', 4]],         //  1  up and back
    [['F5', 6], ['E5', 6], ['C5', 4]],                    //  2  leans on F
    [['G4', 4], ['C5', 4], ['E5', 6], [null, 2]],         //  3  same shape, brighter
    [['A4', 8], [null, 8]],                               //  4  and lets it hang

    //      B: the same idea a fourth up, then the turnaround
    [['D5', 4], ['F5', 4], ['A5', 4], ['F5', 4]],         //  5
    [['Bb5', 6], ['A5', 6], ['F5', 4]],                   //  6  the flat six
    [['G5', 4], ['E5', 4], ['C5', 6], [null, 2]],         //  7  falls home
    [['A4', 6], ['C#5', 6], ['E5', 4]],                   //  8  A major: back to bar 1
  ],

  chords: ['Am', 'F', 'C', 'Am', 'Dm', 'Bb', 'C', 'A'],

  // Straight eighths on the hat, kick on one and three. It is a menu, not a
  // dance floor -- bar 8 gets the only fill, to mark the loop.
  drums: [
    'K--hS--hK--hS--h',
    'K--hS--hK--hS--h',
    'K--hS--hK--hS--h',
    'K--hS--hK--hS-Sh',
    'K--hS--hK--hS--h',
    'K--hS--hK--hS--h',
    'K--hS--hK--hS--h',
    'K--hS--hK-KhSSSS',
  ],
};

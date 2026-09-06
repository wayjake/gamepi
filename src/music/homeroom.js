'use strict';
// "Homeroom" -- the hallways, stage one of src/games/knuckles.js.
//
// A minor at 132: cautious, on its toes, a first day. The lead keeps landing
// on the same E and being pulled off it, which is what walking down a corridor
// full of eighth graders feels like.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Homeroom',
  bpm: 132,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 4], ['C5', 4], ['E5', 4], ['D5', 4]],         //  1
    [['C5', 8], ['B4', 4], ['A4', 4]],                    //  2
    [['F5', 4], ['E5', 4], ['D5', 4], ['C5', 4]],         //  3  down the stairs
    [['E5', 12], [null, 4]],                              //  4  and holds
    [['D5', 4], ['F5', 4], ['A5', 4], ['F5', 4]],         //  5  up a fourth
    [['E5', 4], ['C5', 4], ['A4', 8]],                    //  6
    [['F5', 4], ['G5', 4], ['A5', 6], [null, 2]],         //  7  the one bright bar
    [['G5', 4], ['E5', 4], ['C5', 4], ['B4', 4]],         //  8  back round
  ],

  chords: ['Am', 'C', 'F', 'Am', 'Dm', 'Am', 'F', 'C'],

  drums: [
    'K--hS--hK--hS--h',
    'K--hS--hK--hS-h-',
    'K--hS--hK--hS--h',
    'K--hS--hK-KhS-Sh',
    'K--hS--hK--hS--h',
    'K--hS--hK--hS-h-',
    'K--hS--hK--hS--h',
    'K--hS--hK-KhSSSS',
  ],
};

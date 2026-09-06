'use strict';
// "Juggle" -- keepy-uppy, for Tomo's football minigame.
//
// C major at a run, on a 3-3-2 rhythm: every bar is two dotted eighths and
// an eighth, twice, and the kick sits on the same figure, so the tune bounces
// the way the ball does. The last bar breaks the pattern so the loop is
// audible as a loop.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Juggle',
  bpm: 138,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['E5', 3], ['E5', 3], ['G5', 2], ['E5', 3], ['D5', 3], ['C5', 2]],   //  1  the figure
    [['F5', 3], ['F5', 3], ['A5', 2], ['F5', 3], ['E5', 3], ['D5', 2]],   //  2  up a fourth
    [['E5', 3], ['G5', 3], ['C6', 2], ['G5', 3], ['E5', 3], ['G5', 2]],   //  3  the triad, up
    [['A5', 3], ['E5', 3], ['A5', 2], ['E5', 3], ['C5', 3], ['E5', 2]],   //  4  relative minor
    [['G5', 3], ['E5', 3], ['C5', 2], ['G5', 3], ['E5', 3], ['C5', 2]],   //  5  the triad, down
    [['A5', 3], ['F5', 3], ['C5', 2], ['A5', 3], ['F5', 3], ['C5', 2]],   //  6
    [['D6', 3], ['A5', 3], ['F5', 2], ['D6', 3], ['A5', 3], ['F5', 2]],   //  7  the high point
    [['E6', 3], ['C6', 3], ['G5', 2], ['E5', 4], [null, 4]],              //  8  and a breath
  ],

  chords: ['C', 'F', 'C', 'Am', 'C', 'F', 'Dm', 'C'],

  drums: [
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K-hS-S--',
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K-hK-hS-',
    'K-hK-hS-K---S---',
  ],
};

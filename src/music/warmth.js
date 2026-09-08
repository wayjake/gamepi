'use strict';
// "Warmth" -- the same night as "lamplight", once the room has come round.
//
// Same key, same drum feel, a quarter faster and an octave wider. The tune is
// no longer sitting on one note waiting: it moves every four ticks, the
// chords open out of the A major into F and Bb, and the shaker runs the whole
// bar. Nothing here is a new idea -- the point is that the player should not
// notice a track change, only that the room got better.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Warmth',
  bpm: 112,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['D5', 4], ['F5', 4], ['A5', 4], ['G5', 4]],
    [['F5', 6], ['E5', 2], ['D5', 8]],
    [['F5', 4], ['A5', 4], ['D6', 8]],
    [['C6', 6], ['A5', 2], ['G5', 8]],
    [['A5', 4], ['G5', 4], ['F5', 4], ['E5', 4]],
    [['D5', 8], ['F5', 8]],
    [['G5', 4], ['A5', 4], ['C6', 8]],
    [['D6', 12], [null, 4]],
  ],

  chords: ['Dm', 'F', 'Bb', 'C', 'Dm', 'F', 'C', 'Dm'],

  drums: [
    'K-h-h-h-K-h-h-h-',
    'K-h-h-h-K-h-hSh-',
    'K-h-h-h-K-h-h-h-',
    'K-h-hKh-K-h-hSh-',
    'K-h-h-h-K-h-h-h-',
    'K-h-h-h-K-h-hSh-',
    'K-h-h-h-K-h-h-h-',
    'K-h-hKh-KShSh-hh',
  ],
};

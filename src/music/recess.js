'use strict';
// "Recess" -- the title and menu theme for src/games/knuckles.js.
//
// The one bright thing in a day of middle school. C major, 140, a four-note
// figure that goes up and comes back, and no fill until the last bar so it can
// loop under the menu without drawing attention to the seam.
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Recess',
  bpm: 140,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['C5', 4], ['E5', 4], ['G5', 4], ['E5', 4]],         //  1  the figure
    [['A5', 6], ['G5', 6], ['E5', 4]],                    //  2  leans on the six
    [['D5', 4], ['F5', 4], ['A5', 4], ['F5', 4]],         //  3  same shape, a tone up
    [['G5', 8], [null, 8]],                               //  4  and waits
    [['E5', 4], ['G5', 4], ['C6', 4], ['G5', 4]],         //  5  higher
    [['A5', 4], ['F5', 4], ['C5', 8]],                    //  6  and back down
    [['D5', 4], ['E5', 4], ['F5', 4], ['G5', 4]],         //  7  a walk up
    [['E5', 6], ['D5', 6], ['C5', 4]],                    //  8  home
  ],

  chords: ['C', 'F', 'Dm', 'C', 'Am', 'F', 'Dm', 'C'],

  drums: [
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-Sh',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-h-S-h-',
    'K-h-S-h-K-KhSSSS',
  ],
};

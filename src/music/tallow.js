'use strict';
// "Tallow" -- the title theme for src/games/tallow.js.
//
// The brief was a travelling troupe with a hand drum and not much else, which
// rules out the idiom every other score here uses: no gated snare, no eighth-
// note bass pulse, nothing that sounds like a kit. `K` is a frame drum struck
// with the flat of the hand and `h` is a shaker, and there are long stretches
// of neither.
//
// D aeolian, and the tune never leaves the mode -- no leading tone, no
// dominant, so it turns over without ever resolving. That is the point: it is
// a theme for a story that has not finished happening.
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Tallow',
  bpm: 88,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['D5', 6], ['F5', 4], ['E5', 6]],           // 1  the phrase
    [['D5', 8], [null, 8]],                      // 2  and the room it leaves
    [['C5', 4], ['D5', 4], ['F5', 8]],           // 3
    [['E5', 10], [null, 6]],                     // 4
    [['A5', 6], ['G5', 4], ['F5', 6]],           // 5  up an octave, once
    [['D5', 4], ['F5', 4], ['A5', 8]],           // 6
    [['G5', 6], ['E5', 4], ['D5', 6]],           // 7
    [['D5', 12], [null, 4]],                     // 8  home, but only modally
  ],

  chords: ['Dm', 'Dm', 'F', 'C', 'Gm', 'Bb', 'C', 'Dm'],

  drums: [
    'K-------S-------',
    'K---h---S---h---',
    'K-------S-------',
    'K---h---S---h-h-',
    'K--h-h--S--h-h--',
    'K--h-h--S--h-h--',
    'K--h-h--S--h-h--',
    'K--h-h--S-hSh-hh',
  ],
};

'use strict';
// "Lamplight" -- what plays during a performance while the crowd is still cold.
//
// The mixer has one bed, so a room warming up cannot be a layer coming in: it
// is a change of track. This is the cold half, and "warmth" is the same eight
// bars with the shutters open. They share a key, a tempo relationship and a
// drum feel so the switch reads as the same night getting better rather than
// as a different song starting.
//
// Deliberately narrow: the lead sits on A for most of two bars and the rests
// are longer than the phrases. A crowd that has not decided about you yet is
// quiet, and the score should be too -- there is room for the blips the
// performance itself makes, which are the things the player is listening for.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Lamplight',
  bpm: 100,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['A4', 4], [null, 4], ['A4', 4], ['Bb4', 4]],
    [['A4', 6], [null, 2], ['F4', 8]],
    [['D5', 4], ['C5', 4], ['Bb4', 8]],
    [['A4', 8], [null, 8]],
    [['A4', 4], [null, 4], ['C5', 4], ['D5', 4]],
    [['E5', 6], [null, 2], ['D5', 8]],
    [['C5', 4], ['Bb4', 4], ['A4', 8]],
    [['A4', 10], [null, 6]],
  ],

  // The one A major in the set is bar 4 and bar 7: the only outside note in
  // the game's music, and it is under the beat where the surveyor turns up.
  chords: ['Dm', 'Dm', 'Gm', 'A', 'Dm', 'Bb', 'A', 'Dm'],

  drums: [
    'K---h---K---h---',
    'K---h---K---h-h-',
    'K---h---K---h---',
    'K---h---K-h-h-h-',
    'K---h---K---h---',
    'K---h---K---h-h-',
    'K---h---K---h---',
    'K---h---K-hSh-h-',
  ],
};

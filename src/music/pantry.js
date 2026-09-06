'use strict';
// "Pantry" -- Tomo's feeding and care screen.
//
// Warm and plagal: B flat, G minor, D minor, F, round and round, never
// touching the dominant, so it sits like a kitchen with the stove on. The
// lead moves in quarters and halves; the drums are a kick, a snare and a
// hat where a spoon would tap the pot.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Pantry',
  bpm: 92,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 4], ['F5', 4], ['Bb5', 8]],               //  1  up the chord
    [['Bb5', 4], ['A5', 4], ['G5', 8]],               //  2  and down to G
    [['A5', 4], ['F5', 4], ['D5', 8]],                //  3  D minor
    [['C5', 4], ['E5', 4], ['F5', 8]],                //  4  landing on F
    [['F5', 4], ['G5', 4], ['A5', 4], ['Bb5', 4]],    //  5  a scale up
    [['D6', 4], ['Bb5', 4], ['G5', 8]],               //  6  the high point
    [['F5', 4], ['E5', 4], ['D5', 8]],                //  7
    [['C5', 4], ['A5', 4], ['F5', 8]],                //  8  home, warm
  ],

  chords: ['Bb', 'Gm', 'Dm', 'F', 'Bb', 'Gm', 'Dm', 'F'],

  drums: [
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K---h---S---h-h-',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K---h---S-------',
  ],
};

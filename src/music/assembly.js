'use strict';
// "Assembly" -- the auditorium, stage five of src/games/knuckles.js.
//
// G minor at 118, the slowest thing in the game: the lights are down and the
// whole school is watching. Long notes, the bass doing most of the work, and
// an A major turnaround in bar 8 so the loop lands with a jolt.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Assembly',
  bpm: 118,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['G4', 8], ['Bb4', 4], ['D5', 4]],                   //  1  up the chord, slowly
    [['D5', 6], ['Bb4', 6], ['G4', 4]],                   //  2  and back
    [['F5', 4], ['D5', 4], ['Bb4', 8]],                   //  3
    [['A4', 8], ['D5', 8]],                               //  4
    [['G5', 4], ['F5', 4], ['D5', 4], ['Bb4', 4]],        //  5  from the top
    [['D5', 8], ['F5', 4], ['G5', 4]],                    //  6
    [['A5', 6], ['F5', 6], ['C5', 4]],                    //  7
    [['C#5', 4], ['E5', 4], ['A4', 8]],                   //  8  the jolt
  ],

  chords: ['Gm', 'Gm', 'Bb', 'Dm', 'Gm', 'Bb', 'F', 'A'],

  drums: [
    'K-------S-------',
    'K---h---S---h---',
    'K-------S-------',
    'K---h---S--S-h--',
    'K-------S-------',
    'K---h---S---h---',
    'K-------S-------',
    'K---h---S-S-S-S-',
  ],
};

'use strict';
// "Tomo" -- the title theme for src/games/tomo.js.
//
// A lullaby in F at a rocking pace: the tune leans on the sixth and comes
// home every four bars, the way you would hum something to a small creature
// that has just gone to sleep. Brushed drums, a hat where the bar breathes,
// and a bar of held tonic at the end so the loop has somewhere to land.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Tomo',
  bpm: 100,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A5', 4], ['G5', 2], ['F5', 2], ['C5', 8]],     //  1  the tune
    [['D5', 4], ['F5', 4], ['A5', 6], [null, 2]],     //  2  up to the sixth
    [['Bb5', 4], ['A5', 2], ['G5', 2], ['F5', 8]],    //  3  and over the top
    [['G5', 4], ['E5', 4], ['C5', 8]],                //  4  the dominant
    [['A5', 4], ['G5', 2], ['F5', 2], ['C6', 8]],     //  5  again, higher
    [['D6', 4], ['C6', 4], ['A5', 8]],                //  6
    [['G5', 6], ['E5', 2], ['D5', 8]],                //  7  coming down
    [['F5', 12], [null, 4]],                          //  8  home, and a breath
  ],

  chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'C', 'F'],

  drums: [
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S-h-h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K-------S-------',
  ],
};

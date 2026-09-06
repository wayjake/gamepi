'use strict';
// "Neon" -- the night theme for src/games/kingpin.js.
//
// The town after dark: the same D minor as "Vice" at three quarters of the
// speed, with the drums thinned to a kick and a snare and the lead left
// hanging on long notes. The arpeggio underneath keeps the pulse going so it
// still reads as the same show, just later in the episode.
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Neon',
  bpm: 96,
  bassOctave: 2,
  arpOctave: 4,

  lead: [
    [['A4', 6], ['D5', 6], ['F5', 4]],                     //  1
    [['G5', 8], ['Bb4', 4], ['D5', 4]],                    //  2  over Gm
    [['F5', 6], ['D5', 2], ['Bb4', 8]],                    //  3
    [['C#5', 8], ['E5', 8]],                               //  4  the dominant, held

    [['D5', 4], ['A5', 8], ['F5', 4]],                     //  5
    [['G5', 6], ['A5', 2], ['Bb5', 8]],                    //  6
    [['F5', 4], ['D6', 8], ['C6', 4]],                     //  7
    [['E5', 4], ['G5', 4], ['C6', 4], ['E6', 4]],          //  8  climbs out over C
  ],

  chords: ['Dm', 'Gm', 'Bb', 'A', 'Dm', 'Gm', 'Bb', 'C'],

  drums: [
    'K-------S-------',
    'K---h---S---h---',
    'K-------S-------',
    'K---h---S---h-h-',
    'K-------S-------',
    'K---h---S---h---',
    'K-------S-------',
    'K---K---S--S--h-',
  ],
};

'use strict';
// "Echo" -- for Tomo's watch-and-repeat minigame.
//
// D minor, and built the way the game is: a phrase, then a rest where an
// answer would go. The first four bars call and are answered by silence; the
// last four fill the gaps in. The drums only play under the calls.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Echo',
  bpm: 108,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 4], ['F5', 4], ['A5', 4], [null, 4]],                  //  1  call
    [['A5', 4], ['F5', 4], ['D5', 4], [null, 4]],                  //  2  the same, backwards
    [['G5', 4], ['Bb5', 4], ['D6', 4], [null, 4]],                 //  3  up a fourth
    [['C#6', 4], ['A5', 4], ['E5', 4], [null, 4]],                 //  4  the dominant
    [['D5', 2], ['E5', 2], ['F5', 4], ['A5', 4], [null, 4]],       //  5  the answer
    [['Bb5', 2], ['A5', 2], ['G5', 4], ['F5', 4], [null, 4]],      //  6
    [['G5', 4], ['A5', 4], ['Bb5', 4], ['C6', 4]],                 //  7  filled in
    [['A5', 8], ['C#5', 4], [null, 4]],                            //  8  hanging
  ],

  chords: ['Dm', 'Dm', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A'],

  drums: [
    'K---S---K-------',
    'K---S---K-------',
    'K---S---K---h---',
    'K---S---K---h-h-',
    'K---S---K---S---',
    'K---S---K---S---',
    'K-h-S-h-K-h-S-h-',
    'K---S---K-------',
  ],
};

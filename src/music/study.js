'use strict';
// "Study" -- Tomo's pastimes, from doodling to curing science.
//
// A minor, eighth notes walking up and down the chord like somebody pacing
// a room while they think. The second half opens into longer notes, and the
// last bar is A major -- the dominant -- so the loop leans forward into its
// own first bar instead of stopping.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Study',
  bpm: 100,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 2], ['C5', 2], ['E5', 2], ['A5', 2], ['E5', 2], ['C5', 2], ['A4', 2], ['E5', 2]],  //  1  pacing
    [['A4', 2], ['C5', 2], ['F5', 2], ['A5', 2], ['F5', 2], ['C5', 2], ['A4', 2], ['F5', 2]],  //  2
    [['G4', 2], ['C5', 2], ['E5', 2], ['G5', 2], ['E5', 2], ['C5', 2], ['G4', 2], ['E5', 2]],  //  3
    [['A4', 2], ['D5', 2], ['F5', 2], ['A5', 2], ['F5', 4], ['D5', 4]],                        //  4  slowing
    [['E5', 4], ['C5', 4], ['A5', 4], ['E5', 4]],                                              //  5  a thought
    [['F5', 4], ['A5', 4], ['C6', 8]],                                                         //  6  a better one
    [['D6', 4], ['A5', 4], ['F5', 8]],                                                         //  7
    [['E5', 4], ['C#5', 4], ['E5', 8]],                                                        //  8  the dominant
  ],

  chords: ['Am', 'F', 'C', 'Dm', 'Am', 'F', 'Dm', 'A'],

  drums: [
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S-h-h---',
    'K-------S---h---',
    'K-------S---h---',
    'K-------S---h---',
    'K---h---S---h-h-',
  ],
};

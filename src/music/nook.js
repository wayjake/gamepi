'use strict';
// "Nook" -- Tomo's room, the screen you spend most of the game on.
//
// F major, slow, and mostly space. A tune that has to loop under an hour of
// tending a pet cannot demand attention, so the lead moves in halves and
// wholes, the kick and snare are a bar apart, and the hat only turns up
// where a phrase ends. Everything here is one step from the last note.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Nook',
  bpm: 84,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['C5', 6], ['D5', 2], ['F5', 8]],                //  1  a step and a leap
    [['D5', 6], ['F5', 2], ['Bb5', 8]],               //  2  the same shape, higher
    [['A5', 4], ['G5', 4], ['F5', 4], ['C5', 4]],     //  3  back down the scale
    [['E5', 6], ['D5', 2], ['C5', 8]],                //  4  resting on the fifth
    [['D5', 6], ['F5', 2], ['A5', 8]],                //  5  the minor colour
    [['Bb5', 4], ['A5', 4], ['F5', 8]],               //  6
    [['G5', 6], ['E5', 2], ['D5', 8]],                //  7  the turn
    [['F5', 8], ['C5', 8]],                           //  8  home
  ],

  chords: ['F', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'F'],

  drums: [
    'K-------S-------',
    'K-------S---h---',
    'K-------S-------',
    'K-------S-h-h---',
    'K-------S-------',
    'K-------S---h---',
    'K-------S-------',
    'K-------S-h-----',
  ],
};

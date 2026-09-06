'use strict';
// "Links" -- the menu theme for src/games/golf.js.
//
// The attract theme has to hold a room; this one has to sit behind somebody
// deciding which club to use. So: slower, F major rather than A minor, long
// notes, and a drum part that stays out of the way. It stops entirely once a
// shot is being lined up -- see golf.js music().
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Links',
  bpm: 96,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 8], ['C5', 8]],                               //  1  settles in
    [['G4', 6], ['E4', 6], ['G4', 4]],                    //  2
    [['D5', 8], ['A4', 8]],                               //  3
    [['F5', 6], ['D5', 6], ['Bb4', 4]],                   //  4  the flat side

    [['C5', 8], ['A4', 8]],                               //  5  the opening again
    [['E5', 6], ['G5', 6], ['E5', 4]],                    //  6  up an octave
    [['D5', 10], ['F5', 6]],                              //  7  hangs
    [['C5', 16]],                                         //  8  and rests
  ],

  chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Dm', 'C'],

  // Kick on one, a soft snare on three, hats on the offbeats. Bar 8 leaves the
  // snare out so the loop breathes before it comes round again.
  drums: [
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h---S---h---',
    'K---h-------h---',
  ],
};

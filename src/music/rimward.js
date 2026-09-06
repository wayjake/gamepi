'use strict';
// "Voyage" -- the theme for src/games/rimward.js.
//
// It plays under the whole crossing: docks, stars, the chart, the endings.
// Everything but a fight, so it has to be something you can leave on for an
// hour. Long notes over a slow pulse, the way a title theme for anything set
// in the dark between stars has gone since the seventies: D minor, stated
// wide, walking down to the dominant and back up without ever quite settling.
//
// 4/4, sixteenth-note ticks, sixteen to a bar (src/audio/song.js checks it).
// Bar 7 lands on A major, whose C# leans the loop back into bar 1.

module.exports = {
  title: 'Voyage',
  bpm: 92,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 6], ['F5', 2], ['A5', 8]],                 //  1  the opening, wide
    [['G5', 4], ['F5', 4], ['E5', 8]],                 //  2  answered a step down
    [['F5', 6], ['E5', 2], ['D5', 8]],                 //  3  and again
    [['C5', 4], ['D5', 4], ['A4', 8]],                 //  4  down to the fifth, held
    [['F5', 6], ['G5', 2], ['A5', 4], ['Bb5', 4]],     //  5  climbing
    [['A5', 8], ['G5', 4], ['F5', 4]],                 //  6  the peak, and back
    [['E5', 4], ['D5', 4], ['C#5', 8]],                //  7  A major: the lean
    [['D5', 12], [null, 4]],                           //  8  home, and a breath
  ],

  chords: ['Dm', 'C', 'Bb', 'Am', 'Gm', 'F', 'A', 'Dm'],

  // A slow pulse: kick on one, snare on three, hats keeping the halves. Bar 8
  // gets the only fill, so the loop has a seam you can hear.
  drums: [
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K---h---S---h---',
    'K---h---S---h-h-',
    'K---h---S---h---',
    'K---h---S-S-S-h-',
  ],
};

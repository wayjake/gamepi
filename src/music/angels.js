'use strict';
// "Angels" -- the title theme for src/games/angels.js.
//
// It plays under a menu, so it has to be the same thing forty seconds in as it
// was at the start: A minor, slow, and mostly held notes over a kick that is
// nearly a heartbeat. The lead climbs an octave across bars 5-6 and comes back
// down, so there is one arc in it and no second one.
//
// Bar 8 leans on A major rather than A minor. That is the only bright chord in
// the loop, and it lands exactly where the loop turns over -- the ear hears it
// as a door opening onto the same corridor again.
//
// 4/4, sixteenth notes; every bar sums to 16 (src/audio/song.js asserts it).

module.exports = {
  title: 'Angels',
  bpm: 84,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['A4', 6], ['C5', 4], ['E5', 6]],          //  1  the shape of the whole thing
    [['D5', 4], ['C5', 4], ['A4', 8]],          //  2  and back down
    [['F4', 6], ['A4', 4], ['C5', 6]],          //  3
    [['G4', 4], ['E5', 4], ['C5', 8]],          //  4

    [['D5', 6], ['F5', 4], ['A5', 6]],          //  5  an octave up
    [['A5', 4], ['F5', 4], ['D5', 8]],          //  6
    [['C5', 6], ['A4', 4], ['F4', 6]],          //  7  settling
    [['C#5', 6], ['E5', 4], ['A4', 6]],         //  8  the major third, once
  ],

  chords: ['Am', 'Am', 'F', 'C', 'Dm', 'Dm', 'F', 'A'],

  // Kick on one, snare on three, and almost nothing else. A busy hat part under
  // a menu is a clock ticking at somebody trying to read.
  drums: [
    'K-------S-------',
    'K-------S-----h-',
    'K-------S-------',
    'K---K---S-----h-',
    'K-------S-------',
    'K-------S-----h-',
    'K-------S-------',
    'K---K---S---h-h-',
  ],
};

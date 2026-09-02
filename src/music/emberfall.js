'use strict';
// "Emberfall" -- overworld theme.
//
// D dorian, 4/4. Written in sixteenth notes: each bar is [note, ticks] pairs
// summing to 16 (src/audio/song.js asserts this). null is a rest.
//
// The hook is a 6-6-4 tresillo -- three long, three long, one short -- carrying
// a rising arpeggio. It comes back in bars 1, 3, 5, 7, 10 and 14, at different
// pitches and in different registers, so the ear has one shape to hold on to.
// Bars 9-12 drop an octave for contrast; bar 13 leaps back up for the climax.

module.exports = {
  title: 'Emberfall',
  bpm: 138,
  bassOctave: 3,
  arpOctave: 4,

  //        A: statement and answer, home in D minor
  lead: [
    [['D5', 6], ['F5', 6], ['A5', 4]],                    //  1  the hook
    [['G5', 4], ['F5', 4], ['E5', 8]],                    //  2  falls away
    [['C5', 6], ['E5', 6], ['G5', 4]],                    //  3  hook, a step lower
    [['F5', 4], ['E5', 4], ['D5', 8]],                    //  4  settles home

    //      A': the same opening, but the answer climbs instead of falling
    [['D5', 6], ['F5', 6], ['A5', 4]],                    //  5
    [['G5', 4], ['A5', 4], ['Bb5', 8]],                   //  6  opens up
    [['A5', 6], ['C6', 6], ['D6', 4]],                    //  7  hook at the top
    [['C6', 4], ['Bb5', 4], ['A5', 8]],                   //  8  hangs, unresolved

    //      B: down an octave. Quieter country, more walking than fighting.
    [['F4', 4], ['G4', 4], ['A4', 6], ['C5', 2]],         //  9
    [['D5', 6], ['C5', 6], ['A4', 4]],                    // 10  hook, low and inverted
    [['Bb4', 4], ['C5', 4], ['D5', 6], ['F5', 2]],        // 11
    [['E5', 6], ['D5', 6], ['C5', 4]],                    // 12

    //      C: the leap, then the way home
    [['D5', 2], ['E5', 2], ['F5', 4], ['A5', 4], ['D6', 4]], // 13  the climb
    [['C6', 6], ['A5', 6], ['F5', 4]],                    // 14  hook, falling from the top
    [['A5', 4], ['G5', 4], ['F5', 4], ['E5', 4]],         // 15  over the dominant
    [['D5', 10], [null, 2], ['A4', 4]],                   // 16  home, and a pickup back round
  ],

  chords: [
    'Dm', 'Am', 'C', 'Dm',
    'Dm', 'Bb', 'F', 'Gm',
    'F', 'Dm', 'Bb', 'Am',
    'Dm', 'F', 'A', 'Dm',   // bar 15's A major is the leading tone home
  ],

  drums: [
    'K-h-S-h-K-h-S-h-', 'K-h-S-h-K-h-S-hh', 'K-h-S-h-K-h-S-h-', 'K-hKS-h-K-h-S-hh',
    'K-hKS-h-K-h-S-h-', 'K-h-S-h-K-hKS-h-', 'K-hKS-h-K-h-S-h-', 'K-h-S-hhK-hKS-hh',
    'K---S---K---S---', 'K---S---K--hS---', 'K---S---K---S---', 'K---S-h-K--hS-hh',
    'K-hKS-hhK-hKS-hh', 'K-hKS-h-K-hKS-hh', 'K-hKS-hhK-hKS-hh', 'K-hKS-hhKhhhSSSS',
  ],
};

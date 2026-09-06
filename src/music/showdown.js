'use strict';
// "Showdown" -- what plays while a boss is alive, in all three of them.
//
// One theme rather than three, deliberately: the bosses are the same event
// happening in three different places, and a player who has heard this once
// knows what the room is for before the first shape moves.
//
// G minor, 152, and the kick is on the offbeat as often as the beat. The lead
// spends bars 1-4 stuck on a three-note cell and only breaks out of it in bar
// 6, which is roughly where a fight this length turns.
//
// 4/4, sixteenth notes; every bar sums to 16.

module.exports = {
  title: 'Showdown',
  bpm: 152,
  bassOctave: 3,
  arpOctave: 4,

  lead: [
    [['D5', 2], ['D5', 2], ['Bb4', 4], ['D5', 4], ['G5', 4]],   //  1  the cell
    [['F5', 4], ['D5', 4], ['Bb4', 8]],                         //  2
    [['A4', 2], ['A4', 2], ['D5', 4], ['F5', 4], ['A5', 4]],    //  3  the cell, up a fifth
    [['G5', 4], ['F5', 4], ['D5', 8]],                          //  4

    [['Bb4', 4], ['D5', 4], ['F5', 4], ['Bb5', 4]],             //  5  climbing out
    [['C5', 4], ['E5', 4], ['G5', 4], ['C6', 4]],               //  6  the top
    [['Bb5', 4], ['G5', 4], ['D5', 8]],                         //  7
    [['C#5', 4], ['E5', 4], ['A5', 8]],                         //  8  and round again
  ],

  chords: ['Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'C', 'Gm', 'A'],

  drums: [
    'K-K-h-K-S---h-K-',
    'K-K-h---S---h-h-',
    'K-K-h-K-S---h-K-',
    'K-K-h---S-h-hhh-',
    'K-K-h-K-S---h-K-',
    'K-K-h---S---h-h-',
    'K-K-h-K-S---h-K-',
    'K-K-h---S-h-hhh-',
  ],
};

'use strict';
// The game's sound effects, rendered once at startup by the same synthesiser
// that renders the music. Each one is a handful of note events; there is no
// separate sample format and no sample files, which is the point -- a blip is
// a score of one note.
//
// Everything here is short. The mixer holds these buffers and adds them into
// the output stream as they are triggered, so a long sound is a sound you can
// still hear playing three points later.

const synth = require('./synth');

const note = (name) => synth.noteToFreq(name);

// A pulse channel blip. Fast attack, no sustain: the NES's percussion-adjacent
// register, and what a paddle should sound like.
const blip = (freq, duration, duty = 0.5, volume = 0.5) => ({
  freq, duration, gate: duration, wave: 'pulse', duty, volume,
  env: { attack: 0.001, decay: duration * 0.9, sustain: 0.0, release: 0.02 },
});

const SOUNDS = {
  // Gameplay.
  paddle: { length: 0.12, notes: [{ start: 0, ...blip(note('E5'), 0.055, 0.5, 0.55) }] },
  wall: { length: 0.10, notes: [{ start: 0, ...blip(note('A4'), 0.045, 0.25, 0.45) }] },
  edge: { length: 0.13, notes: [{ start: 0, ...blip(note('B5'), 0.05, 0.125, 0.5) }] },

  // A point: two falling tones and a little noise, so it reads as an event
  // rather than another bounce.
  point: {
    length: 0.55,
    notes: [
      { start: 0, ...blip(note('G5'), 0.12, 0.5, 0.5) },
      { start: 0.11, ...blip(note('C5'), 0.20, 0.5, 0.5) },
      { start: 0, freq: 5200, duration: 0.09, gate: 0.09, wave: 'noise', volume: 0.16,
        env: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 } },
    ],
  },

  // A serve, rising -- the ear reads it as "here it comes".
  serve: {
    length: 0.3,
    notes: [
      { start: 0, ...blip(note('C5'), 0.06, 0.25, 0.4) },
      { start: 0.06, ...blip(note('G5'), 0.09, 0.25, 0.4) },
    ],
  },

  // Menus.
  move: { length: 0.07, notes: [{ start: 0, ...blip(note('C5'), 0.028, 0.125, 0.32) }] },
  select: {
    length: 0.36,
    notes: [
      { start: 0, ...blip(note('C5'), 0.06, 0.5, 0.45) },
      { start: 0.06, ...blip(note('G5'), 0.06, 0.5, 0.45) },
      { start: 0.12, ...blip(note('C6'), 0.14, 0.5, 0.45) },
    ],
  },
  back: {
    length: 0.24,
    notes: [
      { start: 0, ...blip(note('G4'), 0.05, 0.5, 0.4) },
      { start: 0.05, ...blip(note('C4'), 0.12, 0.5, 0.4) },
    ],
  },

  // Boot: one beep per line of the fake power-on check.
  beep: { length: 0.09, notes: [{ start: 0, ...blip(note('A5'), 0.035, 0.5, 0.28) }] },

  // Golf. A struck ball is a click with a body behind it: a very short noise
  // transient for the strike and a pitched thump under it for the ball leaving.
  drive: {
    length: 0.28,
    notes: [
      { start: 0, freq: 7000, duration: 0.02, gate: 0.02, wave: 'noise', volume: 0.30,
        env: { attack: 0.0005, decay: 0.018, sustain: 0, release: 0.01 } },
      { start: 0, ...blip(note('A3'), 0.10, 0.5, 0.42) },
      { start: 0.015, ...blip(note('A4'), 0.06, 0.25, 0.20) },
    ],
  },
  chip: {
    length: 0.2,
    notes: [
      { start: 0, freq: 8200, duration: 0.015, gate: 0.015, wave: 'noise', volume: 0.20,
        env: { attack: 0.0005, decay: 0.014, sustain: 0, release: 0.008 } },
      { start: 0, ...blip(note('D4'), 0.07, 0.5, 0.32) },
    ],
  },
  putt: {
    length: 0.16,
    notes: [
      { start: 0, ...blip(note('G4'), 0.05, 0.5, 0.26) },
      { start: 0, freq: 5200, duration: 0.012, gate: 0.012, wave: 'noise', volume: 0.10,
        env: { attack: 0.0005, decay: 0.011, sustain: 0, release: 0.006 } },
    ],
  },
  bounce: {
    length: 0.12,
    notes: [{ start: 0, freq: 1400, duration: 0.03, gate: 0.03, wave: 'noise', volume: 0.13,
      env: { attack: 0.001, decay: 0.026, sustain: 0, release: 0.012 } }],
  },
  // Three noise hits walking downwards: the synthesiser has no pitch sweep, so
  // a splash is spelled out rather than swept.
  splash: {
    length: 0.5,
    notes: [
      { start: 0, freq: 6400, duration: 0.09, gate: 0.09, wave: 'noise', volume: 0.24,
        env: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } },
      { start: 0.05, freq: 3400, duration: 0.10, gate: 0.10, wave: 'noise', volume: 0.17,
        env: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.06 } },
      { start: 0.12, freq: 1700, duration: 0.14, gate: 0.14, wave: 'noise', volume: 0.11,
        env: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.08 } },
    ],
  },
  holed: {
    length: 0.7,
    notes: [
      { start: 0, ...blip(note('C5'), 0.05, 0.5, 0.30) },
      { start: 0.04, ...blip(note('G5'), 0.06, 0.5, 0.34) },
      { start: 0.10, ...blip(note('C6'), 0.30, 0.5, 0.40) },
      { start: 0.10, ...blip(note('E6'), 0.30, 0.25, 0.16) },
    ],
  },

  // Border Patrol.
  //
  // An engine is the one thing a mixer of one-shots cannot do, because there is
  // no loop to hold: `music()` owns the only looping voice and it is playing the
  // chase theme. So the engine is spelled out instead -- a short pulse fired
  // over and over, faster the quicker you are going, which is exactly how the
  // rate of a real one reads to the ear. Two of them alternating, an octave
  // apart in the noise on top, so a held throttle grains rather than buzzes.
  engineLow: {
    length: 0.2,
    notes: [
      { start: 0, freq: 110, duration: 0.15, gate: 0.15, wave: 'pulse', duty: 0.125, volume: 0.13,
        env: { attack: 0.004, decay: 0.05, sustain: 0.55, release: 0.045 } },
      { start: 0, freq: 640, duration: 0.05, gate: 0.05, wave: 'noise', volume: 0.05,
        env: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02 } },
    ],
  },
  engineHigh: {
    length: 0.2,
    notes: [
      { start: 0, freq: 138, duration: 0.15, gate: 0.15, wave: 'pulse', duty: 0.25, volume: 0.12,
        env: { attack: 0.004, decay: 0.05, sustain: 0.55, release: 0.045 } },
      { start: 0, freq: 1150, duration: 0.045, gate: 0.045, wave: 'noise', volume: 0.045,
        env: { attack: 0.002, decay: 0.035, sustain: 0, release: 0.02 } },
    ],
  },

  // Two tons of sheet metal meeting two tons of sheet metal: a bright noise
  // crack for the panels, the short-tap LFSR under it for the metal ringing,
  // and a low pulse for the mass behind both.
  ram: {
    length: 0.34,
    notes: [
      { start: 0, freq: 2600, duration: 0.06, gate: 0.06, wave: 'noise', volume: 0.30,
        env: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 } },
      { start: 0.01, freq: 900, duration: 0.11, gate: 0.11, wave: 'noise', short: true, volume: 0.20,
        env: { attack: 0.001, decay: 0.10, sustain: 0, release: 0.05 } },
      { start: 0, ...blip(note('D3'), 0.13, 0.5, 0.30) },
    ],
  },

  // A cruiser losing it: the crack, then a tumble of falling tones as it goes
  // round. Falling, because everything that ends badly falls.
  wreck: {
    length: 0.8,
    notes: [
      { start: 0, freq: 3200, duration: 0.09, gate: 0.09, wave: 'noise', volume: 0.28,
        env: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 } },
      { start: 0.06, ...blip(note('G4'), 0.10, 0.25, 0.30) },
      { start: 0.16, ...blip(note('D4'), 0.10, 0.25, 0.28) },
      { start: 0.26, ...blip(note('A3'), 0.12, 0.25, 0.26) },
      { start: 0.38, ...blip(note('D3'), 0.30, 0.5, 0.30) },
      { start: 0.30, freq: 1500, duration: 0.22, gate: 0.22, wave: 'noise', volume: 0.10,
        env: { attack: 0.004, decay: 0.20, sustain: 0, release: 0.10 } },
    ],
  },

  // The two-tone whoop, fired when a cruiser first gets its nose on you. Short
  // enough not to tread on the theme, obvious enough to make you look.
  siren: {
    length: 0.44,
    notes: [
      { start: 0.00, ...blip(note('E5'), 0.11, 0.5, 0.26) },
      { start: 0.11, ...blip(note('A5'), 0.11, 0.5, 0.26) },
      { start: 0.22, ...blip(note('E5'), 0.11, 0.5, 0.24) },
      { start: 0.33, ...blip(note('A5'), 0.10, 0.5, 0.22) },
    ],
  },

  // Tyres letting go: noise with a slow attack, so it swells rather than hits.
  skid: {
    length: 0.34,
    notes: [
      { start: 0, freq: 3800, duration: 0.24, gate: 0.24, wave: 'noise', volume: 0.13,
        env: { attack: 0.03, decay: 0.20, sustain: 0.15, release: 0.08 } },
    ],
  },

  // A jerry can going in the tank: rising, the way every pickup since 1985 has.
  fuel: {
    length: 0.34,
    notes: [
      { start: 0.00, ...blip(note('D5'), 0.05, 0.25, 0.34) },
      { start: 0.05, ...blip(note('A5'), 0.05, 0.25, 0.34) },
      { start: 0.10, ...blip(note('D6'), 0.16, 0.25, 0.36) },
    ],
  },

  // Busted: the siren, then the bottom falling out of it.
  busted: {
    length: 1.3,
    notes: [
      { start: 0.00, ...blip(note('A5'), 0.12, 0.5, 0.40) },
      { start: 0.14, ...blip(note('E5'), 0.12, 0.5, 0.40) },
      { start: 0.28, ...blip(note('A4'), 0.12, 0.5, 0.40) },
      { start: 0.42, ...blip(note('D4'), 0.50, 0.5, 0.44) },
      { start: 0.42, ...blip(note('A3'), 0.50, 0.25, 0.24) },
      { start: 0.40, freq: 2200, duration: 0.30, gate: 0.30, wave: 'noise', volume: 0.10,
        env: { attack: 0.01, decay: 0.28, sustain: 0, release: 0.14 } },
    ],
  },

  // Crossing the line. Three rising thirds and a held major -- the only
  // unambiguously happy noise this game makes.
  crossing: {
    length: 1.4,
    notes: [
      { start: 0.00, ...blip(note('D5'), 0.10, 0.5, 0.40) },
      { start: 0.12, ...blip(note('F5'), 0.10, 0.5, 0.40) },
      { start: 0.24, ...blip(note('A5'), 0.10, 0.5, 0.42) },
      { start: 0.36, ...blip(note('D6'), 0.50, 0.5, 0.46) },
      { start: 0.36, ...blip(note('F5'), 0.50, 0.25, 0.20) },
      { start: 0.90, ...blip(note('A5'), 0.40, 0.5, 0.34) },
    ],
  },

  // City of Angels.
  //
  // A melee game needs two sounds where a paddle needed one: the swing, which
  // happens every time the button is pressed, and the connection, which happens
  // only when it lands. Keeping them separate is what makes missing feel like
  // missing -- the swing alone is air, and the ear notices the missing crack.
  swing: {
    length: 0.16,
    notes: [
      { start: 0, freq: 2600, duration: 0.10, gate: 0.10, wave: 'noise', volume: 0.11,
        env: { attack: 0.022, decay: 0.07, sustain: 0, release: 0.03 } },
    ],
  },
  whack: {
    length: 0.24,
    notes: [
      { start: 0, freq: 1500, duration: 0.05, gate: 0.05, wave: 'noise', short: true, volume: 0.26,
        env: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } },
      { start: 0, ...blip(note('E3'), 0.09, 0.5, 0.34) },
      { start: 0.02, ...blip(note('E4'), 0.06, 0.25, 0.16) },
    ],
  },

  // Taking a hit. Two tones going the wrong way with noise across them, and
  // longer than anything else in the game that isn't an ending -- it has to be
  // audible over a boss theme at the moment a player stops looking at the HUD.
  hurt: {
    length: 0.44,
    notes: [
      { start: 0, freq: 900, duration: 0.10, gate: 0.10, wave: 'noise', volume: 0.20,
        env: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.04 } },
      { start: 0.00, ...blip(note('F4'), 0.10, 0.5, 0.40) },
      { start: 0.10, ...blip(note('B3'), 0.24, 0.5, 0.40) },
    ],
  },

  // The spray can: no pitch at all, just a band of noise with a soft edge on
  // both ends, which is what an aerosol is.
  spray: {
    length: 0.26,
    notes: [
      { start: 0, freq: 7600, duration: 0.18, gate: 0.18, wave: 'noise', volume: 0.14,
        env: { attack: 0.012, decay: 0.10, sustain: 0.35, release: 0.06 } },
      { start: 0.01, freq: 4200, duration: 0.10, gate: 0.10, wave: 'noise', volume: 0.07,
        env: { attack: 0.008, decay: 0.08, sustain: 0.1, release: 0.04 } },
    ],
  },

  // The boombox, which hits everything on the screen at once and should sound
  // like it: a low pulse for the cone moving, and three noise hits walking
  // downwards behind it for the room answering back.
  boom: {
    length: 0.9,
    notes: [
      { start: 0.00, ...blip(note('D3'), 0.34, 0.5, 0.46) },
      { start: 0.00, ...blip(note('D4'), 0.22, 0.25, 0.20) },
      { start: 0.00, freq: 5000, duration: 0.10, gate: 0.10, wave: 'noise', volume: 0.22,
        env: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 } },
      { start: 0.14, freq: 2400, duration: 0.14, gate: 0.14, wave: 'noise', volume: 0.15,
        env: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.07 } },
      { start: 0.34, freq: 1100, duration: 0.20, gate: 0.20, wave: 'noise', volume: 0.09,
        env: { attack: 0.008, decay: 0.18, sustain: 0, release: 0.10 } },
    ],
  },

  // Picking something up, and being given a heart. Both rise; the heart is the
  // softer of the two because it happens far more often.
  pickup: {
    length: 0.42,
    notes: [
      { start: 0.00, ...blip(note('G4'), 0.06, 0.25, 0.36) },
      { start: 0.06, ...blip(note('C5'), 0.06, 0.25, 0.36) },
      { start: 0.12, ...blip(note('E5'), 0.06, 0.25, 0.36) },
      { start: 0.18, ...blip(note('G5'), 0.20, 0.25, 0.40) },
    ],
  },
  heal: {
    length: 0.26,
    notes: [
      { start: 0.00, ...blip(note('E5'), 0.05, 0.5, 0.26) },
      { start: 0.05, ...blip(note('A5'), 0.16, 0.5, 0.30) },
    ],
  },

  // Leaving one screen for the next. Quiet on purpose: it fires more often than
  // any other sound in the game.
  door: {
    length: 0.2,
    notes: [
      { start: 0, ...blip(note('A3'), 0.09, 0.5, 0.24) },
      { start: 0, freq: 700, duration: 0.05, gate: 0.05, wave: 'noise', volume: 0.07,
        env: { attack: 0.002, decay: 0.04, sustain: 0, release: 0.02 } },
    ],
  },

  // A gate that was shut being open. Rising fourths, and the only sound in the
  // game with a major seventh in it.
  unlock: {
    length: 0.8,
    notes: [
      { start: 0.00, ...blip(note('D5'), 0.09, 0.25, 0.34) },
      { start: 0.10, ...blip(note('G5'), 0.09, 0.25, 0.34) },
      { start: 0.20, ...blip(note('C6'), 0.09, 0.25, 0.34) },
      { start: 0.30, ...blip(note('E6'), 0.40, 0.25, 0.38) },
      { start: 0.30, ...blip(note('C6'), 0.40, 0.5, 0.18) },
    ],
  },

  // One page of dialogue arriving. It fires per page, not per character -- a
  // blip per letter is charming for four words and unbearable for four hundred.
  talk: { length: 0.06, notes: [{ start: 0, ...blip(note('D5'), 0.026, 0.125, 0.22) }] },

  // A boss noticing you: three notes down, slowly, with the noise floor rising
  // under them. Nothing else in the game descends this far.
  roar: {
    length: 1.2,
    notes: [
      { start: 0.00, ...blip(note('A4'), 0.20, 0.5, 0.38) },
      { start: 0.22, ...blip(note('F4'), 0.20, 0.5, 0.38) },
      { start: 0.44, ...blip(note('D4'), 0.50, 0.5, 0.42) },
      { start: 0.44, ...blip(note('A3'), 0.50, 0.25, 0.22) },
      { start: 0.30, freq: 1800, duration: 0.50, gate: 0.50, wave: 'noise', volume: 0.09,
        env: { attack: 0.14, decay: 0.30, sustain: 0.2, release: 0.16 } },
    ],
  },

  // A boss taking a hit: the short-tap LFSR, so it rings like struck metal and
  // is instantly distinguishable from an ordinary enemy taking one.
  bossHit: {
    length: 0.26,
    notes: [
      { start: 0, freq: 620, duration: 0.13, gate: 0.13, wave: 'noise', short: true, volume: 0.24,
        env: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.06 } },
      { start: 0, ...blip(note('A3'), 0.08, 0.5, 0.24) },
    ],
  },

  // And a boss going down. The longest sound in the game: it plays into a room
  // where nothing else is moving.
  bossDown: {
    length: 1.7,
    notes: [
      { start: 0.00, freq: 3000, duration: 0.12, gate: 0.12, wave: 'noise', volume: 0.26,
        env: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.06 } },
      { start: 0.10, ...blip(note('D5'), 0.14, 0.25, 0.32) },
      { start: 0.26, ...blip(note('A4'), 0.14, 0.25, 0.32) },
      { start: 0.42, ...blip(note('F4'), 0.14, 0.25, 0.32) },
      { start: 0.58, ...blip(note('D4'), 0.60, 0.5, 0.40) },
      { start: 0.58, ...blip(note('A3'), 0.60, 0.25, 0.20) },
      { start: 0.55, freq: 1400, duration: 0.42, gate: 0.42, wave: 'noise', volume: 0.11,
        env: { attack: 0.02, decay: 0.38, sustain: 0, release: 0.20 } },
      { start: 1.20, ...blip(note('D3'), 0.42, 0.5, 0.30) },
    ],
  },

  // Rimward.
  //
  // The klaxon that opens every trail card: two bars of a minor second, which
  // is the interval every alarm since the first submarine has used.
  alarm: {
    length: 0.5,
    notes: [
      { start: 0.00, ...blip(note('F5'), 0.10, 0.25, 0.30) },
      { start: 0.00, ...blip(note('E5'), 0.10, 0.25, 0.22) },
      { start: 0.24, ...blip(note('F5'), 0.10, 0.25, 0.30) },
      { start: 0.24, ...blip(note('E5'), 0.10, 0.25, 0.22) },
    ],
  },
  // The cannon: a noise crack and a falling tone under it, the way a laser has
  // sounded on every television since 1977.
  cannon: {
    length: 0.3,
    notes: [
      { start: 0, freq: 4400, duration: 0.04, gate: 0.04, wave: 'noise', volume: 0.26,
        env: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 } },
      { start: 0.00, ...blip(note('A5'), 0.05, 0.125, 0.34) },
      { start: 0.05, ...blip(note('E5'), 0.06, 0.125, 0.30) },
      { start: 0.11, ...blip(note('A4'), 0.10, 0.125, 0.26) },
    ],
  },
  // The drive spooling up: a rising arpeggio held at the top, so it reads as
  // something building rather than something happening.
  warp: {
    length: 1.0,
    notes: [
      { start: 0.00, ...blip(note('D4'), 0.12, 0.5, 0.26) },
      { start: 0.12, ...blip(note('A4'), 0.12, 0.5, 0.28) },
      { start: 0.24, ...blip(note('D5'), 0.12, 0.5, 0.30) },
      { start: 0.36, ...blip(note('A5'), 0.50, 0.5, 0.32) },
      { start: 0.36, ...blip(note('D6'), 0.50, 0.25, 0.14) },
      { start: 0.30, freq: 900, duration: 0.55, gate: 0.55, wave: 'noise', volume: 0.06,
        env: { attack: 0.10, decay: 0.40, sustain: 0.1, release: 0.10 } },
    ],
  },

  // Endings.
  over: {
    length: 1.1,
    notes: [
      { start: 0.00, ...blip(note('A4'), 0.16, 0.5, 0.5) },
      { start: 0.18, ...blip(note('F4'), 0.16, 0.5, 0.5) },
      { start: 0.36, ...blip(note('D4'), 0.16, 0.5, 0.5) },
      { start: 0.54, ...blip(note('A3'), 0.42, 0.5, 0.5) },
    ],
  },
  fanfare: {
    length: 1.2,
    notes: [
      { start: 0.00, ...blip(note('C5'), 0.10, 0.5, 0.45) },
      { start: 0.12, ...blip(note('E5'), 0.10, 0.5, 0.45) },
      { start: 0.24, ...blip(note('G5'), 0.10, 0.5, 0.45) },
      { start: 0.36, ...blip(note('C6'), 0.44, 0.5, 0.5) },
      { start: 0.36, ...blip(note('E6'), 0.44, 0.25, 0.22) },
    ],
  },

  // --- Meadowlark ------------------------------------------------------------
  //
  // Farm work. Every tool lands with its own thud, so you can hear what you hit
  // without looking up from the next tile; produce and money rise, and each
  // animal gets one vowel.
  till: {
    length: 0.24,
    notes: [
      { start: 0, ...blip(note('A2'), 0.1, 0.5, 0.4) },
      { start: 0, freq: 900, duration: 0.08, gate: 0.08, wave: 'noise', volume: 0.14,
        env: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 } },
    ],
  },
  sow: {
    length: 0.16,
    notes: [
      { start: 0, ...blip(note('E5'), 0.04, 0.125, 0.22) },
      { start: 0.05, ...blip(note('G5'), 0.05, 0.125, 0.22) },
    ],
  },
  sprinkle: {
    length: 0.42,
    notes: [
      { start: 0, freq: 7000, duration: 0.34, gate: 0.34, wave: 'noise', volume: 0.09,
        env: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 0.06 } },
      { start: 0.02, ...blip(note('A5'), 0.05, 0.125, 0.12) },
      { start: 0.12, ...blip(note('B5'), 0.05, 0.125, 0.1) },
      { start: 0.22, ...blip(note('A5'), 0.05, 0.125, 0.08) },
    ],
  },
  dip: {
    length: 0.26,
    notes: [
      { start: 0, ...blip(note('C4'), 0.08, 0.5, 0.3) },
      { start: 0.07, ...blip(note('G4'), 0.12, 0.5, 0.3) },
    ],
  },
  reap: {
    length: 0.18,
    notes: [
      { start: 0, freq: 3200, duration: 0.09, gate: 0.09, wave: 'noise', volume: 0.12,
        env: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 } },
      { start: 0.02, ...blip(note('B4'), 0.06, 0.25, 0.22) },
    ],
  },
  chop: {
    length: 0.22,
    notes: [
      { start: 0, ...blip(note('D3'), 0.09, 0.5, 0.36) },
      { start: 0, freq: 520, duration: 0.07, gate: 0.07, wave: 'noise', volume: 0.16,
        env: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } },
    ],
  },
  crack: {
    length: 0.22,
    notes: [
      { start: 0, freq: 2600, duration: 0.05, gate: 0.05, wave: 'noise', volume: 0.2,
        env: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } },
      { start: 0.01, ...blip(note('A3'), 0.08, 0.25, 0.3) },
    ],
  },
  munch: {
    length: 0.34,
    notes: [
      { start: 0, freq: 700, duration: 0.06, gate: 0.06, wave: 'noise', volume: 0.12,
        env: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } },
      { start: 0, ...blip(note('C4'), 0.06, 0.5, 0.2) },
      { start: 0.14, freq: 500, duration: 0.06, gate: 0.06, wave: 'noise', volume: 0.12,
        env: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } },
      { start: 0.14, ...blip(note('A3'), 0.06, 0.5, 0.2) },
    ],
  },
  cluck: {
    length: 0.14,
    notes: [
      { start: 0, ...blip(note('D6'), 0.035, 0.125, 0.28) },
      { start: 0.05, ...blip(note('A5'), 0.06, 0.125, 0.24) },
    ],
  },
  moo: {
    length: 0.5,
    notes: [
      { start: 0, ...blip(note('G3'), 0.22, 0.5, 0.34) },
      { start: 0.2, ...blip(note('F3'), 0.26, 0.5, 0.3) },
    ],
  },
  baa: {
    length: 0.34,
    notes: [
      { start: 0.00, ...blip(note('A4'), 0.06, 0.25, 0.26) },
      { start: 0.07, ...blip(note('G4'), 0.06, 0.25, 0.26) },
      { start: 0.14, ...blip(note('A4'), 0.06, 0.25, 0.26) },
      { start: 0.21, ...blip(note('G4'), 0.1, 0.25, 0.24) },
    ],
  },
  coin: {
    length: 0.3,
    notes: [
      { start: 0, ...blip(note('B5'), 0.05, 0.5, 0.36) },
      { start: 0.05, ...blip(note('E6'), 0.2, 0.5, 0.36) },
    ],
  },
  // Going to bed: three steps down, slowly. The morning is the same three, up,
  // and quicker, which is what a rooster is.
  snooze: {
    length: 1.0,
    notes: [
      { start: 0.0, ...blip(note('E5'), 0.24, 0.5, 0.26) },
      { start: 0.28, ...blip(note('C5'), 0.24, 0.5, 0.24) },
      { start: 0.56, ...blip(note('A4'), 0.4, 0.5, 0.22) },
    ],
  },
  rooster: {
    length: 0.7,
    notes: [
      { start: 0.00, ...blip(note('C5'), 0.07, 0.25, 0.3) },
      { start: 0.08, ...blip(note('E5'), 0.07, 0.25, 0.3) },
      { start: 0.16, ...blip(note('G5'), 0.07, 0.25, 0.3) },
      { start: 0.24, ...blip(note('C6'), 0.4, 0.25, 0.34) },
    ],
  },
  // A season turning: one chime, an octave apart.
  bell: {
    length: 0.9,
    notes: [
      { start: 0, ...blip(note('D6'), 0.8, 0.5, 0.3) },
      { start: 0, ...blip(note('D5'), 0.8, 0.25, 0.18) },
    ],
  },

  // Tomo. A pet makes small noises: a drop, a sneeze, a flush, a kick, and
  // the two chimes -- a pastime finished and an egg opening.
  plop: {
    length: 0.26,
    notes: [
      { start: 0, ...blip(note('D4'), 0.08, 0.5, 0.4) },
      { start: 0.08, ...blip(note('A3'), 0.14, 0.5, 0.35) },
    ],
  },
  sneeze: {
    length: 0.42,
    notes: [
      { start: 0, freq: 6000, duration: 0.08, gate: 0.08, wave: 'noise', volume: 0.2,
        env: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 } },
      { start: 0.09, ...blip(note('A5'), 0.06, 0.25, 0.32) },
      { start: 0.15, ...blip(note('D5'), 0.22, 0.25, 0.3) },
    ],
  },
  flush: {
    length: 0.62,
    notes: [
      { start: 0, freq: 1200, duration: 0.5, gate: 0.5, wave: 'noise', volume: 0.18,
        env: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 0.08 } },
      { start: 0.3, ...blip(note('E5'), 0.1, 0.5, 0.2) },
      { start: 0.4, ...blip(note('A5'), 0.18, 0.5, 0.22) },
    ],
  },
  kick: {
    length: 0.14,
    notes: [
      { start: 0, ...blip(note('G4'), 0.05, 0.25, 0.5) },
      { start: 0, freq: 3000, duration: 0.05, gate: 0.05, wave: 'noise', volume: 0.15,
        env: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 } },
    ],
  },
  ding: {
    length: 0.7,
    notes: [
      { start: 0, ...blip(note('G5'), 0.12, 0.5, 0.3) },
      { start: 0.12, ...blip(note('C6'), 0.5, 0.5, 0.32) },
    ],
  },
  hatch: {
    length: 0.6,
    notes: [
      { start: 0.00, ...blip(note('E6'), 0.07, 0.25, 0.3) },
      { start: 0.08, ...blip(note('G6'), 0.07, 0.25, 0.3) },
      { start: 0.16, ...blip(note('C6'), 0.4, 0.5, 0.34) },
    ],
  },

  // --- Timmy Tough Knuckles --------------------------------------------------
  //
  // A brawler borrows most of City of Angels' kit (swing, whack, hurt, pickup,
  // heal) and needs four of its own: a weapon breaking, a body hitting the
  // floor, a coach's whistle, and a squishy leaving a hand.
  snap: {
    length: 0.3,
    notes: [
      { start: 0, freq: 3800, duration: 0.03, gate: 0.03, wave: 'noise', volume: 0.28,
        env: { attack: 0.0005, decay: 0.028, sustain: 0, release: 0.01 } },
      { start: 0.0, ...blip(note('E5'), 0.05, 0.25, 0.3) },
      { start: 0.05, ...blip(note('A4'), 0.14, 0.25, 0.3) },
    ],
  },
  thud: {
    length: 0.3,
    notes: [
      { start: 0, freq: 420, duration: 0.12, gate: 0.12, wave: 'noise', volume: 0.26,
        env: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.04 } },
      { start: 0, ...blip(note('A2'), 0.14, 0.5, 0.4) },
    ],
  },
  whistle: {
    length: 0.45,
    notes: [
      { start: 0.0, ...blip(note('D6'), 0.14, 0.125, 0.28) },
      { start: 0.16, ...blip(note('D6'), 0.22, 0.125, 0.3) },
      { start: 0.16, ...blip(note('A6'), 0.22, 0.125, 0.1) },
    ],
  },
  toss: {
    length: 0.2,
    notes: [
      { start: 0, freq: 2200, duration: 0.12, gate: 0.12, wave: 'noise', volume: 0.14,
        env: { attack: 0.03, decay: 0.08, sustain: 0, release: 0.03 } },
      { start: 0, ...blip(note('C5'), 0.05, 0.25, 0.2) },
    ],
  },

  // Kingpin.
  //
  // Three guns, and the ear has to tell them apart from across the map: the
  // pistol is a crack with a short tail, the uzi is the same crack with no
  // tail at all (it is fired ten times a second, and a tail would smear into
  // a hiss), and the rifle is longer, lower, and the only one with any bass.
  shot: {
    length: 0.22,
    notes: [
      { start: 0, freq: 5200, duration: 0.05, gate: 0.05, wave: 'noise', volume: 0.30,
        env: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 } },
      { start: 0.00, ...blip(note('A4'), 0.06, 0.125, 0.30) },
      { start: 0.03, ...blip(note('D3'), 0.10, 0.5, 0.22) },
    ],
  },
  rattle: {
    length: 0.09,
    notes: [
      { start: 0, freq: 4800, duration: 0.035, gate: 0.035, wave: 'noise', volume: 0.24,
        env: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 } },
      { start: 0, ...blip(note('E4'), 0.04, 0.125, 0.22) },
    ],
  },
  rifle: {
    length: 0.42,
    notes: [
      { start: 0, freq: 3600, duration: 0.09, gate: 0.09, wave: 'noise', volume: 0.32,
        env: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 } },
      { start: 0.00, ...blip(note('E4'), 0.08, 0.125, 0.30) },
      { start: 0.04, ...blip(note('A2'), 0.24, 0.5, 0.30) },
      { start: 0.10, freq: 900, duration: 0.22, gate: 0.22, wave: 'noise', short: true, volume: 0.10,
        env: { attack: 0.004, decay: 0.2, sustain: 0, release: 0.08 } },
    ],
  },
};

function render(spec) {
  const frames = Math.ceil(spec.length * synth.SAMPLE_RATE);
  const inner = {
    left: new Float32Array(frames * synth.OVERSAMPLE),
    right: new Float32Array(frames * synth.OVERSAMPLE),
  };
  for (const event of spec.notes) synth.renderNote(inner, { pan: 0, ...event });
  return synth.downsample(inner, frames);
}

// Every sound, rendered. Cheap enough to do at startup (all of them together
// are under two seconds of audio) and it keeps the frame loop free of synthesis.
function all() {
  const out = {};
  for (const [name, spec] of Object.entries(SOUNDS)) out[name] = render(spec);
  return out;
}

module.exports = { SOUNDS, render, all };

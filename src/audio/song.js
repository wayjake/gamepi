'use strict';
// Turns a score (see src/music/) into stereo PCM.
//
// A score is written in sixteenth notes: every bar is an array of [note, ticks]
// pairs and every bar must add up to 16. That's asserted at load time -- it
// catches arithmetic slips in the score far more reliably than listening does.

const synth = require('./synth');

const TICKS_PER_BAR = 16;

const CHORDS = {
  Dm: ['D', 'F', 'A'],
  Am: ['A', 'C', 'E'],
  Gm: ['G', 'Bb', 'D'],
  C: ['C', 'E', 'G'],
  F: ['F', 'A', 'C'],
  Bb: ['Bb', 'D', 'F'],
  A: ['A', 'C#', 'E'],
};

// Voice character. Panning keeps the two pulse channels from masking each
// other; the NES was mono but a little spread reads better through a TV.
const VOICES = {
  lead: {
    wave: 'pulse', duty: 0.5, volume: 0.30, pan: -0.25,
    env: { attack: 0.004, decay: 0.06, sustain: 0.75, release: 0.05 },
    vibrato: { delay: 0.18, rate: 5.5, depth: 0.004 },
  },
  harmony: {
    wave: 'pulse', duty: 0.25, volume: 0.13, pan: 0.30,
    env: { attack: 0.002, decay: 0.04, sustain: 0.45, release: 0.04 },
  },
  bass: {
    wave: 'triangle', volume: 0.34, pan: 0,
    env: { attack: 0.002, decay: 0.02, sustain: 0.95, release: 0.03 },
  },
};

// Noise voices. Frequency here is the LFSR clock, not a pitch.
const DRUMS = {
  K: { freq: 260, volume: 0.30, gate: 0.02, env: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 } },
  S: { freq: 1900, volume: 0.20, gate: 0.03, env: { attack: 0.001, decay: 0.075, sustain: 0.05, release: 0.04 } },
  h: { freq: 9000, volume: 0.06, gate: 0.01, env: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.01 } },
};

function validate(score) {
  const bars = score.lead.length;
  const problems = [];

  score.lead.forEach((bar, i) => {
    const total = bar.reduce((sum, [, ticks]) => sum + ticks, 0);
    if (total !== TICKS_PER_BAR) problems.push(`lead bar ${i + 1} is ${total} ticks, expected ${TICKS_PER_BAR}`);
  });
  if (score.chords.length !== bars) problems.push(`${score.chords.length} chords for ${bars} bars`);
  if (score.drums.length !== bars) problems.push(`${score.drums.length} drum bars for ${bars} bars`);

  score.chords.forEach((name, i) => {
    if (!CHORDS[name]) problems.push(`bar ${i + 1}: unknown chord "${name}"`);
  });
  score.drums.forEach((pattern, i) => {
    if (pattern.length !== TICKS_PER_BAR) problems.push(`drum bar ${i + 1} is ${pattern.length} steps, expected ${TICKS_PER_BAR}`);
    for (const step of pattern) {
      if (step !== '-' && !DRUMS[step]) problems.push(`drum bar ${i + 1}: unknown hit "${step}"`);
    }
  });

  if (problems.length) throw new Error(`score "${score.title}":\n  ${problems.join('\n  ')}`);
  return bars;
}

// Expands the score into flat note events, in seconds.
function schedule(score, bpm) {
  const tick = 60 / bpm / 4; // one sixteenth
  const events = [];
  const bars = validate(score);

  score.lead.forEach((bar, barIndex) => {
    let t = barIndex * TICKS_PER_BAR;
    for (const [note, ticks] of bar) {
      if (note) {
        events.push({
          ...VOICES.lead,
          freq: synth.noteToFreq(note),
          start: t * tick,
          duration: ticks * tick,
          gate: ticks * tick * (ticks > 4 ? 0.94 : 0.86),
        });
      }
      t += ticks;
    }
  });

  score.chords.forEach((name, barIndex) => {
    const [root, third, fifth] = CHORDS[name];
    const barStart = barIndex * TICKS_PER_BAR;

    // Bass: a driving eighth-note figure. Octave 3, not 2 -- a small TV
    // speaker rolls off long before the low D of octave 2 is audible.
    const bassFigure = [root, root, fifth, root, root, root, fifth, root];
    bassFigure.forEach((n, i) => {
      events.push({
        ...VOICES.bass,
        freq: synth.noteToFreq(`${n}${score.bassOctave ?? 3}`),
        start: (barStart + i * 2) * tick,
        duration: 2 * tick,
        gate: 2 * tick * 0.8,
      });
    });

    // Harmony: eighth-note arpeggio across the chord.
    const arp = [root, third, fifth, third, root, third, fifth, third];
    arp.forEach((n, i) => {
      events.push({
        ...VOICES.harmony,
        freq: synth.noteToFreq(`${n}${score.arpOctave ?? 4}`),
        start: (barStart + i * 2) * tick,
        duration: 2 * tick,
        gate: 2 * tick * 0.5,
      });
    });
  });

  score.drums.forEach((pattern, barIndex) => {
    [...pattern].forEach((step, i) => {
      if (step === '-') return;
      const drum = DRUMS[step];
      events.push({
        wave: 'noise', pan: 0, short: false,
        ...drum,
        start: (barIndex * TICKS_PER_BAR + i) * tick,
        duration: drum.gate,
      });
    });
  });

  return { events, duration: bars * TICKS_PER_BAR * tick, bars };
}

function render(score, { bpm = score.bpm } = {}) {
  const { events, duration, bars } = schedule(score, bpm);

  const tail = 0.25;
  const frames = Math.ceil((duration + tail) * synth.SAMPLE_RATE);
  const inner = {
    left: new Float32Array(frames * synth.OVERSAMPLE),
    right: new Float32Array(frames * synth.OVERSAMPLE),
  };
  for (const event of events) synth.renderNote(inner, event);

  const mix = synth.downsample(inner, frames);
  return { pcm: synth.toPcm(mix), duration, bars, notes: events.length, bpm };
}

module.exports = { render, schedule, validate, CHORDS, DRUMS, TICKS_PER_BAR };

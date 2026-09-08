'use strict';
// A long-form piece, and how it becomes notes.
//
// audio/song.js expands a score: sixteen ticks a bar, one chord name per bar,
// three fixed voices and a drum string, all of it arriving as one rendered
// buffer to be looped. That shape is exactly right for a thirty second game
// theme and cannot express a ten minute one -- there is no way to say that the
// second movement is slower, that the pad drops out for eight bars, or that the
// tune comes back a fourth lower with half its notes missing.
//
// So a *piece* is the other format. It is an arrangement rather than a loop:
//
//   piece -> movements (each with its own tempo and feel)
//         -> sections  (each with a chord cycle and a list of parts)
//         -> bars      (the timeline: absolute seconds, chord, tick length)
//         -> events    (notes, expanded one bar at a time, on demand)
//
// Two properties make everything downstream simple, and both are the same rule
// scenes live under -- a picture is a pure function of t:
//
//  - **A bar's contents are a fact about that bar.** barEvents(piece, n) seeds
//    its own generator from the piece seed and n, exactly as kingpin's
//    priceAt() seeds from place, good and day. Nothing that happened earlier in
//    the playthrough can change it, so the listener muting the drums for two
//    minutes does not send the melody somewhere else, the renderer and the
//    meters agree without talking to each other, and a test can ask what bar 91
//    contains without playing the first ninety.
//  - **Everything is checked at load.** A bar that does not add up to sixteen
//    ticks, a chord nobody can spell, a motif that is referenced and missing --
//    all of them throw when the piece is required, like ROOMS in angels.js and
//    PLACES in kingpin.js. Music you cannot hear the bug in is exactly the kind
//    of bug that wants finding at load.

const TICKS = 16; // sixteenths in a bar. Everything rhythmic is written in these.

const STEMS = ['pad', 'bass', 'keys', 'lead', 'arp', 'beat', 'haze', 'choir'];

// What each stem is called on screen, and in what order the rack shows them.
const STEM_LABEL = {
  pad: 'PAD', bass: 'BASS', keys: 'KEYS', lead: 'LEAD',
  arp: 'ARP', beat: 'BEAT', haze: 'HAZE', choir: 'CHOIR',
};

// --- pitch -------------------------------------------------------------------

const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Note name to a pitch class, 0..11. Octave numbers are handled by the caller:
// nothing in a piece is written with one, because everything is written as a
// degree of a scale or a tone of a chord and the register is the part's job.
function pitchClass(name) {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  return (LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

// The modes, as semitone offsets. Aeolian and dorian carry most of this record:
// aeolian for the flat sixth that makes a chord sound like an evening, dorian
// for the natural one that stops it sounding like a funeral.
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
};

// Chord qualities, as semitones above the root. Wider than song.js's three
// triads on purpose: a ninth is the whole difference between a chord that
// sounds like a game and one that sounds like weather.
const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m11: [0, 3, 7, 10, 14, 17],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
};

// "Dbmaj9" -> { root: 1, tones: [0,4,7,11,14], name }
function parseChord(symbol) {
  const m = /^([A-G][#b]?)(.*)$/.exec(symbol);
  if (!m) throw new Error(`bad chord: ${symbol}`);
  const tones = QUALITIES[m[2]];
  if (!tones) throw new Error(`bad chord: ${symbol} -- unknown quality "${m[2]}"`);
  return { name: symbol, root: pitchClass(m[1]), tones };
}

// A scale degree to MIDI. Degrees run past the ends of the scale in both
// directions and wrap into the next octave, so a melody can be written as one
// long line of numbers without ever thinking about where the octave breaks are.
function degreeToMidi(tonic, scale, degree, octave) {
  const n = scale.length;
  const step = Math.floor(degree / n);
  const within = degree - step * n;
  return 12 * (octave + 1) + tonic + scale[within] + 12 * step;
}

// The nth tone of a chord, counting up through octaves the same way.
function chordToMidi(chord, index, octave) {
  const n = chord.tones.length;
  const step = Math.floor(index / n);
  const within = index - step * n;
  return 12 * (octave + 1) + chord.root + chord.tones[within] + 12 * step;
}

// --- the timeline ------------------------------------------------------------

// Every bar of the piece, with the second it starts at. Built once when the
// piece is required: two hundred bars is nothing to precompute, and having the
// whole map in hand is what lets a pad hold a chord over the bar line, the HUD
// draw the movements as a strip, and the listener drop the needle anywhere.
function buildTimeline(piece) {
  const bars = [];
  let at = 0;

  piece.movements.forEach((movement, mi) => {
    const beat = 60 / movement.bpm;
    const barLength = beat * 4;
    const tick = barLength / TICKS;
    const movementStart = at;

    movement.sections.forEach((section, si) => {
      const cycle = section.chords.map(parseChord);
      for (let b = 0; b < section.bars; b++) {
        bars.push({
          index: bars.length,
          start: at,
          length: barLength,
          tick,
          swing: movement.swing ?? 0,
          bpm: movement.bpm,
          movement: mi,
          movementStart,
          section: si,
          sectionRef: section,
          barInSection: b,
          bars: section.bars,
          chord: cycle[b % cycle.length],
        });
        at += barLength;
      }
    });
    movement.start = movementStart;
    movement.end = at;
  });

  return { bars, duration: at };
}

// --- validation --------------------------------------------------------------

const DRUM_VOICES = 'KSthHrpc';

function checkMotif(motif, where, problems) {
  if (!motif || !Array.isArray(motif.bars) || !motif.bars.length) {
    problems.push(`${where}: a motif is { bars: [[[degree, ticks], ...], ...] }`);
    return;
  }
  motif.bars.forEach((bar, i) => {
    const total = bar.reduce((sum, [, ticks]) => sum + ticks, 0);
    if (total !== TICKS) problems.push(`${where} bar ${i + 1} is ${total} ticks, expected ${TICKS}`);
    for (const [degree, ticks] of bar) {
      if (degree !== null && !Number.isInteger(degree)) problems.push(`${where} bar ${i + 1}: degree ${degree} is not a whole number`);
      if (!Number.isInteger(ticks) || ticks < 1) problems.push(`${where} bar ${i + 1}: ${ticks} is not a length`);
    }
  });
}

function validate(piece) {
  const problems = [];
  const where = piece.title ?? 'a piece';

  if (!MODES[piece.mode]) problems.push(`unknown mode "${piece.mode}"`);
  try { pitchClass(piece.key); } catch (err) { problems.push(err.message); }
  if (!Array.isArray(piece.movements) || piece.movements.length !== 3) {
    problems.push('a piece is three movements -- that is the shape the form is');
  }

  for (const [name, motif] of Object.entries(piece.motifs ?? {})) checkMotif(motif, `motif ${name}`, problems);

  (piece.movements ?? []).forEach((movement, mi) => {
    const at = `movement ${mi + 1}`;
    if (!(movement.bpm > 30 && movement.bpm < 210)) problems.push(`${at}: bpm ${movement.bpm} is not a tempo`);
    if (!movement.name) problems.push(`${at}: has no name`);
    if (!Array.isArray(movement.sections) || !movement.sections.length) problems.push(`${at}: has no sections`);

    (movement.sections ?? []).forEach((section, si) => {
      const here = `${at} section ${si + 1}`;
      if (!Number.isInteger(section.bars) || section.bars < 1) problems.push(`${here}: bars is ${section.bars}`);
      if (!Array.isArray(section.chords) || !section.chords.length) problems.push(`${here}: has no chords`);
      for (const symbol of section.chords ?? []) {
        try { parseChord(symbol); } catch (err) { problems.push(`${here}: ${err.message}`); }
      }

      for (const [stem, part] of Object.entries(section.parts ?? {})) {
        if (!STEMS.includes(stem)) { problems.push(`${here}: "${stem}" is not a stem (${STEMS.join(', ')})`); continue; }
        const pattern = part.pattern ?? (part.motif ? 'motif' : null);
        if (!pattern) { problems.push(`${here}: ${stem} has neither a pattern nor a motif`); continue; }
        if (!PATTERNS[stem] || !PATTERNS[stem][pattern]) {
          problems.push(`${here}: ${stem} has no pattern "${pattern}" (${Object.keys(PATTERNS[stem] ?? {}).join(', ')})`);
        }
        if (part.motif && !(piece.motifs ?? {})[part.motif]) problems.push(`${here}: ${stem} wants motif "${part.motif}", which is not written`);
        if (stem === 'beat' && part.steps) {
          for (const [i, line] of part.steps.entries()) {
            if (line.length !== TICKS && line.length !== TICKS * 2) {
              problems.push(`${here}: drum line ${i + 1} is ${line.length} steps, expected ${TICKS} or ${TICKS * 2}`);
            }
            for (const step of line) {
              if (step !== '-' && !DRUM_VOICES.includes(step)) problems.push(`${here}: drum line ${i + 1} has no voice "${step}"`);
            }
          }
        }
      }
    });
  });

  if (problems.length) throw new Error(`piece "${where}":\n  ${problems.join('\n  ')}`);
  return piece;
}

// --- expansion ---------------------------------------------------------------
//
// One generator per pattern name. Each is handed everything it could want to
// know about the bar and pushes events; none of them may keep state between
// calls, because a bar is a fact and has to come out the same whenever it is
// asked for.

// The register anything here may ask for. The bottom is below the lowest note
// on a bass guitar and the top is above the top of a flute, so nothing musical
// is ever moved -- it exists to stop a generator that stacks an octave on top
// of a ninth on top of an already high part from asking for a pitch that
// arrives as a whistle, which is what the weather generator used to do.
//
// A note outside it is folded by octaves rather than clamped. Clamping changes
// the pitch class, and a piece where the only out-of-key notes are the ones the
// safety rail put there is worse than one with no rail at all.
const LOWEST = 28;
const HIGHEST = 100;

const push = (out, event) => {
  if (event.midi !== undefined) {
    let midi = event.midi;
    while (midi > HIGHEST) midi -= 12;
    while (midi < LOWEST) midi += 12;
    event.midi = midi;
  }
  out.push(event);
  return out;
};

// Where a sixteenth actually lands. Swing pushes every other one late, which is
// the difference between a drum machine and a drummer.
function tickAt(bar, tick) {
  const swung = tick % 2 === 1 ? tick + (bar.swing ?? 0) : tick;
  return bar.start + swung * bar.tick;
}

// How far through its section this bar is, 0..1. Sections use it to open a
// filter or lean on the volume as they build.
const progress = (bar) => (bar.bars <= 1 ? 1 : bar.barInSection / (bar.bars - 1));

// A part may name a value as a pair, meaning "sweep from the first to the
// second across the section". Everything a part can set goes through here.
function shape(value, bar, fallback) {
  if (value === undefined) return fallback;
  if (Array.isArray(value)) return value[0] + (value[1] - value[0]) * progress(bar);
  return value;
}

// Chord tones spread over a register rather than stacked in root position. A
// close voicing of a ninth chord is mud below middle C; an open one is the
// whole sound.
function voicing(chord, octave, count, spread) {
  const notes = [];
  for (let i = 0; i < count; i++) {
    const index = spread ? i * 2 : i;
    notes.push(chordToMidi(chord, index, octave));
  }
  return notes;
}

// How many bars this chord is about to be held for, so a pad can play through
// the bar line instead of restriking. Capped by the part, and it never runs
// past the end of a section.
function held(timeline, index, cap) {
  const here = timeline.bars[index];
  let n = 1;
  while (n < cap) {
    const next = timeline.bars[index + n];
    if (!next || next.section !== here.section || next.movement !== here.movement) break;
    if (next.chord.name !== here.chord.name) break;
    n++;
  }
  return n;
}

const isFirstOfChord = (timeline, index) => {
  const here = timeline.bars[index];
  const before = timeline.bars[index - 1];
  return !before || before.section !== here.section || before.movement !== here.movement
    || before.chord.name !== here.chord.name;
};

const PATTERNS = {
  // --- pad: the bed. One chord, held, with the filter doing the moving. -----
  pad: {
    wash(ctx, out) {
      const { bar, part, timeline } = ctx;
      if (!isFirstOfChord(timeline, bar.index)) return;
      const bars = held(timeline, bar.index, part.hold ?? 4);
      const octave = part.octave ?? 3;
      for (const midi of voicing(bar.chord, octave, part.notes ?? 4, part.spread !== false)) {
        push(out, {
          stem: 'pad', midi, at: bar.start, dur: bar.length * bars,
          gate: bar.length * bars * 0.96,
          vel: shape(part.vel, bar, 0.8), tone: shape(part.open, bar, 0.42),
        });
      }
    },
    // Two chords a bar, breathing. Used where a wash would be too still.
    breathe(ctx, out) {
      const { bar, part } = ctx;
      const octave = part.octave ?? 3;
      for (const half of [0, 8]) {
        for (const midi of voicing(bar.chord, octave, part.notes ?? 3, true)) {
          push(out, {
            stem: 'pad', midi, at: tickAt(bar, half), dur: bar.tick * 8,
            gate: bar.tick * 7, vel: shape(part.vel, bar, 0.7) * (half ? 0.8 : 1),
            tone: shape(part.open, bar, 0.5),
          });
        }
      }
    },
    // A single low fifth, no third: the sound of a room rather than a chord.
    drone(ctx, out) {
      const { bar, part, timeline } = ctx;
      if (!isFirstOfChord(timeline, bar.index)) return;
      const bars = held(timeline, bar.index, part.hold ?? 8);
      const root = chordToMidi(bar.chord, 0, part.octave ?? 2);
      for (const midi of [root, root + 7, root + 12]) {
        push(out, {
          stem: 'pad', midi, at: bar.start, dur: bar.length * bars,
          gate: bar.length * bars * 0.98, vel: shape(part.vel, bar, 0.7),
          tone: shape(part.open, bar, 0.3),
        });
      }
    },
  },

  // --- bass ----------------------------------------------------------------
  bass: {
    roots(ctx, out) {
      const { bar, part, rng } = ctx;
      const octave = part.octave ?? 2;
      const root = chordToMidi(bar.chord, 0, octave);
      const beats = [[0, 6], [8, 6]];
      for (const [tick, len] of beats) {
        push(out, {
          stem: 'bass', midi: root, at: tickAt(bar, tick), dur: bar.tick * len,
          gate: bar.tick * len * 0.9, vel: shape(part.vel, bar, 0.85), tone: shape(part.open, bar, 0.3),
        });
      }
      // An occasional fifth on the last sixteenth, so two bars are never quite
      // the same bar twice.
      if (rng.chance(part.lift ?? 0.35)) {
        push(out, {
          stem: 'bass', midi: chordToMidi(bar.chord, 2, octave), at: tickAt(bar, 14),
          dur: bar.tick * 2, gate: bar.tick * 1.6, vel: 0.7, tone: 0.35,
        });
      }
    },
    // Root on one, the offbeat push before three: the figure the whole of this
    // kind of music is built on.
    dub(ctx, out) {
      const { bar, part, rng, timeline } = ctx;
      const octave = part.octave ?? 2;
      const root = chordToMidi(bar.chord, 0, octave);
      const fifth = chordToMidi(bar.chord, 2, octave);
      const figure = [[0, root, 5], [7, root, 2], [10, fifth, 4]];
      for (const [tick, midi, len] of figure) {
        push(out, {
          stem: 'bass', midi, at: tickAt(bar, tick), dur: bar.tick * len,
          gate: bar.tick * len * 0.85, vel: shape(part.vel, bar, 0.85) * (tick ? 0.85 : 1),
          tone: shape(part.open, bar, 0.34),
        });
      }
      // A pickup on the last sixteenth: the root of the chord that is about to
      // arrive, an octave down. Taking a fixed interval off this chord's root
      // instead -- which is what this was -- put a chromatic note under a bar
      // line about once a minute, and a bass playing out of the key is the one
      // wrong note nobody forgives.
      const next = timeline.bars[bar.index + 1];
      if (next && rng.chance(0.25)) {
        push(out, {
          stem: 'bass', midi: chordToMidi(next.chord, 0, octave), at: tickAt(bar, 15),
          dur: bar.tick, gate: bar.tick * 0.8, vel: 0.55, tone: 0.4,
        });
      }
    },
    walk(ctx, out) {
      const { bar, part } = ctx;
      const octave = part.octave ?? 2;
      const line = [0, 2, 1, 2, 0, 3, 2, 1];
      line.forEach((index, i) => {
        push(out, {
          stem: 'bass', midi: chordToMidi(bar.chord, index, octave), at: tickAt(bar, i * 2),
          dur: bar.tick * 2, gate: bar.tick * 1.7,
          vel: shape(part.vel, bar, 0.75) * (i % 2 ? 0.8 : 1), tone: shape(part.open, bar, 0.36),
        });
      });
    },
    hold(ctx, out) {
      const { bar, part, timeline } = ctx;
      if (!isFirstOfChord(timeline, bar.index)) return;
      const bars = held(timeline, bar.index, part.hold ?? 4);
      push(out, {
        stem: 'bass', midi: chordToMidi(bar.chord, 0, part.octave ?? 2), at: bar.start,
        dur: bar.length * bars, gate: bar.length * bars * 0.97,
        vel: shape(part.vel, bar, 0.8), tone: shape(part.open, bar, 0.25),
      });
    },
  },

  // --- keys: the electric piano, struck rather than swept ------------------
  keys: {
    // Chord tones dropped in at seeded places. Sparse on purpose: this is the
    // part that makes a bar sound like it was played rather than programmed.
    chime(ctx, out) {
      const { bar, part, rng } = ctx;
      const octave = part.octave ?? 4;
      const slots = part.slots ?? [0, 3, 6, 10, 12];
      const density = shape(part.density, bar, 0.55);
      for (const tick of slots) {
        if (!rng.chance(density)) continue;
        const index = rng.int(4);
        push(out, {
          stem: 'keys', midi: chordToMidi(bar.chord, index, octave), at: tickAt(bar, tick),
          dur: bar.tick * 6, gate: bar.tick * 4,
          vel: shape(part.vel, bar, 0.7) * rng.range(0.75, 1), tone: shape(part.open, bar, 0.55),
        });
      }
    },
    // The chord, struck as one, with the top note a beat behind the rest.
    stab(ctx, out) {
      const { bar, part } = ctx;
      const octave = part.octave ?? 4;
      const notes = voicing(bar.chord, octave, part.notes ?? 3, true);
      notes.forEach((midi, i) => {
        push(out, {
          stem: 'keys', midi, at: tickAt(bar, 0) + i * 0.012, dur: bar.tick * 8,
          gate: bar.tick * 6, vel: shape(part.vel, bar, 0.72), tone: shape(part.open, bar, 0.5),
        });
      });
    },
    motif(ctx, out) { return motifInto('keys', ctx, out, { dur: 0.9, tone: 0.55 }); },
  },

  // --- lead: the tune ------------------------------------------------------
  lead: {
    motif(ctx, out) { return motifInto('lead', ctx, out, { dur: 0.96, tone: 0.5 }); },
    // One long note, a scale degree above the chord. The lead as a held sound
    // rather than a line, which is what the last movement of each piece wants.
    hold(ctx, out) {
      const { bar, part, timeline } = ctx;
      if (!isFirstOfChord(timeline, bar.index)) return;
      const bars = held(timeline, bar.index, part.hold ?? 2);
      push(out, {
        stem: 'lead', midi: chordToMidi(bar.chord, part.tone ?? 2, part.octave ?? 5),
        at: bar.start, dur: bar.length * bars, gate: bar.length * bars * 0.9,
        vel: shape(part.vel, bar, 0.7), tone: shape(part.open, bar, 0.55),
      });
    },
  },

  // --- arp: the sequencer --------------------------------------------------
  arp: {
    run(ctx, out) {
      const { bar, part, rng } = ctx;
      const octave = part.octave ?? 4;
      const span = part.span ?? 5;
      const every = part.every ?? 2; // in ticks: 2 is eighths, 1 is sixteenths
      const dir = part.dir ?? 'updown';
      const gate = part.gate ?? 0.55;
      const drop = shape(part.drop, bar, 0);
      let step = 0;
      for (let tick = 0; tick < TICKS; tick += every) {
        const cycle = dir === 'updown' ? span * 2 - 2 : span;
        const k = step % cycle;
        const index = dir === 'down' ? span - 1 - k : dir === 'updown' && k >= span ? cycle - k : k;
        step++;
        if (drop && rng.chance(drop)) continue;
        push(out, {
          stem: 'arp', midi: chordToMidi(bar.chord, index, octave), at: tickAt(bar, tick),
          dur: bar.tick * every, gate: bar.tick * every * gate,
          vel: shape(part.vel, bar, 0.6) * (tick % 4 === 0 ? 1 : 0.78),
          tone: shape(part.open, bar, 0.6),
        });
      }
    },
    // A written sequence on the pluck voice. Northlight gives its tune to the
    // sequencer rather than to the lead, and this is how: same motif, same
    // transforms, a short gate.
    motif(ctx, out) { return motifInto('arp', ctx, out, { dur: 0.5, tone: 0.62 }); },
    // Chord tones scattered rather than cycled: the same texture, less obvious.
    scatter(ctx, out) {
      const { bar, part, rng } = ctx;
      const octave = part.octave ?? 4;
      const every = part.every ?? 2;
      for (let tick = 0; tick < TICKS; tick += every) {
        if (!rng.chance(shape(part.density, bar, 0.6))) continue;
        push(out, {
          stem: 'arp', midi: chordToMidi(bar.chord, rng.int(part.span ?? 5), octave),
          at: tickAt(bar, tick), dur: bar.tick * every, gate: bar.tick * every * 0.5,
          vel: shape(part.vel, bar, 0.55) * rng.range(0.7, 1), tone: shape(part.open, bar, 0.62),
        });
      }
    },
  },

  // --- beat ----------------------------------------------------------------
  beat: {
    kit(ctx, out) {
      const { bar, part, rng } = ctx;
      const lines = part.steps;
      const line = lines[bar.barInSection % lines.length];
      const resolution = line.length / TICKS; // 1 for sixteenths, 2 for thirty-seconds
      const ghost = shape(part.ghost, bar, 0);
      for (let i = 0; i < line.length; i++) {
        const voice = line[i];
        if (voice === '-') continue;
        const tick = i / resolution;
        // A hit on a beat is louder than one between: without this the pattern
        // is a grid, and with it it is a groove.
        const strong = tick % 4 === 0 ? 1 : tick % 2 === 0 ? 0.86 : 0.72;
        push(out, {
          stem: 'beat', voice, at: tickAt(bar, tick), dur: 0.4, gate: 0.02,
          vel: shape(part.vel, bar, 0.9) * strong * rng.range(0.9, 1.04),
          tone: shape(part.open, bar, 0.5),
        });
      }
      // A ghosted snare somewhere in the second half, sometimes. The one place
      // the drums are allowed to surprise you.
      if (ghost && rng.chance(ghost)) {
        push(out, {
          stem: 'beat', voice: 'r', at: tickAt(bar, 8 + rng.int(7)), dur: 0.2, gate: 0.02,
          vel: 0.4, tone: 0.5,
        });
      }
    },
  },

  // --- haze: tape, weather, radio -----------------------------------------
  haze: {
    // A filtered noise swell, one every few bars, rising and falling across it.
    swells(ctx, out) {
      const { bar, part, rng } = ctx;
      const every = part.every ?? 4;
      if (bar.barInSection % every !== 0) return;
      push(out, {
        stem: 'haze', voice: 'swell', midi: chordToMidi(bar.chord, 0, part.octave ?? 4),
        at: bar.start + rng.range(0, bar.length * 0.2), dur: bar.length * every * 0.9,
        gate: bar.length * every * 0.55, vel: shape(part.vel, bar, 0.6),
        tone: shape(part.open, bar, 0.45),
      });
    },
    // Short blips at seeded places: the sound of a dial being moved.
    grain(ctx, out) {
      const { bar, part, rng } = ctx;
      const density = shape(part.density, bar, 0.5);
      for (let tick = 0; tick < TICKS; tick += 2) {
        if (!rng.chance(density * 0.25)) continue;
        push(out, {
          stem: 'haze', voice: 'grain', midi: chordToMidi(bar.chord, rng.int(5), (part.octave ?? 5) + rng.int(2)),
          at: tickAt(bar, tick) + rng.range(0, bar.tick), dur: 0.5,
          gate: rng.range(0.02, 0.16), vel: shape(part.vel, bar, 0.5) * rng.range(0.5, 1),
          tone: rng.range(0.4, 0.9),
        });
      }
    },
  },

  // --- choir: the voices ---------------------------------------------------
  choir: {
    oohs(ctx, out) {
      const { bar, part, timeline } = ctx;
      if (!isFirstOfChord(timeline, bar.index)) return;
      const bars = held(timeline, bar.index, part.hold ?? 2);
      const octave = part.octave ?? 4;
      for (const midi of voicing(bar.chord, octave, part.notes ?? 3, part.spread !== false)) {
        push(out, {
          stem: 'choir', midi, at: bar.start + 0.04, dur: bar.length * bars,
          gate: bar.length * bars * 0.88, vel: shape(part.vel, bar, 0.7),
          tone: shape(part.open, bar, 0.5),
        });
      }
    },
    motif(ctx, out) { return motifInto('choir', ctx, out, { dur: 0.98, tone: 0.45 }); },
  },
};

// A written motif, placed into a bar and put through whatever the section asks
// of it. This is where structure comes from: the same six notes arrive in the
// first movement plain, in the second a fourth lower with half of them gone,
// and in the third stretched to twice the length. Nothing is generated -- the
// tunes are written down in the piece, and only the transformations are code.
function motifInto(stem, ctx, out, defaults) {
  const { bar, part, piece, rng } = ctx;
  const motif = piece.motifs[part.motif];
  const t = part.transform ?? {};
  const scale = MODES[piece.mode];
  const tonic = pitchClass(piece.key);
  const octave = (part.octave ?? 5) + (t.octave ?? 0);

  // Which bar of the motif this is. A motif shorter than the section repeats;
  // `stretch` plays each of its bars over two, which is how the last movement
  // says the same thing more slowly.
  const stretch = t.stretch ?? 1;
  const position = Math.floor(bar.barInSection / stretch) % motif.bars.length;
  const half = stretch > 1 ? bar.barInSection % stretch : 0;

  let notes = motif.bars[position];
  if (t.retro) notes = [...notes].reverse();

  // Under `stretch`, each bar of the motif covers `stretch` bars, so this bar
  // takes its share of the ticks -- the first half of the phrase, then the
  // second.
  let tick = 0;
  const events = [];
  for (const [degree, ticks] of notes) {
    events.push({ degree, ticks, tick });
    tick += ticks;
  }
  const window = TICKS / stretch;
  const from = half * window;
  const chosen = stretch > 1 ? events.filter((e) => e.tick >= from && e.tick < from + window) : events;

  for (const event of chosen) {
    if (event.degree === null) continue;
    if (t.thin && rng.chance(t.thin)) continue;
    const degree = event.degree + (t.steps ?? 0);
    const midi = degreeToMidi(tonic, scale, degree, octave);
    const at = tickAt(bar, (event.tick - from) * stretch);
    const length = event.ticks * stretch * bar.tick;
    push(out, {
      stem, midi, at, dur: length,
      gate: length * (defaults.dur ?? 0.95),
      vel: shape(part.vel, bar, 0.8) * rng.range(0.92, 1),
      tone: shape(part.open, bar, defaults.tone ?? 0.5),
    });
    // A grace note above, occasionally, on a long one. The ornament is seeded
    // from the bar, so it is in the same place every time this bar comes round.
    if (t.ornament && event.ticks >= 4 && rng.chance(t.ornament)) {
      push(out, {
        stem, midi: degreeToMidi(tonic, scale, degree + 1, octave), at,
        dur: bar.tick * 0.9, gate: bar.tick * 0.55, vel: 0.5, tone: 0.6,
      });
    }
  }
}

// --- the front door ----------------------------------------------------------

// Everything one bar contains, for every stem the arrangement gives it. Seeded
// from the piece and the bar index and from nothing else, so it is the same
// list however you arrived at it.
function barEvents(piece, index) {
  const bar = piece.timeline.bars[index];
  if (!bar) return [];
  const cached = piece.cache.get(index);
  if (cached) return cached;

  const { Rng } = require('./tone');
  const out = [];
  for (const [stem, part] of Object.entries(bar.sectionRef.parts ?? {})) {
    const pattern = part.pattern ?? 'motif';
    // One generator per stem per bar, so adding a part to a section cannot
    // change what another part plays.
    const rng = new Rng((piece.seed * 2654435761 + index * 40503 + stemSalt(stem)) >>> 0);
    PATTERNS[stem][pattern]({ bar, part, piece, timeline: piece.timeline, rng }, out);
  }
  out.sort((a, b) => a.at - b.at);
  piece.cache.set(index, out);
  return out;
}

const stemSalt = (stem) => (STEMS.indexOf(stem) + 1) * 7919;

// Which bar covers this second. Used to drop the needle: everything else walks
// forward a bar at a time.
function barAt(piece, seconds) {
  const bars = piece.timeline.bars;
  let lo = 0;
  let hi = bars.length - 1;
  if (seconds <= 0) return 0;
  if (seconds >= piece.duration) return bars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].start <= seconds) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Loads a piece: validates it, builds the timeline, and freezes the parts of it
// nothing downstream has any business writing to.
function load(spec) {
  const piece = { ...spec };
  validate(piece);
  piece.timeline = buildTimeline(piece);
  piece.duration = piece.timeline.duration;
  piece.cache = new Map();
  piece.seed = piece.seed ?? 1;
  // Which stems the arrangement ever asks for, so the rack knows what to build
  // and the listener is not offered a switch that does nothing.
  const used = new Set();
  for (const movement of piece.movements) {
    for (const section of movement.sections) {
      for (const stem of Object.keys(section.parts ?? {})) used.add(stem);
    }
  }
  piece.stems = STEMS.filter((stem) => used.has(stem));
  return piece;
}

// Which stems the arrangement is asking for at this second -- what is *scored*,
// as opposed to what the listener has left switched on. The rack draws both.
function scoredAt(piece, seconds) {
  const bar = piece.timeline.bars[Math.min(barAt(piece, seconds), piece.timeline.bars.length - 1)];
  return new Set(Object.keys(bar.sectionRef.parts ?? {}));
}

module.exports = {
  TICKS, STEMS, STEM_LABEL, MODES, QUALITIES, DRUM_VOICES, PATTERNS, LOWEST, HIGHEST,
  load, validate, barEvents, barAt, scoredAt,
  parseChord, pitchClass, degreeToMidi, chordToMidi, buildTimeline,
};

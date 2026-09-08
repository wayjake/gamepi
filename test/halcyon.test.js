'use strict';
// The music, the rig it is played on, and the desk in front of it.
//
// test/music.test.js does the equivalent job for a score: render it and check
// the pitches coming out are the ones that went in. This does the same for a
// piece, and then the things a score cannot go wrong at -- an arrangement that
// asks for a part nobody wrote, a bar whose contents depend on how you arrived
// at it, a fader that mutes the picture but not the sound.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pieceLib = require('../src/audio/piece');
const rackLib = require('../src/audio/rack');
const tone = require('../src/audio/tone');
const halcyon = require('../src/games/halcyon');
const input = require('../src/input');
const sceneRenderer = require('../src/gfx/scene');
const invariants = require('./invariants');

const PIECES = path.join(__dirname, '..', 'src', 'music', 'pieces');
const FPS = 30;
const BLOCK = 1470;

const ids = fs.readdirSync(PIECES).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));

// Runs the rack the way game.js does -- advance one frame, pull one block --
// and reports what came out.
function listen(piece, { levels = null, from = 0, seconds = 2, keep = false } = {}) {
  const rig = rackLib.open(piece, { seed: piece.seed, fps: FPS });
  if (levels) for (const [name, level] of Object.entries(levels)) rig.set(name, level);
  if (from) rig.seek(from);

  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const frames = Math.round(seconds * FPS);
  const samples = keep ? new Float32Array(frames * BLOCK) : null;
  let peak = 0;
  let sum = 0;

  for (let f = 0; f < frames; f++) {
    rig.advance(1 / FPS);
    left.fill(0);
    right.fill(0);
    rig.pull(left, right, BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      const l = left[i];
      peak = Math.max(peak, Math.abs(l), Math.abs(right[i]));
      sum += l * l + right[i] * right[i];
      if (samples) samples[f * BLOCK + i] = l;
    }
  }
  return { peak, rms: Math.sqrt(sum / (frames * BLOCK * 2)), samples, rig };
}

const only = (piece, stem) => Object.fromEntries(piece.stems.map((name) => [name, name === stem ? 1 : 0]));

// The first bar in which this part actually plays a note -- not the first bar
// that scores it. A pad holding one chord over four bars, or a sparse part that
// rolled no notes in its opening bar, is scored long before it is audible.
function momentFor(piece, stem) {
  for (let i = 0; i < piece.timeline.bars.length; i++) {
    if (!piece.timeline.bars[i].sectionRef.parts[stem]) continue;
    if (pieceLib.barEvents(piece, i).some((event) => event.stem === stem)) return piece.timeline.bars[i].start;
  }
  return null;
}

for (const id of ids) {
  const piece = pieceLib.load(require(path.join(PIECES, id)));
  const name = piece.title;

  test(`${name}: is three movements and about ten minutes`, () => {
    assert.strictEqual(piece.movements.length, 3);
    assert.ok(piece.duration > 9.5 * 60 && piece.duration < 10.5 * 60,
      `${(piece.duration / 60).toFixed(2)} minutes is not ten`);
    // Each movement has to be a movement, not a bridge.
    for (const movement of piece.movements) {
      const span = movement.end - movement.start;
      assert.ok(span > 150 && span < 250, `${movement.name} is ${span.toFixed(0)}s`);
      assert.ok(movement.sections.length >= 3, `${movement.name} has ${movement.sections.length} sections`);
    }
    // Every movement is a different tempo. If two are the same the listener
    // hears one long movement with a key change in it.
    const tempos = new Set(piece.movements.map((m) => m.bpm));
    assert.strictEqual(tempos.size, 3, 'two movements share a tempo');
  });

  test(`${name}: every note is in the key and inside a register something can play`, () => {
    const tonic = pieceLib.pitchClass(piece.key);
    const scale = new Set(pieceLib.MODES[piece.mode].map((s) => (tonic + s) % 12));
    const strays = [];
    for (let i = 0; i < piece.timeline.bars.length; i++) {
      for (const event of pieceLib.barEvents(piece, i)) {
        if (event.midi === undefined) continue;
        assert.ok(event.midi >= pieceLib.LOWEST && event.midi <= pieceLib.HIGHEST,
          `bar ${i + 1}: ${event.stem} asks for midi ${event.midi}`);
        if (!scale.has(((event.midi % 12) + 12) % 12)) strays.push(`bar ${i + 1} ${event.stem} ${event.midi}`);
      }
    }
    // Every chord in all three pieces is diatonic, so a note that is not is a
    // generator inventing an interval rather than a piece choosing one.
    assert.deepStrictEqual(strays.slice(0, 5), [], `${strays.length} notes outside ${piece.key} ${piece.mode}`);
  });

  test(`${name}: a bar is a fact, whichever way you came to it`, () => {
    const fresh = pieceLib.load(require(path.join(PIECES, id)));
    const forwards = [];
    for (let i = 0; i < 40; i++) forwards.push(JSON.stringify(pieceLib.barEvents(fresh, i)));

    const backwards = pieceLib.load(require(path.join(PIECES, id)));
    const out = [];
    for (let i = 39; i >= 0; i--) out[i] = JSON.stringify(pieceLib.barEvents(backwards, i));
    assert.deepStrictEqual(out, forwards, 'a bar came out differently depending on what was asked for first');

    // And asking twice is the same as asking once.
    assert.strictEqual(JSON.stringify(pieceLib.barEvents(fresh, 17)), forwards[17]);
  });

  test(`${name}: every part it asks for makes a sound of its own`, () => {
    for (const stem of piece.stems) {
      assert.ok(rackLib.PATCHES[stem], `no patch for ${stem}`);
      const at = momentFor(piece, stem);
      assert.ok(at !== null, `${stem} is in the manifest but never scored`);
      const { peak, rms } = listen(piece, { levels: only(piece, stem), from: at, seconds: 4 });
      assert.ok(peak > 0.02, `${stem} alone is silence (peak ${peak.toFixed(4)})`);
      assert.ok(rms > 0.001, `${stem} alone is nearly silence (rms ${rms.toFixed(5)})`);
    }
  });

  test(`${name}: the mix is loud, and it never clips`, () => {
    // Sampled where every part is playing at once, which is the worst case the
    // limiter has to survive. There is no normalising stage after this.
    const { peak, rms } = listen(piece, { from: piece.taster ?? piece.duration / 2, seconds: 6 });
    assert.ok(peak < 1, `peak ${peak.toFixed(3)} clips`);
    assert.ok(peak > 0.3, `peak ${peak.toFixed(3)} is too quiet to be a record`);
    assert.ok(rms > 0.05, `rms ${rms.toFixed(3)} is too quiet to be a record`);
  });

  test(`${name}: rendering it twice gives the same samples`, () => {
    const a = listen(piece, { from: 100, seconds: 1.5, keep: true }).samples;
    const b = listen(piece, { from: 100, seconds: 1.5, keep: true }).samples;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    assert.strictEqual(worst, 0, 'two renders of the same seconds differ -- something is not seeded');
  });
}

// --- the pipeline, end to end ------------------------------------------------

// Normalised autocorrelation, the same trick test/music.test.js uses on the
// chip synth. The bass is the voice to measure: it is nearly a sine, so its
// period is unambiguous even through the filter and the tape wobble.
function detectPitch(samples, rate, minHz = 30, maxHz = 400) {
  const minLag = Math.floor(rate / maxHz);
  const maxLag = Math.ceil(rate / minHz);
  const r = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i + lag < samples.length; i++) {
      sum += samples[i] * samples[i + lag];
      a += samples[i] * samples[i];
      b += samples[i + lag] * samples[i + lag];
    }
    r.push(sum / (Math.sqrt(a * b) || 1));
  }
  let peak = r.indexOf(Math.max(...r));
  for (const divisor of [3, 2]) {
    const candidate = Math.round((peak + minLag) / divisor) - minLag;
    if (candidate >= 0 && r[candidate] >= r[peak] * 0.9) { peak = candidate; break; }
  }
  return rate / (minLag + peak);
}

test('the note that was written is the note that comes out', () => {
  const piece = pieceLib.load(require(path.join(PIECES, 'sundial')));
  const at = momentFor(piece, 'bass');
  const bar = piece.timeline.bars[pieceLib.barAt(piece, at)];
  const first = pieceLib.barEvents(piece, bar.index).find((e) => e.stem === 'bass');
  assert.ok(first, 'no bass in the bar the arrangement says has bass in it');

  const { samples } = listen(piece, { levels: only(piece, 'bass'), from: bar.start, seconds: 1, keep: true });
  // A window inside the first note, past the attack and the filter sweep.
  const window = samples.subarray(Math.round(0.12 * tone.SAMPLE_RATE), Math.round(0.32 * tone.SAMPLE_RATE));
  const heard = detectPitch(window, tone.SAMPLE_RATE);
  const written = tone.mtof(first.midi) * 2 ** ((piece.drift ?? 0) / 1200);
  const cents = 1200 * Math.log2(heard / written);
  assert.ok(Math.abs(cents) < 60,
    `wrote ${written.toFixed(1)} Hz, heard ${heard.toFixed(1)} Hz (${cents.toFixed(0)} cents out)`);
});

test('the tape is worn on purpose: every piece is deliberately off concert pitch', () => {
  for (const id of ids) {
    const piece = pieceLib.load(require(path.join(PIECES, id)));
    assert.ok(Math.abs(piece.drift) >= 3 && Math.abs(piece.drift) <= 30,
      `${piece.title} drifts ${piece.drift} cents, which is either inaudible or broken`);
  }
});

// --- the desk ----------------------------------------------------------------

function machine(seed = 5) {
  const game = halcyon.create(720, 480, { scores: null, seed });
  const pad = new input.Pad('p1');
  const step = (n = 1) => { for (let i = 0; i < n; i++) game.update(1 / FPS, { p1: pad.read(), p2: input.idle() }); };
  const tap = (button) => { pad.set(button, true); step(1); pad.set(button, false); step(1); };
  const start = (which = 'sundial') => {
    const index = halcyon.MENU.findIndex((entry) => entry.id === which);
    for (let i = 0; i < index; i++) tap('down');
    tap('a');
  };
  return { game, pad, step, tap, start };
}

// Moves the cursor to a named part on the bottom row.
function selectPart(drive, name) {
  const stems = halcyon.PIECES[halcyon.PIECE_IDS.indexOf(drive.game.state().piece.toLowerCase())].stems;
  if (drive.game.state().row === 0) drive.tap('down');
  const want = stems.indexOf(name);
  while (drive.game.state().col !== want) drive.tap('right');
  return stems;
}

test('halcyon: every part can be switched off, and it goes out of the picture too', () => {
  const drive = machine();
  drive.start('sundial');
  drive.step(FPS * 130); // into OPEN, where all eight are scored

  const state = drive.game.state();
  assert.strictEqual(state.screen, 'play');
  assert.ok(state.scored.length >= 7, `only ${state.scored.length} parts scored where all eight should be`);

  const busy = drive.game.scene().layers.reduce((n, layer) => n + layer.shapes.length, 0);

  for (const name of ['beat', 'arp', 'keys', 'lead']) {
    selectPart(drive, name);
    drive.tap('a');
    assert.strictEqual(drive.game.state().levels[name], 0, `${name} would not switch off`);
  }
  drive.step(FPS * 3);
  const quiet = drive.game.scene().layers.reduce((n, layer) => n + layer.shapes.length, 0);
  assert.ok(quiet < busy, `switching four parts off drew ${quiet} shapes against ${busy}`);

  // And the sound. Same seconds of the same piece, four faders down.
  const piece = halcyon.PIECES[halcyon.PIECE_IDS.indexOf('sundial')];
  const all = listen(piece, { from: 130, seconds: 3 });
  const some = listen(piece, {
    from: 130, seconds: 3,
    levels: { beat: 0, arp: 0, keys: 0, lead: 0 },
  });
  assert.ok(some.rms < all.rms * 0.85, `muting four parts changed the mix by ${(1 - some.rms / all.rms) * 100 | 0}%`);
  assert.ok(some.rms > 0, 'muting four parts silenced the other four');
});

test('halcyon: solo is a view of the desk, not a change to it', () => {
  const drive = machine();
  drive.start('sundial');
  drive.step(FPS * 130);

  selectPart(drive, 'pad');
  drive.tap('a');                       // pad off, deliberately
  selectPart(drive, 'beat');
  drive.tap('b');                       // solo the beat
  const soloed = drive.game.state();
  assert.strictEqual(soloed.solo, 'beat');
  assert.strictEqual(soloed.levels.beat, 1);
  assert.strictEqual(soloed.levels.choir, 0, 'solo left something else up');

  drive.tap('b');                       // and back
  const after = drive.game.state();
  assert.strictEqual(after.solo, null);
  assert.strictEqual(after.levels.choir, 1, 'coming out of solo did not put the desk back');
  assert.strictEqual(after.levels.pad, 0, 'coming out of solo undid a mute the listener had made');
});

test('halcyon: the knobs turn, and PART moves between movements', () => {
  const drive = machine();
  drive.start('northlight');
  drive.step(FPS * 4);

  drive.tap('up');                      // to the knob row
  assert.strictEqual(drive.game.state().row, 0);
  const room = drive.game.state().knobs.space;
  drive.tap('a');
  assert.strictEqual(drive.game.state().knobs.space, room + 1);
  drive.tap('b');
  drive.tap('b');
  assert.strictEqual(drive.game.state().knobs.space, room - 1);

  while (drive.game.state().col !== 2) drive.tap('right');  // PART
  drive.tap('a');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 1, 'PART did not move to the second movement');
  drive.tap('a');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 2);
  drive.tap('a');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 2, 'PART walked off the end of the piece');

  // From the middle of a movement, down goes to the start of the one you are
  // in; from its start, down goes to the one before it. Every machine with a
  // track button does that, and a hand expects it.
  drive.step(FPS * 20);
  const into = drive.game.state().at;
  drive.tap('b');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 2);
  assert.ok(drive.game.state().at < into, 'down from the middle did not go back to the start of the movement');
  drive.tap('b');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 1);
});

test('halcyon: the rack shows what the arrangement is asking for, not what is switched on', () => {
  const drive = machine();
  drive.start('sundial');
  drive.step(FPS * 3);                  // HAZE: pad and haze only

  const early = drive.game.state();
  assert.deepStrictEqual([...early.scored].sort(), ['haze', 'pad']);
  assert.strictEqual(early.levels.beat, 1, 'the beat is switched on');
  assert.ok((early.meters.beat ?? 0) < 0.01, 'and it is not playing, because the piece has not asked for it');

  drive.step(FPS * 130);
  assert.ok(drive.game.state().scored.length >= 7, 'the arrangement never brought the rest in');
});

test('halcyon: the meters follow the notes, and a muted part reads zero', () => {
  const drive = machine();
  drive.start('sundial');
  drive.step(FPS * 130);

  const loud = drive.game.state().meters;
  assert.ok(loud.pad > 0.05, `the pad is playing and the meter says ${loud.pad}`);
  assert.ok(loud.bass > 0.02, `the bass is playing and the meter says ${loud.bass}`);

  selectPart(drive, 'pad');
  drive.tap('a');
  drive.step(FPS * 2);
  assert.strictEqual(drive.game.state().meters.pad, 0, 'a muted part still moves its meter');
});

test('halcyon: a piece runs out, and says so', () => {
  const drive = machine();
  drive.start('harvest');
  drive.step(4);

  // Straight to the last movement rather than sitting through twenty thousand
  // frames of the first two.
  drive.tap('up');
  while (drive.game.state().col !== 2) drive.tap('right');
  drive.tap('a');
  drive.tap('a');
  drive.step(2);
  assert.strictEqual(drive.game.state().movement, 2);

  const piece = halcyon.PIECES[halcyon.PIECE_IDS.indexOf('harvest')];
  const left = piece.duration - drive.game.state().at;
  drive.step(Math.ceil((left + 1) * FPS));

  assert.strictEqual(drive.game.state().screen, 'end');
  assert.ok(drive.game.state().done);
  const scene = drive.game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'halcyon [end]');

  drive.tap('a');
  assert.strictEqual(drive.game.state().screen, 'menu');
});

test('halcyon: the menu previews whatever the cursor is on', () => {
  const drive = machine();
  drive.step(2);
  const first = drive.game.state().piece;
  drive.tap('down');
  drive.step(FPS);
  const second = drive.game.state().piece;
  assert.notStrictEqual(first, second, 'moving down the menu did not change what is playing');
  assert.ok(drive.game.state().at > 0, 'the preview is not playing anything');
  assert.ok(drive.game.stream(), 'the menu has no live source, so the shop has no listening post');
});

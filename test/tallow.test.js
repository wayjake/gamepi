'use strict';

const test = require('node:test');
const assert = require('node:assert');

const tallow = require('../src/games/tallow/theatre');
const shadowLib = require('../src/games/tallow/shadow');
const book = require('../src/games/tallow/book');
const { REGISTERS, ZONES } = require('../src/games/tallow/registers');
const { PALETTE } = require('../src/gfx/palette');
const sceneRenderer = require('../src/gfx/scene');
const { Canvas } = require('../src/canvas');
const input = require('../src/input');
const invariants = require('./invariants');

const FPS = 30;
const STEP = 1 / FPS;
const ZONE_MIDDLE = { sharp: 0.15, full: 0.5, looming: 0.9 };

function player(game) {
  const pad = new input.Pad('p1');
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [button, down] of Object.entries(held)) pad.set(button, down);
      game.update(STEP, { p1: pad.read() });
    }
  };
  const tap = (button) => { pad.set(button, true); step(1); pad.set(button, false); step(1); };
  return { pad, step, tap };
}

const toShow = (game) => {
  const drive = player(game);
  drive.tap('a');                       // PERFORM is the first entry
  assert.strictEqual(game.state().screen, 'play');
  return drive;
};

// A puppeteer that is only as good as it has to be, in the house style: it
// works out which shadow can reach the next beat's register, cycles to it,
// slides the dial into the right zone and presses A on the beat. It does not
// plan two beats ahead, which is the thing a real player learns to do.
function puppeteer(game, { play = true } = {}) {
  const drive = player(game);
  const beats = game.beats();

  const stepOnce = () => {
    const s = game.state();
    if (s.screen !== 'play') { drive.step(1); return; }

    const beat = beats[s.beat];
    if (!beat) { drive.step(1); return; }

    const rod = s.rods[s.active];
    const held = shadowLib.CAST[rod.at];
    // Prefer what is already in hand; otherwise walk the rack toward somebody
    // who can say it.
    let zone = ZONES.find((z) => held.zones[z.id] === beat.register);
    if (!zone) {
      drive.tap('right');
      return;
    }

    const want = ZONE_MIDDLE[zone.id];
    const gap = want - rod.depth;
    const due = game.beatAt(s.beat) - s.clock;

    if (play && Math.abs(due) <= tallow.WINDOW * 0.5 && Math.abs(gap) < 0.2) {
      drive.tap('a');
      return;
    }
    if (Math.abs(gap) > 0.04) { drive.step(1, { up: gap > 0, down: gap < 0 }); return; }
    drive.step(1, { up: false, down: false });
  };

  return { drive, stepOnce, beats };
}

const runShow = (game, opts) => {
  const bot = puppeteer(game, opts);
  for (let i = 0; i < 2400 && game.state().screen === 'play'; i++) bot.stepOnce();
  return game.state();
};

// --- the data ---------------------------------------------------------------

test('tallow: the rack and the Book check themselves at require time', () => {
  assert.throws(() => shadowLib.validate([{ ...shadowLib.CAST[0], zones: { sharp: 'sulking', full: 'grief', looming: 'dread' } }]),
    /not a register/);
  assert.throws(() => shadowLib.validate([shadowLib.CAST[0], shadowLib.CAST[0]]), /share an id/);
  assert.throws(() => shadowLib.validate([{ ...shadowLib.CAST[0], stretch: 'middle' }]), /not a zone/);
  const fourBeats = (register) => [0, 1, 2, 3].map((i) => ({ register: i === 2 ? register : 'grief', line: `LINE ${i}` }));
  assert.throws(() => book.validate([{ id: 'x', title: 'X', beats: fourBeats('weather') }]), /not a register/);
  assert.throws(() => book.validate([{ id: 'x', title: 'X', beats: fourBeats('grief').slice(0, 2) }]), /at least four beats/);
  assert.throws(() => book.validate([{ id: 'x', title: 'X', beats: fourBeats('grief').map((b) => ({ ...b, line: 'A '.repeat(40) })) }]),
    /longer than the caption box/);
});

// The one that matters: a page calling for a register nothing in the rack can
// produce is unplayable, and only a playthrough to that page would show it.
test('tallow: every page of the Book can be cast from the rack', () => {
  for (const scene of book.SCENES) {
    assert.doesNotThrow(() => book.castable(scene, shadowLib.CAST), `${scene.id} cannot be cast`);
  }
  assert.throws(() => book.castable({ id: 'x', beats: [{ register: 'wonder' }] },
    [{ zones: { sharp: 'grief', full: 'grief', looming: 'grief' } }]), /nothing in the rack/);
});

test('tallow: every register is somebody natural and somebody stretch', () => {
  const natural = new Set();
  const stretched = new Set();
  for (const shadow of shadowLib.CAST) {
    for (const zone of ZONES) {
      const register = shadow.zones[zone.id];
      if (shadow.stretch === zone.id) stretched.add(register);
      else natural.add(register);
    }
  }
  for (const register of Object.keys(REGISTERS)) {
    assert.ok(natural.has(register), `nothing plays ${register} comfortably`);
  }
  assert.ok(stretched.size >= 3, `only ${stretched.size} registers are anybody's stretch`);
});

// The art direction bet: a silhouette plus one dyed patch has to tell six
// people apart. Measured as a column profile, which is roughly what the eye
// gets at twelve feet from a 13" tube.
test('tallow: the six do not come out looking like each other', () => {
  const profile = (shadow) => {
    const canvas = new Canvas(240, 240);
    canvas.clear(PALETTE.linen);
    const built = shadowLib.build(shadow, { x: 120, base: 210, size: 190, t: 0, phase: 0, dir: 1 });
    for (const shape of built.body) sceneRenderer.draw(canvas, shape, PALETTE.shade, 0);
    const columns = new Array(24).fill(0);
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 240; x++) {
        if (canvas.px[y * 240 + x] === PALETTE.shade) columns[Math.floor(x / 10)]++;
      }
    }
    return columns;
  };

  const profiles = shadowLib.CAST.map(profile);
  profiles.forEach((columns, i) => {
    const ink = columns.reduce((a, b) => a + b, 0);
    assert.ok(ink > 1200, `${shadowLib.CAST[i].id} is barely there: ${ink} px`);
  });

  for (let a = 0; a < profiles.length; a++) {
    for (let b = a + 1; b < profiles.length; b++) {
      const apart = profiles[a].reduce((sum, v, i) => sum + Math.abs(v - profiles[b][i]), 0);
      assert.ok(apart > 900,
        `${shadowLib.CAST[a].id} and ${shadowLib.CAST[b].id} are only ${apart} apart -- they will read as the same person`);
    }
  }
});

// --- the look ---------------------------------------------------------------

// invariants.noFlicker only polices PALETTE.ink, because everywhere else in
// this repo a silhouette *is* ink. Here it is `shade`, and an interlaced field
// does not care what the colour was called -- so the same rule is run again
// against the colour this game actually draws its people in.
function noThinRuns(canvas, colour, where) {
  const { width, height } = canvas;
  const at = (x, y) => canvas.px[y * width + x];
  const offenders = [];
  for (let y = 1; y < height - 1; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const thin = at(x, y) === colour && at(x, y - 1) !== colour && at(x, y + 1) !== colour;
      if (thin) run++;
      else {
        if (run >= invariants.MIN_FLICKER_LENGTH) offenders.push(`${run}px at y=${y}`);
        run = 0;
      }
    }
    if (run >= invariants.MIN_FLICKER_LENGTH) offenders.push(`${run}px at y=${y}`);
  }
  assert.deepStrictEqual(offenders, [], `${where}: 1px-tall shade runs will flicker: ${offenders.slice(0, 4).join(', ')}`);
}

test('tallow: no screen draws a one-pixel-tall run of shade', () => {
  const check = (game, label) => {
    const scene = game.scene();
    noThinRuns(sceneRenderer.render(scene), PALETTE.shade, `tallow [${label}]`);
  };

  const menu = tallow.create(720, 480, { seed: 5 });
  check(menu, 'menu');

  tallow.MENU.forEach((entry, index) => {
    if (entry.id === 'quit') return;
    const game = tallow.create(720, 480, { seed: 5 });
    const drive = player(game);
    for (let i = 0; i < index; i++) drive.tap('down');
    drive.tap('a');
    check(game, entry.id);
    drive.step(70);
    check(game, `${entry.id}, running`);
  });

  // And the dial at both ends, where the puppets are at their largest and
  // their smallest -- the two places a thin run would appear if anywhere.
  for (const button of ['up', 'down']) {
    const game = tallow.create(720, 480, { seed: 9 });
    const drive = toShow(game);
    drive.step(45, { [button]: true });
    check(game, `play, dial ${button}`);
  }
});

test('tallow: the rack pages through everybody and every page is legal', () => {
  const game = tallow.create(720, 480, { seed: 3 });
  const drive = player(game);
  drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'rack');

  for (let i = 0; i < shadowLib.CAST.length; i++) {
    assert.strictEqual(game.state().pick, i);
    const scene = game.scene();
    invariants.legalFrame(scene, sceneRenderer.render(scene), `tallow [rack ${shadowLib.CAST[i].id}]`);
    noThinRuns(sceneRenderer.render(scene), PALETTE.shade, `tallow [rack ${shadowLib.CAST[i].id}]`);
    drive.tap('right');
  }
  assert.strictEqual(game.state().pick, 0, 'the rack does not wrap round');
});

// --- the dial ---------------------------------------------------------------

test('tallow: the same puppet reads three ways depending on how it is held', () => {
  for (const shadow of shadowLib.CAST) {
    const seen = ZONES.map((zone) => shadowLib.reading(shadow, ZONE_MIDDLE[zone.id]));
    seen.forEach((r, i) => assert.strictEqual(r.zone, ZONES[i].id, `${shadow.id}: dial band ${i} is wrong`));
    assert.strictEqual(seen.filter((r) => r.stretch).length, 1, `${shadow.id}: exactly one zone is its stretch`);
  }
});

test('tallow: the dial moves with the stick, and only for the hand in use', () => {
  const game = tallow.create(720, 480, { seed: 11 });
  const drive = toShow(game);
  const before = game.state().rods.map((r) => r.depth);

  drive.step(20, { up: true });
  const after = game.state();
  assert.ok(after.rods[0].depth > before[0], 'up did not carry it back toward the lamp');
  assert.strictEqual(after.rods[1].depth, before[1], 'the other hand moved too');

  drive.tap('b');
  assert.strictEqual(game.state().active, 1, 'B did not change hands');
  // `up` is still held from above -- step() only touches the buttons it is
  // given, exactly like a stick nobody let go of.
  drive.step(20, { up: false, down: true });
  assert.ok(game.state().rods[1].depth < before[1], 'the second hand will not move');
});

// --- the performance --------------------------------------------------------

test('tallow: playing the beats warms the room, and the show ends', () => {
  const game = tallow.create(720, 480, { seed: 21 });
  toShow(game);
  const end = runShow(game);

  assert.strictEqual(end.screen, 'result');
  assert.ok(!end.walked, 'the crowd walked out on a competent show');
  assert.ok(end.hits + end.stretches >= game.beats().length * 0.6,
    `only ${end.hits + end.stretches} of ${game.beats().length} beats landed`);
  assert.ok(end.warmth > tallow.WARMTH_START, `the room got colder: ${end.warmth}`);
  assert.ok(end.tally > 0, 'a good night paid nothing');
});

test('tallow: a player who does nothing is left playing to an empty room', () => {
  const game = tallow.create(720, 480, { seed: 21 });
  const drive = toShow(game);
  for (let i = 0; i < 2400 && game.state().screen === 'play'; i++) drive.step(1);

  const end = game.state();
  assert.strictEqual(end.screen, 'result');
  assert.ok(end.walked, 'nobody left, so there was never anything at stake');
  assert.strictEqual(end.hits + end.stretches, 0);
});

test('tallow: a stretch is reached for, and is paid more than a comfortable hit', () => {
  const game = tallow.create(720, 480, { seed: 33 });
  toShow(game);
  const end = runShow(game);

  assert.ok(end.stretches > 0, 'the bot never reached for anything, so nothing can level');
  // Every landed beat is worth its own rate, and a stretch is worth more than
  // twice a safe hit. That ratio is the whole reason to take the risk.
  assert.ok(end.tally >= end.hits * 10 + end.stretches * 25,
    `stretches are not being paid for: ${end.tally} for ${end.hits} hits and ${end.stretches} stretches`);
  assert.ok(end.warmth > tallow.WARMTH_START, 'reaching left the room colder than it started');
});

test('tallow: pressing A at nothing costs, so mashing is not a strategy', () => {
  const game = tallow.create(720, 480, { seed: 4 });
  const drive = toShow(game);
  const start = game.state().warmth;
  for (let i = 0; i < 20; i++) drive.tap('a');   // well before the first beat
  const after = game.state();
  assert.ok(after.warmth < start, 'mashing was free');
  assert.strictEqual(after.beat, 0, 'a mash resolved a beat that had not arrived');
});

test('tallow: the wrong register is worse than the right one, and both resolve the beat', () => {
  const wrongOne = tallow.create(720, 480, { seed: 6 });
  const drive = toShow(wrongOne);
  const beats = wrongOne.beats();

  // Sit on a zone that cannot say what the first beat wants, then answer it.
  const wanted = beats[0].register;
  const held = shadowLib.CAST[wrongOne.state().rods[0].at];
  const badZone = ZONES.find((z) => held.zones[z.id] !== wanted);
  const want = ZONE_MIDDLE[badZone.id];
  for (let i = 0; i < 60 && Math.abs(wrongOne.state().rods[0].depth - want) > 0.05; i++) {
    drive.step(1, { up: wrongOne.state().rods[0].depth < want, down: wrongOne.state().rods[0].depth > want });
  }
  while (wrongOne.state().clock < tallow.LEAD_IN - 0.05) drive.step(1, { up: false, down: false });
  drive.tap('a');

  const after = wrongOne.state();
  assert.strictEqual(after.beat, 1, 'a wrong answer did not use the beat up');
  assert.strictEqual(after.marks[0], 'wrong');
  assert.ok(after.warmth < tallow.WARMTH_START, 'the wrong register cost nothing');
});

test('tallow: the show can be held, and picks up where it was', () => {
  const game = tallow.create(720, 480, { seed: 8 });
  const drive = toShow(game);
  drive.step(40);
  const clock = game.state().clock;

  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  drive.step(60);
  assert.strictEqual(game.state().clock, clock, 'the show ran on while it was held');

  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'tallow [paused]');

  drive.tap('b');
  assert.strictEqual(game.state().screen, 'play');
  drive.step(10);
  assert.ok(game.state().clock > clock, 'it did not start again');
});

test('tallow: every track it asks for is a score in src/music', () => {
  const song = require('../src/audio/song');
  const game = tallow.create(720, 480, { seed: 2 });
  const drive = player(game);
  const asked = new Set([game.music()]);

  drive.tap('a');
  asked.add(game.music());
  const bot = puppeteer(game);
  for (let i = 0; i < 2400 && game.state().screen === 'play'; i++) { bot.stepOnce(); asked.add(game.music()); }
  asked.add(game.music());

  assert.ok(asked.has('lamplight') && asked.has('warmth'), `the room never changed the record: ${[...asked]}`);
  for (const name of asked) {
    if (name === null) continue;
    assert.doesNotThrow(() => song.validate(require(`../src/music/${name}`)), `${name} is not a valid score`);
  }
});

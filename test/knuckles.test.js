'use strict';
// Timmy Tough Knuckles. The generic contract is in test/game.test.js; this is
// the brawler's own rules -- lives, weapons that wear out, lunch, the waves,
// the bosses, and a pad-driven run from the first bell to the last one.

const test = require('node:test');
const assert = require('node:assert');

const knuckles = require('../src/games/knuckles');
const sceneRenderer = require('../src/gfx/scene');
const input = require('../src/input');
const invariants = require('./invariants');

const STEP = 1 / 30;

function fakeTable(rows = []) {
  let board = rows.map((row, i) => ({ rank: i + 1, name: row.name, score: row.score }));
  const pad = () => {
    const out = [...board];
    while (out.length < 8) out.push({ rank: out.length + 1, name: 'AAA', score: 0 });
    return out.map((row, i) => ({ ...row, rank: i + 1 })).slice(0, 8);
  };
  return {
    recorded: [],
    table: () => pad(),
    placing(game, score) {
      if (score <= 0) return 0;
      const index = pad().findIndex((row) => score > row.score);
      return index === -1 ? 0 : index + 1;
    },
    record(game, name, score) {
      this.recorded.push({ name, score });
      board = [...board, { name, score }].sort((a, b) => b.score - a.score).slice(0, 8);
      return pad();
    },
  };
}

function player(game) {
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [pad, buttons] of Object.entries(held)) {
        for (const [button, down] of Object.entries(buttons)) pads[pad].set(button, down);
      }
      game.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
    }
  };
  const tap = (button, pad = 'p1') => {
    pads[pad].set(button, true);
    step(1);
    pads[pad].set(button, false);
    step(1);
  };
  return { pads, step, tap };
}

const legal = (game, label) => {
  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), `knuckles [${label}]`);
};

// Menu -> 1 PLAYER -> pick the given kid -> the stage-one card -> play.
function start(game, { hero = 'timmy', players = 1 } = {}) {
  const drive = player(game);
  if (players === 2) drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'pick');
  const want = knuckles.ROSTER.indexOf(hero);
  for (let i = 0; i < want; i++) drive.tap('right');
  drive.tap('a');
  if (players === 2) drive.tap('a', 'p2');
  drive.step(20);
  assert.strictEqual(game.state().screen, 'brief');
  drive.step(20);
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'play');
  return drive;
}

// --- the data --------------------------------------------------------------

test('knuckles: five stages, five bosses, and the school in the order asked for', () => {
  assert.strictEqual(knuckles.LEVELS.length, 5);
  assert.deepStrictEqual(knuckles.LEVELS.map((l) => l.id), ['hall', 'gym', 'field', 'courts', 'auditorium']);
  const bosses = knuckles.LEVELS.map((l) => l.boss);
  assert.strictEqual(new Set(bosses).size, 5, 'every stage has its own boss');
  for (const id of bosses) assert.ok(knuckles.BOSSES[id], `no such boss: ${id}`);
  // Teachers, the principal, and bullies.
  assert.ok(knuckles.BOSSES.grunt.title.includes('P.E.'));
  assert.ok(knuckles.BOSSES.stern.title.includes('PRINCIPAL'));
  assert.ok(knuckles.BOSSES.biff.title.includes('BULLY'));
});

test('knuckles: every wave names a real kind, and each stage brings a new one', () => {
  const seen = new Set();
  const introduced = [];
  for (const level of knuckles.LEVELS) {
    assert.ok(level.waves.length >= 4, `${level.id} has only ${level.waves.length} waves`);
    let lastAt = -1;
    for (const wave of level.waves) {
      assert.ok(wave.at > lastAt || (wave.at === 0 && lastAt === -1), `${level.id}: waves out of order at ${wave.at}`);
      assert.ok(wave.at <= level.length - 640, `${level.id}: wave at ${wave.at} is past the end`);
      lastAt = wave.at;
      for (const kind of wave.foes) {
        assert.ok(knuckles.KINDS[kind], `${level.id}: unknown kind ${kind}`);
        if (!seen.has(kind)) { seen.add(kind); introduced.push([level.id, kind]); }
      }
    }
    for (const item of level.items) {
      assert.ok(item.kind === 'lunch' || knuckles.PICKUPS.includes(item.kind), `${level.id}: unknown item ${item.kind}`);
      assert.ok(item.at < level.length, `${level.id}: item past the end`);
    }
  }
  assert.deepStrictEqual([...seen], knuckles.KIND_ORDER, 'every kind is used, in the order they are introduced');
  // One new kind per stage for the first four; the fifth is everyone at once.
  assert.deepStrictEqual(introduced.map((i) => i[0]), ['hall', 'hall', 'gym', 'field', 'courts']);
  // And the waves get bigger.
  const biggest = knuckles.LEVELS.map((l) => Math.max(...l.waves.map((w) => w.foes.length)));
  for (let i = 1; i < biggest.length; i++) assert.ok(biggest[i] >= biggest[i - 1], `stage ${i + 1} is easier than stage ${i}`);
});

test('knuckles: every line on a card fits across it', () => {
  const lines = [
    ...knuckles.LEVELS.flatMap((l) => l.brief.map((line) => [l.id, line])),
    ...knuckles.ENDING.map((line) => ['ending', line]),
    ...knuckles.HOW_TO.map((line) => ['howto', line]),
    ...Object.entries(knuckles.BOSSES).map(([id, b]) => [id, b.taunt]),
  ];
  for (const [where, line] of lines) {
    assert.ok(line.length <= knuckles.WRAP, `${where}: "${line}" is ${line.length} columns, card holds ${knuckles.WRAP}`);
  }
});

test('knuckles: the weapons wear out, and fists do not', () => {
  assert.strictEqual(knuckles.WEAPONS.fists.hits, null);
  for (const id of knuckles.PICKUPS) {
    assert.ok(knuckles.WEAPONS[id].hits > 0, `${id} never breaks`);
  }
});

// --- the run ---------------------------------------------------------------

test('knuckles: the pick screen takes a kid from each pad, and the kids differ', () => {
  const walk = (hero) => {
    const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 3 });
    const drive = start(game, { hero });
    const from = game.state().at[0][0];
    drive.step(30, { p1: { right: true } });
    return game.state().at[0][0] - from;
  };
  const rosa = walk('rosa');
  const timmy = walk('timmy');
  const moose = walk('moose');
  assert.ok(rosa > timmy && timmy > moose, `speeds: rosa ${rosa}, timmy ${timmy}, moose ${moose}`);

  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 3 });
  const drive = player(game);
  drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().players, 2);
  drive.tap('right', 'p2');
  drive.tap('a', 'p2');
  assert.deepStrictEqual(game.state().picks[1], { hero: 'moose', locked: true });
  legal(game, 'pick, one locked');
  drive.step(30);
  assert.strictEqual(game.state().screen, 'pick', 'the game started before player one had chosen');
  drive.tap('a');
  drive.step(20);
  assert.strictEqual(game.state().screen, 'brief');
  assert.deepStrictEqual(game.state().picks.map((p) => p.hero), ['timmy', 'moose']);
  legal(game, 'brief');
});

test('knuckles: three lives, then it is over', () => {
  const store = fakeTable();
  const game = knuckles.create(720, 480, { scores: store, seed: 5 });
  const drive = start(game);
  assert.deepStrictEqual(game.state().lives, [knuckles.LIVES]);

  // Stand there. The first wave walks in at the bell.
  let seenLives = new Set();
  for (let i = 0; i < 30 * 120 && game.state().screen === 'play'; i++) {
    drive.step(1);
    seenLives.add(game.state().lives[0]);
  }
  const s = game.state();
  assert.strictEqual(s.screen, 'over', 'a kid who never moves should be beaten');
  assert.strictEqual(s.won, false);
  assert.deepStrictEqual(s.lives, [0]);
  assert.deepStrictEqual([...seenLives].sort(), [0, 1, 2, 3], 'every life was lost one at a time');
  legal(game, 'game over');
  assert.strictEqual(game.music(), null, 'no theme over a loss');
});

test('knuckles: a pencil is eight hits and then it is fists again', () => {
  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 5 });
  const drive = start(game);
  const pencil = game.state().items.find((i) => i.kind === 'pencil');
  assert.ok(pencil, 'stage one should open with a pencil on the floor');

  // Walk over it.
  for (let i = 0; i < 300 && game.state().weapon[0].kind === 'fists'; i++) {
    const [px, py] = game.state().at[0];
    drive.step(1, { p1: { right: pencil.x - px > 4, left: px - pencil.x > 4, down: pencil.y - py > 3, up: py - pencil.y > 3 } });
  }
  drive.step(1, { p1: { right: false, left: false, up: false, down: false } });
  assert.deepStrictEqual(game.state().weapon[0], { kind: 'pencil', hits: knuckles.WEAPONS.pencil.hits });
  assert.ok(game.drain().includes('pickup'));

  // Stand and poke whoever comes. Every landed hit costs one; misses are free.
  let counts = [];
  let frames = 0;
  while (game.state().weapon[0].kind === 'pencil' && frames++ < 30 * 90) {
    const s = game.state();
    const [px, py] = s.at[0];
    const near = s.foes.find((f) => Math.abs(f.x - px) < 50 && Math.abs(f.y - py) < knuckles.LANE && f.mode !== 'down' && f.mode !== 'dying');
    const any = s.foes.some((f) => f.mode !== 'dying');
    if (near) drive.step(1, { p1: { left: near.x < px && frames % 8 === 0, right: near.x > px && frames % 8 === 0, a: frames % 4 < 2 } });
    else drive.step(1, { p1: { a: false, left: false, right: !any } });
    const hits = game.state().weapon[0].hits;
    if (counts[counts.length - 1] !== hits) counts.push(hits);
    if (game.state().screen !== 'play') break;
  }
  assert.deepStrictEqual(game.state().weapon[0], { kind: 'fists', hits: null }, `pencil still going after ${frames} frames: ${counts}`);
  assert.deepStrictEqual(counts.filter((c) => c !== null), [8, 7, 6, 5, 4, 3, 2, 1].slice(0, counts.length - 1), 'the count should fall one landed hit at a time');
  assert.ok(game.drain().includes('snap'), 'a breaking pencil should snap');
});

test('knuckles: a lunch box heals', () => {
  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 5 });
  const drive = start(game);
  const lunch = game.state().items.find((i) => i.kind === 'lunch');
  assert.ok(lunch);

  // Get hit first.
  for (let i = 0; i < 30 * 20 && game.state().hp[0] >= game.state().maxHp[0]; i++) drive.step(1);
  const hurt = game.state().hp[0];
  assert.ok(hurt < game.state().maxHp[0], 'nobody landed a punch in twenty seconds');

  let healed = false;
  for (let i = 0; i < 30 * 12 && !healed && game.state().screen === 'play'; i++) {
    const [px, py] = game.state().at[0];
    drive.step(1, { p1: { right: lunch.x - px > 4, left: px - lunch.x > 4, down: lunch.y - py > 3, up: py - lunch.y > 3 } });
    if (game.drain().includes('heal')) healed = true;
  }
  assert.ok(healed, 'walking over the lunch box did nothing');
  assert.ok(!game.state().items.some((i) => i.x === lunch.x && i.kind === 'lunch'), 'the lunch box is still there');
});

test('knuckles: the pause menu can resume, restart and quit', () => {
  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 4 });
  const drive = start(game);
  drive.step(60);
  assert.strictEqual(game.music(), 'homeroom');

  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  legal(game, 'paused');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'play');

  drive.step(60, { p1: { right: true } });
  drive.step(1, { p1: { right: false } });
  const before = game.state().at[0][0];
  drive.tap('start');
  drive.tap('down');
  drive.tap('a'); // RESTART
  assert.strictEqual(game.state().screen, 'brief', 'a restart goes back to the first bell');
  assert.strictEqual(game.state().stage, 1);
  drive.step(20);
  drive.tap('a');
  assert.ok(game.state().at[0][0] < before, 'restart did not put the kid back');

  drive.tap('start');
  drive.tap('down'); drive.tap('down');
  drive.tap('a'); // QUIT TO MENU
  assert.strictEqual(game.state().screen, 'menu');
  assert.strictEqual(game.music(), 'recess');
});

// A mediocre player, per kid. It goes for the nearest standing kid, kicks when
// crowded, steps off a lane it is being charged down, eats when hurt, and
// otherwise walks right. Deliberately no better than that: if this can finish,
// the game finishes.
function brain(field, who = 0) {
  const midLane = (field.top + field.bottom) / 2;
  let frames = 0;
  let stuck = 0;
  let last = [0, 0];
  let mark = null;
  let markFor = 0;

  return (s) => {
    frames++;
    const want = new Set();
    if (s.out[who] || s.down[who]) return want;
    const [px, py] = s.at[who];
    if (Math.abs(px - last[0]) + Math.abs(py - last[1]) < 2) stuck++; else stuck = 0;
    last = [px, py];

    const live = s.foes.filter((f) => f.mode !== 'dying');
    const standing = live.filter((f) => f.mode !== 'down' && f.mode !== 'rise');

    // Something coming down my lane: a projectile, or a kid winding a charge.
    const shot = s.shots.find((sh) => sh.from === 'enemy' && Math.abs(sh.y - py) < 22
      && Math.sign(sh.vx) === Math.sign(px - sh.x) && Math.abs(sh.x - px) < 170);
    const charger = live.find((f) => (f.charging || f.mode === 'charge') && Math.abs(f.y - py) < 24
      && Math.sign(f.facing) === Math.sign(px - f.x) && Math.abs(f.x - px) < 360);
    const onScreen = s.items.filter((i) => i.x > s.cam + 20 && i.x < s.cam + 620);
    const lunch = onScreen.filter((i) => i.kind === 'lunch')
      .map((i) => ({ i, d: Math.hypot(i.x - px, i.y - py) })).sort((a, b) => a.d - b.d)[0];
    const gear = onScreen.filter((i) => i.kind !== 'lunch')
      .map((i) => ({ i, d: Math.hypot(i.x - px, i.y - py) })).sort((a, b) => a.d - b.d)[0];
    const hurt = s.hp[who] <= s.maxHp[who] - knuckles.LUNCH_HEAL;

    const toward = (gx, gy) => {
      if (gx - px > 4) want.add('right'); else if (px - gx > 4) want.add('left');
      if (gy - py > 3) want.add('down'); else if (py - gy > 3) want.add('up');
    };

    if (shot || charger) {
      want.add(py > midLane ? 'up' : 'down');
      if (py <= field.top + 4) { want.delete('up'); want.add('down'); }
      if (py >= field.bottom - 4) { want.delete('down'); want.add('up'); }
    } else if (lunch && hurt && lunch.d < 320 && !standing.some((f) => Math.abs(f.x - lunch.i.x) < 40 && Math.abs(f.y - lunch.i.y) < 30)) {
      toward(lunch.i.x, lunch.i.y);
    } else if (standing.length) {
      if (markFor > 0) markFor--;
      const ranked = standing.map((f) => ({ f, d: Math.hypot(f.x - px, f.y - py) })).sort((a, b) => a.d - b.d);
      const still = ranked.find((r) => mark && r.f.kind === mark.kind && Math.abs(r.f.x - mark.x) < 60 && Math.abs(r.f.y - mark.y) < 60);
      if (!still || markFor === 0) { mark = ranked[0].f; markFor = 45; } else mark = still.f;
      const t = mark;
      const side = t.x >= px ? 1 : -1;
      const reach = 26;
      const gx = t.x - side * reach;
      const dx = Math.abs(t.x - px);
      const dy = Math.abs(t.y - py);
      // Come in on a different lane and step onto theirs at the last moment.
      if (dx > reach + 30) toward(gx, t.y + (t.y > midLane ? -20 : 20));
      else toward(gx, t.y);
      if (dx < reach + 14 && dy < knuckles.LANE - 2) {
        if (side !== (s.facing[who] || 1)) want.add(side > 0 ? 'right' : 'left');
        const crowd = standing.filter((f) => Math.abs(f.x - px) < 70 && Math.abs(f.y - py) < 30).length;
        const heavy = t.boss || t.kind === 'jock';
        want.add(crowd >= 2 || (heavy && frames % 3 === 0) ? 'b' : 'a');
        if (frames % 4 >= 2) { want.delete('a'); want.delete('b'); }
      }
      if (stuck > 60) { mark = null; markFor = 0; stuck = 0; want.add(py > midLane ? 'up' : 'down'); }
    } else if (gear && s.weapon[who].kind === 'fists' && gear.d < 260) {
      toward(gear.i.x, gear.i.y);
    } else if (lunch && s.hp[who] < s.maxHp[who] && lunch.d < 260) {
      toward(lunch.i.x, lunch.i.y);
    } else {
      want.add('right');
      if (Math.abs(py - midLane) > 30) want.add(py > midLane ? 'up' : 'down');
    }
    return want;
  };
}

const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b'];

// Drives the whole game with one pad, from the title to the last bell.
function playthrough(seed, { cap = 45000, check = null, store = fakeTable(), until = null } = {}) {
  const game = knuckles.create(720, 480, { scores: store, seed });
  const pad = new input.Pad('p1');
  const think = brain(game.field, 0);

  let frames = 0;
  const stages = new Set();
  const kinds = new Set();
  let deaths = 0;
  let lastLives = knuckles.LIVES;
  const weaponsUsed = new Set();
  let expired = 0;
  let lastWeapon = 'fists';

  while (frames++ < cap) {
    const s = game.state();
    if (check && frames % 150 === 0) check(game, `${s.level} f${frames}`);
    if (s.screen === 'over' || s.screen === 'scores') break;
    if (until && until(s)) break;

    let want = new Set();
    if (s.screen !== 'play') {
      // Menu, pick, cards: press A now and then.
      if (frames % 8 === 0) want.add('a');
    } else {
      stages.add(s.stage);
      for (const f of s.foes) kinds.add(f.kind);
      if (s.lives[0] < lastLives) deaths++;
      lastLives = s.lives[0];
      if (s.weapon[0].kind !== 'fists') weaponsUsed.add(s.weapon[0].kind);
      if (lastWeapon !== 'fists' && s.weapon[0].kind === 'fists') expired++;
      lastWeapon = s.weapon[0].kind;
      want = think(s);
    }

    for (const b of BUTTONS) pad.set(b, want.has(b));
    game.update(STEP, { p1: pad.read() });
  }

  return { game, frames, state: game.state(), score: game.state().score, stages, kinds, deaths, weaponsUsed, expired };
}

test('knuckles: the second player fights too, and the game goes on without one of them', () => {
  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 9 });
  const drive = start(game, { players: 2, hero: 'moose' });
  assert.strictEqual(game.state().at.length, 2);
  legal(game, 'two players');

  const [, p2Before] = game.state().at;
  drive.step(30, { p2: { right: true } });
  drive.step(1, { p2: { right: false } });
  assert.ok(game.state().at[1][0] > p2Before[0] + 20, 'pad two does not move kid two');

  // Kid one stands still and gets beaten; kid two fights on, through the
  // stage cards if it comes to that, and stays in the game.
  const think = brain(game.field, 1);
  let frames = 0;
  while (!game.state().out[0] && frames++ < 30 * 400) {
    const s = game.state();
    if (s.screen === 'over') break;
    const want = s.screen === 'play' ? think(s) : new Set(frames % 8 === 0 ? ['a'] : []);
    for (const b of BUTTONS) drive.pads.p2.set(b, want.has(b));
    drive.step(1);
  }
  const s = game.state();
  assert.notStrictEqual(s.screen, 'over', `the game ended while kid two was still standing (lives ${s.lives}, hp ${s.hp})`);
  assert.deepStrictEqual(s.out, [true, false], `kid one should be out and kid two not (lives ${s.lives})`);
  assert.ok(s.score > 0, 'kid two never beat anyone');
  if (s.screen !== 'play') { drive.step(30); drive.tap('a', 'p2'); }
  assert.strictEqual(game.state().screen, 'play');
  legal(game, 'one kid out');
});

test('knuckles: the day can be survived with a pad', () => {
  const seen = [];
  const runs = [3, 4, 6, 8].map((seed, i) => ({
    seed,
    ...playthrough(seed, { check: i === 0 ? (game, label) => { legal(game, label); seen.push(label); } : null }),
  }));
  const won = runs.filter((r) => r.state.won);
  assert.ok(won.length >= 3,
    `only ${won.length} of 4 runs survived: ${runs.map((r) => `${r.seed}=stage${r.state.stage}/${r.state.score}/${r.state.lives}`).join(' ')}`);
  assert.ok(seen.length > 20, 'the first run was not checked along the way');

  for (const r of won) {
    assert.strictEqual(r.state.screen, 'over');
    assert.deepStrictEqual([...r.stages], [1, 2, 3, 4, 5]);
    assert.deepStrictEqual([...r.kinds].filter((k) => knuckles.KINDS[k]).sort(), knuckles.KIND_ORDER.slice().sort(), `seed ${r.seed}: not every kind was met`);
    assert.ok(r.state.score > 10000, `seed ${r.seed}: finished on ${r.state.score}`);
    assert.ok(r.state.placing > 0, 'a finish should make an empty board');
    assert.ok(r.weaponsUsed.size >= 2, `seed ${r.seed}: only held ${[...r.weaponsUsed]}`);
    assert.ok(r.expired >= 1, `seed ${r.seed}: nothing ever wore out`);
  }
  // It should not be a walk in the park: somebody lost a life somewhere.
  assert.ok(runs.some((r) => r.deaths > 0), 'nobody ever lost a life, which is not a difficulty curve');
});

test('knuckles: a charge goes where it was aimed', () => {
  // Let the bot walk to Biff, then take the pad: stand off down his lane and
  // give him the room to charge.
  const { game } = playthrough(3, { until: (s) => s.foes.some((f) => f.boss && f.x < s.cam + 600) });
  assert.strictEqual(game.state().screen, 'play');
  const drive = player(game);
  const pad = drive.pads.p1;
  let aimed = null;
  let frames = 0;
  while (frames++ < 30 * 60 && aimed === null && game.state().screen === 'play') {
    const s = game.state();
    const boss = s.foes.find((f) => f.boss);
    assert.ok(boss, 'Biff left');
    const [px, py] = s.at[0];
    for (const b of ['up', 'down', 'left', 'right', 'a', 'b']) pad.set(b, false);
    if (boss.mode === 'charge') {
      aimed = boss.facing;
      // Cross behind him mid-charge; his facing must not follow.
      for (let i = 0; i < 6; i++) {
        pad.set(aimed > 0 ? 'right' : 'left', true);
        drive.step(1);
        const now = game.state().foes.find((f) => f.boss);
        if (!now || now.mode !== 'charge') break;
        assert.strictEqual(now.facing, aimed, 'the charge re-aimed mid-run');
      }
      break;
    }
    const gx = boss.x - 200;
    if (gx - px > 4) pad.set('right', true); else if (px - gx > 4) pad.set('left', true);
    if (boss.y - py > 3) pad.set('down', true); else if (py - boss.y > 3) pad.set('up', true);
    drive.step(1);
  }
  assert.ok(aimed !== null, 'never saw Biff charge');
});

test('knuckles: a finish posts a score, and a kid who never fights earns nothing', () => {
  const idle = knuckles.create(720, 480, { scores: fakeTable(), seed: 5 });
  const drive = start(idle);
  for (let i = 0; i < 30 * 120 && idle.state().screen === 'play'; i++) drive.step(1);
  assert.strictEqual(idle.state().screen, 'over');
  assert.strictEqual(idle.state().score, 0);
  assert.strictEqual(idle.state().placing, 0, 'nothing is not a high score');
  drive.step(30);
  drive.tap('a');
  assert.strictEqual(idle.state().screen, 'menu');

  const store = fakeTable();
  const { game, score } = playthrough(3, { store });
  assert.strictEqual(game.state().screen, 'over');
  assert.ok(score > 0);
  assert.ok(game.state().placing > 0);
  const post = player(game);
  post.step(30);
  legal(game, 'entering initials');
  post.tap('down');
  post.tap('a'); post.tap('a'); post.tap('a');
  assert.strictEqual(game.state().screen, 'scores');
  assert.deepStrictEqual(store.recorded, [{ name: 'BAA', score }]);
  legal(game, 'scores');
});

test('knuckles: the music follows the day', () => {
  const game = knuckles.create(720, 480, { scores: fakeTable(), seed: 2 });
  assert.strictEqual(game.music(), 'recess');
  const drive = start(game);
  assert.strictEqual(game.music(), 'homeroom');
  drive.tap('start');
  assert.strictEqual(game.music(), 'homeroom', 'the pause keeps the stage theme');
  const tracks = new Set(knuckles.LEVELS.map((l) => l.track));
  assert.ok(tracks.size >= 4, 'the stages should not all sound the same');
});

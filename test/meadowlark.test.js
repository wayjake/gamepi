'use strict';
// Meadowlark, played by a farmhand that can find its way around the map.
//
// The generic checks in game.test.js already hold every screen to the palette,
// overscan and flicker rules and prove a run replays from its inputs. These
// are about the farm: that the loop of till, sow, water, sleep, pick and ship
// actually pays, that the water gets where the channels say it does, that the
// seasons turn and the save comes back, and that a whole spring can be worked
// by a player who is only following the hint line.

const test = require('node:test');
const assert = require('node:assert');

const farm = require('../src/games/meadowlark');
const input = require('../src/input');
const sceneRenderer = require('../src/gfx/scene');
const invariants = require('./invariants');

const STEP = 1 / 30;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function fakeTable() {
  return { recorded: [], table: () => [], placing: (game, score) => (score > 0 ? 1 : 0), record(game, name, score) { this.recorded.push({ name, score }); return []; } };
}

// Drives the game through real Pads and paths around the farm using what the
// game itself says is walkable.
function farmhand(game) {
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [b, d] of Object.entries(held)) pads.p1.set(b, d);
      game.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
    }
  };
  const tap = (b) => { pads.p1.set(b, true); step(1); pads.p1.set(b, false); step(1); };
  const settle = () => { let g = 0; while ((game.state().moving || game.state().acting || game.state().card) && g++ < 200) step(1); };
  const face = (dir) => { if (game.state().dir !== dir) { pads.p1.set(dir, true); step(1); pads.p1.set(dir, false); step(1); } };
  // Six frames: one to turn, three for the turn delay, two into the step. Any
  // longer and the held stick chains a second step.
  const move = (dir) => {
    const from = game.state().at.join(',');
    step(6, { [dir]: true });
    step(1, { [dir]: false });
    settle();
    return game.state().at.join(',') !== from;
  };
  const route = (tc, tr) => {
    const [sc, sr] = game.state().at;
    const key = (c, r) => `${c},${r}`;
    const prev = new Map([[key(sc, sr), null]]);
    const queue = [[sc, sr]];
    while (queue.length) {
      const [c, r] = queue.shift();
      if (c === tc && r === tr) break;
      for (const [dir, [dc, dr]] of Object.entries(DIRS)) {
        const nc = c + dc;
        const nr = r + dr;
        if (prev.has(key(nc, nr)) || !game.walkable(nc, nr)) continue;
        prev.set(key(nc, nr), { from: key(c, r), dir });
        queue.push([nc, nr]);
      }
    }
    if (!prev.has(key(tc, tr))) return null;
    const dirs = [];
    for (let k = key(tc, tr); prev.get(k); k = prev.get(k).from) dirs.unshift(prev.get(k).dir);
    return dirs;
  };
  const walkTo = (c, r) => {
    const dirs = route(c, r);
    if (!dirs) return false;
    for (const dir of dirs) if (!move(dir)) return false;
    return true;
  };
  // Stand beside (c, r), facing it.
  const approach = (c, r) => {
    const at = game.state().at;
    for (const [dir, [dc, dr]] of Object.entries(DIRS)) {
      if (at[0] === c - dc && at[1] === r - dr) { face(dir); return true; }
    }
    const sides = Object.entries(DIRS)
      .map(([dir, [dc, dr]]) => ({ dir, c: c - dc, r: r - dr }))
      .filter((s) => game.walkable(s.c, s.r))
      .sort((a, b) => (Math.abs(a.c - at[0]) + Math.abs(a.r - at[1])) - (Math.abs(b.c - at[0]) + Math.abs(b.r - at[1])));
    for (const s of sides) if (walkTo(s.c, s.r)) { face(s.dir); return true; }
    return false;
  };
  const act = () => { tap('a'); settle(); };
  const hold = (hand) => { let g = 0; while (game.state().hand !== hand && g++ < 12) tap('b'); return game.state().hand === hand; };
  const holdSeeds = (crop) => {
    tap('select');
    assert.strictEqual(game.state().screen, 'bag');
    // The bag lists seeds first, alphabetically.
    const seeds = Object.keys(game.state().bag).filter((id) => id.startsWith('seed:')).sort();
    const index = seeds.indexOf(`seed:${crop}`);
    assert.ok(index >= 0, `no ${crop} seeds in the bag`);
    for (let i = 0; i < index; i++) tap('down');
    tap('a');
    assert.strictEqual(game.state().hand, 'seed');
    assert.strictEqual(game.state().seed, crop);
  };
  const toBed = () => {
    assert.ok(walkTo(farm.DOOR.c, farm.DOOR.r), 'could not reach the door');
    face('up');
    assert.strictEqual(game.state().intent, 'sleep', `at the door the hint is "${game.state().hint}"`);
    act();
    assert.strictEqual(game.state().screen, 'prompt');
  };
  const sleepThrough = () => {
    let guard = 0;
    while (game.state().night !== 'card' && guard++ < 300) step(1);
    assert.strictEqual(game.state().night, 'card', 'the night never reached the morning card');
    step(30);
    tap('a');
    guard = 0;
    while (game.state().screen !== 'play' && guard++ < 400) step(1);
    assert.strictEqual(game.state().screen, 'play', 'the morning never came');
    settle();
  };
  const sleep = () => { toBed(); tap('a'); sleepThrough(); };
  return { pads, step, tap, settle, face, move, walkTo, approach, act, hold, holdSeeds, toBed, sleep, sleepThrough };
}

const start = (options = {}) => {
  const store = farm.memoryStore();
  const game = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store, ...options });
  const hand = farmhand(game);
  hand.tap('a'); // NEW FARM
  hand.settle();
  assert.strictEqual(game.state().screen, 'play');
  return { game, hand, store };
};

const legal = (game, label) => {
  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), `meadowlark [${label}]`);
};

// --- the map -----------------------------------------------------------------

test('meadowlark: the map is fourteen by fourteen and every glyph is known', () => {
  assert.strictEqual(farm.MAP.length, farm.ROWS);
  for (const line of farm.MAP) {
    assert.strictEqual(line.length, farm.COLS, `"${line}" is not ${farm.COLS} wide`);
    for (const ch of line) assert.ok(farm.GLYPH[ch], `unknown glyph "${ch}"`);
  }
});

test('meadowlark: the door, the bin, the stall and the water can all be reached from the start', () => {
  const { game, hand } = start();
  assert.ok(hand.walkTo(farm.DOOR.c, farm.DOOR.r), 'the door');
  assert.ok(hand.approach(3, 1), 'the shipping bin');
  assert.strictEqual(game.state().intent, 'ship');
  assert.ok(hand.approach(8, 13), 'the stall');
  assert.strictEqual(game.state().intent, 'shop');
  hand.hold('can');
  assert.ok(hand.approach(0, 5), 'the creek');
  assert.ok(['fill', 'none'].includes(game.state().intent));
  assert.ok(hand.approach(8, 2), 'the pond');
  assert.strictEqual(game.state().target.ground, 'water');
});

test('meadowlark: the seed scatters different rocks on different farms, never on the plot or the paths', () => {
  const a = farm.create(720, 480, { scores: fakeTable(), seed: 1, save: farm.memoryStore() });
  const b = farm.create(720, 480, { scores: fakeTable(), seed: 2, save: farm.memoryStore() });
  for (const g of [a, b]) { const h = farmhand(g); h.tap('a'); }
  let differ = 0;
  let scattered = 0;
  for (let r = 0; r < farm.ROWS; r++) {
    for (let c = 0; c < farm.COLS; c++) {
      const ta = a.tile(c, r);
      const tb = b.tile(c, r);
      if (ta.o !== tb.o) differ++;
      if (['rock', 'stump', 'weed'].includes(ta.o)) {
        scattered++;
        assert.strictEqual(ta.g, 'grass', `a ${ta.o} on ${ta.g} at ${c},${r}`);
      }
    }
  }
  assert.ok(differ > 10, `only ${differ} tiles differ between two seeds`);
  assert.ok(scattered > 30, `only ${scattered} things scattered`);
  for (const [c, r] of [[5, 5], [6, 6], [7, 7]]) assert.strictEqual(a.tile(c, r).g, 'soil', `the starting plot at ${c},${r}`);
});

// --- the loop ----------------------------------------------------------------

test('meadowlark: till, sow, water, sleep four nights, pick, ship, and get paid at dawn', () => {
  const { game, hand } = start();
  const gold = game.state().gold;

  // A grass tile near the house, to prove tilling. Then the plot.
  hand.hold('hoe');
  assert.ok(hand.approach(3, 4));
  if (game.state().target.object === 'weed') hand.act();
  assert.strictEqual(game.state().intent, 'hoe', game.state().hint);
  const energy = game.state().energy;
  hand.act();
  assert.strictEqual(game.tile(3, 4).g, 'soil');
  assert.ok(game.state().energy < energy, 'tilling is free');
  assert.ok(game.drain().includes('till'));

  hand.holdSeeds('turnip');
  const plots = [[3, 4], [5, 5], [6, 5], [7, 5]];
  for (const [c, r] of plots) {
    assert.ok(hand.approach(c, r), `reach ${c},${r}`);
    assert.strictEqual(game.state().intent, 'seed', game.state().hint);
    hand.act();
    assert.strictEqual(game.tile(c, r).crop.id, 'turnip');
  }
  assert.strictEqual(game.state().bag['seed:turnip'], 10 - plots.length);

  hand.hold('can');
  for (const [c, r] of plots) {
    hand.approach(c, r);
    assert.strictEqual(game.state().intent, 'can', game.state().hint);
    hand.act();
    assert.ok(game.tile(c, r).wet, `${c},${r} is still dry`);
  }
  assert.strictEqual(game.state().water, farm.CAN[1].cap - plots.length);
  legal(game, 'watered plot');

  // Water it each morning and it comes up in four.
  for (let night = 1; night <= farm.CROPS.turnip.days; night++) {
    hand.sleep();
    assert.strictEqual(game.state().day, 1 + night);
    const crop = game.tile(5, 5).crop;
    assert.strictEqual(crop.age, night, `after ${night} nights`);
    if (night < farm.CROPS.turnip.days) {
      for (const [c, r] of plots) {
        if (game.tile(c, r).wet) continue; // it rained
        if (game.state().water === 0) { hand.approach(0, 6); hand.act(); assert.strictEqual(game.state().water, farm.CAN[1].cap); }
        hand.approach(c, r);
        hand.act();
        assert.ok(game.tile(c, r).wet, `${c},${r} dry on day ${night + 1}: ${game.state().hint}`);
      }
    }
  }
  assert.ok(game.tile(5, 5).crop, 'the crop vanished');

  for (const [c, r] of plots) {
    hand.approach(c, r);
    assert.strictEqual(game.state().intent, 'harvest', game.state().hint);
    hand.tap('a');
    hand.step(9);
    legal(game, 'harvest pose');
    hand.settle();
    assert.strictEqual(game.tile(c, r).crop, null, 'a turnip regrew');
  }
  assert.strictEqual(game.state().bag.turnip, plots.length);

  // Ship all but one -- the one is supper.
  assert.ok(hand.approach(3, 1));
  hand.act();
  assert.strictEqual(game.state().screen, 'ship');
  for (let i = 1; i < plots.length - 1; i++) hand.tap('right');
  hand.tap('a');
  assert.strictEqual(game.state().shipped.turnip, plots.length - 1);
  assert.strictEqual(game.state().bag.turnip, 1);
  legal(game, 'shipping');
  hand.tap('b');

  hand.sleep();
  assert.strictEqual(game.state().gold, gold + (plots.length - 1) * farm.CROPS.turnip.sells, 'the bin did not pay out');
  assert.strictEqual(game.state().lifetime.shipped, (plots.length - 1) * farm.CROPS.turnip.sells);
});

test('meadowlark: a crop that goes unwatered does not grow', () => {
  const { game, hand } = start();
  hand.holdSeeds('turnip');
  hand.approach(5, 5);
  hand.act();
  hand.sleep();
  if (game.state().weather !== 'rain') assert.strictEqual(game.tile(5, 5).crop.age, 0);
});

test('meadowlark: eating gives energy back, and the can refills at the water', () => {
  const { game, hand } = start();
  hand.hold('hoe');
  // Till until tired enough to notice.
  const before = game.state().energy;
  let tilled = 0;
  for (let r = 4; r <= 8 && tilled < 6; r++) {
    for (let c = 3; c <= 9 && tilled < 6; c++) {
      if (game.tile(c, r).g !== 'grass' || game.tile(c, r).o) continue;
      hand.approach(c, r);
      if (game.state().intent !== 'hoe') continue;
      hand.act();
      tilled++;
    }
  }
  assert.ok(tilled >= 4, `only tilled ${tilled}`);
  assert.ok(game.state().energy <= before - tilled * farm.COST.hoe + 0.01);

  // Nothing to eat yet: grow one turnip and eat it.
  hand.holdSeeds('turnip');
  hand.approach(5, 5); hand.act();
  hand.hold('can');
  for (let i = 0; i < 4; i++) {
    hand.approach(5, 5);
    if (game.state().intent === 'can') hand.act();
    hand.sleep();
  }
  hand.approach(5, 5);
  assert.strictEqual(game.state().intent, 'harvest', game.state().hint);
  hand.act();
  // Spend some energy so there is room to eat.
  hand.hold('hoe');
  for (let i = 0; i < 3; i++) { hand.approach(4 + i, 8); if (game.state().intent === 'hoe') hand.act(); }
  const tired = game.state().energy;
  hand.tap('select');
  const rows = Object.keys(game.state().bag);
  assert.ok(rows.includes('turnip'));
  const seeds = rows.filter((id) => id.startsWith('seed:')).length;
  for (let i = 0; i < seeds; i++) hand.tap('down');
  hand.tap('a');
  assert.ok(game.drain().includes('munch'), 'eating makes no noise');
  assert.ok(game.state().energy > tired, 'eating gave nothing back');
  assert.ok(!game.state().bag.turnip, 'the turnip is still in the bag');
  hand.tap('b');

  // Empty the can on the plot, then fill it.
  hand.hold('can');
  let guard = 0;
  while (game.state().water > 0 && guard++ < 20) {
    const dry = [[5, 5], [6, 5], [7, 5], [5, 6], [6, 6], [7, 6], [5, 7], [6, 7], [7, 7]].find(([c, r]) => !game.tile(c, r).wet);
    if (!dry) break;
    hand.approach(...dry);
    hand.act();
  }
  hand.approach(0, 6);
  assert.strictEqual(game.state().intent, game.state().water < farm.CAN[1].cap ? 'fill' : 'none');
  hand.act();
  assert.strictEqual(game.state().water, farm.CAN[1].cap);
  assert.ok(game.drain().includes('dip'));
});

test('meadowlark: sleeping hungry wakes you tired, and midnight puts you to bed', () => {
  const { game, hand } = start();
  // Run the clock out without eating: food drains all day.
  let guard = 0;
  while (game.state().screen === 'play' && guard++ < 20000) hand.step(1);
  assert.strictEqual(game.state().screen, 'night', 'midnight did not end the day');
  hand.sleepThrough();
  assert.strictEqual(game.state().day, 2);
  assert.strictEqual(game.state().energy, farm.COLLAPSE_WAKE, 'collapsing should cost the morning');

  // Now go to bed properly, still hungry.
  hand.sleep();
  assert.ok(game.state().food < farm.HUNGRY);
  assert.strictEqual(game.state().energy, farm.TIRED_WAKE);
});

// --- water -------------------------------------------------------------------

test('meadowlark: the spade digs a channel for a stone, and fills one back in for the stone back', () => {
  // A new farm cannot afford the spade on day one, so author a save that can:
  // the persistence seam is how a test puts a farm in any state it likes.
  const { game, hand, store } = start();
  assert.deepStrictEqual(game.irrigation(), [], 'a new farm has no channels');
  hand.sleep();
  const data = store.load();
  data.tools.spade = 1;
  data.bag = { stone: 2 };
  store.write(data);
  const g = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store });
  const h = farmhand(g);
  h.tap('down'); h.tap('a'); h.settle();
  assert.ok(h.hold('spade'), 'the spade is not in the hands');

  // (1,6) is grass beside the creek at (0,6).
  const t = g.tile(1, 6);
  assert.ok(t.g === 'grass');
  h.approach(1, 6);
  if (t.o === 'weed') { h.hold('hoe'); h.act(); h.hold('spade'); h.approach(1, 6); }
  assert.strictEqual(g.state().intent, 'spade', g.state().hint);
  h.act();
  assert.strictEqual(g.tile(1, 6).g, 'channel');
  assert.strictEqual(g.state().bag.stone, 1);
  assert.deepStrictEqual(g.irrigation(), [[1, 6]], 'a channel touching the creek should be live');
  legal(g, 'a live channel');

  h.approach(1, 6);
  assert.strictEqual(g.state().intent, 'unspade', g.state().hint);
  h.act();
  assert.strictEqual(g.tile(1, 6).g, 'grass');
  assert.strictEqual(g.state().bag.stone, 2);
  assert.deepStrictEqual(g.irrigation(), []);
});

test('meadowlark: a saved farm authored with channels waters the soil next to live ones only', () => {
  // Build a farm, sleep once to save it, then edit the save: a channel from
  // the creek at (0,6) running east to (3,6), soil at (4,6) and (2,7), a
  // stray channel at (8,8) with soil at (9,8), and a sprinkler at (3,5) fed by
  // the channel with soil at (4,4).
  const { game, hand, store } = start();
  hand.sleep();
  const data = store.load();
  assert.ok(data, 'sleeping did not save');
  const set = (c, r, patch) => Object.assign(data.tiles[r][c], patch);
  for (let c = 1; c <= 3; c++) set(c, 6, { g: 'channel', o: null });
  set(4, 6, { g: 'soil', o: null, wet: false });
  set(2, 7, { g: 'soil', o: null, wet: false });
  set(8, 8, { g: 'channel', o: null });
  set(9, 8, { g: 'soil', o: null, wet: false });
  set(3, 5, { g: 'grass', o: 'sprinkler' });
  set(4, 4, { g: 'soil', o: null, wet: false });
  set(2, 4, { g: 'soil', o: null, wet: false });
  data.weather = 'sun';
  store.write(data);

  const loaded = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store });
  const h = farmhand(loaded);
  h.tap('down'); h.tap('a'); // CONTINUE
  h.settle();
  assert.strictEqual(loaded.state().screen, 'play');
  const live = loaded.irrigation().map(([c, r]) => `${c},${r}`).sort();
  assert.deepStrictEqual(live, ['1,6', '2,6', '3,6']);
  legal(loaded, 'channels');

  // Sleep and see what got wet. Rain would wet everything, so skip rainy days.
  let guard = 0;
  do { h.sleep(); } while (loaded.state().weather === 'rain' && guard++ < 10);
  assert.notStrictEqual(loaded.state().weather, 'rain');
  assert.ok(loaded.tile(4, 6).wet, 'soil at the end of a live channel is dry');
  assert.ok(loaded.tile(2, 7).wet, 'soil beside a live channel is dry');
  assert.ok(!loaded.tile(9, 8).wet, 'soil beside a dry channel got wet');
  assert.ok(loaded.tile(4, 4).wet, 'the sprinkler did not reach its corner');
  assert.ok(loaded.tile(2, 4).wet, 'the sprinkler did not reach its other corner');
});

// --- seasons -----------------------------------------------------------------

test('meadowlark: the seasons turn every 28 days, spring crops die in summer, and the music follows', () => {
  const { game, hand } = start();
  assert.strictEqual(game.music(), farm.SEASONS[0].track);
  hand.holdSeeds('turnip');
  hand.approach(5, 5); hand.act();
  for (let i = 0; i < farm.DAYS - 1; i++) hand.sleep();
  assert.strictEqual(game.state().day, farm.DAYS);
  assert.strictEqual(game.state().season, 0);
  hand.sleep();
  assert.strictEqual(game.state().season, 1);
  assert.strictEqual(game.state().day, 1);
  assert.ok(game.tile(5, 5).crop.dead, 'a turnip survived into summer');
  assert.strictEqual(game.music(), farm.SEASONS[1].track);
  // Summer seeds only, at the stall.
  hand.approach(8, 13); hand.act();
  const state = game.state();
  assert.strictEqual(state.screen, 'shop');
  legal(game, 'summer shop');
  hand.tap('b');
  // And the withered plant can be cleared.
  hand.hold('sickle');
  hand.approach(5, 5);
  assert.strictEqual(game.state().intent, 'clear', game.state().hint);
  hand.act();
  assert.strictEqual(game.tile(5, 5).crop, null);
});

test('meadowlark: the weather is a function of the calendar, not of what you did', () => {
  const a = start();
  const b = start();
  for (let i = 0; i < 6; i++) {
    a.hand.sleep();
    // b does a day's work first.
    b.hand.hold('hoe');
    b.hand.approach(4 + (i % 3), 7);
    if (b.game.state().intent === 'hoe') b.hand.act();
    b.hand.sleep();
    assert.strictEqual(a.game.state().weather, b.game.state().weather, `day ${i + 2}`);
  }
});

test('meadowlark: it rains sometimes in spring, and rain waters the plot', () => {
  const { game, hand } = start();
  hand.holdSeeds('turnip');
  hand.approach(5, 5); hand.act();
  let rained = false;
  for (let i = 0; i < 40 && !rained; i++) {
    hand.sleep();
    if (game.state().weather === 'rain') {
      rained = true;
      legal(game, 'rain');
      for (let r = 5; r <= 7; r++) for (let c = 5; c <= 7; c++) assert.ok(game.tile(c, r).wet, `${c},${r} dry in the rain`);
    }
  }
  assert.ok(rained, 'forty days without rain');
});

test('meadowlark: winter can be slept through, at the cost of hay and bread', () => {
  const { game, hand, store } = start();
  hand.sleep();
  const data = store.load();
  data.season = 3; data.day = 1; data.weather = 'snow';
  data.buildings.coop = true;
  data.tiles[9][3].g = 'coop'; data.tiles[9][3].o = null;
  data.animals = [{ id: 1, kind: 'chicken', name: 'PIP', happy: 8, fed: true, petted: false, ready: false, since: 0, c: 2, r: 11, to: null, t: 0, wait: 1, face: 1 }];
  data.bag = { hay: 10, turnip: 3 };
  data.gold = 1000;
  store.write(data);

  const loaded = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store });
  const h = farmhand(loaded);
  h.tap('down'); h.tap('a');
  h.settle();
  assert.strictEqual(loaded.state().season, 3);
  assert.strictEqual(loaded.music(), farm.SEASONS[3].track);
  legal(loaded, 'winter');

  h.toBed();
  assert.deepStrictEqual(loaded.state().prompt, ['SLEEP UNTIL MORNING', 'SLEEP UNTIL SPRING', 'NOT YET']);
  h.tap('down');
  h.tap('a');
  let guard = 0;
  while (loaded.state().night !== 'card' && guard++ < 400) { if (guard === 60) legal(loaded, 'winter montage'); h.step(1); }
  assert.strictEqual(loaded.state().night, 'card');
  h.step(40);
  legal(loaded, 'thaw card');
  h.tap('a');
  guard = 0;
  while (loaded.state().screen !== 'play' && guard++ < 400) h.step(1);

  const s = loaded.state();
  assert.strictEqual(s.season, 0);
  assert.strictEqual(s.day, 1);
  assert.strictEqual(s.year, 2);
  assert.ok(!s.bag.hay, 'the hen left hay uneaten');
  assert.ok(!s.bag.turnip, 'the farmer left food uneaten');
  // 28 days: 3 turnips, then 25 loaves; the hen was fed for 10 of them and
  // laid while happy.
  assert.ok(s.gold < 1000 - 20 * farm.BREAD + 10 * farm.GOODS.egg.sells, `gold ${s.gold}`);
  assert.ok(s.lifetime.shipped > 0, 'the hen shipped nothing all winter');
  assert.strictEqual(s.animals[0].fed, false, 'the hen was fed on day 28 with no hay left');
});

// --- the shop and the animals ------------------------------------------------

test('meadowlark: tools are bought once, buildings need wood, animals need a building, and a fed hen lays', () => {
  const { game, hand, store } = start();
  hand.sleep();
  const data = store.load();
  data.gold = 20000;
  data.bag = { wood: 12, hay: 5 };
  store.write(data);
  const g = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store });
  const h = farmhand(g);
  h.tap('down'); h.tap('a'); h.settle();

  h.approach(8, 13); h.act();
  assert.strictEqual(g.state().screen, 'shop');
  const at = (id) => {
    const springSeeds = Object.values(farm.CROPS).filter((c) => c.season === 0).length;
    const index = springSeeds + farm.SHOP.findIndex((e) => e.id === id);
    while (g.state().cursor !== index) h.tap(g.state().cursor < index ? 'down' : 'up');
  };
  at('tool:axe'); h.tap('a');
  assert.strictEqual(g.state().tools.axe, 1);
  assert.strictEqual(g.state().gold, 20000 - 500);
  h.tap('a');
  assert.strictEqual(g.state().gold, 20000 - 500, 'sold the same axe twice');

  at('animal:chicken'); h.tap('a');
  assert.strictEqual(g.state().animals.length, 0, 'a hen with no coop');
  at('build:barn'); h.tap('a');
  assert.strictEqual(g.state().buildings.barn, false, 'a barn with 12 wood');
  at('build:coop'); h.tap('a');
  assert.strictEqual(g.state().buildings.coop, true);
  assert.ok(!g.state().bag.wood, 'the coop did not use the wood');
  at('animal:chicken'); h.tap('a');
  assert.strictEqual(g.state().animals.length, 1);
  assert.strictEqual(g.state().animals[0].kind, 'chicken');
  h.tap('b');
  legal(g, 'coop and hen');
  assert.ok(g.tile(3, 9).g === 'coop');

  // Pet her, sleep, and there is an egg to take in the morning. She wanders
  // while you walk over, so it can take a second approach.
  const hen = () => g.state().animals[0];
  const reach = (intent) => {
    for (let i = 0; i < 6; i++) { h.approach(...hen().at); if (g.state().intent === intent) return true; }
    return false;
  };
  assert.ok(reach('pet'), `could not reach the hen to pet her: ${g.state().hint}`);
  const happy = hen().happy;
  h.act();
  assert.ok(g.drain().includes('cluck'));
  assert.strictEqual(hen().happy, happy + 1);
  h.sleep();
  assert.ok(hen().ready, 'no egg after a fed, happy night');
  assert.ok(reach('collect'), `could not reach the hen for the egg: ${g.state().hint}`);
  h.act();
  assert.strictEqual(g.state().bag.egg, 1);
  assert.ok(!hen().ready);
});

// --- persistence -------------------------------------------------------------

test('meadowlark: the farm is saved at each sleep and CONTINUE brings it back', () => {
  const { game, hand, store } = start();
  assert.strictEqual(store.load(), null);
  hand.hold('hoe');
  hand.approach(4, 4);
  if (game.state().intent === 'clear') hand.act();
  if (game.state().intent === 'hoe') hand.act();
  const tilled = game.tile(4, 4).g;
  hand.sleep();
  assert.strictEqual(game.state().saves, 1);
  const saved = store.load();
  assert.strictEqual(saved.day, 2);
  assert.strictEqual(saved.version, farm.SAVE_VERSION);

  const again = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: store });
  const h = farmhand(again);
  assert.strictEqual(again.state().screen, 'menu');
  h.tap('down'); h.tap('a');
  assert.strictEqual(again.state().screen, 'play');
  assert.strictEqual(again.state().day, 2);
  assert.strictEqual(again.state().gold, game.state().gold);
  assert.strictEqual(again.tile(4, 4).g, tilled);
  legal(again, 'continued');

  // And with nothing saved, CONTINUE stays put and says so.
  const empty = farm.create(720, 480, { scores: fakeTable(), seed: 7, save: farm.memoryStore() });
  const e = farmhand(empty);
  e.tap('down'); e.tap('a');
  assert.strictEqual(empty.state().screen, 'menu');
  legal(empty, 'no save');
});

test('meadowlark: quitting to the menu from the pause screen forgets the day but not the save', () => {
  const { game, hand, store } = start();
  hand.sleep();
  hand.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  hand.tap('down'); hand.tap('down'); hand.tap('down'); hand.tap('a');
  assert.strictEqual(game.state().screen, 'menu');
  assert.strictEqual(game.music(), 'meadow');
  assert.ok(store.load(), 'the save went with it');
});

test('meadowlark: a year on the board is the lifetime shipped, under the year', () => {
  const { game, hand, store } = start();
  hand.sleep();
  const data = store.load();
  data.season = 3; data.day = farm.DAYS; data.weather = 'snow';
  data.lifetime.shipped = 4321;
  store.write(data);
  const table = fakeTable();
  const g = farm.create(720, 480, { scores: table, seed: 7, save: store });
  const h = farmhand(g);
  h.tap('down'); h.tap('a'); h.settle();
  h.sleep();
  assert.strictEqual(g.state().year, 2);
  assert.deepStrictEqual(table.recorded, [{ name: 'YR1', score: 4321 }]);
});

// --- a whole spring ----------------------------------------------------------

// The farmhand only reads the hint line and the tile in front of it, buys
// turnip seed when it has the money, and goes to bed when it is tired. If it
// comes out of spring ahead, so will anyone.
test('meadowlark: a plain farmhand comes out of its first spring in profit', () => {
  const { game, hand } = start();
  const plots = [];
  for (let r = 5; r <= 7; r++) for (let c = 5; c <= 7; c++) plots.push([c, r]);

  const buySeeds = () => {
    const empty = plots.filter(([c, r]) => !game.tile(c, r).crop).length;
    const held = game.state().bag['seed:turnip'] ?? 0;
    const want = Math.min(empty - held, Math.floor(game.state().gold / farm.CROPS.turnip.price));
    if (want <= 0) return;
    hand.approach(8, 13); hand.act();
    if (game.state().screen !== 'shop') return;
    for (let i = 0; i < want; i++) hand.tap('a');
    hand.tap('b');
  };
  const ship = () => {
    const turnips = game.state().bag.turnip ?? 0;
    if (turnips < 2) return;
    hand.approach(3, 1); hand.act();
    if (game.state().screen !== 'ship') return;
    for (let i = 1; i < turnips - 1; i++) hand.tap('right');
    hand.tap('a');
    hand.tap('b');
  };
  const eatIfHungry = () => {
    if (game.state().food > 40 || !game.state().bag.turnip) return;
    hand.tap('select');
    const rows = Object.keys(game.state().bag).filter((id) => id.startsWith('seed:')).length;
    for (let i = 0; i < rows; i++) hand.tap('down');
    hand.tap('a');
    hand.tap('b');
  };

  for (let day = 1; day <= farm.DAYS - 1; day++) {
    // Pick anything ripe.
    for (const [c, r] of plots) {
      const t = game.tile(c, r);
      if (t.crop && !t.crop.dead && t.crop.age >= farm.CROPS.turnip.days) { hand.approach(c, r); hand.act(); }
    }
    ship();
    buySeeds();
    // Sow the empty plots.
    if ((game.state().bag['seed:turnip'] ?? 0) > 0) {
      hand.holdSeeds('turnip');
      for (const [c, r] of plots) {
        if (game.tile(c, r).crop || !game.state().bag['seed:turnip']) continue;
        hand.approach(c, r);
        if (game.state().intent === 'seed') hand.act();
      }
    }
    // Water everything dry, refilling at the creek.
    hand.hold('can');
    for (const [c, r] of plots) {
      const t = game.tile(c, r);
      if (!t.crop || t.wet) continue;
      if (game.state().water === 0) { hand.approach(0, 6); hand.act(); }
      hand.approach(c, r);
      if (game.state().intent === 'can') hand.act();
    }
    eatIfHungry();
    hand.sleep();
    assert.strictEqual(game.state().day, day + 1);
  }

  const s = game.state();
  assert.strictEqual(s.season, 0);
  assert.ok(s.lifetime.shipped > 600, `shipped only ${s.lifetime.shipped} all spring`);
  assert.ok(s.gold > 500, `ended spring with ${s.gold}`);
  assert.ok(s.lifetime.harvested >= 20, `harvested only ${s.lifetime.harvested}`);
  legal(game, 'end of spring');
});

test('meadowlark: the shell gets a title, a blurb, an accent and an emblem', () => {
  assert.strictEqual(farm.title, 'MEADOWLARK');
  assert.ok(farm.blurb);
  assert.ok(farm.accent);
  assert.ok(farm.emblem({ x: 0, y: 0, w: 108, h: 60 }).length > 5);
  assert.ok(farm.MENU.some((e) => e.id === 'quit'));
  for (const line of farm.HOW_TO) assert.ok(line.length <= 40, `"${line}" is wider than the picture`);
});

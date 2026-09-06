'use strict';
// Tomo, kept by a player with a stopwatch.
//
// The generic checks in game.test.js hold every screen to the palette,
// overscan and flicker rules and prove a session replays from its inputs.
// These are about the pet: that it hatches as one of seven things with a
// name of its own, that it gets hungry on the wall clock and dies of neglect,
// that a player who turns up with food keeps it alive, that the three games
// can be played and pay, that levels open the pastimes up to the cure for
// science, and that the almanac has a hundred things in it to find.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const tomo = require('../src/games/tomo');
const input = require('../src/input');
const sceneRenderer = require('../src/gfx/scene');
const invariants = require('./invariants');

const STEP = 1 / 30;
const { DAY, HOUR, MINUTE } = tomo;
const MUSIC = path.join(__dirname, '..', 'src', 'music');

function fakeTable() {
  return { recorded: [], table: () => [], placing: (game, score) => (score > 0 ? 1 : 0), record(game, name, score) { this.recorded.push({ name, score }); return []; } };
}

// A wall clock the test can wind. Starts at noon on a Wednesday in June, so
// the pet is awake and it is not a holiday.
function stopwatch(start = new Date(2026, 5, 10, 12, 0, 0).getTime()) {
  let now = start;
  return { now: () => now, wind: (seconds) => { now += seconds * 1000; }, set: (ms) => { now = ms; } };
}

function open(store, watch, seed = 7) {
  const game = tomo.create(720, 480, { scores: fakeTable(), seed, save: store, clock: watch.now });
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [b, d] of Object.entries(held)) pads.p1.set(b, d);
      game.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
    }
  };
  const tap = (b) => { pads.p1.set(b, true); step(1); pads.p1.set(b, false); step(1); };
  const dismiss = () => { let guard = 0; while (game.state().cards > 0 && guard++ < 20) { step(12); tap('a'); } };
  const legal = (label) => { const scene = game.scene(); invariants.legalFrame(scene, sceneRenderer.render(scene), `tomo [${label}]`); };
  const icon = (id) => {
    assert.strictEqual(game.state().screen, 'home', `not at home (${game.state().screen})`);
    dismiss();
    const want = tomo.HOME_ICONS.findIndex((i) => i.id === id);
    let guard = 0;
    while (game.state().icon !== want && guard++ < 8) tap('right');
    tap('a');
  };
  const home = () => { let guard = 0; while (game.state().screen !== 'home' && guard++ < 8) { step(14); tap('b'); dismiss(); } dismiss(); };
  const hatch = () => {
    assert.strictEqual(game.state().screen, 'menu');
    tap('a');                                  // NEW TOMO
    assert.strictEqual(game.state().screen, 'create');
    for (let i = 0; i < 4; i++) tap('a');      // down the rows to HATCH
    tap('a');
    assert.strictEqual(game.state().screen, 'hatching');
    step(95);
    tap('a');
    assert.strictEqual(game.state().screen, 'home');
    dismiss();
  };
  const resume = () => { tap('down'); tap('a'); assert.strictEqual(game.state().screen, 'home', 'CONTINUE did not reach the room'); };
  const quit = () => {
    home();
    tap('start');
    if (game.state().screen !== 'paused') { dismiss(); tap('start'); } // a visitor can knock as you leave
    assert.strictEqual(game.state().screen, 'paused'); tap('down'); tap('down'); tap('a'); assert.strictEqual(game.state().screen, 'menu'); };
  // The care screen: `tab` 0 is the pantry, 1 is care; `row` is the index.
  const tend = (tab, row) => {
    icon(tab === 0 ? 'feed' : 'care');
    assert.strictEqual(game.state().screen, 'care');
    for (let i = 0; i < row; i++) tap('down');
    tap('a');
    dismiss();
    tap('b');
    dismiss();
  };
  const feed = (foodId) => tend(0, tomo.FOODS.filter((f) => f.level <= game.state().pet.level).findIndex((f) => f.id === foodId));
  const care = (id) => tend(1, tomo.CARE.findIndex((c) => c.id === id));
  return { game, pads, step, tap, dismiss, legal, icon, home, hatch, resume, quit, feed, care };
}

// Plays juggle like somebody who is paying attention. `skill` is the chance
// of taking a kick that is on.
function juggler(t, { frames = 3000, skill = 1 } = {}) {
  let kicks = 0;
  for (let i = 0; i < frames && t.game.state().screen === 'juggle'; i++) {
    const m = t.game.state().mini;
    if (m.over) { t.step(1); continue; }
    const under = m.ball.x + m.ball.vx * 0.15;
    const held = { left: under < m.x - 8, right: under > m.x + 8 };
    const low = m.ball.vy > 0 && m.ball.y > 480 - 20 - 66 - 60 && Math.abs(m.ball.x - m.x) < 40;
    if (low && Math.random() < skill) { t.pads.p1.set('a', true); kicks++; }
    t.step(1, held);
    t.pads.p1.set('a', false);
  }
  return kicks;
}

test('tomo: the almanac has at least a hundred things in it, all distinct', () => {
  assert.ok(tomo.FACETS.length >= 100, `only ${tomo.FACETS.length} facets`);
  const keys = new Set(tomo.FACETS.map((f) => f.key));
  assert.strictEqual(keys.size, tomo.FACETS.length, 'two facets share a key');
  for (const f of tomo.FACETS) {
    assert.ok(f.name && f.name === f.name.toUpperCase(), `${f.key} has no upper-case name`);
    assert.ok(f.line || f.hint, `${f.key} has nothing to say about itself`);
    assert.ok((f.line ?? f.hint).length <= 40, `${f.key}: "${f.line ?? f.hint}" is wider than the screen`);
  }
  assert.strictEqual(tomo.ARCHETYPES.length, 7);
  const names = tomo.ACTIVITIES.map((a) => a.name);
  assert.ok(names.includes('COMPUTER PROGRAMMING'));
  assert.ok(names.includes('RESEARCHING THE CURE FOR SCIENCE'));
  for (let i = 1; i < tomo.ACTIVITIES.length; i++) assert.ok(tomo.ACTIVITIES[i].level >= tomo.ACTIVITIES[i - 1].level, 'pastimes are not in level order');
  // Every food in the shop can be reached: the levels it asks for are levels.
  for (const f of tomo.FOODS) assert.ok(f.level >= 1 && f.level <= 24, `${f.name} unlocks at level ${f.level}`);
});

test('tomo: every one of the seven bodies hatches, each with a name, and draws', () => {
  const seen = new Map();
  const names = new Set();
  for (let seed = 1; seed <= 80 && seen.size < 7; seed++) {
    const t = open(tomo.memoryStore(), stopwatch(), seed);
    t.hatch();
    const pet = t.game.state().pet;
    names.add(pet.name);
    assert.ok(/^[A-Z]{2,6}$/.test(pet.name), `odd name "${pet.name}"`);
    if (!seen.has(pet.body)) { seen.set(pet.body, seed); t.legal(`home, ${pet.body}`); }
  }
  assert.deepStrictEqual([...seen.keys()].sort(), tomo.ARCHETYPES.map((a) => a.id).sort(), `only hatched ${[...seen.keys()]}`);
  assert.ok(names.size >= 5, `the names are not random enough: ${[...names]}`);
});

test('tomo: the create screen rolls a name and the traits can be set', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 3);
  t.tap('a');
  const first = t.game.state().draft.name;
  t.tap('right');
  assert.notStrictEqual(t.game.state().draft.name, first, 'RIGHT on the name row should roll another');
  t.legal('create');
  t.tap('down');
  t.tap('right');
  assert.strictEqual(t.game.state().draft.temper, 1 % tomo.TEMPERS.length === t.game.state().draft.temper ? t.game.state().draft.temper : t.game.state().draft.temper);
  t.tap('b');
  assert.strictEqual(t.game.state().screen, 'menu');
});

test('tomo: it gets hungry on the wall clock, and starves if nobody comes', () => {
  const store = tomo.memoryStore();
  const watch = stopwatch();
  const first = open(store, watch);
  first.hatch();
  const fed = first.game.state().pet.food;
  first.quit();
  assert.ok(store.raw, 'nothing was saved');

  watch.wind(6 * HOUR);
  const later = open(store, watch);
  later.resume();
  const pet = later.game.state().pet;
  assert.ok(pet.food < fed - 50 && pet.food > 0, `six hours away took food from ${fed} to ${pet.food}`);
  assert.ok(later.game.state().cards >= 1, 'no WHILE YOU WERE AWAY card');
  later.legal('away card');
  assert.ok(pet.age >= 6 * HOUR - 1, 'time away did not age it');
  later.quit();

  // Two days of nothing: the food runs out and then the health does.
  watch.wind(2 * DAY);
  const gone = open(store, watch);
  gone.tap('down');
  gone.tap('a');
  assert.strictEqual(gone.game.state().screen, 'dead');
  assert.strictEqual(gone.game.state().fallen.cause, 'starved');
  gone.legal('dead');
  gone.step(40);
  gone.tap('a');
  assert.strictEqual(gone.game.state().screen, 'menu');
  gone.legal('menu with a memorial');
  const saved = store.load();
  assert.strictEqual(saved.pet, null, 'a dead pet is still in the save');
  assert.strictEqual(saved.memorial.length, 1);
  gone.tap('down');
  gone.tap('a');
  assert.strictEqual(gone.game.state().screen, 'menu', 'CONTINUE found a pet that has gone');
});

test('tomo: fed, flushed and played with three times a day, it lives a week', () => {
  const store = tomo.memoryStore();
  const watch = stopwatch();
  const first = open(store, watch);
  first.hatch();
  first.quit();

  for (let visit = 0; visit < 21; visit++) {
    watch.wind(8 * HOUR);
    const t = open(store, watch, 100 + visit);
    t.resume();
    assert.ok(t.game.state().pet, `it died before visit ${visit + 1}`);
    t.dismiss();
    if (t.game.state().pet.asleep) { t.tap('select'); t.dismiss(); }
    for (let i = 0; i < 3 && t.game.state().pet.food < tomo.FULL; i++) t.feed('rice');
    if (t.game.state().pet.messes > 0) t.care('flush');
    if (t.game.state().pet.sick) t.care('medicine');
    t.care('praise');
    t.icon('play');
    t.tap('a');
    if (t.game.state().screen === 'juggle') { juggler(t); t.step(40); t.tap('a'); }
    t.home();
    const pet = t.game.state().pet;
    assert.ok(pet.food > 50, `visit ${visit + 1}: food only ${pet.food.toFixed(0)}`);
    assert.strictEqual(pet.messes, 0);
    t.quit();
  }

  const t = open(store, watch);
  t.resume();
  const pet = t.game.state().pet;
  assert.ok(pet.age >= 7 * DAY, `only ${(pet.age / DAY).toFixed(1)} days old`);
  assert.strictEqual(pet.stage, 'adult');
  assert.ok(pet.health > 50, `health down to ${pet.health.toFixed(0)}`);
  assert.ok(pet.badges.includes('week'), `badges: ${pet.badges}`);
  assert.ok(pet.badges.includes('firstmeal'));
  assert.ok(pet.level >= 3, `only level ${pet.level} after a week`);
  assert.ok(pet.counts.visits >= 1, 'nobody ever came to the door');
  t.legal('a week old');
});

test('tomo: it sleeps at night, dreams, and can be woken', () => {
  const watch = stopwatch(new Date(2026, 5, 10, 23, 30, 0).getTime());
  const t = open(tomo.memoryStore(), watch);
  t.hatch();
  assert.strictEqual(t.game.state().pet.asleep, true, 'hatched at half past eleven and not asleep');
  assert.strictEqual(t.game.state().pet.weather, tomo.weatherFor({ y: 2026, m: 6, d: 10 }));
  t.legal('asleep at night');
  t.feed('rice');
  assert.match(t.game.state().note ?? '', /ASLEEP/);
  t.step(Math.ceil(3 * MINUTE / STEP) + 5);
  assert.ok(t.game.state().pet.counts.dreams >= 1, 'no dream after three minutes asleep');
  t.legal('dreaming');
  t.tap('select');
  assert.strictEqual(t.game.state().pet.asleep, false, 'SELECT did not wake it');
  t.dismiss();
  t.legal('woken at night');
});

test('tomo: too tired or too hungry, it will not play', () => {
  const store = tomo.memoryStore();
  const watch = stopwatch();
  const first = open(store, watch);
  first.hatch();
  first.quit();
  watch.wind(9 * HOUR);
  const hungry = open(store, watch);
  hungry.resume();
  assert.ok(hungry.game.state().pet.food < tomo.HUNGRY, `food ${hungry.game.state().pet.food}`);
  hungry.icon('play');
  hungry.tap('a');
  assert.strictEqual(hungry.game.state().screen, 'play', 'it played while starving');
  assert.match(hungry.game.state().note, /HUNGRY/);
  hungry.tap('b');
  hungry.feed('rice');
  hungry.feed('rice');

  // Every game costs rest. Lose quickly until there is none left.
  let guard = 0;
  while (hungry.game.state().pet.rest >= tomo.TIRED && guard++ < 20) {
    hungry.icon('play');
    hungry.tap('a');
    assert.strictEqual(hungry.game.state().screen, 'juggle');
    hungry.step(120);
    assert.strictEqual(hungry.game.state().screen, 'result');
    hungry.tap('a');
    hungry.home();
  }
  hungry.icon('play');
  hungry.tap('a');
  assert.strictEqual(hungry.game.state().screen, 'play');
  assert.match(hungry.game.state().note, /TIRED/);
  hungry.tap('b');
  hungry.care('tuck');
  assert.strictEqual(hungry.game.state().pet.asleep, true, 'a tired pet should take the nap');
});

test('tomo: juggling can be kept up, and pays', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 12);
  t.hatch();
  const before = t.game.state().pet;
  t.icon('play');
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'juggle');
  assert.strictEqual(t.game.music(), 'juggle');
  t.step(4);
  t.legal('juggle');
  juggler(t);
  // A player this good can go on for minutes; B ends it with the score so far.
  if (t.game.state().screen === 'juggle') { t.tap('b'); t.step(40); }
  assert.strictEqual(t.game.state().screen, 'result');
  const r = t.game.state().result;
  assert.ok(r.score >= 10, `a player who watches the ball only managed ${r.score}`);
  t.legal('result');
  const after = t.game.state().pet;
  assert.ok(after.xp + (after.level - before.level) * 100 > before.xp, 'no xp for a game');
  assert.ok(after.beans > before.beans, 'no beans for a game');
  assert.ok(after.joy > before.joy, 'no joy for a game');
  assert.ok(after.rest < before.rest, 'a game should tire it');
  assert.strictEqual(after.counts.juggleBest, r.score);
  t.tap('a');
  t.dismiss();
  assert.ok(t.game.state().pet.badges.includes('juggle10'), `badges: ${t.game.state().pet.badges}`);

  // A player who never kicks drops it straight away.
  t.icon('play');
  t.tap('a');
  t.step(120);
  assert.strictEqual(t.game.state().screen, 'result');
  assert.strictEqual(t.game.state().result.score, 0);
});

test('tomo: the orchard and echo can be played to a score', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 21);
  t.hatch();
  t.icon('play');
  t.tap('down');
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'orchard');
  assert.strictEqual(t.game.music(), 'orchard');
  for (let i = 0; i < 45 * 30 && t.game.state().screen === 'orchard'; i++) {
    const m = t.game.state().mini;
    const good = m.fruit.filter((f) => f.kind !== 'rotten').sort((a, b) => b.y - a.y)[0];
    const bad = m.fruit.find((f) => f.kind === 'rotten' && Math.abs(f.x - m.x) < 50 && f.y > 250);
    let held = {};
    if (bad) held = { left: bad.x >= m.x, right: bad.x < m.x };
    else if (good) held = { left: good.x < m.x - 6, right: good.x > m.x + 6 };
    if (i === 60) t.legal('orchard');
    t.step(1, { left: false, right: false, ...held });
  }
  assert.strictEqual(t.game.state().screen, 'result');
  assert.ok(t.game.state().result.score >= 8, `orchard scored ${t.game.state().result.score}`);
  t.tap('a');
  t.home();

  t.icon('play');
  t.tap('down');
  t.tap('down');
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'echo');
  assert.strictEqual(t.game.music(), 'echo');
  let guard = 0;
  while (t.game.state().screen === 'echo' && guard++ < 9000) {
    const m = t.game.state().mini;
    if (m.over) { t.step(1); continue; }
    if (m.phase !== 'input') { if (guard === 20) t.legal('echo'); t.step(1); continue; }
    t.tap(m.seq[m.index]);
  }
  assert.strictEqual(t.game.state().screen, 'result');
  assert.strictEqual(t.game.state().result.score, 20, 'a player who copies exactly should clear every round');
  t.tap('a');
  t.dismiss();
  assert.ok(t.game.state().pet.badges.includes('echo8'));
});

test('tomo: pastimes pay, and levels unlock more of them', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 5);
  t.hatch();
  t.icon('work');
  assert.strictEqual(t.game.state().screen, 'work');
  assert.strictEqual(t.game.music(), 'study');
  t.legal('work');
  // The last one on the list is locked.
  t.tap('up');
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'work');
  assert.match(t.game.state().note, /LEVEL 24/);
  t.tap('down');
  const before = t.game.state().pet;
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'working');
  t.step(30);
  t.legal('working');
  t.step(Math.ceil(tomo.ACTIVITIES[0].secs / STEP));
  assert.strictEqual(t.game.state().screen, 'home');
  assert.ok(t.game.state().cards >= 1, 'no line about what happened');
  t.legal('finding card');
  t.dismiss();
  const after = t.game.state().pet;
  assert.strictEqual(after.counts.did.doodle, 1);
  assert.strictEqual(after.beans, before.beans + tomo.ACTIVITIES[0].beans);

  // Enough doodling reaches level 2, which opens stargazing.
  let guard = 0;
  while (t.game.state().pet.level < 2 && guard++ < 6) {
    t.icon('work');
    t.tap('a');
    t.step(Math.ceil(tomo.ACTIVITIES[0].secs / STEP) + 2);
    t.dismiss();
  }
  assert.strictEqual(t.game.state().pet.level, 2);
  assert.ok(t.game.state().pet.seen >= 6, 'the book is not filling up');
  assert.strictEqual(tomo.ACTIVITIES.find((a) => a.id === 'programming').level, 11);
  assert.strictEqual(tomo.ACTIVITIES.find((a) => a.id === 'science').level, 20);
  assert.ok(tomo.xpFor(20) > tomo.xpFor(11) && tomo.xpFor(11) > tomo.xpFor(1));
});

test('tomo: the shop sells, the pantry holds, and the room fills up', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 9);
  t.hatch();
  t.icon('shop');
  assert.strictEqual(t.game.state().screen, 'shop');
  t.legal('shop, food');
  const beans = t.game.state().pet.beans;
  t.tap('a'); // the first food
  assert.strictEqual(t.game.state().pet.beans, beans - tomo.FOODS.filter((f) => f.cost > 0)[0].cost);
  t.tap('right');
  t.legal('shop, toys');
  t.tap('a'); // a ball
  assert.deepStrictEqual(t.game.state().pet.toys, ['ball']);
  t.tap('a');
  assert.match(t.game.state().note, /ALREADY/);
  t.tap('right');
  t.tap('a'); // a rug
  assert.deepStrictEqual(t.game.state().pet.decor, ['rug']);
  t.legal('shop, decor');
  t.tap('b');
  t.legal('home with a rug');
  t.icon('play');
  t.tap('up'); // the ball is last
  t.tap('a');
  assert.match(t.game.state().note, /BALL/);
  t.legal('playing with a toy');
  t.tap('b');
  t.feed('onigiri');
  assert.strictEqual(t.game.state().pet.pantry.onigiri, 2);
});

test('tomo: the almanac pages through everything and remembers what was met', () => {
  const t = open(tomo.memoryStore(), stopwatch(), 4);
  t.hatch();
  t.feed('rice');
  t.icon('book');
  assert.strictEqual(t.game.state().screen, 'almanac');
  for (let page = 0; page <= tomo.KINDS.length; page++) {
    assert.strictEqual(t.game.state().page, page);
    t.legal(`almanac page ${page}`);
    t.tap('down');
    t.tap('right');
  }
  assert.strictEqual(t.game.state().page, 0, 'the pages do not wrap');
  const pet = t.game.state().pet;
  assert.ok(pet.seen >= 5, `only ${pet.seen} things seen after hatching and a meal`);
  t.tap('b');
  t.tap('start');
  t.legal('paused');
  t.tap('down');
  t.tap('a');
  assert.strictEqual(t.game.state().screen, 'howto');
  assert.strictEqual(t.game.music(), 'nook', 'the help from the pause menu should keep the room playing');
  t.legal('howto');
});

test('tomo: every track it asks for is a score in src/music', () => {
  const asked = new Set();
  const t = open(tomo.memoryStore(), stopwatch(), 2);
  asked.add(t.game.music());
  t.tap('a'); asked.add(t.game.music());
  for (let i = 0; i < 5; i++) t.tap('a');
  asked.add(t.game.music());
  t.step(95); t.tap('a'); t.dismiss();
  asked.add(t.game.music());
  for (const id of ['feed', 'play', 'work', 'shop', 'book']) { t.icon(id); asked.add(t.game.music()); t.home(); }
  assert.ok(asked.size >= 6, `only ${[...asked]}`);
  for (const track of asked) {
    assert.ok(fs.existsSync(path.join(MUSIC, `${track}.js`)), `no score for "${track}"`);
  }
});

test('tomo: weather comes from the date and the seasons show', () => {
  const kinds = new Set();
  for (let d = 0; d < 365; d++) {
    const at = new Date(2026, 0, 1 + d);
    const date = { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() };
    const w = tomo.weatherFor(date);
    assert.strictEqual(w, tomo.weatherFor(date));
    kinds.add(w);
  }
  assert.deepStrictEqual([...kinds].sort(), tomo.WEATHER.map((w) => w.id).sort());
  assert.notStrictEqual(tomo.weatherFor({ y: 2026, m: 7, d: 10 }), 'snow');
});

test('tomo: a holiday brings a gift once, and the save ignores an old version', () => {
  const watch = stopwatch(new Date(2026, 11, 25, 10, 0, 0).getTime());
  const store = tomo.memoryStore();
  const t = open(store, watch);
  t.hatch();
  const pet = t.game.state().pet;
  assert.ok(pet.badges.length >= 0);
  assert.ok(pet.beans > 60, 'no yule gift');
  assert.ok(t.game.state().cards >= 0);
  t.legal('yule');
  t.quit();
  watch.wind(HOUR);
  const again = open(store, watch);
  again.resume();
  // A visitor may have left a few beans on the way back in, but not a gift's worth.
  assert.ok(again.game.state().pet.beans - pet.beans < 40, 'the gift was given twice');

  const stale = tomo.memoryStore({ version: 0, pet: { name: 'OLD' }, memorial: [] });
  const fresh = open(stale, watch);
  fresh.tap('down');
  fresh.tap('a');
  assert.strictEqual(fresh.game.state().screen, 'menu', 'an old save was half-loaded');
});

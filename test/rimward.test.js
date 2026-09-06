'use strict';
// Rimward, driven the way a captain would drive it: buy, refit, depart, deal
// with whatever the trail sends, and either arrive or don't. The generic
// per-game checks live in test/game.test.js; these are the ones that need to
// know what a hold or a fork is.

const test = require('node:test');
const assert = require('node:assert');

const sceneRenderer = require('../src/gfx/scene');
const input = require('../src/input');
const invariants = require('./invariants');
const rimward = require('../src/games/rimward');

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
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) game.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
  };
  const tap = (button) => {
    pads.p1.set(button, true); step(1);
    pads.p1.set(button, false); step(1);
  };
  return { pads, step, tap };
}

const check = (game, label) => {
  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), `rimward [${label}]`);
};

// Through the menu and the origin screen, as the given profession, to the
// docks at Sol.
function leaveEarth(profession = 'merchant', options = {}) {
  const game = rimward.create(720, 480, { scores: fakeTable(), seed: 7, ...options });
  const drive = player(game);
  drive.tap('a'); // NEW VOYAGE
  assert.strictEqual(game.state().screen, 'origin');
  const want = rimward.PROFESSIONS.findIndex((p) => p.id === profession);
  for (let i = 0; i < want; i++) drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'station');
  assert.strictEqual(game.state().at, 'sol');
  return { game, drive };
}

// Picks a station menu entry by id, from wherever the cursor is.
function choose(game, drive, id) {
  const items = rimward.stationMenuFor(rimward.NODES[game.state().at]);
  const index = items.findIndex((item) => item.id === id);
  assert.ok(index >= 0, `${game.state().at} has no ${id}`);
  while (game.state().cursor !== index) drive.tap('down');
  drive.tap('a');
}

// Buys up to the targets, row by row, and leaves. Stops on a row when a press
// changes nothing -- the hold is full, the tank is full, or the purse is.
function shop(game, drive, targets) {
  choose(game, drive, 'stores');
  assert.strictEqual(game.state().screen, 'shop');
  for (const supply of rimward.SUPPLIES) {
    let guard = 0;
    while (game.state().sup[supply.key] < (targets[supply.key] ?? 0) && guard++ < 80) {
      const before = game.state().sup[supply.key];
      drive.tap('right');
      if (game.state().sup[supply.key] === before) break;
    }
    drive.tap('down');
  }
  drive.tap('a'); // BACK
  assert.strictEqual(game.state().screen, 'station');
}

function refit(game, drive, marks) {
  choose(game, drive, 'dockyard');
  assert.strictEqual(game.state().screen, 'shop');
  for (const system of rimward.SYSTEMS) {
    let guard = 0;
    while (game.state().ship[system.key] < (marks[system.key] ?? 1) && guard++ < 3) {
      const before = game.state().ship[system.key];
      drive.tap('a');
      if (game.state().ship[system.key] === before) break;
    }
    drive.tap('down');
  }
  drive.tap('a'); // BACK
  assert.strictEqual(game.state().screen, 'station');
}

// The captain. Cautious by default: pays pirates off, leaves derelicts alone,
// takes the long way at both forks, patches the hull and doses the sick.
function captain(game, drive, { frames = 60000, risky = false, onScreen = null } = {}) {
  const provisioned = new Set();
  const seen = new Set();
  let n = 0;
  let battles = 0;
  let events = 0;

  while (game.state().screen !== 'over' && game.state().screen !== 'menu' && n < frames) {
    const s = game.state();
    if (!seen.has(s.screen)) { seen.add(s.screen); if (onScreen) onScreen(s.screen); }

    switch (s.screen) {
      case 'station': {
        if (!provisioned.has(s.at)) {
          provisioned.add(s.at);
          const here = rimward.NODES[s.at];
          if (here.upgrades && s.at === 'sol') refit(game, drive, { engine: 2, cargo: 2 });
          if (here.kind !== 'beacon') {
            shop(game, drive, { fuel: 999, rations: 999, spares: 4, medkits: 2 });
            if (s.crew.some((p) => p.alive && p.health < 60)) choose(game, drive, 'rest');
          }
        } else {
          choose(game, drive, 'depart');
        }
        break;
      }
      case 'chart': {
        if (!s.chartChoose) { drive.tap('b'); break; }
        const options = rimward.outgoing(s.at);
        const want = options.findIndex((leg) => (risky ? leg.hazard >= 0.15 : leg.hazard < 0.15));
        while (game.state().course !== Math.max(0, want)) drive.tap('right');
        drive.tap('a');
        break;
      }
      case 'travel': {
        const hurt = s.hull < 0.4 * rimward.HULL[s.ship.hull - 1] && s.sup.spares > 0;
        const sick = s.crew.findIndex((p) => p.alive && (p.ailment || p.health < 40));
        if (hurt) {
          drive.tap('a');
          const want = rimward.TRAVEL_MENU.findIndex((m) => m.id === 'repair');
          while (game.state().cursor !== want) drive.tap('down');
          drive.tap('a');
          if (game.state().screen === 'options') drive.tap('b');
        } else if (sick >= 0 && s.sup.medkits > 0) {
          drive.tap('a');
          const want = rimward.TRAVEL_MENU.findIndex((m) => m.id === 'crew');
          while (game.state().cursor !== want) drive.tap('down');
          drive.tap('a');
          while (game.state().cursor !== sick) drive.tap('down');
          drive.tap('a');
          drive.tap('b'); drive.tap('b');
        } else {
          drive.step(1);
        }
        break;
      }
      case 'event': {
        if (s.event.phase === 'ask') {
          const spec = rimward.EVENTS.find((e) => e.id === s.event.id);
          const labels = spec.choices.map((c) => c.label);
          const prefer = risky
            ? ['FIGHT', 'BOARD IT', 'FIT A SPARE', 'BUY IT', 'RUN']
            : [s.sup.credits >= 400 ? 'PAY THEM' : 'FIGHT', 'LEAVE IT', 'FIT A SPARE', s.sup.fuel < 40 ? 'BUY IT' : 'DECLINE'];
          const want = labels.findIndex((l) => prefer.includes(l));
          while (game.state().cursor !== Math.max(0, want)) drive.tap('down');
          drive.tap('a');
          events++;
        } else {
          drive.step(10);
          drive.tap('a');
        }
        break;
      }
      case 'battle': {
        if (s.battle.phase === 'choose') {
          const patch = s.hull < 30 && s.sup.spares > 0;
          const want = rimward.ACTIONS.findIndex((a) => a.id === (patch ? 'patch' : 'fire'));
          while (game.state().cursor !== want) drive.tap('down');
          drive.tap('a');
        } else {
          drive.step(7);
          drive.tap('a');
          if (game.state().screen !== 'battle') battles++;
        }
        break;
      }
      case 'loading':
      case 'options':
      case 'crew':
      case 'supplies':
      case 'shop':
        drive.step(1);
        if (s.screen !== 'loading') drive.tap('b');
        break;
      default:
        throw new Error(`the captain has no plan for ${s.screen}`);
    }
    n++;
  }
  return { frames: n, seen, battles, events };
}

// --- the docks ---------------------------------------------------------------

test('rimward: the hold is finite, and so is the tank', () => {
  const { game, drive } = leaveEarth('merchant');
  check(game, 'station, sol');
  choose(game, drive, 'stores');
  check(game, 'shop, stores');
  drive.tap('b');
  choose(game, drive, 'dockyard');
  check(game, 'shop, dockyard');
  drive.tap('b');
  shop(game, drive, { fuel: 9999, rations: 9999, spares: 0, medkits: 0 });
  const s = game.state();
  assert.strictEqual(s.sup.fuel, rimward.TANK[0], 'the tank took more than it holds');
  assert.strictEqual(s.sup.rations, rimward.CARGO[0], 'the hold took more than it holds');
  assert.ok(s.sup.credits > 0, 'a merchant should not be able to spend everything on a mark-one hold');

  // With the hold full, a spare does not fit, and selling ten rations makes room.
  choose(game, drive, 'stores');
  drive.tap('down'); drive.tap('down'); // SPARES
  drive.tap('right');
  assert.strictEqual(game.state().sup.spares, 0, 'a spare went into a full hold');
  drive.tap('up');
  drive.tap('left');
  assert.strictEqual(game.state().sup.rations, rimward.CARGO[0] - 10);
  drive.tap('down');
  drive.tap('right');
  assert.strictEqual(game.state().sup.spares, 1);
});

test('rimward: the dockyard sells speed, and it costs', () => {
  const slow = leaveEarth('merchant');
  shop(slow.game, slow.drive, { fuel: 90, rations: 100 });
  const quick = leaveEarth('merchant');
  const purse = quick.game.state().sup.credits;
  refit(quick.game, quick.drive, { engine: 2 });
  assert.strictEqual(quick.game.state().ship.engine, 2);
  assert.strictEqual(quick.game.state().sup.credits, purse - rimward.SYSTEMS[0].cost[1]);
  shop(quick.game, quick.drive, { fuel: 90, rations: 100 });

  for (const { game, drive } of [slow, quick]) {
    choose(game, drive, 'depart');
    assert.strictEqual(game.state().screen, 'loading');
    drive.step(Math.ceil(rimward.LOAD_TIME / STEP) + 2);
    assert.strictEqual(game.state().screen, 'travel', 'the loading screen did not get out of the way');
    // Five days under way, and no further -- an event would stop the clock.
    while (game.state().day < 6 && game.state().screen === 'travel') drive.step(1);
  }
  const a = slow.game.state();
  const b = quick.game.state();
  assert.ok(b.dist > a.dist * 1.2, `mark two covered ${b.dist.toFixed(1)} against mark one's ${a.dist.toFixed(1)}`);
  assert.ok(a.sup.fuel < 90, 'flying burned nothing');
});

test('rimward: a prospector cannot afford what a merchant can', () => {
  const rich = leaveEarth('merchant');
  const poor = leaveEarth('prospector');
  assert.ok(rich.game.state().sup.credits > poor.game.state().sup.credits * 2);
  refit(poor.game, poor.drive, { engine: 3 });
  assert.strictEqual(poor.game.state().ship.engine, 2, 'a prospector bought a mark-three drive at Sol');
  refit(rich.game, rich.drive, { engine: 3 });
  assert.strictEqual(rich.game.state().ship.engine, 3);
});

// --- the void ----------------------------------------------------------------

test('rimward: a family that leaves with nothing does not get far, and the voyage ends', () => {
  const { game, drive } = leaveEarth('prospector');
  choose(game, drive, 'depart');
  drive.step(Math.ceil(rimward.LOAD_TIME / STEP) + 2);
  assert.strictEqual(game.state().screen, 'travel');

  // No fuel, no food: adrift on day one, and the calendar does the rest. Events
  // still need dismissing, which is all this captain does.
  let frames = 0;
  while (game.state().screen !== 'over' && frames++ < 6000) {
    const s = game.state();
    if (s.screen === 'travel') drive.step(1);
    else if (s.screen === 'event' || s.screen === 'battle') { drive.step(10); drive.tap('a'); }
    else throw new Error(`unexpected screen ${s.screen}`);
  }
  const s = game.state();
  assert.strictEqual(s.screen, 'over', 'starving in the dark went on for ever');
  assert.ok(['perished', 'destroyed'].includes(s.ending), `ended ${s.ending}`);
  assert.ok(s.adrift, 'an empty tank should leave the ship adrift');
  assert.ok(s.day > 5 && s.day < 60, `it took ${s.day} days`);
  assert.ok(s.crew.every((p) => !p.alive) || s.ending === 'destroyed');
  check(game, `over, ${s.ending}`);
});

test('rimward: at Tau Ceti the reef and the arc are both on offer', () => {
  const { game, drive } = leaveEarth('merchant');
  refit(game, drive, { engine: 3, tank: 2 });
  shop(game, drive, { fuel: 999, rations: 250, spares: 3, medkits: 2 });
  choose(game, drive, 'depart');

  let guard = 0;
  while (game.state().at !== 'tau' && game.state().screen !== 'over' && guard++ < 20000) {
    const s = game.state();
    if (s.screen === 'station') choose(game, drive, 'depart');
    else if (s.screen === 'travel' || s.screen === 'loading') drive.step(1);
    else if (s.screen === 'event') {
      if (s.event.phase === 'ask') { drive.tap('a'); } else { drive.step(10); drive.tap('a'); }
    } else if (s.screen === 'battle') {
      if (s.battle.phase === 'choose') drive.tap('a'); else { drive.step(7); drive.tap('a'); }
    } else throw new Error(`unexpected screen ${s.screen}`);
  }
  assert.strictEqual(game.state().at, 'tau', `never reached Tau Ceti (${game.state().screen}, ${game.state().ending})`);
  check(game, 'station, tau ceti');

  choose(game, drive, 'depart');
  const s = game.state();
  assert.strictEqual(s.screen, 'chart');
  assert.ok(s.chartChoose, 'the fork did not ask');
  const options = rimward.outgoing('tau');
  assert.strictEqual(options.length, 2);
  check(game, 'chart, choosing');

  drive.tap('right');
  assert.strictEqual(game.state().course, 1);
  drive.tap('a');
  assert.strictEqual(game.state().leg, options[1].id);
  assert.notStrictEqual(options[0].ly, options[1].ly, 'the two ways are the same length');
  check(game, 'loading');
});

test('rimward: the crossing can be made, and every screen on the way draws a legal frame', () => {
  const outcomes = [];
  const seen = new Set();
  let battles = 0;
  let events = 0;

  for (const seed of [3, 7, 11, 21, 33]) {
    const store = fakeTable();
    const game = rimward.create(720, 480, { scores: store, seed });
    const drive = player(game);
    drive.tap('a');
    drive.tap('a'); // MERCHANT
    const run = captain(game, drive, {
      onScreen: (screen) => { if (!seen.has(screen)) check(game, `${screen}, seed ${seed}`); },
    });
    for (const screen of run.seen) seen.add(screen);
    battles += run.battles;
    events += run.events;
    const s = game.state();
    assert.strictEqual(s.screen, 'over', `seed ${seed}: the voyage never ended (${s.screen}, day ${s.day}, ${run.frames} frames)`);
    outcomes.push({ seed, ending: s.ending, day: s.day, dist: Math.round(s.dist), alive: s.crew.filter((p) => p.alive).length, tally: s.tally });
    if (process.env.RIMWARD_LOG) console.log(JSON.stringify(outcomes[outcomes.length - 1]), s.leg, JSON.stringify(s.sup));
    check(game, `over, ${s.ending}, seed ${seed}`);

    if (s.ending === 'settled') {
      assert.ok(s.tally > 0, 'arriving is worth something');
      assert.ok(s.placing > 0, 'and should make an empty board');
      drive.step(30);
      check(game, 'over, entering initials');
      drive.tap('down');
      drive.tap('a'); drive.tap('a'); drive.tap('a');
      assert.strictEqual(game.state().screen, 'scores');
      assert.strictEqual(store.recorded[0].name, 'BAA');
      assert.strictEqual(store.recorded[0].score, s.tally);
    }
  }

  const settled = outcomes.filter((o) => o.ending === 'settled');
  assert.ok(settled.length >= 3, `a careful merchant should usually arrive: ${JSON.stringify(outcomes)}`);
  assert.ok(events > 0, 'nothing happened on the way');
  assert.ok(battles > 0, 'nobody shot at anyone across five crossings');
  for (const screen of ['loading', 'travel', 'event', 'battle', 'chart', 'station']) {
    assert.ok(seen.has(screen), `the ${screen} screen was never reached`);
  }
});

test('rimward: a captain who fights everything and boards everything lives dangerously', () => {
  const outcomes = [];
  for (const seed of [3, 7, 11, 21, 33]) {
    const game = rimward.create(720, 480, { scores: fakeTable(), seed });
    const drive = player(game);
    drive.tap('a');
    drive.tap('down'); drive.tap('down'); drive.tap('a'); // PROSPECTOR
    const run = captain(game, drive, { risky: true });
    const s = game.state();
    assert.strictEqual(s.screen, 'over', `seed ${seed}: never ended`);
    outcomes.push({ seed, ending: s.ending, day: s.day, battles: run.battles });
  }
  const dead = outcomes.filter((o) => o.ending !== 'settled');
  assert.ok(dead.length >= 1, `the reef and the narrows never cost anyone anything: ${JSON.stringify(outcomes)}`);
  assert.ok(outcomes.some((o) => o.battles > 0), 'a captain who fights everything fought nothing');
});

// --- the rest of the machine -------------------------------------------------

test('rimward: the theme drops out for a fight and comes back after', () => {
  let checked = false;
  for (const seed of [3, 7, 11, 21, 33, 45]) {
    const game = rimward.create(720, 480, { scores: fakeTable(), seed });
    const drive = player(game);
    drive.tap('a'); drive.tap('a');
    assert.strictEqual(game.music(), 'voyage');
    captain(game, drive, {
      risky: true,
      onScreen: (screen) => { if (screen === 'battle') { assert.strictEqual(game.music(), null); checked = true; } },
    });
    if (checked) { assert.strictEqual(game.music(), 'voyage'); break; }
  }
  assert.ok(checked, 'no fight in six crossings');
});

test('rimward: the pause menu resumes, and can abandon the voyage', () => {
  const { game, drive } = leaveEarth('merchant');
  shop(game, drive, { fuel: 90, rations: 100 });
  choose(game, drive, 'depart');
  drive.step(Math.ceil(rimward.LOAD_TIME / STEP) + 2);
  assert.strictEqual(game.state().screen, 'travel');

  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  check(game, 'paused');
  const day = game.state().day;
  drive.step(60);
  assert.strictEqual(game.state().day, day, 'the calendar ran while paused');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'travel');

  drive.tap('start');
  drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'menu');
});

test('rimward: the travel options show the hold, the crew, and the chart', () => {
  const { game, drive } = leaveEarth('merchant');
  shop(game, drive, { fuel: 90, rations: 100, spares: 2, medkits: 1 });
  choose(game, drive, 'depart');
  drive.step(Math.ceil(rimward.LOAD_TIME / STEP) + 2);
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'options');
  check(game, 'options');

  const open = (id) => {
    const want = rimward.TRAVEL_MENU.findIndex((m) => m.id === id);
    while (game.state().cursor !== want) drive.tap('down');
    drive.tap('a');
  };
  open('supplies');
  assert.strictEqual(game.state().screen, 'supplies');
  check(game, 'supplies');
  drive.tap('b');
  open('crew');
  assert.strictEqual(game.state().screen, 'crew');
  check(game, 'crew');
  drive.tap('b');
  open('chart');
  assert.strictEqual(game.state().screen, 'chart');
  assert.strictEqual(game.state().chartChoose, false);
  check(game, 'chart, under way');
  drive.tap('b');
  assert.strictEqual(game.state().screen, 'travel');

  // Pace and rations are dials, not screens.
  drive.tap('a');
  while (game.state().cursor !== rimward.TRAVEL_MENU.findIndex((m) => m.id === 'pace')) drive.tap('down');
  drive.tap('right');
  assert.strictEqual(game.state().pace, 'burn');
  drive.tap('left'); drive.tap('left');
  assert.strictEqual(game.state().pace, 'coast');
  drive.tap('down');
  drive.tap('right');
  assert.strictEqual(game.state().rations, 'full');
  drive.tap('b');
  assert.strictEqual(game.state().screen, 'travel');
});

test('rimward: the almanac turns its pages', () => {
  const game = rimward.create(720, 480, { scores: fakeTable(), seed: 1 });
  const drive = player(game);
  drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'almanac');
  for (let i = 0; i < rimward.ALMANAC.length; i++) {
    assert.strictEqual(game.state().page, i);
    check(game, `almanac, page ${i + 1}`);
    drive.tap('a');
  }
  assert.strictEqual(game.state().screen, 'menu');
});

test('rimward: word wrap fills lines and never overruns them', () => {
  const lines = rimward.wrap('THE DOCKS ARE OPEN. BUY WHAT YOU CAN, AND THEN SOME MORE, BECAUSE THE RIM IS A LONG WAY OFF.', 20);
  assert.ok(lines.every((l) => l.length <= 20), lines.join('|'));
  assert.ok(lines.length >= 4);
  assert.deepStrictEqual(rimward.wrap('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10), ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ']);
});

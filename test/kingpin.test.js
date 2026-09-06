'use strict';
// Kingpin. The generic checks every game gets are in test/game.test.js; these
// are the ones only a town needs.
//
// Most of them are played rather than asserted, through a walker that reads
// state().at and state().tile and pushes a real Pad -- the same idea as the
// City of Angels playthrough. If a route in here stops working it is because
// the map changed, and the map changing is exactly what these are watching.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const kingpin = require('../src/games/kingpin');
const sceneRenderer = require('../src/gfx/scene');
const input = require('../src/input');
const invariants = require('./invariants');

const {
  TOWN, GLYPH, SOLID, COLS, ROWS, PLACES, CORNERS, DISTRICTS, START,
  GOODS, WEAPONS, SPEECH, FACES, priceAt, paginate, WRAP, LAST_DAY,
} = kingpin;

const FPS = 30;
const STEP = 1 / FPS;

function fakeTable(rows = []) {
  let board = rows.map((row, i) => ({ rank: i + 1, name: row.name, score: row.score }));
  const pad = () => {
    const out = [...board];
    while (out.length < 8) out.push({ rank: out.length + 1, name: 'AAA', score: null });
    return out.map((row, i) => ({ ...row, rank: i + 1 })).slice(0, 8);
  };
  return {
    recorded: [],
    table: () => pad(),
    placing: (game, score) => (score > 0 ? 1 : 0),
    record(game, name, score) { this.recorded.push({ name, score }); return pad(); },
  };
}

const walkable = (col, row) => !SOLID.has(GLYPH[TOWN[row][col]]);

// Breadth-first over the town's tiles. The game does not need this -- nothing
// in it paths -- but a test that has to get to the gun shop does.
function route(from, to) {
  const key = ([c, r]) => `${c},${r}`;
  const prev = new Map([[key(from), null]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift();
    if (at[0] === to[0] && at[1] === to[1]) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [at[0] + dc, at[1] + dr];
      if (next[0] < 0 || next[1] < 0 || next[0] >= COLS || next[1] >= ROWS) continue;
      if (prev.has(key(next)) || !walkable(next[0], next[1])) continue;
      prev.set(key(next), at);
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) return null;
  const out = [];
  for (let at = to; at; at = prev.get(key(at))) out.unshift(at);
  return out;
}

// Drives a game the way somebody with a map would.
function drive(game) {
  const pad = new input.Pad('p1');
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [button, down] of Object.entries(held)) pad.set(button, down);
      game.update(STEP, { p1: pad.read() });
    }
  };
  const tap = (button) => { pad.set(button, true); step(1); pad.set(button, false); step(1); };
  const release = () => { for (const button of input.BUTTONS) pad.set(button, false); step(1); };

  // Everything on screen, read and dismissed.
  const readOn = (limit = 400) => {
    for (let i = 0; i < limit; i++) {
      const state = game.state();
      if (state.cards > 0 || (state.talking > 0 && !state.options.length)) tap('a');
      else break;
    }
  };

  const walkTo = (col, row, budget = 9000) => {
    let frames = 0;
    for (let plan = 0; plan < 60; plan++) {
      const from = game.state().tile;
      const legs = route(from, [col, row]);
      assert.ok(legs, `nothing walks from ${from} to ${col},${row}`);
      let interrupted = false;

      for (const [c, r] of legs.slice(1)) {
        const [tx, ty] = game.centreOf(c, r);
        for (let i = 0; i < 240; i++) {
          const state = game.state();
          if (state.screen !== 'play') { release(); return state.screen; }
          // A card means something happened to you, up to and including being
          // put in the back of a car two districts away. Re-plan from wherever
          // you have ended up.
          if (state.cards > 0 || state.talking > 0) { release(); tap('a'); interrupted = true; break; }
          const [px, py] = state.at;
          if (Math.abs(px - tx) < 5 && Math.abs(py - ty) < 5) break;
          assert.ok(frames++ < budget, `still walking to ${col},${row} after ${budget} frames`);
          step(1, { left: px - tx > 3, right: tx - px > 3, up: py - ty > 3, down: ty - py > 3 });
        }
        release();
        if (interrupted) break;
      }
      if (interrupted) continue;
      const [tx, ty] = game.centreOf(col, row);
      const [px, py] = game.state().at;
      if (Math.abs(px - tx) < 6 && Math.abs(py - ty) < 6) return 'play';
    }
    return game.state().screen;
  };

  const goTo = (placeId) => walkTo(PLACES[placeId].at[0], PLACES[placeId].at[1]);

  // Opens whatever you are standing on and picks the option whose label
  // contains `match`.
  const choose = (match) => {
    for (let i = 0; i < 80 && game.state().talking > 0 && !game.state().options.length; i++) tap('a');
    const options = game.state().options;
    const index = options.findIndex((label) => label.includes(match));
    assert.ok(index >= 0, `no option matching "${match}" in [${options.join(' | ')}]`);
    for (let i = 0; i < index; i++) tap('down');
    tap('a');
  };

  const enter = (placeId, match) => { goTo(placeId); tap('a'); if (match) choose(match); };

  // Opens a place's counter, whatever that place calls it.
  const shop = (placeId) => {
    goTo(placeId);
    tap('a');
    choose(PLACES[placeId].kind === 'armoury' ? 'TRADE IRON' : 'BUSINESS');
    assert.strictEqual(game.state().screen, 'trade', `${placeId} did not open a counter`);
  };

  // Moves the trade cursor onto a good and buys the lot or sells the lot.
  const deal = (placeId, goodId, side) => {
    shop(placeId);
    for (let i = 0; i < PLACES[placeId].sells.indexOf(goodId); i++) tap('down');
    tap(side === 'buy' ? 'a' : 'b');
    tap('start');
  };

  return { pad, step, tap, release, readOn, walkTo, goTo, choose, enter, shop, deal };
}

// Trades up until there is `target` in hand, the way a player would: the best
// pair on the board today, walked. Guns and crews are late-game money and a
// test that wants to reach them has to earn it like everybody else.
function earn(game, pad, target, trips = 8) {
  // A counter that has just been sold thirty units is a counter that is done
  // with you for a while, so this never runs the same errand twice -- which is
  // the same thing the shop depth is teaching a player.
  const spent = new Set();
  for (let trip = 0; trip < trips && game.state().cash < target; trip++) {
    const day = game.state().day;
    const markets = Object.entries(PLACES).filter(([, p]) => p.sells);
    let best = null;
    for (const good of GOODS) {
      for (const [from, fromPlace] of markets) {
        if (!fromPlace.sells.includes(good.id)) continue;
        const buy = priceAt(from, good.id, day);
        if (buy > game.state().cash) continue;
        for (const [to, toPlace] of markets) {
          if (to === from || !toPlace.sells.includes(good.id)) continue;
          if (spent.has(`${good.id}:${from}:${to}`)) continue;
          const rate = (priceAt(to, good.id, day) * 0.94 - buy) / buy;
          if (!best || rate > best.rate) best = { rate, good: good.id, from, to };
        }
      }
    }
    if (!best || best.rate <= 0) break;
    spent.add(`${best.good}:${best.from}:${best.to}`);

    pad.deal(best.from, best.good, 'buy');
    pad.deal(best.to, best.good, 'sell');
  }
  return game.state().cash;
}

function started(options = {}) {
  const game = kingpin.create(720, 480, { scores: fakeTable(), seed: 7, ...options });
  const drive1 = drive(game);
  drive1.tap('a');           // NEW GAME
  drive1.readOn();
  assert.strictEqual(game.state().screen, 'play');
  return { game, drive: drive1 };
}

// --- the town ----------------------------------------------------------------

test('kingpin: every door and every corner can be walked to', () => {
  const problems = [];
  for (const [id, place] of Object.entries(PLACES)) {
    if (!walkable(place.at[0], place.at[1])) problems.push(`${id} is not a tile you can stand on`);
    else if (!route([START.col, START.row], place.at)) problems.push(`${id} cannot be reached`);
  }
  for (const corner of CORNERS) {
    if (!route([START.col, START.row], [corner.col, corner.row])) problems.push(`corner ${corner.col},${corner.row}`);
  }
  assert.deepStrictEqual(problems, []);

  // And a door has to open onto the street rather than into its own building,
  // which is the failure a reachability check on its own would not catch: a
  // door reachable only through another door is a shop inside a shop.
  for (const [id, place] of Object.entries(PLACES)) {
    const [c, r] = place.at;
    const open = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      .filter(([dc, dr]) => walkable(c + dc, r + dr) && GLYPH[TOWN[r + dr][c + dc]] !== '+');
    assert.ok(open.length >= 1, `${id}'s door has nothing outside it`);
  }
});

test('kingpin: the districts cover the town exactly once', () => {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const hits = DISTRICTS.filter((d) => c >= d.from[0] && c <= d.to[0] && r >= d.from[1] && r <= d.to[1]);
      assert.strictEqual(hits.length, 1, `${c},${r} is in ${hits.length} districts`);
    }
  }
});

test('kingpin: the corners are spread across the town, not piled in one district', () => {
  const districts = new Set(CORNERS.map((k) => k.district));
  assert.ok(districts.size >= 3, `corners only exist in ${[...districts].join(', ')}`);
  assert.ok(CORNERS.length >= 6, `${CORNERS.length} corners is not a town`);
});

// --- prices ------------------------------------------------------------------

test('kingpin: a price is a fact about the day, not about what you did', () => {
  const before = priceAt('docks', 'powder', 4);
  const { game, drive: pad } = started();
  pad.goTo('docks');
  pad.tap('a');
  pad.choose('BUSINESS');
  pad.step(1, { right: true });
  pad.step(30, { right: true });
  pad.release();
  assert.ok(game.state().bag.grass > 0, 'bought nothing, so nothing was proved');
  assert.strictEqual(priceAt('docks', 'powder', 4), before, 'trading moved the board price');
  assert.strictEqual(priceAt('docks', 'powder', 4), priceAt('docks', 'powder', 4));
});

test('kingpin: somewhere is always worth the walk, and it is not always the same somewhere', () => {
  const markets = Object.entries(PLACES).filter(([, p]) => p.sells);
  const routes = [];
  for (let day = 1; day <= LAST_DAY; day++) {
    let best = null;
    for (const good of GOODS) {
      for (const [from, fromPlace] of markets) {
        if (!fromPlace.sells.includes(good.id)) continue;
        for (const [to, toPlace] of markets) {
          if (to === from || !toPlace.sells.includes(good.id)) continue;
          const margin = (priceAt(to, good.id, day) * 0.94 - priceAt(from, good.id, day)) / priceAt(from, good.id, day);
          if (!best || margin > best.margin) best = { margin, good: good.id, from, to };
        }
      }
    }
    assert.ok(best.margin > 0.25, `day ${day} has no trade worth making (${(best.margin * 100).toFixed(0)}%)`);
    routes.push(`${best.good}:${best.from}:${best.to}`);
  }
  // A town where the answer is the same every morning is a town with one road.
  assert.ok(new Set(routes).size >= 8, `only ${new Set(routes).size} different trades in a whole run`);
});

test('kingpin: a shop has a bottom, so one enormous sale is not the game', () => {
  const { game, drive: pad } = started();
  pad.goTo('docks');
  pad.tap('a');
  pad.choose('BUSINESS');

  pad.step(1, { right: true });
  pad.step(60, { right: true });   // fill up on grass
  pad.release();
  const held = game.state().bag.grass;
  assert.ok(held >= 10, `only bought ${held}`);

  const first = game.state().cash;
  pad.step(1, { left: true });
  pad.release();
  const one = game.state().cash - first;

  pad.step(1, { left: true });
  pad.step(30, { left: true });
  pad.release();
  const after = game.state().cash;
  pad.step(1, { left: true });
  pad.release();
  const later = game.state().cash - after;

  assert.ok(game.state().bag.grass < held - 6, 'the counter never took the rest');
  assert.ok(later < one, `the tenth unit fetched ${later} against the first at ${one}`);
});

// --- the loop ----------------------------------------------------------------

test('kingpin: buy on the quay, sell where it is wanted, come out ahead', () => {
  // Play the best trade of day one the way a player would find it: look at the
  // board in one shop, walk to another, sell.
  const { game, drive: pad } = started();
  const day = game.state().day;

  let best = null;
  for (const good of GOODS) {
    if (!PLACES.docks.sells.includes(good.id)) continue;
    for (const [to, place] of Object.entries(PLACES)) {
      if (to === 'docks' || !place.sells || !place.sells.includes(good.id)) continue;
      const margin = priceAt(to, good.id, day) * 0.94 - priceAt('docks', good.id, day);
      if (margin > 0 && (!best || margin / priceAt('docks', good.id, day) > best.rate)) {
        best = { good: good.id, to, rate: margin / priceAt('docks', good.id, day) };
      }
    }
  }
  assert.ok(best, 'nothing on the quay was worth moving on day one');

  const before = game.state().cash;
  pad.deal('docks', best.good, 'buy');
  assert.ok(game.state().bag[best.good] > 0, `bought no ${best.good} with ${before}`);
  pad.deal(best.to, best.good, 'sell');

  assert.strictEqual(game.state().bag[best.good], 0, 'the shop did not take it all');
  assert.ok(game.state().cash > before, `walked ${best.good} to ${best.to} and came back with less`);
});

test('kingpin: a crew works a corner, and you have to come back for the money', () => {
  const { game, drive: pad } = started({ seed: 3 });

  earn(game, pad, 2200);
  pad.enter('towers', 'TAKE SOMEBODY ON');
  pad.readOn();
  assert.strictEqual(game.state().crew.length, 1, 'nobody came down the stairs');
  assert.strictEqual(game.state().crew[0].corner, null, 'a new hand starts off duty');

  // And something for them to sell. A hand with nothing is a wage with legs.
  pad.goTo('docks');
  pad.tap('a');
  pad.choose('BUSINESS');
  pad.tap('a');
  pad.tap('start');
  assert.ok(game.state().bag.grass >= 12, `only ${game.state().bag.grass} to hand out`);

  // They follow you to a corner and go to work on it.
  const corner = CORNERS.find((k) => k.district === 'flats') ?? CORNERS[0];
  pad.walkTo(corner.col, corner.row);
  assert.strictEqual(game.state().intent, 'corner', `standing on ${game.state().tile} the pad offers ${game.state().intent}`);
  const carrying = game.state().bag.grass;
  pad.tap('a');
  pad.choose('GRASS');
  pad.readOn();

  const posted = game.state().crew[0];
  assert.notStrictEqual(posted.corner, null, 'nobody went on the corner');
  assert.ok(posted.stock > 0, 'they went out with nothing');
  assert.strictEqual(game.state().bag.grass, carrying - posted.stock,
    'what they went out with did not come out of your bag');

  // Stand back and let them work. The money is theirs until you take it.
  const cashBefore = game.state().cash;
  pad.step(30 * 40);
  const working = game.state().crew[0];
  assert.ok(working, 'the hand vanished');
  assert.ok(working.held > 0, 'forty seconds on a corner and nothing sold');
  assert.ok(working.stock < posted.stock, 'the stock never went down');
  assert.strictEqual(game.state().cash, cashBefore, 'a corner should not pay itself into your pocket');

  const owed = working.held;
  pad.walkTo(corner.col, corner.row);
  pad.tap('a');
  pad.choose('TAKE THE');
  assert.ok(game.state().cash >= cashBefore + owed, 'collecting paid nothing');
  assert.strictEqual(game.state().crew[0].held, 0);
});

test('kingpin: the bicycle is a story unlock, and it makes you quicker', () => {
  const road = [START.col, START.row];
  const plain = started({ seed: 5 });
  assert.strictEqual(plain.game.state().bike, false);
  plain.drive.walkTo(road[0], road[1]);
  const from = plain.game.state().at[0];
  plain.drive.step(45, { right: true });
  plain.drive.release();
  const onFoot = plain.game.state().at[0] - from;
  assert.ok(onFoot > 40, `walking right went nowhere: ${onFoot}`);

  const { game, drive: pad } = started({ seed: 5 });
  pad.enter('bar', 'LISTEN');
  pad.readOn();
  assert.strictEqual(game.state().story.job, 'benny', 'Vito never handed over the parcel');

  const owed = game.state().debt;
  pad.goTo('garage');
  pad.tap('a');
  pad.readOn();
  assert.strictEqual(game.state().bike, true, 'Benny kept the bicycle');
  assert.ok(game.state().debt < owed, 'the errand paid nothing off');
  assert.ok(game.state().capacity > kingpin.BAG, 'the bike carries nothing extra');

  pad.walkTo(road[0], road[1]);
  const start = game.state().at[0];
  pad.step(45, { right: true });
  pad.release();
  const onWheels = game.state().at[0] - start;
  assert.ok(onWheels > onFoot * 1.3, `bike covered ${onWheels} against ${onFoot} on foot`);
});

// --- consequences ------------------------------------------------------------

test('kingpin: killing the town costs you the town', () => {
  const { game, drive: pad } = started({ seed: 4 });
  const before = game.state();
  assert.strictEqual(before.dead, 0);
  const recruitsBefore = before.recruits;
  const demandBefore = before.demand;
  assert.ok(recruitsBefore > 0, 'nobody was available to begin with');

  // Swing at whoever is nearest until the street empties. The bat is enough:
  // this is about what killing does, not about what it is done with.
  let guard = 0;
  while (game.state().dead < 8 && guard++ < 12000) {
    const state = game.state();
    if (state.screen !== 'play') break;
    if (state.cards > 0 || state.talking > 0) { pad.tap('a'); continue; }
    const [px, py] = state.at;
    // The nearest body, chased and hit.
    const target = state.crowd
      .map((p) => [p.x, p.y])
      .sort((a, b) => Math.hypot(a[0] - px, a[1] - py) - Math.hypot(b[0] - px, b[1] - py))[0];
    if (!target) { pad.step(4); continue; }
    const dx = target[0] - px;
    const dy = target[1] - py;
    const close = Math.hypot(dx, dy) < game.TILE * 0.9;
    pad.step(1, {
      left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4, b: close && guard % 4 === 0,
    });
    pad.step(1, { b: false });
  }

  const after = game.state();
  assert.ok(after.dead >= 8, `only killed ${after.dead} in ${guard} frames`);
  assert.ok(after.people < before.people, 'the town is the same size after eight funerals');
  assert.ok(after.demand < demandBefore, `demand held at ${after.demand}`);
  assert.ok(after.recruits < recruitsBefore, `still ${after.recruits} people willing to work for you`);
  assert.ok(after.heat > 40, 'eight bodies and nobody called it in');

  // And it shows up in the money: the same shop pays less for the same thing.
  const clean = kingpin.create(720, 480, { scores: fakeTable(), seed: 4 });
  assert.ok(after.demand < clean.state().demand);
});

test('kingpin: the police can be paid, and the heat comes off', () => {
  const { game, drive: pad } = started({ seed: 9 });
  const heated = () => game.state().heat;
  earn(game, pad, 4000);

  // Running guns is what the town notices, so run some guns.
  pad.deal('docks', 'chops', 'buy');
  pad.deal('pawn', 'chops', 'sell');

  const hot = heated();
  assert.ok(hot > 6, `running guns across town only raised ${hot}`);

  // The collection box first: it takes a little off and buys back some of the
  // town's opinion, which the envelope does not.
  const goodwill = game.state().goodwill;
  pad.enter('church', 'IN THE BOX');
  pad.readOn();
  assert.ok(game.state().goodwill > goodwill, 'the box changed nothing');
  const cooler = heated();
  assert.ok(cooler < hot, `heat sat at ${cooler} after the box`);

  // Then the envelope, which is the blunt instrument and takes the rest.
  const purse = game.state().cash;
  pad.enter('cops', 'ENVELOPE');
  pad.readOn();
  assert.ok(heated() < cooler, `heat sat at ${heated()} after an envelope`);
  assert.strictEqual(game.state().cash, purse - kingpin.BRIBE);
});

test('kingpin: get hot enough and the police come looking', () => {
  const { game, drive: pad } = started({ seed: 12 });
  earn(game, pad, 5000);

  // Run guns back and forth until somebody notices.
  for (let round = 0; round < 3 && game.state().wanted < 1; round++) {
    pad.deal('docks', 'chops', 'buy');
    pad.deal('pawn', 'chops', 'sell');
  }

  let seen = 0;
  for (let i = 0; i < 30 * 60 && game.state().screen === 'play'; i++) {
    pad.step(1);
    seen = Math.max(seen, game.state().foes.filter((f) => f.kind === 'cop').length);
    if (game.state().busts > 0) break;
  }
  assert.ok(game.state().heat > 20, `heat only reached ${game.state().heat}`);
  assert.ok(seen > 0 || game.state().busts > 0, 'nobody in a uniform ever turned up');
});

// --- endings -----------------------------------------------------------------

test('kingpin: a fortnight of sleep ends the run, and the bus ends it better', () => {
  const { game, drive: pad } = started({ seed: 2 });
  for (let day = 1; day <= LAST_DAY + 1 && game.state().screen === 'play'; day++) {
    pad.goTo('room');
    pad.tap('a');
    pad.choose('SLEEP');
    pad.readOn();
  }
  const state = game.state();
  assert.strictEqual(state.screen, 'over');
  assert.strictEqual(state.ending, 'taken', 'day twenty-two came and went');
  assert.ok(state.day > LAST_DAY);

  // The bus is the other way out, and it keeps everything rather than half.
  const runner = started({ seed: 2 });
  for (let day = 1; day <= 3; day++) {
    runner.drive.goTo('room');
    runner.drive.tap('a');
    runner.drive.choose('SLEEP');
    runner.drive.readOn();
  }
  runner.drive.enter('depot', 'TICKET');
  runner.drive.readOn();
  assert.strictEqual(runner.game.state().screen, 'over');
  assert.strictEqual(runner.game.state().ending, 'bus');
  assert.ok(runner.game.state().score > state.score,
    `leaving on the bus scored ${runner.game.state().score} against being taken at ${state.score}`);
});

test('kingpin: a night costs wages and the debt grows', () => {
  const { game, drive: pad } = started({ seed: 6 });
  const owed = game.state().debt;
  pad.goTo('room');
  pad.tap('a');
  pad.choose('SLEEP');
  pad.readOn();
  assert.strictEqual(game.state().day, 2);
  assert.ok(game.state().debt > owed, `Vito is still owed exactly ${game.state().debt}`);
});

// --- the two ways to lose ----------------------------------------------------

// Walks into whoever is trying to hurt you until one of you stops. Vito's
// collectors are the reliable way to be hurt: the police would rather arrest
// you, which is a different ending entirely.
function walkIntoTrouble(game, pad, budget = 30 * 240) {
  for (let i = 0; i < budget && game.state().screen === 'play'; i++) {
    const state = game.state();
    if (state.cards > 0 || state.talking > 0) { pad.tap('a'); continue; }
    const them = state.foes
      .filter((f) => f.kind === 'collector' || f.kind === 'rival')
      .sort((a, b) => Math.hypot(a.x - state.at[0], a.y - state.at[1])
        - Math.hypot(b.x - state.at[0], b.y - state.at[1]))[0];
    if (!them) { pad.step(3); continue; }
    const dx = them.x - state.at[0];
    const dy = them.y - state.at[1];
    pad.step(1, { right: dx > 2, left: dx < -2, down: dy > 2, up: dy < -2 });
  }
  pad.release();
}

test('kingpin: an unpaid debt sends somebody, and going down is not the end of it', () => {
  const { game, drive: pad } = started({ seed: 4 });

  // Never pay him. The interest compounds nightly and eventually two men come
  // and ask about it in person.
  for (let day = 0; day < 12 && game.state().debt <= 1700 && game.state().screen === 'play'; day++) {
    pad.goTo('room');
    pad.tap('a');
    pad.choose('SLEEP');
    pad.readOn();
  }
  assert.ok(game.state().debt > 1700, `the debt only reached ${game.state().debt}`);

  walkIntoTrouble(game, pad);
  assert.strictEqual(game.state().screen, 'died', `still standing after four minutes of it`);
  assert.strictEqual(game.state().health, 0);

  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'kingpin [went down]');

  // The clinic takes half of what you have and puts you back on the street.
  const purse = game.state().cash;
  pad.step(30);
  pad.tap('a');
  pad.readOn();
  const up = game.state();
  assert.strictEqual(up.screen, 'play');
  assert.strictEqual(up.health, 12, 'you get up on your feet, not on your knees');
  assert.ok(up.cash <= Math.round(purse * 0.5), `the clinic charged ${purse - up.cash}`);
  assert.strictEqual(up.district, 'heights', 'the clinic is up the hill and that is where you wake up');

  // And the other way off that screen.
  walkIntoTrouble(game, pad);
  assert.strictEqual(game.state().screen, 'died');
  pad.step(30);
  pad.tap('down');
  pad.tap('a');
  assert.strictEqual(game.state().screen, 'over');
  assert.strictEqual(game.state().ending, 'dead');
});

test('kingpin: four times on the sheet and you do the fortnight inside', () => {
  const { game, drive: pad } = started({ seed: 4 });

  // Make it hot, then stand there and let them take you. Repeatedly.
  for (let i = 0; i < 30 * 900 && game.state().screen === 'play'; i++) {
    const state = game.state();
    if (state.cards > 0 || state.talking > 0) { pad.tap('a'); continue; }
    if (state.heat > 60) { pad.step(2); continue; }
    const [px, py] = state.at;
    const target = state.crowd
      .map((p) => [p.x, p.y])
      .sort((a, b) => Math.hypot(a[0] - px, a[1] - py) - Math.hypot(b[0] - px, b[1] - py))[0];
    if (!target) { pad.step(3); continue; }
    const dx = target[0] - px;
    const dy = target[1] - py;
    const close = Math.hypot(dx, dy) < game.TILE * 0.9;
    pad.step(1, { left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4, b: close && i % 4 === 0 });
    pad.step(1, { b: false });
  }

  const state = game.state();
  assert.strictEqual(state.screen, 'over');
  assert.strictEqual(state.ending, 'prison', `ended ${state.ending} on ${state.busts} arrests`);
  assert.ok(state.busts >= 4, `only ${state.busts} arrests`);

  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'kingpin [prison]');
});

// --- what it looks like ------------------------------------------------------

test('kingpin: every screen a run reaches draws a legal frame', () => {
  const { game, drive: pad } = started({ seed: 8 });
  const check = (label) => {
    const scene = game.scene();
    invariants.legalFrame(scene, sceneRenderer.render(scene), `kingpin [${label}]`);
  };

  check('play, in the street');

  // A conversation, which is the one screen with a face on it.
  pad.goTo('bar');
  pad.tap('a');
  pad.step(6);
  assert.ok(game.state().talking > 0);
  check('talking, with a portrait');
  for (let i = 0; i < 40 && !game.state().options.length; i++) pad.tap('a');
  assert.ok(game.state().options.length, 'the conversation offered nothing to say');
  check('talking, choosing');

  pad.choose('LISTEN');
  for (let i = 0; i < 40 && game.state().talking > 0; i++) pad.tap('a');
  assert.ok(game.state().cards > 0, 'the errand never landed');
  check('a card');
  pad.readOn();

  pad.goTo('docks');
  pad.tap('a');
  pad.choose('BUSINESS');
  assert.strictEqual(game.state().screen, 'trade');
  check('the trade screen');
  pad.tap('a');
  check('the trade screen, holding stock');
  pad.tap('start');

  pad.goTo('room');
  pad.tap('a');
  pad.choose('BOX UNDER');
  assert.strictEqual(game.state().trade.mode, 'stash');
  check('the stash');
  pad.tap('start');

  pad.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  check('paused');
  pad.tap('a');

  // The far end of the map, which is a different set of colours entirely.
  pad.goTo('villa');
  check('play, up the hill');
});

test('kingpin: every word anybody says fits in the box', () => {
  const fresh = {
    day: 1, sold: 0, cash: 400, debt: 1000, health: 12, heat: 0,
    town: { people: 72, dead: 0, copsKilled: 0, goodwill: 0 },
    story: { metVito: false, job: null, bike: false },
  };
  const late = {
    day: LAST_DAY, sold: 90, cash: 9000, debt: 2400, health: 3, heat: 80,
    town: { people: 50, dead: 9, copsKilled: 2, goodwill: 3 },
    story: { metVito: true, job: 'done', bike: true },
  };

  const said = [];
  const push = (who, value) => {
    for (const line of Array.isArray(value) ? value : [value]) said.push([who, line]);
  };

  for (const view of [fresh, late]) {
    for (const [id, fn] of Object.entries(SPEECH.MARKET_TALK)) push(id, fn(view));
    push('arms', SPEECH.ARMS_TALK(view));
    push('cops', SPEECH.COPSHOP_TALK(view));
    push('church', SPEECH.CHURCH_TALK(view));
    push('confession', SPEECH.CONFESSION(view));
    push('clinic', SPEECH.CLINIC_TALK(view));
    push('vito', SPEECH.VITO_TALK(view));
    push('benny', SPEECH.BENNY_TALK(view));
    push('depot', SPEECH.DEPOT_TALK(view));
    push('home', SPEECH.HOME_TALK(view));
    for (const left of [0, 4]) push('towers', SPEECH.TOWERS_TALK(view, left));
    for (const district of DISTRICTS) push('street', SPEECH.STREET_TALK(view, district));
    for (const hand of [{ corner: null, stock: 0, held: 0 }, { corner: 1, stock: 0, held: 0 },
      { corner: 1, stock: 4, held: 1200 }, { corner: 1, stock: 4, held: 10 }]) {
      push('crew', SPEECH.CREW_TALK(view, hand));
    }
  }
  push('arms words', Object.values(SPEECH.ARMS_WORDS));
  push('wants', Object.values(SPEECH.WANT_WORDS));
  push('vito job', SPEECH.VITO_JOB);
  push('benny job', SPEECH.BENNY_JOB);
  push('opening', kingpin.OPENING);
  for (const lines of Object.values(kingpin.ENDING)) push('ending', lines);

  assert.ok(said.length > 60, `only ${said.length} lines in the whole script`);
  for (const [who, line] of said) {
    assert.ok(String(line).trim().length, `${who}: an empty line`);
    for (const page of paginate([line])) {
      assert.ok(page.length <= 3, `${who}: a page of ${page.length} lines`);
      for (const row of page) {
        assert.ok(row.length <= WRAP, `${who}: "${row}" is ${row.length} columns, the box holds ${WRAP}`);
      }
    }
  }

  // The how-to screen is drawn straight rather than wrapped.
  for (const line of kingpin.HOW_TO) {
    assert.ok(line.length <= 44, `how to play: "${line}" is ${line.length} columns`);
  }
  // And everybody who can be talked to has a face to put next to the words.
  for (const [id, place] of Object.entries(PLACES)) {
    if (place.kind === 'home') continue;
    assert.ok(FACES[place.face], `${id} has nobody's face on the door`);
  }
});

test('kingpin: every track it asks for is a score in src/music', () => {
  const music = path.join(__dirname, '..', 'src', 'music');
  const asked = new Set();
  const { game, drive: pad } = started({ seed: 15 });
  asked.add(game.music());                       // daylight

  // After dark, which is a different theme and the reason to go home.
  for (let i = 0; i < 30 * 120 && game.state().screen === 'play'; i++) {
    pad.step(1);
    asked.add(game.music());
    if (asked.size >= 3) break;
  }

  // And the one that plays when they are looking for you.
  earn(game, pad, 4000);
  for (let round = 0; round < 3 && game.state().wanted < 2; round++) {
    pad.deal('docks', 'chops', 'buy');
    pad.deal('pawn', 'chops', 'sell');
    asked.add(game.music());
  }
  asked.add(game.music());

  assert.ok(asked.size >= 2, `only ever asked for ${[...asked].join(', ')}`);
  assert.ok(asked.has('dragnet') || game.state().heat < 55, 'hot and still playing the daytime theme');
  for (const track of asked) {
    assert.ok(track, 'a game screen asked for no music at all');
    assert.ok(fs.existsSync(path.join(music, `${track}.js`)), `no score for "${track}"`);
  }

  // The menu has one too, and the shell plays it before anything starts.
  const fresh = kingpin.create(720, 480, { scores: fakeTable() });
  assert.ok(fs.existsSync(path.join(music, `${fresh.music()}.js`)), `no score for "${fresh.music()}"`);
});

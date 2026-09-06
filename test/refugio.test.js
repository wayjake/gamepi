'use strict';
// Refugio, the town at the end of Border Patrol's dirt road. Reaching it from
// the highway is tested in test/game.test.js; these drive the town module on
// its own, through a walker that reads state().tile and pushes a real Pad --
// the same idea as the Kingpin and City of Angels playthroughs.

const test = require('node:test');
const assert = require('node:assert');

const town = require('../src/games/border/town');
const sceneRenderer = require('../src/gfx/scene');
const png = require('../src/gfx/png');
const input = require('../src/input');
const invariants = require('./invariants');
const { picture } = require('../src/gfx/safearea');
const { PALETTE } = require('../src/gfx/palette');

const { TOWN, GLYPH, SOLID, COLS, ROWS, PLACES, LOCALS, START } = town;

const FPS = 30;
const STEP = 1 / FPS;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function open(seed = 7) {
  const sounds = [];
  const game = town.create(720, 480, { court: picture(720, 480), say: (name) => sounds.push(name), random: rng(seed) });
  return { game, sounds };
}

// What the town draws, as the scene border.js would wrap it in.
function sceneOf(game) {
  const built = game.parts();
  return {
    title: 'Refugio', width: 720, height: 480, background: PALETTE.ink,
    matte: picture(720, 480), matteColour: PALETTE.ink, ink: 3, layers: built.layers, text: built.text,
  };
}
const check = (game, label) => {
  const scene = sceneOf(game);
  invariants.legalFrame(scene, sceneRenderer.render(scene), `refugio [${label}]`);
};

const walkable = (col, row) => !SOLID.has(GLYPH[TOWN[row][col]]);

// Breadth-first over the town's tiles, for a test that has to get somewhere.
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

function drive(game) {
  const pad = new input.Pad('p1');
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [button, down] of Object.entries(held)) pad.set(button, down);
      game.update(STEP, pad.read());
    }
  };
  const tap = (button) => { pad.set(button, true); step(1); pad.set(button, false); step(1); };
  const release = () => { for (const button of input.BUTTONS) pad.set(button, false); step(1); };

  // Everything on screen, read and dismissed -- cards and pages, not choices.
  const readOn = (limit = 100) => {
    for (let i = 0; i < limit; i++) {
      const state = game.state();
      if (state.cards > 0 || (state.talking > 0 && !state.options.length)) tap('a');
      else break;
    }
  };

  const walkTo = (col, row, budget = 6000) => {
    readOn();
    let frames = 0;
    const legs = route(game.state().tile, [col, row]);
    assert.ok(legs, `nothing walks from ${game.state().tile} to ${col},${row}`);
    for (const [c, r] of legs.slice(1)) {
      const [tx, ty] = game.centreOf(c, r);
      for (let i = 0; i < 240; i++) {
        const state = game.state();
        if (state.cards > 0) { release(); readOn(); }
        const [px, py] = state.at;
        if (Math.abs(px - tx) < 4 && Math.abs(py - ty) < 4) break;
        assert.ok(frames++ < budget, `still walking to ${col},${row} after ${budget} frames`);
        step(1, { left: px - tx > 3, right: tx - px > 3, up: py - ty > 3, down: ty - py > 3 });
      }
      release();
    }
  };

  const goTo = (placeId) => walkTo(PLACES[placeId].at[0], PLACES[placeId].at[1]);

  // Reads through the pages and picks the option whose label contains `match`.
  const choose = (match) => {
    for (let i = 0; i < 40 && game.state().talking > 0 && !game.state().options.length; i++) tap('a');
    const options = game.state().options;
    const index = options.findIndex((label) => label.includes(match));
    assert.ok(index >= 0, `no option matching "${match}" in [${options.join(' | ')}]`);
    for (let i = 0; i < index; i++) tap('down');
    tap('a');
  };

  // Waits out a shift or a service and reads the card that follows.
  const waitOut = () => {
    for (let i = 0; i < 600 && (game.state().working || game.state().service); i++) step(1);
    assert.ok(!game.state().working && !game.state().service, 'still at it after twenty seconds');
    readOn();
  };

  return { pad, step, tap, release, readOn, walkTo, goTo, choose, waitOut };
}

// --- the map -----------------------------------------------------------------

test('refugio: the map is the size it says, and every door and person can be reached', () => {
  // The module throws at require time if any of this is wrong; this is the
  // same walk done in the open, so a failure says where.
  assert.strictEqual(TOWN.length, ROWS);
  for (const line of TOWN) assert.strictEqual(line.length, COLS);
  for (const [id, place] of Object.entries(PLACES)) {
    assert.strictEqual(TOWN[place.at[1]][place.at[0]], '+', `${id}'s door is not a door`);
    assert.ok(route([START.col, START.row], place.at), `${id} cannot be walked to`);
    assert.ok(walkable(place.at[0], place.at[1] + 1) || walkable(place.at[0], place.at[1] - 1),
      `${id}'s door opens onto nothing`);
  }
  for (const who of LOCALS) {
    assert.ok(walkable(who.at[0], who.at[1]), `${who.name} starts inside something`);
    assert.ok(route([START.col, START.row], who.at), `${who.name} cannot be walked to`);
  }
  // Only one way in, and it is closed.
  const edges = [...TOWN[ROWS - 1]].filter((ch) => ch === 'x').length;
  assert.strictEqual(edges, 3, 'the road out is not three tiles wide');
});

// --- doors -------------------------------------------------------------------

test('refugio: every door opens a conversation with somebody', () => {
  const { game } = open();
  const pad = drive(game);
  for (const [id, place] of Object.entries(PLACES)) {
    pad.goTo(id);
    assert.strictEqual(game.state().intent, 'place', `at ${id} the button offers "${game.state().hint}"`);
    assert.strictEqual(game.state().hint, place.name);
    pad.tap('a');
    assert.ok(game.state().talking > 0, `${id} said nothing`);
    check(game, `talking at ${id}`);
    for (let i = 0; i < 40 && game.state().talking > 0 && !game.state().options.length; i++) pad.tap('a');
    if (game.state().options.length) {
      check(game, `choosing at ${id}`);
      pad.tap('b');
    }
    assert.strictEqual(game.state().talking, 0, `${id} would not let go`);
  }
});

test('refugio: a shift pays its wage once a day, and the day is what brings it back', () => {
  const { game, sounds } = open();
  const pad = drive(game);
  const diner = PLACES.diner;

  pad.goTo('diner');
  pad.tap('a');
  pad.choose(diner.offer);
  assert.strictEqual(game.state().working, 'diner');
  check(game, 'working');
  pad.waitOut();
  assert.strictEqual(game.state().cash, diner.wage, `paid ${game.state().cash} for a ${diner.wage} shift`);
  assert.strictEqual(game.state().trust, town.SHIFT_TRUST);
  assert.strictEqual(game.state().shifts, 1);
  assert.ok(sounds.includes('coin'), 'no sound of money');
  const clock = game.state().clock;

  // Not twice.
  pad.tap('a');
  for (let i = 0; i < 40 && game.state().talking > 0 && !game.state().options.length; i++) pad.tap('a');
  assert.ok(!game.state().options.some((o) => o.includes(diner.offer)), 'a second shift was offered the same day');
  pad.tap('b');
  assert.ok(game.state().clock >= clock, 'time went backwards');

  // Every job pays, and each is its own once-a-day.
  pad.goTo('garage');
  pad.tap('a');
  pad.choose(PLACES.garage.offer);
  pad.waitOut();
  pad.goTo('orchard');
  pad.tap('a');
  pad.choose(PLACES.orchard.offer);
  pad.waitOut();
  assert.strictEqual(game.state().cash, diner.wage + PLACES.garage.wage + PLACES.orchard.wage);
  assert.strictEqual(game.state().shifts, 3);

  // Sleep, and the diner wants you again.
  pad.goTo('house');
  pad.tap('a');
  pad.choose('SLEEP');
  pad.readOn();
  assert.strictEqual(game.state().day, 2);
  assert.strictEqual(game.state().clock, 0);
  assert.deepStrictEqual(game.state().tile, [PLACES.house.at[0], PLACES.house.at[1] + 1], "you did not wake up at Rosa's");
  pad.goTo('diner');
  pad.tap('a');
  pad.choose(diner.offer);
  pad.waitOut();
  assert.strictEqual(game.state().shifts, 4);
});

test('refugio: a service is worth more than a shift, and only once a day', () => {
  const { game, sounds } = open();
  const pad = drive(game);
  pad.goTo('church');
  pad.tap('a');
  pad.choose('SERVICE');
  assert.ok(game.state().service, 'the service never started');
  check(game, 'in a service');
  pad.waitOut();
  assert.strictEqual(game.state().trust, town.SERVICE_TRUST);
  assert.ok(town.SERVICE_TRUST > town.SHIFT_TRUST);
  assert.strictEqual(game.state().cash, 0, 'the church paid you');
  assert.ok(sounds.includes('bell'));

  pad.tap('a');
  for (let i = 0; i < 40 && game.state().talking > 0 && !game.state().options.length; i++) pad.tap('a');
  assert.ok(!game.state().options.some((o) => o.includes('SERVICE')), 'a second service the same day');
  pad.tap('b');
});

test('refugio: everybody can be met, and knows you the second time', () => {
  const { game } = open();
  const pad = drive(game);
  for (const who of LOCALS) {
    // Wanderers wander, so aim at where they are now and try again if they
    // have stepped away by the time you get there. Once you are beside one
    // they hold still, which is what makes the last attempt stick.
    for (let attempt = 0; attempt < 8 && game.state().who !== who.id; attempt++) {
      const here = game.state().people.find((p) => p.id === who.id);
      pad.walkTo(Math.floor(here.x / game.TILE), Math.floor(here.y / game.TILE));
    }
    assert.strictEqual(game.state().who, who.id, `beside ${who.name} the button offers "${game.state().hint}"`);
    assert.strictEqual(game.state().hint, 'SAY HELLO');
    pad.tap('a');
    assert.ok(game.state().talking > 0);
    check(game, `meeting ${who.name}`);
    pad.readOn();
    assert.ok(game.state().met.includes(who.id));

    if (game.state().who === who.id) {
      assert.strictEqual(game.state().hint, `TALK TO ${who.name}`);
      pad.tap('a');
      assert.ok(game.state().talking > 0, `${who.name} had nothing to say the second time`);
      pad.readOn();
    }
  }
  assert.strictEqual(game.state().met.length, LOCALS.length);
  assert.strictEqual(game.state().trust, LOCALS.length * town.MEET_TRUST, 'meeting people again counted twice');
});

test('refugio: nobody stays out all night', () => {
  const { game } = open();
  const pad = drive(game);
  pad.readOn();
  pad.step(Math.ceil(town.DAY_LENGTH * FPS) + 2);
  assert.strictEqual(game.state().day, 2);
  assert.strictEqual(game.state().card, 'DAY 2');
  pad.readOn();
  assert.deepStrictEqual(game.state().tile, [PLACES.house.at[0], PLACES.house.at[1] + 1]);
});

// --- drawing -----------------------------------------------------------------

test('refugio: the first frame is legal, and so is one with the camera moved', () => {
  const { game } = open();
  const pad = drive(game);
  check(game, 'arriving');
  pad.readOn();
  check(game, 'the road in');
  pad.walkTo(16, 9);
  check(game, 'the plaza');
  pad.walkTo(3, 2);
  check(game, 'the top corner');
});

test('refugio: drawing has no side effects, and the same seed draws the same town', () => {
  const a = open(5);
  const b = open(5);
  const other = open(6);
  const script = (game) => {
    const pad = drive(game);
    pad.readOn();
    pad.step(30, { up: true });
    pad.step(30, { up: false, right: true });
    pad.step(60, { right: false });
  };
  script(a.game);
  script(b.game);
  script(other.game);

  const before = JSON.stringify(a.game.state());
  const first = png.encode(sceneRenderer.render(sceneOf(a.game)));
  const second = png.encode(sceneRenderer.render(sceneOf(a.game)));
  assert.ok(first.equals(second), 'drawing twice drew two different pictures');
  assert.strictEqual(JSON.stringify(a.game.state()), before, 'drawing moved the town on');

  assert.ok(first.equals(png.encode(sceneRenderer.render(sceneOf(b.game)))), 'the same seed drew a different town');
  assert.ok(!first.equals(png.encode(sceneRenderer.render(sceneOf(other.game)))), 'the seed changes nothing');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const shell = require('../src/shell');
const sceneRenderer = require('../src/gfx/scene');
const input = require('../src/input');
const invariants = require('./invariants');
const manifest = require('../src/manifest');
const { PALETTE } = require('../src/gfx/palette');

const GAMES = path.join(__dirname, '..', 'src', 'games');
const STEP = 1 / 30;

const emptyBoard = () => Array.from({ length: 8 }, (_, i) => ({ rank: i + 1, name: 'AAA', score: null }));
const fakeTable = () => ({ table: () => emptyBoard(), placing: () => 0, record: () => emptyBoard() });

function driver(machine) {
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) machine.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
  };
  const tap = (button, pad = 'p1') => {
    pads[pad].set(button, true); step(1);
    pads[pad].set(button, false); step(1);
  };
  const hold = (buttons, seconds) => {
    for (const b of buttons) pads.p1.set(b, true);
    step(Math.ceil(seconds / STEP));
  };
  const release = (buttons) => {
    for (const b of buttons) pads.p1.set(b, false);
    step(1);
  };
  return { pads, step, tap, hold, release };
}

const toSelect = (machine) => {
  const drive = driver(machine);
  drive.step(150);
  assert.strictEqual(machine.state().screen, 'select');
  return drive;
};

test('the machine boots on its own, and start skips the wait', () => {
  const slow = shell.create(720, 480, { scores: fakeTable() });
  const drive = driver(slow);
  drive.step(2);
  assert.strictEqual(slow.state().screen, 'boot');
  drive.step(150);
  assert.strictEqual(slow.state().screen, 'select');

  const quick = shell.create(720, 480, { scores: fakeTable() });
  const impatient = driver(quick);
  impatient.step(3);
  impatient.tap('start');
  assert.strictEqual(quick.state().screen, 'select');
});

test('the selector offers every game in src/games', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const onDisk = fs.readdirSync(GAMES).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
  assert.deepStrictEqual(machine.state().games, onDisk);
  assert.ok(onDisk.length >= 2, 'the selector is only interesting with more than one game');

  // Everything it lists has to be drawable in it.
  for (const entry of machine.catalogue) {
    assert.ok(entry.title, `${entry.id} has no title`);
    assert.ok(typeof entry.emblem === 'function', `${entry.id} has no emblem for the selector`);
    assert.ok(Array.isArray(entry.emblem({ x: 0, y: 0, w: 100, h: 60 })), `${entry.id}'s emblem drew nothing`);
  }
});

test('the boot and selector screens draw legal frames', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = driver(machine);

  drive.step(4);
  let scene = machine.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'shell [boot]');

  drive.step(150);
  scene = machine.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'shell [select]');

  // And with the cursor moved, in case the highlight is what breaks it.
  drive.tap('down');
  scene = machine.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'shell [select, second row]');
});

test('choosing a game runs it, and the shell draws what it draws', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);
  drive.tap('a');

  const state = machine.state();
  assert.strictEqual(state.screen, 'playing');
  assert.ok(state.game, 'nothing was launched');
  assert.ok(state.inner, 'the running game has no state');
  assert.strictEqual(state.inner.screen, 'menu', 'a game starts at its own menu');

  const scene = machine.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), `shell [playing ${state.game}]`);
});

// The point of an OS-level quit is that it is the same everywhere, including
// from inside a game that is busy doing something else.
test('holding start and select leaves a game, and a tap does not', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);
  drive.tap('a');
  assert.strictEqual(machine.state().screen, 'playing');

  drive.tap('start');
  assert.strictEqual(machine.state().screen, 'playing', 'a tap of start left the game');

  drive.hold(['start', 'select'], shell.QUIT_HOLD / 2);
  assert.strictEqual(machine.state().screen, 'playing', 'it left before the hold was up');
  assert.ok(machine.state().quitHeld > 0, 'the hold is not being counted');

  drive.release(['start', 'select']);
  assert.strictEqual(machine.state().quitHeld, 0, 'letting go did not cancel it');

  drive.hold(['start', 'select'], shell.QUIT_HOLD + 0.2);
  assert.strictEqual(machine.state().screen, 'select', 'holding both did not leave the game');
  assert.strictEqual(machine.state().game, null);
});

// The pad this console has a spare button on: one press, straight back to the
// shelf, no hold. Nothing else in the machine is allowed to want it.
test('the star button leaves a game on its own', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);
  drive.tap('a');
  assert.strictEqual(machine.state().screen, 'playing');

  drive.tap('home');
  assert.strictEqual(machine.state().screen, 'select', 'the star did not leave the game');
  assert.strictEqual(machine.state().game, null);
  assert.strictEqual(machine.state().quitHeld, 0);

  // And it is inert on the shelf: there is nothing to go back to from here.
  const cursor = machine.state().cursor;
  drive.tap('home');
  assert.strictEqual(machine.state().screen, 'select');
  assert.strictEqual(machine.state().cursor, cursor);
});

test('a game sees nothing while the quit combo is being held', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);
  drive.tap('a');

  const before = machine.state().inner.cursor;
  drive.hold(['start', 'select', 'down'], shell.QUIT_HOLD / 2);
  assert.strictEqual(machine.state().inner.cursor, before,
    'the game acted on the buttons being used to leave it');
});

test('the quit indicator is drawn over whatever the game is showing', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);
  drive.tap('a');

  const plain = machine.scene();
  drive.hold(['start', 'select'], shell.QUIT_HOLD / 2);
  const holding = machine.scene();

  assert.ok(holding.layers.length > plain.layers.length, 'nothing was added over the game');
  invariants.legalFrame(holding, sceneRenderer.render(holding), 'shell [quitting]');
});

// Every game, not just the first: the star and the hold are the shell's, but a
// player who has never read the footer still has to be able to get back from
// the menu in front of them, and one game without the entry breaks the shelf.
test('every game can hand itself back through its own menu', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);

  for (const id of machine.state().games) {
    machine.launch(id);
    assert.strictEqual(machine.state().inner.screen, 'menu', `${id} did not start at its menu`);

    const module = require(path.join(GAMES, id));
    const quit = module.MENU.findIndex((entry) => entry.id === 'quit');
    assert.ok(quit >= 0, `${id}'s menu has no way back to the shell`);
    for (let i = 0; i < quit; i++) drive.tap('down');
    drive.tap('a');

    assert.strictEqual(machine.state().screen, 'select', `QUIT in ${id}'s menu did not reach the shell`);
    assert.strictEqual(machine.state().game, null);
  }
});

// The shelf card: the row you are on says who it is for and what it is made
// of, and only that row -- the others have no room for it at a readable size.
test('the selected row shows its manifest, and the others do not', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = toSelect(machine);

  const said = () => machine.scene().text.map((t) => t.text);
  const tagsOf = (entry) => manifest.tags(entry.meta);

  for (let i = 0; i < machine.catalogue.length; i++) {
    const entry = machine.catalogue[i];
    assert.strictEqual(machine.state().cursor, i);
    const labels = said();
    for (const tag of tagsOf(entry)) {
      assert.ok(labels.includes(tag), `${entry.id}'s row is missing ${JSON.stringify(tag)}`);
    }
    // The rating is coloured by what it is, so a parent can find it at a glance.
    const rating = machine.scene().text.find((t) => t.text === tagsOf(entry)[1]);
    assert.strictEqual(rating.fill, PALETTE[shell.RATING_INK[entry.meta.rating]], `${entry.id}'s rating is the wrong colour`);

    // The rows beside it stay shut.
    const others = machine.catalogue.filter((e) => e !== entry);
    const shut = others.map((e) => tagsOf(e)[0]).filter((t) => !tagsOf(entry).includes(t));
    for (const tag of shut) assert.ok(!labels.includes(tag), `a row that is not selected shows ${JSON.stringify(tag)}`);

    const scene = machine.scene();
    invariants.legalFrame(scene, sceneRenderer.render(scene), `shell [select, ${entry.id} open]`);
    drive.tap('down');
  }
});

test('the shell plays the attract theme, and hands music over to a game', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  assert.strictEqual(machine.music(), 'attract');
  const drive = toSelect(machine);
  assert.strictEqual(machine.music(), 'attract');

  drive.tap('a');
  assert.notStrictEqual(machine.music(), undefined, 'a running game must say what it wants playing');
});

test('sounds from the shell and the running game both come out', () => {
  const machine = shell.create(720, 480, { scores: fakeTable() });
  const drive = driver(machine);
  drive.step(60);
  assert.ok(machine.drain().includes('beep'), 'the boot check should beep');
  assert.deepStrictEqual(machine.drain(), [], 'sounds came back twice');

  drive.step(120);
  drive.tap('a');
  drive.tap('down'); // the game's own cursor
  assert.ok(machine.drain().includes('move'), "the running game's sounds are being dropped");
});

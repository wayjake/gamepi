'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const manifest = require('../src/manifest');

const GAMES = path.join(__dirname, '..', 'src', 'games');
const ok = { players: [1], rating: 'pg', audio: '8-bit', graphics: '2d' };

// The shelf card every game carries. It is checked here as well as in
// shell.list() because a game is allowed to be loaded without the shell.
for (const file of fs.readdirSync(GAMES).filter((f) => f.endsWith('.js'))) {
  const name = file.replace(/\.js$/, '');
  const module = require(path.join(GAMES, file));

  test(`${name}: has a manifest that adds up`, () => {
    const meta = manifest.validate(module.meta, name);
    assert.ok(manifest.summary(meta).length <= 40, 'a summary has to fit across the picture');

    // Most of a manifest is a claim about the game that only a person can
    // check. One of them isn't: a 3D game is exactly a game that draws through
    // gfx/scene3d.js, so that one is held to the code.
    const source = fs.readFileSync(path.join(GAMES, file), 'utf8');
    assert.strictEqual(meta.graphics.startsWith('3d'), /require\('\.\.\/gfx\/scene3d'\)/.test(source),
      `${name} says ${meta.graphics} but its requires say otherwise`);
  });
}

test('a manifest has to say all four things', () => {
  for (const field of manifest.FIELDS) {
    const missing = { ...ok };
    delete missing[field];
    assert.throws(() => manifest.validate(missing, 'x'), new RegExp(`meta.${field} is missing`));
  }
  assert.throws(() => manifest.validate(undefined, 'x'), /no meta/);
  assert.throws(() => manifest.validate({ ...ok, extra: 1 }, 'x'), /not a manifest field/);
});

test('every value comes off a known list', () => {
  assert.throws(() => manifest.validate({ ...ok, rating: 'M' }, 'x'), /meta.rating/);
  assert.throws(() => manifest.validate({ ...ok, audio: 'mp3' }, 'x'), /meta.audio/);
  assert.throws(() => manifest.validate({ ...ok, graphics: 'vector' }, 'x'), /meta.graphics/);
  assert.throws(() => manifest.validate({ ...ok, players: [] }, 'x'), /meta.players/);
  assert.throws(() => manifest.validate({ ...ok, players: [1, 4] }, 'x'), /meta.players/);
});

test('players are sorted and deduplicated, and the manifest is frozen', () => {
  const meta = manifest.validate({ ...ok, players: [2, 1, 2] }, 'x');
  assert.deepStrictEqual([...meta.players], [1, 2]);
  assert.throws(() => { meta.rating = 'nsfw'; }, TypeError);
});

// A rating is a claim about a game, and a claim nobody can account for is one
// that gets argued with instead of trusted.
test('anything above PG has to say what makes it that', () => {
  assert.throws(() => manifest.validate({ ...ok, rating: 'nsfw' }, 'x'), /has to say why/);
  assert.throws(() => manifest.validate({ ...ok, rating: '13', content: [] }, 'x'), /has to say why/);
  assert.throws(() => manifest.validate({ ...ok, content: 'guns' }, 'x'), /meta.content/);
  assert.ok(manifest.validate({ ...ok, rating: '13', content: ['fighting'] }, 'x'));
});

test('a summary reads as a shelf card', () => {
  assert.strictEqual(
    manifest.summary(manifest.validate({ players: [1, 2], rating: '13', audio: 'wav', graphics: '3d-low', content: ['x'] }, 'x')),
    '1-2 PLAYERS  13+  SAMPLED  3D LOW POLY');
  assert.strictEqual(manifest.summary(manifest.validate(ok, 'x')), '1 PLAYER  PG  8-BIT  2D');
  assert.deepStrictEqual(manifest.tags(manifest.validate(ok, 'x')), ['1 PLAYER', 'PG', '8-BIT', '2D']);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The real module writes to ~/.gamepi. GAMEPI_HOME redirects it, and the module
// reads that at require time, so each run gets its own directory.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gamepi-scores-'));
process.env.GAMEPI_HOME = HOME;
const scores = require('../src/scores');

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const names = (rows) => rows.map((r) => `${r.name}:${r.score === null ? '-' : r.score}`).join(' ');

test('a cold board is full, and every row on it is empty', () => {
  const rows = scores.table('nothing-played');
  assert.strictEqual(rows.length, scores.KEEP);
  assert.ok(rows.every((r) => r.score === null), names(rows));
  assert.deepStrictEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
});

// An empty row used to carry a zero, which is the *best* possible score the
// moment the ordering flips -- a fresh golf board would have read as eight
// rounds of nothing.
test('an empty row is never better than a real one, either way round', () => {
  scores.record('bothways', 'AAA', 10);
  for (const lower of [false, true]) {
    const rows = scores.table('bothways', { lower });
    assert.strictEqual(rows[0].score, 10, `lower=${lower}: ${names(rows)}`);
    assert.ok(rows.slice(1).every((r) => r.score === null));
  }
});

test('a bigger number wins by default', () => {
  scores.record('high', 'AAA', 100);
  scores.record('high', 'BBB', 300);
  scores.record('high', 'CCC', 200);
  assert.deepStrictEqual(scores.table('high').slice(0, 3).map((r) => r.name), ['BBB', 'CCC', 'AAA']);
});

test('a smaller number wins when the game says so', () => {
  const low = { lower: true };
  scores.record('low', 'AAA', 6, low);
  scores.record('low', 'BBB', 3, low);
  scores.record('low', 'CCC', 9, low);
  assert.deepStrictEqual(scores.table('low', low).slice(0, 3).map((r) => r.name), ['BBB', 'AAA', 'CCC']);
});

test('you have to beat a score, not match it', () => {
  scores.record('ties', 'AAA', 50);
  assert.strictEqual(scores.placing('ties', 51), 1);
  assert.strictEqual(scores.placing('ties', 50), 2, 'a tie took the place above');
  assert.strictEqual(scores.placing('ties', 49), 2);

  const low = { lower: true };
  scores.record('lowties', 'AAA', 5, low);
  assert.strictEqual(scores.placing('lowties', 4, low), 1);
  assert.strictEqual(scores.placing('lowties', 5, low), 2);
  assert.strictEqual(scores.placing('lowties', 6, low), 2);
});

test('a score of nothing never makes the board', () => {
  assert.strictEqual(scores.placing('zero', 0), 0);
  assert.strictEqual(scores.placing('zero', -5), 0);
  assert.strictEqual(scores.placing('zero', NaN), 0);
  // ...but zero strokes is not a thing either, so golf agrees.
  assert.strictEqual(scores.placing('zero', 0, { lower: true }), 0);
});

test('the board keeps only its top rows', () => {
  for (let i = 1; i <= scores.KEEP + 6; i++) scores.record('busy', 'AAA', i * 10);
  const rows = scores.table('busy');
  assert.strictEqual(rows.length, scores.KEEP);
  assert.strictEqual(rows[0].score, (scores.KEEP + 6) * 10);
  assert.ok(rows.every((r) => r.score !== null));
});

test('games do not share a board', () => {
  scores.record('one', 'AAA', 11);
  scores.record('two', 'BBB', 22);
  assert.strictEqual(scores.table('one')[0].score, 11);
  assert.strictEqual(scores.table('two')[0].score, 22);
});

test('initials are three characters from a set the font can draw', () => {
  const rows = scores.record('names', 'jakeson', 999);
  assert.strictEqual(rows[0].name, 'JAK');
  for (const ch of scores.ALPHABET) assert.strictEqual(ch.length, 1);
  assert.ok(scores.ALPHABET.includes('A') && scores.ALPHABET.includes('Z') && scores.ALPHABET.includes('0'));
});

// The table is on disk, and a machine that has been switched off badly should
// not be a machine that refuses to boot.
test('a corrupt table reads as an empty one rather than throwing', () => {
  fs.writeFileSync(scores.FILE, '{ this is not json');
  assert.doesNotThrow(() => scores.table('anything'));
  assert.ok(scores.table('anything').every((r) => r.score === null));

  // And writing over it puts things right again.
  scores.record('anything', 'AAA', 7);
  assert.strictEqual(scores.table('anything')[0].score, 7);
});

test('the table lives outside the repo, where a deploy cannot delete it', () => {
  assert.ok(!scores.DIR.includes(path.join('Work', 'gamePi')) || scores.DIR.startsWith(os.tmpdir()),
    `${scores.DIR} is inside the working tree, which deploy.sh rsyncs with --delete`);
});

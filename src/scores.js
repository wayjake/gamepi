'use strict';
// The high score table, kept outside the repo on purpose.
//
// scripts/deploy.sh rsyncs with --delete, so anything stored inside the working
// tree is wiped on the next deploy -- which is exactly the moment you'd least
// want to lose the table. ~/.gamepi survives.
//
// Golf is why every function takes `{ lower }`: in pong a bigger number is a
// better round and in golf it is a worse one. Empty rows carry a null score
// rather than a zero, because a zero would be the best score on the board the
// moment the ordering flipped.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.GAMEPI_HOME ?? path.join(os.homedir(), '.gamepi');
const FILE = path.join(DIR, 'scores.json');
const KEEP = 8;

// Arcade initials: three characters, all of which exist in the font.
const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-'];
const DEFAULT_NAME = 'AAA';

const empty = () => ({ name: DEFAULT_NAME, score: null, at: null });

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing is normal on a fresh machine; corrupt is not, but a scoreboard is
    // not worth refusing to boot over.
    return {};
  }
}

// Best first, and an unset row is never better than a real one.
const order = (lower) => (a, b) => {
  if (a.score === null) return b.score === null ? 0 : 1;
  if (b.score === null) return -1;
  return lower ? a.score - b.score : b.score - a.score;
};

// Always KEEP rows, so the table draws the same whether or not anyone has
// played yet -- an arcade cabinet shows a full board on a cold start.
function table(game, { lower = false } = {}) {
  const rows = (read()[game] ?? [])
    .filter((row) => row && typeof row.score === 'number')
    .map((row) => ({
      name: String(row.name ?? DEFAULT_NAME).slice(0, 3).toUpperCase(),
      score: Math.max(0, Math.floor(row.score)),
      at: row.at ?? null,
    }));

  while (rows.length < KEEP) rows.push(empty());
  rows.sort(order(lower));
  return rows.slice(0, KEEP).map((row, i) => ({ ...row, rank: i + 1 }));
}

// Where a score would land, or 0 if it wouldn't make the board. Ties go to the
// score already there -- you have to beat it, not match it.
function placing(game, score, { lower = false } = {}) {
  // Zero is not a round in either direction: pong's tally is zero for a versus
  // match, and nobody holes out in no strokes.
  if (!Number.isFinite(score) || score <= 0) return 0;
  const rows = table(game, { lower });
  const better = (a, b) => (b === null ? true : lower ? a < b : a > b);
  const index = rows.findIndex((row) => better(score, row.score));
  return index === -1 ? 0 : index + 1;
}

function record(game, name, score, { lower = false } = {}) {
  const rows = table(game, { lower }).filter((row) => row.score !== null);
  rows.push({ name: String(name).slice(0, 3).toUpperCase(), score, at: new Date().toISOString() });
  rows.sort(order(lower));

  const all = read();
  all[game] = rows.slice(0, KEEP).map(({ name: n, score: s, at }) => ({ name: n, score: s, at }));
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n');
  return table(game, { lower });
}

module.exports = { table, placing, record, ALPHABET, DEFAULT_NAME, KEEP, FILE, DIR };

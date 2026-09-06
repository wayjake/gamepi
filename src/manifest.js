'use strict';
// What a game *is*, as opposed to what it does.
//
// The game contract in CLAUDE.md says what a game must be able to *do* --
// update, scene, drain, music, state. This is the other half: the shelf card.
// Every game module exports a `meta` object beside its title and emblem saying
// how many can play, who it is for, what it sounds like and what it looks like,
// and this file is the only place the allowed answers are written down.
//
// It is a package.json for a cartridge, and it exists for the same reason one
// does: the shell already discovers games by filename, so anything that wants
// to sort, filter or describe them -- `--list`, a future menu that hides the
// grown-up ones, box art on the selector -- has to be able to ask a game about
// itself rather than know a list of them by heart.
//
// A bad value throws at load, like every other contract here (angels' ROOMS,
// kingpin's PLACES, song.validate). A game with a manifest nobody can read is
// worse than a game with none: it would sit in the selector claiming to be
// something it isn't.

// How many can play at once. A game lists every count it supports, so [1, 2]
// is one or two and [2] would be a game that needs two.
const PLAYERS = [1, 2];

// Three steps, because three is what a shelf needs: fine for anyone, fine for
// most, and one you would rather nobody stumbled into from the selector.
const RATINGS = ['pg', '13', 'nsfw'];

// Where the sound comes from. Everything here is `8-bit` today -- rendered as
// PCM in JS by audio/synth.js -- and `wav` is for the day something ships a
// recorded sample, which is a different answer to "can this run with no files".
const AUDIO = ['8-bit', 'wav'];

// What the picture is made of. `3d-low` is flat-shaded triangles off
// gfx/scene3d.js; `3d-high` is nothing yet and would need a renderer that does
// not exist. Isometric games are 2d: gfx/iso.js paints diamonds into a canvas.
const GRAPHICS = ['2d', '3d-low', '3d-high'];

const FIELDS = ['players', 'rating', 'audio', 'graphics'];

// What each value is called on screen. The renderer's font has no lower case
// worth using, so these are the shapes a label actually takes.
const LABELS = {
  rating: { pg: 'PG', 13: '13+', nsfw: 'NSFW' },
  audio: { '8-bit': '8-BIT', wav: 'SAMPLED' },
  graphics: { '2d': '2D', '3d-low': '3D LOW POLY', '3d-high': '3D' },
};

function oneOf(value, allowed, field, where) {
  if (!allowed.includes(value)) {
    throw new Error(`${where}: meta.${field} is ${JSON.stringify(value)}, not one of ${allowed.join(', ')}`);
  }
}

// Returns the manifest, checked and frozen. `where` is the game's id, so a
// message names the file to open.
function validate(meta, where = 'a game') {
  if (!meta || typeof meta !== 'object') throw new Error(`${where}: no meta -- see src/manifest.js`);

  for (const field of FIELDS) {
    if (meta[field] === undefined) throw new Error(`${where}: meta.${field} is missing`);
  }
  for (const field of Object.keys(meta)) {
    if (!FIELDS.includes(field) && field !== 'content') throw new Error(`${where}: meta.${field} is not a manifest field`);
  }

  if (!Array.isArray(meta.players) || !meta.players.length) {
    throw new Error(`${where}: meta.players is a list of the player counts it supports, e.g. [1, 2]`);
  }
  const players = [...new Set(meta.players)].sort((a, b) => a - b);
  for (const count of players) oneOf(count, PLAYERS, 'players', where);

  oneOf(meta.rating, RATINGS, 'rating', where);
  oneOf(meta.audio, AUDIO, 'audio', where);
  oneOf(meta.graphics, GRAPHICS, 'graphics', where);

  // Why it is rated what it is, in a few words. Optional on a PG game and
  // required above it: a rating nobody can account for gets argued with.
  const content = meta.content ?? [];
  if (!Array.isArray(content) || content.some((c) => typeof c !== 'string' || !c)) {
    throw new Error(`${where}: meta.content is a list of short strings, e.g. ['gun violence']`);
  }
  if (meta.rating !== 'pg' && !content.length) {
    throw new Error(`${where}: meta.rating is ${meta.rating}, so meta.content has to say why`);
  }

  return Object.freeze({ players: Object.freeze(players), rating: meta.rating, audio: meta.audio, graphics: meta.graphics, content: Object.freeze([...content]) });
}

// The four things a shelf card says, as they read on screen, in the order
// they are said: players, rating, sound, picture. The selector draws them one
// at a time so the rating can take its own colour; --list joins them.
function tags(meta) {
  const players = meta.players.length > 1
    ? `${meta.players[0]}-${meta.players[meta.players.length - 1]} PLAYERS`
    : `${meta.players[0]} PLAYER${meta.players[0] > 1 ? 'S' : ''}`;
  return [players, LABELS.rating[meta.rating], LABELS.audio[meta.audio], LABELS.graphics[meta.graphics]];
}

// The one-line version, for --list.
function summary(meta) {
  return tags(meta).join('  ');
}

module.exports = { validate, tags, summary, PLAYERS, RATINGS, AUDIO, GRAPHICS, FIELDS, LABELS };

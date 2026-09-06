'use strict';
// The bit that isn't a game: boot, the game selector, and one way out.
//
// Everything a player sees before they choose something lives here, and so
// does the rule that they can always get back. Games own their own menus,
// scores and pause screens; the shell owns the machine.
//
// It presents the same interface a game does -- update, scene, drain, music,
// state -- so src/game.js drives it with exactly the code that used to drive
// pong, and stage.js still has no idea what it is running.

const fs = require('fs');
const path = require('path');

const { PALETTE } = require('./gfx/palette');
const { picture } = require('./gfx/safearea');
const scores = require('./scores');
const manifest = require('./manifest');
const input = require('./input');
const psf = require('./psf');

const GAMES = path.join(__dirname, 'games');
const ASSETS = path.join(__dirname, '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz'));

// Boot check. It is theatre, but it is honest theatre -- every line reports
// something the machine actually is.
const BOOT_LINES = [
  (w, h) => `FRAMEBUFFER ${w}X${h} 16BPP     OK`,
  () => 'COMPOSITE NTSC 480I           OK',
  () => 'SAFE AREA CALIBRATED          OK',
  () => 'AUDIO 44100 STEREO            OK',
  () => 'PAD 1                         OK',
];
const BOOT_STEP = 0.42;
const BOOT_HOLD = 0.7;

// Hold both for this long to leave a game. Long enough that it can't happen by
// accident during a rally, short enough that nobody has to look it up twice.
const QUIT_HOLD = 0.9;

// A row on the shelf is a title and a blurb. The selected row opens up to
// show its manifest as well -- players, rating, sound, picture -- because at a
// scale the CRT can read there is no room for a third line on every row, and
// the row you are on is the one you are asking about. Three rows fit either
// way: one open and two shut is exactly what three of the old height was.
const ROW_H = 88;
const OPEN_H = 136;
const VISIBLE_ROWS = 3;

// The rating is the one tag that colours a decision, so it gets a colour.
const RATING_INK = { pg: 'moss', 13: 'sun', nsfw: 'ember' };

function list(dir = GAMES) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const module = require(path.join(dir, f));
      const id = f.replace(/\.js$/, '');
      return {
        id,
        title: module.title ?? f,
        blurb: module.blurb ?? '',
        accent: module.accent ?? 'sun',
        emblem: module.emblem ?? null,
        lower: module.lowerIsBetter === true,
        // Throws on a game whose shelf card doesn't add up, at the moment the
        // machine finds it rather than the moment somebody picks it.
        meta: manifest.validate(module.meta, id),
        module,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const table = options.scores ?? scores;
  const catalogue = options.games ?? list();
  if (!catalogue.length) throw new Error('no games in src/games');

  const sounds = [];
  const say = (name) => sounds.push(name);

  const shell = {
    screen: 'boot',
    elapsed: 0,
    cursor: 0,
    top: 0,          // first visible row, for when there are more than fit
    booted: 0,
    quitHeld: 0,     // how long START+SELECT has been down
    running: null,   // the live game
    playing: null,   // its catalogue entry
  };

  const go = (screen) => { shell.screen = screen; shell.elapsed = 0; };

  function launch(entry) {
    shell.playing = entry;
    shell.running = entry.module.create(width, height, {
      scores: table,
      seed: options.seed,
    });
    shell.quitHeld = 0;
    go('playing');
  }

  function leave() {
    shell.running = null;
    shell.playing = null;
    shell.quitHeld = 0;
    go('select');
  }

  // --- the step -------------------------------------------------------------

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    shell.elapsed += dt;

    switch (shell.screen) {
      case 'boot': {
        const shown = Math.min(BOOT_LINES.length, Math.floor(shell.elapsed / BOOT_STEP));
        while (shell.booted < shown) { shell.booted++; say('beep'); }
        const done = shell.elapsed >= BOOT_LINES.length * BOOT_STEP + BOOT_HOLD;
        if (done || any.pressed.start || any.pressed.a) { shell.cursor = 0; go('select'); }
        break;
      }

      case 'select': {
        if (any.pressed.up) { shell.cursor = (shell.cursor + catalogue.length - 1) % catalogue.length; say('move'); }
        if (any.pressed.down) { shell.cursor = (shell.cursor + 1) % catalogue.length; say('move'); }
        shell.top = Math.max(Math.min(shell.top, shell.cursor), shell.cursor - (VISIBLE_ROWS - 1));
        if (any.pressed.a || any.pressed.start) { say('select'); launch(catalogue[shell.cursor]); }
        break;
      }

      case 'playing': {
        // The short way out, for a pad that has a button spare: the star beside
        // START on an 8BitDo, the guide on an X-input pad. It is an edge rather
        // than a hold because it is one button and no game is allowed to want
        // it -- there is nothing to disambiguate it from.
        if (any.pressed.home) { say('back'); leave(); break; }

        // And the long way out, for a pad that hasn't. The reason it is here
        // rather than in each game: it has to work the same everywhere,
        // including in a game that has hung on its own menu. While the combo is
        // down the game is fed nothing, so it can't act on the buttons being
        // used to leave it.
        const quitting = any.start && any.select;
        if (quitting) {
          shell.quitHeld += dt;
          if (shell.quitHeld >= QUIT_HOLD) { say('back'); leave(); }
          else shell.running.update(dt, { p1: input.idle(), p2: input.idle() });
          break;
        }
        shell.quitHeld = 0;

        shell.running.update(dt, { p1, p2 });
        if (shell.running.state().exit) { say('back'); leave(); }
        break;
      }

      default:
        throw new Error(`unknown shell screen: ${shell.screen}`);
    }
  }

  // --- drawing --------------------------------------------------------------

  const text = (body, x, y, opts = {}) => ({
    text: body, x: Math.round(x), y: Math.round(y),
    scale: opts.scale ?? 2, anchor: opts.anchor ?? 'middle',
    fill: opts.fill ?? PALETTE.cream, font: opts.font ?? FONT,
  });

  const centred = (body, y, opts = {}) => {
    const font = opts.font ?? FONT;
    const scale = opts.scale ?? 2;
    return text(body, mid.x, y - (font.height * scale) / 2, { ...opts, font, scale });
  };

  const rect = (x, y, w, h, fill) =>
    ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });

  function bootScreen() {
    const shown = Math.min(BOOT_LINES.length, Math.floor(shell.elapsed / BOOT_STEP));
    const lines = BOOT_LINES.slice(0, shown).map((line, i) =>
      text(line(width, height), court.x + 30, court.y + 120 + i * 32, { anchor: 'start', fill: PALETTE.moss }));

    const total = BOOT_LINES.length * BOOT_STEP + BOOT_HOLD;
    const done = Math.min(1, shell.elapsed / total);
    const barW = court.w - 60;

    return {
      layers: [{ flat: true, shapes: [
        rect(court.x + 30, court.y + court.h - 70, barW, 18, PALETTE.bark),
        rect(court.x + 30, court.y + court.h - 70, Math.max(4, barW * done), 18, PALETTE.moss),
      ] }],
      text: [
        centred('GAMEPI', court.y + 60, { scale: 2, font: HEAVY }),
        ...lines,
        ...(done >= 1 ? [centred('READY', court.y + court.h - 110, { scale: 2, fill: PALETTE.sun })] : []),
      ],
    };
  }

  function selectScreen() {
    const shapes = [rect(court.x + 40, court.y + 70, court.w - 80, 4, PALETTE.bark)];
    const labels = [centred('GAMEPI', court.y + 46, { scale: 2, font: HEAVY, fill: PALETTE.cream })];

    const rows = catalogue.slice(shell.top, shell.top + VISIBLE_ROWS);
    let y = court.y + 88;
    rows.forEach((entry, i) => {
      const index = shell.top + i;
      const selected = index === shell.cursor;
      const h = selected ? OPEN_H : ROW_H;
      const accent = PALETTE[entry.accent] ?? PALETTE.sun;

      // The selected row is a filled bar in the game's own colour; the rest are
      // outlines. One glance tells you where you are and what you are on.
      if (selected) {
        shapes.push(rect(court.x + 24, y, court.w - 48, h - 16, accent));
        shapes.push(rect(court.x + 28, y + 4, court.w - 56, h - 24, PALETTE.ink));
      } else {
        shapes.push(rect(court.x + 24, y, court.w - 48, 3, PALETTE.bark));
      }

      // The emblem is the game's own drawing, boxed. Box art, in other words.
      const card = { x: court.x + 44, y: y + 14, w: 108, h: 60 };
      shapes.push(rect(card.x - 3, card.y - 3, card.w + 6, card.h + 6, selected ? accent : PALETTE.bark));
      shapes.push(rect(card.x, card.y, card.w, card.h, PALETTE.ink));
      if (entry.emblem) shapes.push(...entry.emblem(card));

      // The heavy font is 16x32, so scale 1 is already 32px tall. At scale 2 the
      // title ran straight through the line under it.
      const textX = card.x + card.w + 26;
      labels.push(text(entry.title, textX, y + 12, {
        anchor: 'start', scale: 1, font: HEAVY, fill: selected ? accent : PALETTE.cream,
      }));
      labels.push(text(entry.blurb, textX, y + 46, { anchor: 'start', scale: 2, fill: PALETTE.bark }));

      // On the title's line, not the blurb's -- they collided at the widths a
      // long blurb reaches. The word BEST went the same way: a five-digit score
      // beside a title as long as BORDER PATROL had nowhere left to sit, and a
      // number in the game's colour on the shelf does not need labelling.
      const best = table.table(entry.id, { lower: entry.lower })[0];
      if (best && best.score !== null) {
        labels.push(text(`${best.score} ${best.name}`, court.x + court.w - 44, y + 12,
          { anchor: 'end', scale: 2, fill: PALETTE.moss }));
      }

      // The manifest, on the open row only. It runs from the card's left edge
      // rather than the title's because the longest line (3D LOW POLY, with
      // two players) is 33 characters, and at the scale the CRT reads that is
      // wider than the title column. One text shape per tag, so the rating can
      // be coloured; the gap between them is two characters, as in --list.
      if (selected) {
        const tags = manifest.tags(entry.meta);
        const gap = FONT.width * 2 * 2;
        let x = card.x;
        tags.forEach((tag, k) => {
          const fill = k === 1 ? PALETTE[RATING_INK[entry.meta.rating]] : k === 0 ? PALETTE.cream : PALETTE.bark;
          labels.push(text(tag, x, y + 84, { anchor: 'start', scale: 2, fill }));
          x += tag.length * FONT.width * 2 + gap;
        });
      }

      y += h;
    });

    // 40 characters is what fits across the picture at this size.
    labels.push(centred('A PLAYS  ·  STAR OR START+SELECT QUITS',
      court.y + court.h - 26, { scale: 2, fill: PALETTE.bark }));

    return { layers: [{ flat: true, shapes }], text: labels };
  }

  // Drawn over whatever the game is showing, so it is visible from inside a
  // rally as much as from a menu.
  function quitOverlay() {
    const done = Math.min(1, shell.quitHeld / QUIT_HOLD);
    const w = 300;
    const x = mid.x - w / 2;
    const y = court.y + court.h - 96;
    return {
      layers: [{ flat: true, shapes: [
        rect(x - 10, y - 34, w + 20, 74, PALETTE.ink),
        rect(x, y, w, 14, PALETTE.bark),
        rect(x, y, Math.max(3, w * done), 14, PALETTE.sun),
      ] }],
      text: [centred('LEAVING', y - 18, { scale: 2, fill: PALETTE.sun })],
    };
  }

  function scene() {
    if (shell.screen === 'playing') {
      const inner = shell.running.scene();
      if (shell.quitHeld <= 0) return inner;
      const over = quitOverlay();
      return {
        ...inner,
        layers: [...inner.layers, ...over.layers],
        text: [...(inner.text ?? []), ...over.text],
      };
    }

    const { layers, text: labels } = shell.screen === 'boot' ? bootScreen() : selectScreen();
    return {
      title: `gamePi (${shell.screen})`,
      width,
      height,
      background: PALETTE.ink,
      matte: court,
      matteColour: PALETTE.ink,
      font: FONT,
      layers,
      text: labels,
    };
  }

  return {
    update,
    scene,
    drain() {
      const mine = sounds.splice(0, sounds.length);
      const theirs = shell.running ? shell.running.drain() : [];
      return [...mine, ...theirs];
    },
    music() {
      return shell.screen === 'playing' ? shell.running.music() : 'attract';
    },
    state() {
      return {
        screen: shell.screen,
        cursor: shell.cursor,
        game: shell.playing?.id ?? null,
        quitHeld: shell.quitHeld,
        games: catalogue.map((entry) => entry.id),
        ...(shell.running ? { inner: shell.running.state() } : {}),
      };
    },
    // For src/game.js --game X, which skips the selector while developing.
    launch(id) {
      const entry = catalogue.find((e) => e.id === id);
      if (!entry) throw new Error(`unknown game: ${id}`);
      launch(entry);
    },
    catalogue,
  };
}

module.exports = { create, list, BOOT_LINES, QUIT_HOLD, VISIBLE_ROWS, RATING_INK };

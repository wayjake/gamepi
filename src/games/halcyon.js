'use strict';
// HALCYON -- three long pieces, and the desk they are played on.
//
// Every other game on this shelf uses sound the way a game does: a bed loops
// under the screen you are on, and hits fire on top of it. This one is the
// other way round. The music is the thing, ten minutes of it in three
// movements, generated note by note as it plays (src/audio/piece.js) through a
// synthesiser built for warmth rather than for a cartridge (src/audio/rack.js),
// and what you *do* is stand at the desk and take parts out of it.
//
// Two decisions shape the whole file:
//
//  - **The arrangement and the desk are different things.** A section of the
//    piece scores certain parts; your switches then mute or unmute them. A part
//    that is switched on but not scored plays nothing and says so. That way the
//    structure of the piece survives being played with -- you are mixing it, not
//    composing it -- and you can hear what the piece meant by putting everything
//    back on.
//  - **The picture is drawn from the notes, not from the samples.** See
//    halcyon/view.js. It means the visual moves identically whether or not
//    anything is listening, which is what lets the tests check it and what makes
//    --mute free.
//
// Nothing here posts a score. There is nothing to win; the shelf card says so.

const fs = require('fs');
const path = require('path');
const { textWidth } = require('../canvas');
const { PALETTE, WASH } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const input = require('../input');
const psf = require('../psf');
const pieceLib = require('../audio/piece');
const rackLib = require('../audio/rack');
const viewLib = require('./halcyon/view');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz'));

const GAME = 'halcyon';

// Pieces are discovered by filename, like scenes, tracks and games: drop a
// file in src/music/pieces and it is on the menu. They are loaded here rather
// than when one is chosen, so a piece that does not add up throws when the
// shell finds the game instead of when somebody presses A on it.
const PIECE_DIR = path.join(__dirname, '..', 'music', 'pieces');
const PIECE_IDS = fs.readdirSync(PIECE_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
const PIECES = PIECE_IDS.map((id) => pieceLib.load(require(path.join(PIECE_DIR, id))));

const MENU = [
  ...PIECES.map((piece, i) => ({ id: PIECE_IDS[i], label: piece.title, piece: i })),
  { id: 'how', label: 'HOW TO LISTEN' },
  { id: 'quit', label: 'QUIT' },
];

const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'FROM THE TOP' },
  { id: 'quit', label: 'BACK TO THE SHELF' },
];

const HOW_TO = [
  'TEN MINUTES. THREE MOVEMENTS.',
  'EIGHT PARTS, AND ALL OF THEM YOURS.',
  '',
  'LEFT RIGHT   ALONG THE ROW',
  'UP   DOWN    BETWEEN THE ROWS',
  'A            SWITCH THE PART OFF',
  'B            SOLO IT',
  'START        STOP THE TAPE',
  '',
  'ON THE TOP ROW, A AND B TURN THE',
  'KNOB: HOW MUCH ROOM, HOW WORN THE',
  'TAPE, AND WHICH MOVEMENT PLAYS.',
  '',
  'A PART THE PIECE IS NOT ASKING FOR',
  'STAYS DARK UNTIL IT IS.',
];

// The desk. The top row is three knobs, the bottom row is the parts.
const KNOBS = [
  { id: 'space', label: 'ROOM' },
  { id: 'tape', label: 'TAPE' },
  { id: 'move', label: 'PART' },
];
const KNOB_STEPS = 5;

function create(width, height, options = {}) {
  const court = picture(width, height);
  const seed = options.seed ?? 1;

  // The layout, top to bottom, adding up to the picture rectangle exactly:
  // the head, the movement strip, the window the piece is drawn in, the line
  // that says what A does, the knobs and the parts.
  const HEAD = { x: court.x, y: court.y, w: court.w, h: 36 };
  const STRIP = { x: court.x, y: court.y + 38, w: court.w, h: 5 };
  const VIEW = { x: court.x, y: court.y + 48, w: court.w, h: 228 };
  const HINT = court.y + 282;
  const CTRL = { x: court.x, y: court.y + 300, w: court.w, h: 34 };
  const RACK = { x: court.x + 1, y: court.y + 340, w: court.w - 2, h: 100 };
  const CELL = { w: 78, gap: 2 };

  const game = {
    screen: 'menu',
    exit: false,
    cursor: 0,
    pause: 0,
    chosen: 0,        // which piece the menu is sitting on
    row: 1,           // 0 knobs, 1 parts
    col: 0,
    solo: null,
    knobs: { space: 2, tape: 2, move: 0 },
    t: 0,
    rig: null,
    view: null,
    piece: null,
  };

  // --- the tape --------------------------------------------------------------

  // One rack at a time. Opening a new one is how a piece starts, and how the
  // menu changes what it is previewing when the cursor moves.
  function mount(index, from, level) {
    const piece = PIECES[index];
    game.piece = piece;
    game.rig = rackLib.open(piece, { seed: piece.seed, fps: 30 });
    game.rig.space = game.knobs.space / 2;
    game.rig.tape = game.knobs.tape / 2;
    game.rig.output = level;
    if (from) game.rig.seek(from);
    game.view = viewLib.create({ view: VIEW, wash: WASH[piece.colour] ?? WASH.dawn, seed });
    game.solo = null;
    game.knobs.move = game.rig.where().index;
    return game.rig;
  }

  // The menu plays whatever the cursor is on, from the busiest part of it. It
  // is a record shop listening post: you choose by ear, not by reading titles.
  function preview() {
    const entry = MENU[game.cursor];
    if (entry.piece === undefined) {
      if (game.rig) game.rig.output = 0;
      return;
    }
    if (game.chosen === entry.piece && game.rig && game.screen === 'menu') return;
    game.chosen = entry.piece;
    mount(entry.piece, PIECES[entry.piece].taster ?? 0, 0.42);
  }

  function levels() {
    return game.rig ? game.rig.levels : {};
  }

  const stems = () => (game.piece ? game.piece.stems : []);

  // --- input -----------------------------------------------------------------

  function menuInput(pad) {
    if (pad.pressed.up) { game.cursor = (game.cursor + MENU.length - 1) % MENU.length; preview(); }
    if (pad.pressed.down) { game.cursor = (game.cursor + 1) % MENU.length; preview(); }
    if (!pad.pressed.a) return;

    const entry = MENU[game.cursor];
    if (entry.id === 'quit') { game.exit = true; return; }
    if (entry.id === 'how') { game.screen = 'how'; if (game.rig) game.rig.output = 0.2; return; }
    mount(entry.piece, 0, 1);
    game.row = 1;
    game.col = 0;
    game.t = 0;
    game.screen = 'play';
  }

  function knob(id, by) {
    if (id === 'move') {
      const movements = game.piece.movements;
      const now = game.rig.where().index;
      const wanted = Math.min(movements.length - 1, Math.max(0, now + by));
      // Down from the top of a movement means the start of the one before it;
      // down from the middle means the start of this one. That is what every
      // machine with a track button does, and it is what a hand expects.
      const into = game.rig.at - movements[now].start;
      const target = by < 0 && into > 6 ? now : wanted;
      game.rig.seek(movements[target].start);
      game.knobs.move = target;
      return;
    }
    game.knobs[id] = Math.min(KNOB_STEPS - 1, Math.max(0, game.knobs[id] + by));
    game.rig.space = game.knobs.space / 2;
    game.rig.tape = game.knobs.tape / 2;
  }

  // Solo is a view of the desk, not a change to it: coming out of solo puts
  // every switch back where it was, because otherwise soloing the drums for
  // eight bars would quietly wipe out a mix you had spent five minutes on.
  function applySolo() {
    for (const name of stems()) {
      const wanted = game.solo === null ? (game.desk[name] ? 1 : 0) : (name === game.solo ? 1 : 0);
      game.rig.set(name, wanted);
    }
  }

  function playInput(pad) {
    if (pad.pressed.start) { game.screen = 'paused'; game.pause = 0; return; }

    const row = game.row;
    const length = row === 0 ? KNOBS.length : stems().length;
    if (pad.pressed.left) game.col = (game.col + length - 1) % length;
    if (pad.pressed.right) game.col = (game.col + 1) % length;
    if (pad.pressed.up || pad.pressed.down) {
      game.row = row === 0 ? 1 : 0;
      const to = game.row === 0 ? KNOBS.length : stems().length;
      game.col = Math.min(game.col, to - 1);
    }

    if (row === 0) {
      if (pad.pressed.a) knob(KNOBS[game.col].id, 1);
      if (pad.pressed.b) knob(KNOBS[game.col].id, -1);
      return;
    }

    const name = stems()[game.col];
    if (pad.pressed.a) {
      if (game.solo !== null) game.solo = null;
      game.desk[name] = !game.desk[name];
      applySolo();
    }
    if (pad.pressed.b) {
      game.solo = game.solo === name ? null : name;
      applySolo();
    }
  }

  function pausedInput(pad) {
    if (pad.pressed.up) game.pause = (game.pause + PAUSE_MENU.length - 1) % PAUSE_MENU.length;
    if (pad.pressed.down) game.pause = (game.pause + 1) % PAUSE_MENU.length;
    if (pad.pressed.start) { game.screen = 'play'; return; }
    if (!pad.pressed.a) return;
    switch (PAUSE_MENU[game.pause].id) {
      case 'resume': game.screen = 'play'; break;
      case 'restart': game.rig.seek(0); game.screen = 'play'; break;
      default:
        game.screen = 'menu';
        game.cursor = game.chosen;
        mount(game.chosen, PIECES[game.chosen].taster ?? 0, 0.42);
        break;
    }
  }

  // --- the frame -------------------------------------------------------------

  game.desk = {};

  function update(dt, pads) {
    const pad = input.merge(pads.p1 ?? input.idle(), pads.p2 ?? input.idle());
    game.t += dt;

    switch (game.screen) {
      case 'menu': menuInput(pad); break;
      case 'how': if (pad.pressed.a || pad.pressed.b || pad.pressed.start) { game.screen = 'menu'; preview(); } break;
      case 'play': playInput(pad); break;
      case 'paused': pausedInput(pad); break;
      default: // 'end'
        if (pad.pressed.a) {
          game.screen = 'menu';
          game.cursor = game.chosen;
          mount(game.chosen, PIECES[game.chosen].taster ?? 0, 0.42);
        }
        break;
    }

    if (!game.rig) preview();
    if (!game.rig) return;

    // The rack only runs where the picture is running. Pausing lets the tails
    // ring out rather than cutting them, because rig.output is a fade.
    const listening = game.screen === 'play' || game.screen === 'menu' || game.screen === 'end';
    game.rig.output = game.screen === 'play' ? 1 : game.screen === 'menu' ? 0.42 : game.screen === 'how' ? 0.2 : 0;
    if (listening || game.screen === 'how') {
      const fired = game.rig.advance(dt);
      if (game.view) game.view.update(dt, game.rig, fired);
      if (game.rig.done && game.screen === 'play') game.screen = 'end';
    } else {
      game.rig.advance(0);
      if (game.view) game.view.update(dt, game.rig, []);
    }
    game.knobs.move = game.rig.where().index;
  }

  // --- drawing ---------------------------------------------------------------

  const text = (body, x, y, opts = {}) => ({ text: body, x: Math.round(x), y: Math.round(y), ...opts });
  const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), fill });
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const centred = (body, y, opts = {}) => text(body, court.x + court.w / 2, y, { anchor: 'middle', ...opts });

  // A box drawn as four bars rather than one outline: the renderer has no
  // stroke, and four bars is also the only way to keep every edge thick enough
  // that an interlaced field can hold it.
  function frame(x, y, w, h, weight, fill) {
    return [
      rect(x, y, w, weight, fill), rect(x, y + h - weight, w, weight, fill),
      rect(x, y, weight, h, fill), rect(x + w - weight, y, weight, h, fill),
    ];
  }

  function head() {
    const where = game.rig.where();
    const wash = WASH[game.piece.colour] ?? WASH.dawn;
    const shapes = [];
    const labels = [
      text(game.piece.title, HEAD.x, HEAD.y + 2, { font: HEAVY, scale: 1, fill: wash[4], anchor: 'start' }),
      text(where.name, HEAD.x + court.w, HEAD.y + 2, { anchor: 'end', scale: 1, fill: PALETTE.cream }),
      text(where.section, HEAD.x + court.w, HEAD.y + 19, { anchor: 'end', scale: 1, fill: wash[3] }),
      // Measured off the title rather than at a fixed offset: NORTHLIGHT is
      // three characters longer than the other two and ran straight through
      // the clock.
      text(`${clock(game.rig.at)} / ${clock(game.piece.duration)}   ${where.chord}`,
        HEAD.x + textWidth(HEAVY, game.piece.title, 1) + 14, HEAD.y + 12,
        { anchor: 'start', scale: 1, fill: PALETTE.bark }),
    ];

    // The strip: one segment per movement, the played part filled in. Ten
    // minutes is long enough that "where am I" has to be answerable at a glance.
    let at = STRIP.x;
    game.piece.movements.forEach((movement, i) => {
      const span = ((movement.end - movement.start) / game.piece.duration) * (STRIP.w - 8);
      const through = Math.max(0, Math.min(1, (game.rig.at - movement.start) / (movement.end - movement.start)));
      shapes.push(rect(at, STRIP.y, span, STRIP.h, i === where.index ? wash[1] : wash[0]));
      if (through > 0) shapes.push(rect(at, STRIP.y, span * through, STRIP.h, wash[3]));
      at += span + 4;
    });
    return { shapes, labels };
  }

  function desk() {
    const shapes = [];
    const labels = [];
    const wash = WASH[game.piece.colour] ?? WASH.dawn;
    const scored = game.rig.scored;

    // The knobs.
    const knobW = Math.floor((CTRL.w - 2 * KNOBS.length) / KNOBS.length);
    KNOBS.forEach((entry, i) => {
      const x = CTRL.x + i * (knobW + 2);
      const picked = game.row === 0 && game.col === i;
      shapes.push(rect(x, CTRL.y, knobW, CTRL.h, wash[0]));
      if (picked) shapes.push(...frame(x, CTRL.y, knobW, CTRL.h, 2, PALETTE.sun));

      const value = entry.id === 'move'
        ? ['I', 'II', 'III', 'IV'][game.knobs.move] ?? '-'
        : null;
      labels.push(text(entry.label, x + 10, CTRL.y + 9, { scale: 1, anchor: 'start', fill: picked ? PALETTE.sun : PALETTE.bark }));
      if (value !== null) {
        labels.push(text(value, x + knobW - 12, CTRL.y + 9, { scale: 1, anchor: 'end', fill: PALETTE.cream }));
      } else {
        for (let k = 0; k < KNOB_STEPS; k++) {
          const lit = k <= game.knobs[entry.id];
          shapes.push(rect(x + knobW - 18 - (KNOB_STEPS - 1 - k) * 13, CTRL.y + 10, 9, 14, lit ? wash[3] : wash[1]));
        }
      }
    });

    // The parts.
    stems().forEach((name, i) => {
      const x = RACK.x + i * (CELL.w + CELL.gap);
      const on = (game.rig.levels[name] ?? 0) > 0;
      const asked = scored.has(name);
      const picked = game.row === 1 && game.col === i;
      const meter = game.rig.meters[name] ?? 0;

      shapes.push(rect(x, RACK.y, CELL.w, RACK.h, wash[0]));

      // The bar is what the part is doing right now; the block behind it is how
      // tall it could be. A part switched on but not scored shows an empty
      // frame, which is the answer to "why can I not hear it".
      const barH = Math.round((RACK.h - 46) * meter);
      if (barH > 1) shapes.push(rect(x + 6, RACK.y + (RACK.h - 30) - barH, CELL.w - 12, barH, on ? wash[4] : wash[1]));
      // The signal light: lit when the arrangement is asking for this part.
      // Unlit with the switch still up is the answer to "why can I not hear
      // it" -- it is not your doing, the piece is not playing it yet.
      shapes.push(rect(x + 6, RACK.y + 5, CELL.w - 12, 5, asked ? (on ? wash[4] : wash[2]) : wash[1]));

      shapes.push(rect(x, RACK.y + RACK.h - 22, CELL.w, 22, on ? wash[2] : wash[0]));
      if (picked) shapes.push(...frame(x, RACK.y, CELL.w, RACK.h, 2, PALETTE.sun));
      if (game.solo === name) shapes.push(...frame(x + 3, RACK.y + 3, CELL.w - 6, RACK.h - 6, 2, PALETTE.ember));

      labels.push(text(pieceLib.STEM_LABEL[name] ?? name, x + CELL.w / 2, RACK.y + RACK.h - 19, {
        anchor: 'middle', scale: 1, fill: on ? PALETTE.cream : PALETTE.bark,
      }));
    });

    // What A does here, spelled out, the way every other game on this shelf
    // prints its one action.
    const hint = game.row === 0
      ? `A  MORE ${KNOBS[game.col].label}       B  LESS`
      : `A  ${(game.rig.levels[stems()[game.col]] ?? 0) > 0 ? 'MUTE' : 'UNMUTE'} ${pieceLib.STEM_LABEL[stems()[game.col]]}      B  SOLO`;
    labels.push(centred(hint, HINT, { scale: 1, fill: PALETTE.bark }));
    return { shapes, labels };
  }

  function playScreen() {
    const top = head();
    const bottom = desk();
    return {
      layers: [
        ...game.view.layers(game.rig),
        { flat: true, shapes: [...top.shapes, ...bottom.shapes] },
      ],
      text: [...top.labels, ...bottom.labels],
    };
  }

  function pausedScreen() {
    const under = playScreen();
    const plate = { x: court.x + 150, y: court.y + 140, w: court.w - 300, h: 170 };
    return {
      layers: [
        // The whole picture as one faded layer: the dither breaks up runs
        // anyway, and a scratch copy per layer is the expensive way to do it.
        { flat: true, alpha: 0.4, shapes: under.layers.flatMap((layer) => layer.shapes) },
        { flat: true, shapes: [rect(plate.x, plate.y, plate.w, plate.h, PALETTE.ink), ...frame(plate.x, plate.y, plate.w, plate.h, 3, PALETTE.cream)] },
      ],
      text: [
        centred('STOPPED', plate.y + 18, { scale: 2, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((entry, i) => centred(entry.label, plate.y + 68 + i * 28, {
          scale: 1, fill: i === game.pause ? PALETTE.cream : PALETTE.bark,
        })),
      ],
    };
  }

  function menuScreen() {
    const wash = WASH[PIECES[game.chosen].colour] ?? WASH.dawn;
    const shapes = [];
    const labels = [
      text('HALCYON', court.x + 24, court.y + 16, { font: HEAVY, scale: 1, anchor: 'start', fill: wash[4] }),
      text('THREE PIECES FOR A LONG EVENING', court.x + 24, court.y + 54, { scale: 1, anchor: 'start', fill: PALETTE.bark }),
    ];

    // A band of the chosen piece's wash down the right, and its parts moving in
    // it: the menu is already the instrument, quietly.
    for (let k = 0; k < 5; k++) {
      shapes.push(rect(court.x + court.w - 150, court.y + 16 + k * 34, 150, 34, wash[4 - k]));
    }
    if (game.rig) {
      stems().forEach((name, i) => {
        const meter = game.rig.meters[name] ?? 0;
        const h = Math.round(6 + meter * 74);
        shapes.push(rect(court.x + court.w - 140 + i * 17, court.y + 200 - h, 13, h, wash[(i % 2) + 3]));
      });
    }

    MENU.forEach((entry, i) => {
      const y = court.y + 92 + i * 62;
      const picked = i === game.cursor;
      const piece = entry.piece === undefined ? null : PIECES[entry.piece];
      if (picked) shapes.push(rect(court.x + 24, y - 6, court.w - 200, piece ? 66 : 30, wash[1]));
      labels.push(text(entry.label, court.x + 34, y, {
        scale: piece ? 2 : 1, fill: picked ? PALETTE.cream : PALETTE.bark,
      }));
      if (piece) {
        labels.push(text(`${piece.subtitle ?? ''}`, court.x + 36, y + 26, { scale: 1, fill: picked ? wash[3] : PALETTE.bark }));
        labels.push(text(`${clock(piece.duration)}`, court.x + court.w - 176, y + 4, { anchor: 'end', scale: 1, fill: picked ? PALETTE.sun : PALETTE.bark }));
        if (picked) {
          labels.push(text(piece.movements.map((m) => m.name.replace(/^[IVX]+\. /, '')).join('  /  '),
            court.x + 36, y + 40, { scale: 1, fill: wash[3] }));
        }
      }
    });
    return { layers: [{ flat: true, shapes }], text: labels };
  }

  function howScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(court.x + 40, court.y + 20, court.w - 80, court.h - 40, WASH.dawn[0])] }],
      text: [
        centred('HOW TO LISTEN', court.y + 34, { scale: 2, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => text(line, court.x + 80, court.y + 84 + i * 21, { scale: 1, fill: PALETTE.cream })),
        centred('PRESS A', court.y + court.h - 34, { scale: 1, fill: PALETTE.bark }),
      ],
    };
  }

  function endScreen() {
    const wash = WASH[game.piece.colour] ?? WASH.dawn;
    return {
      layers: [
        ...game.view.layers(game.rig),
        { flat: true, shapes: [rect(court.x + 120, court.y + 150, court.w - 240, 150, PALETTE.ink),
          ...frame(court.x + 120, court.y + 150, court.w - 240, 150, 3, wash[3])] },
      ],
      text: [
        centred(game.piece.title, court.y + 176, { font: HEAVY, scale: 1, fill: wash[4] }),
        centred('THAT IS THE WHOLE OF IT', court.y + 224, { scale: 1, fill: PALETTE.cream }),
        centred('PRESS A', court.y + 260, { scale: 1, fill: PALETTE.bark }),
      ],
    };
  }

  const SCREENS = {
    menu: menuScreen, how: howScreen, play: playScreen, paused: pausedScreen, end: endScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Halcyon (${game.screen})`,
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

  // Every part starts up. The piece as written is the thing you are given;
  // what you do to it is subtraction.
  for (const name of pieceLib.STEMS) game.desk[name] = true;
  preview();

  return {
    update,
    scene,
    drain() { return []; },
    // Nothing from TRACKS: this game brings its own instrument. game.js reads
    // stream() instead, and the rack renders one block per video frame.
    music() { return null; },
    stream() { return game.rig; },
    state() {
      const rig = game.rig;
      const meters = {};
      for (const name of stems()) meters[name] = Number((rig.meters[name] ?? 0).toFixed(4));
      return {
        screen: game.screen,
        exit: game.exit,
        cursor: game.cursor,
        piece: game.piece ? game.piece.title : null,
        at: rig ? Number(rig.at.toFixed(3)) : 0,
        movement: rig ? rig.where().index : 0,
        section: rig ? rig.where().section : '',
        chord: rig ? rig.where().chord : '',
        done: rig ? rig.done : false,
        row: game.row,
        col: game.col,
        solo: game.solo,
        knobs: { ...game.knobs },
        levels: { ...(rig ? rig.levels : {}) },
        scored: rig ? [...rig.scored] : [],
        meters,
      };
    },
    court,
    rig: () => game.rig,
  };
}

// The shelf card: a low sun over three ridges, in the first piece's wash.
function emblem({ x, y, w, h }) {
  const wash = WASH.dawn;
  const shapes = [];
  for (let k = 0; k < 4; k++) {
    shapes.push({ type: 'rect', x: Math.round(x), y: Math.round(y + (h * k) / 4), w: Math.round(w), h: Math.ceil(h / 4), fill: wash[4 - k] });
  }
  shapes.push({ type: 'disc', x: Math.round(x + w * 0.5), y: Math.round(y + h * 0.56), r: Math.round(h * 0.2), fill: wash[4] });
  for (let k = 0; k < 3; k++) {
    shapes.push({
      type: 'chain',
      fill: wash[2 - k],
      points: [0, 1, 2, 3, 4].map((i) => ({
        x: Math.round(x + (w * i) / 4),
        y: Math.round(y + h * (0.62 + k * 0.13) - Math.sin(i * 1.7 + k) * h * 0.06),
        r: Math.round(h * 0.09),
      })),
    });
  }
  return shapes;
}

module.exports = {
  title: 'HALCYON',
  blurb: 'THREE PIECES, EIGHT PARTS',
  meta: {
    players: [1],
    rating: 'pg',
    audio: 'synth',
    graphics: '2d',
    content: [],
  },
  accent: 'violet',
  emblem,
  create, GAME, MENU, PAUSE_MENU, HOW_TO, KNOBS, PIECES, PIECE_IDS,
};

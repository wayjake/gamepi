'use strict';
// TALLOW -- a shadow-puppet troupe, and the vertical slice of one.
//
// This is the performance screen and nothing else yet: no road, no towns, no
// save slots, no fade. It exists first because it is the only part that can
// answer the two questions the rest of the design is betting on -- whether a
// silhouette and one patch of dyed paper can tell six people apart at 720x480
// through composite, and whether casting under time pressure is any good on a
// d-pad. Both are cheap to re-cut now and expensive later. See docs/tallow.md.
//
// The look is the separating rule for this game and it is one line: no ink
// outlines anywhere, fill only, value does the work. Every other game in this
// repo is the poster look -- ink grown under a flat fill -- so `tallow` uses
// `shade` for its silhouettes and never PALETTE.ink, and the matte is `soot`
// so the frame reads as the edge of a lamp instead of a letterbox.
//
// Two things fall out of the renderer that are worth knowing before editing:
//
//  - Shapes in one layer weld. Both rods go into a single inkOnly layer on
//    purpose, so two puppets brought together merge into one silhouette. That
//    is the eclipse the design asks for, and it is free.
//  - A fade is a scratch canvas plus a full-frame dither copy, so alpha layers
//    are counted, not sprinkled. There are three in a performance: the joins
//    in the lamp gradient, the hotspot, and every puppet's penumbra together.

const path = require('path');
const { PALETTE } = require('../../gfx/palette');
const { picture } = require('../../gfx/safearea');
const input = require('../../input');
const psf = require('../../psf');

const { REGISTERS, ZONES } = require('./registers');
const shadowLib = require('./shadow');
const book = require('./book');

const ASSETS = path.join(__dirname, '..', '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz'));

const GAME = 'tallow';

// --- the show ---------------------------------------------------------------

const BEAT_TIME = 1.7;   // seconds between beats. Casting, not a rhythm chart.
const LEAD_IN = 2.4;     // before the first one, so a show has a curtain
const TAIL = 2.2;        // after the last, so the ending is not a cut
const WINDOW = 0.30;     // how late or early A still counts

// Warmth is the health bar and it runs both ways: a show cannot be lost, only
// walked out of, and what a bad night costs is the rack rather than a life.
const WARMTH_START = 52;
const HIT = 5;
const STRETCH = 9;       // the register a shadow is bad at, held at the extreme
const DUET = 3;          // the other rod was also on the beat
const WRONG = -5;
const MISS = -7;
const FUMBLE = -2;       // A on nothing. Mashing is not a strategy.
const FUMBLE_COOL = 0.35;

// The dial. Depth 0 is pressed against the sheet, 1 is back at the lamp.
const DIAL_SPEED = 1.15;  // a full sweep in a beat and a half, so it is a move
const SIZE_MIN = 124;   // pressed to the sheet. Small, not illegible:
const SIZE_MAX = 228;   // below about 120 a figure stops having a hat.

const TALLY_HIT = 10;
const TALLY_STRETCH = 25;
const TALLY_DUET = 15;

const MENU = [
  { id: 'perform', label: 'PERFORM' },
  { id: 'rack', label: 'THE RACK' },
  { id: 'how', label: 'HOW TO PLAY' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'FROM THE TOP' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

const HOW_TO = [
  'THE LAMP IS BEHIND THE SHEET.',
  '',
  'UP    CARRY IT BACK TO THE LAMP',
  '      -- HUGE, SOFT, LOOMING',
  'DOWN  PRESS IT TO THE SHEET',
  '      -- SMALL, SHARP, CLOSE',
  'LEFT  RIGHT   CHANGE THE SHADOW',
  'B     THE OTHER HAND',
  'A     PLAY THE BEAT',
  '',
  'EACH SHADOW READS THREE WAYS.',
  'ONE OF THE THREE IT IS BAD AT.',
  'THAT IS THE ONE THAT TEACHES IT.',
];

// --- helpers ----------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x, y, r, fill });

// Grown by `by` in every direction, for the penumbra of a puppet held back
// near the lamp. There is no blur here -- softness is a bigger shape dithered
// over the top of a solid one, which is what a half-lit edge looks like once
// composite has had it.
function grow(shape, by) {
  if (shape.type === 'disc') return { ...shape, r: shape.r + by };
  if (shape.type === 'chain') return { ...shape, points: shape.points.map((p) => ({ ...p, r: p.r + by })) };
  return { ...shape, x: shape.x - by, y: shape.y - by, w: shape.w + by * 2, h: shape.h + by * 2 };
}

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const random = rng(options.seed ?? 0x54414c4c);
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };

  // The three horizontal bands the screen is built from.
  const TRACK = { x: court.x, y: court.y, w: court.w, h: 72 };
  const SHEET = { x: court.x, y: court.y + 72, w: court.w, h: 262 };
  const HUD = { x: court.x, y: court.y + 334, w: court.w, h: court.h - 334 };
  const GLOW = SHEET.y + SHEET.h * 0.56;   // where the lamp sits behind the cloth
  const NOW_X = court.x + 168;             // the beat line on the track
  const TRACK_SPEED = (court.w - (NOW_X - court.x) - 30) / (BEAT_TIME * 3.4);

  const cast = shadowLib.CAST;
  const sounds = [];
  const say = (name) => sounds.push(name);

  // The audience, cut once. Seeded, so a frame is reproducible from the seed
  // and the frame number -- and so two seeds actually draw different pictures,
  // which is what test/game.test.js checks the seed is for.
  const crowd = [];
  for (let i = 0; i < 14; i++) {
    crowd.push({
      x: court.x + 18 + i * ((court.w - 36) / 13) + (random() - 0.5) * 16,
      r: 13 + random() * 7,
      lift: random() * 10,
      phase: random(),
      // Who gives up first. Slicing the front off the list emptied the room
      // from the left, which reads as a bug rather than as a room emptying.
      patience: random(),
    });
  }
  crowd.forEach((person, i) => { person.order = i; });
  const byPatience = [...crowd].sort((a, b) => a.patience - b.patience);
  const motes = [];
  for (let i = 0; i < 9; i++) {
    motes.push({ x: random(), y: random(), speed: 0.4 + random() * 0.9, drift: random() });
  }

  const game = {
    screen: 'menu',
    exit: false,
    elapsed: 0,
    cursor: 0,
    pick: 0,              // the rack viewer's cursor
    scene: 0,             // which page of the Book
    clock: 0,
    beat: 0,
    warmth: WARMTH_START,
    hits: 0,
    misses: 0,
    wrongs: 0,
    stretches: 0,
    duets: 0,
    tally: 0,
    walked: false,
    fumbleCool: 0,
    active: 0,
    rods: [{ at: 0, depth: 0.5 }, { at: 1, depth: 0.5 }],
    marks: [],            // one per beat: null, 'hit', 'stretch', 'wrong', 'miss'
    said: '',             // the line the last resolved beat spoke
  };

  const go = (screen) => { game.screen = screen; game.elapsed = 0; };
  const beats = () => book.SCENES[game.scene].beats;
  const beatAt = (i) => LEAD_IN + i * BEAT_TIME;
  const shadowOn = (rod) => cast[game.rods[rod].at];
  const readingOn = (rod) => shadowLib.reading(shadowOn(rod), game.rods[rod].depth);

  // --- performing -----------------------------------------------------------

  function startShow(sceneIndex = 0) {
    game.scene = sceneIndex;
    game.clock = 0;
    game.beat = 0;
    game.warmth = WARMTH_START;
    game.hits = 0;
    game.misses = 0;
    game.wrongs = 0;
    game.stretches = 0;
    game.duets = 0;
    game.tally = 0;
    game.walked = false;
    game.fumbleCool = 0;
    game.active = 0;
    game.rods = [{ at: 0, depth: 0.5 }, { at: 1, depth: 0.5 }];
    game.marks = beats().map(() => null);
    game.said = '';
    go('play');
  }

  const warm = (by) => { game.warmth = clamp(game.warmth + by, 0, 100); };

  function resolve(index) {
    const beat = beats()[index];
    const here = readingOn(game.active);
    const other = readingOn(game.active === 0 ? 1 : 0);
    game.said = beat.line;

    if (here.register !== beat.register) {
      game.marks[index] = 'wrong';
      game.wrongs++;
      warm(WRONG);
      say('back');
      return;
    }

    const duet = other.register === beat.register;
    if (here.stretch) {
      game.marks[index] = 'stretch';
      game.stretches++;
      game.tally += TALLY_STRETCH;
      warm(STRETCH);
      say('unlock');
    } else {
      game.marks[index] = 'hit';
      game.hits++;
      game.tally += TALLY_HIT;
      warm(HIT);
      say('talk');
    }
    if (duet) {
      game.duets++;
      game.tally += TALLY_DUET;
      warm(DUET);
      say('heal');
    }
  }

  function perform(dt, pad) {
    game.clock += dt;
    game.fumbleCool = Math.max(0, game.fumbleCool - dt);

    const rod = game.rods[game.active];
    if (pad.up) rod.depth = clamp(rod.depth + DIAL_SPEED * dt, 0, 1);
    if (pad.down) rod.depth = clamp(rod.depth - DIAL_SPEED * dt, 0, 1);
    if (pad.pressed.left) { rod.at = (rod.at + cast.length - 1) % cast.length; say('move'); }
    if (pad.pressed.right) { rod.at = (rod.at + 1) % cast.length; say('move'); }
    if (pad.pressed.b) { game.active = game.active === 0 ? 1 : 0; say('move'); }

    const list = beats();
    if (pad.pressed.a) {
      if (game.beat < list.length && Math.abs(game.clock - beatAt(game.beat)) <= WINDOW) {
        resolve(game.beat);
        game.beat++;
      } else if (game.fumbleCool <= 0) {
        game.fumbleCool = FUMBLE_COOL;
        warm(FUMBLE);
        say('beep');
      }
    }

    // A beat that went past unanswered.
    while (game.beat < list.length && game.clock > beatAt(game.beat) + WINDOW) {
      game.marks[game.beat] = 'miss';
      game.said = list[game.beat].line;
      game.misses++;
      warm(MISS);
      say('wall');
      game.beat++;
    }

    if (game.warmth <= 0) {
      game.walked = true;
      game.tally = Math.max(0, game.tally - 50);
      say('busted');
      go('result');
      return;
    }
    if (game.beat >= list.length && game.clock > beatAt(list.length - 1) + TAIL) {
      game.tally += Math.round(game.warmth);
      say(game.warmth >= 70 ? 'holed' : 'select');
      go('result');
    }
  }

  // --- menus ----------------------------------------------------------------

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }
  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2);
    game.elapsed += dt;

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        say('select');
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') { game.exit = true; break; }
        if (choice === 'perform') startShow(0);
        else if (choice === 'rack') { game.pick = 0; go('rack'); }
        else go('how');
        break;
      }

      case 'rack':
        if (any.pressed.left) { game.pick = (game.pick + cast.length - 1) % cast.length; say('move'); }
        if (any.pressed.right) { game.pick = (game.pick + 1) % cast.length; say('move'); }
        if (any.pressed.b || any.pressed.start) { say('back'); go('menu'); }
        break;

      case 'how':
        if (confirmed(any) || any.pressed.b) { say('back'); go('menu'); }
        break;

      case 'play':
        if (any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        perform(dt, any);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('play');
        else if (choice === 'restart') startShow(game.scene);
        else { game.cursor = 0; go('menu'); }
        break;
      }

      case 'result':
        if (game.elapsed < 0.6) break;
        if (confirmed(any) || any.pressed.b) { say('select'); game.cursor = 0; go('menu'); }
        break;

      default:
        throw new Error(`unknown screen: ${game.screen}`);
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

  // The lit sheet. Ten bands off the five-step lamp ramp, brightest a little
  // below the middle where the lamp actually is, with the joins dithered by a
  // single alpha layer -- one scratch copy for the whole gradient rather than
  // one per join.
  const BANDS = [1, 1, 2, 2, 3, 4, 4, 3, 2, 2];
  function sheetLayers(warmth) {
    const dim = warmth < 25 ? 1 : 0;
    const h = SHEET.h / BANDS.length;
    const solid = [];
    const joins = [];
    BANDS.forEach((band, i) => {
      const here = Math.max(0, band - dim);
      solid.push(rect(SHEET.x, SHEET.y + i * h, SHEET.w, Math.ceil(h) + 1, PALETTE[`lamp${here}`]));
      const next = i + 1 < BANDS.length ? Math.max(0, BANDS[i + 1] - dim) : here;
      if (next !== here) {
        joins.push(rect(SHEET.x, SHEET.y + (i + 1) * h - 7, SHEET.w, 14, PALETTE[`lamp${Math.max(here, next)}`]));
      }
    });
    return { solid, joins, dim };
  }

  // A lamp behind cloth has no edge. One disc dithered at a flat alpha very
  // much does, so the glow is three nested steps of the ramp painted inside
  // each other and dithered together -- the falloff is in the colour, and the
  // dither only softens the joins.
  function glowShapes(cx, cy, scale = 1) {
    return [
      disc(cx, cy, 272 * scale, PALETTE.lamp2),
      disc(cx, cy, 210 * scale, PALETTE.lamp3),
      disc(cx, cy, 156 * scale, PALETTE.lamp4),
      disc(cx, cy, 96 * scale, PALETTE.lamp4),
    ];
  }

  function moteShapes(clock) {
    return motes.map((m) => {
      const y = SHEET.y + 16 + ((m.y + clock * 0.035 * m.speed) % 1) * (SHEET.h - 32);
      const x = SHEET.x + 30 + ((m.x + Math.sin(clock * 0.25 + m.drift * 6.28) * 0.02 + 1) % 1) * (SHEET.w - 60);
      return disc(x, y, 3, PALETTE.lamp1);
    });
  }

  // Everybody on the sheet, as one welded silhouette plus one penumbra.
  function puppetLayers(clock) {
    const core = [];
    const soft = [];
    const accents = [];

    game.rods.forEach((rod, i) => {
      const shadow = cast[rod.at];
      const size = SIZE_MIN + rod.depth * (SIZE_MAX - SIZE_MIN);
      // A puppet carried back from the sheet grows away from the lamp in every
      // direction, so it is the centre that stays put, not the feet.
      const centre = GLOW - 26;
      const built = shadowLib.build(shadow, {
        x: court.x + (i === 0 ? 196 : 444),
        base: centre + size * 0.5,
        size,
        t: clock,
        phase: i * 0.37,
        dir: i === 0 ? 1 : -1,
      });
      core.push(...built.body);
      const blur = 2 + rod.depth * 9;
      soft.push(...built.body.map((s) => grow(s, blur)));
      for (const patch of built.accent ?? []) accents.push({ ...patch, fill: PALETTE[shadow.accent] });
    });

    return [
      // The penumbra is the same silhouette grown and dithered over the top,
      // so it is an inkOnly layer in `shade` like the core -- one fill for the
      // whole soft edge, not a colour per shape.
      { inkOnly: true, fill: PALETTE.shade, alpha: 0.4, shapes: soft },
      { inkOnly: true, fill: PALETTE.shade, shapes: core },
      { flat: true, shapes: accents },
    ];
  }

  function crowdLayer(warmth) {
    // The audience thins as the room cools. Nothing random about it: how many
    // are left is the warmth, so a player can read the room by counting heads.
    const staying = Math.max(4, Math.round((warmth / 100) * crowd.length));
    const left = new Set(byPatience.slice(0, crowd.length - staying).map((p) => p.order));
    const base = SHEET.y + SHEET.h - 4;
    const shapes = [];
    crowd.filter((person) => !left.has(person.order)).forEach((person) => {
      const lean = Math.sin(game.clock / 2.6 + person.phase * 6.28) * (warmth > 60 ? 3 : 1);
      const top = base - person.lift - person.r * 1.15 + lean;
      shapes.push({ type: 'disc', x: person.x, y: top, r: person.r });
      shapes.push({
        type: 'chain',
        points: [
          { x: person.x - person.r * 1.5, y: base + person.r * 0.7, r: person.r * 0.85 },
          { x: person.x, y: top + person.r * 1.25, r: person.r * 0.95 },
          { x: person.x + person.r * 1.5, y: base + person.r * 0.7, r: person.r * 0.85 },
        ],
      });
    });
    return { inkOnly: true, fill: PALETTE.shade, shapes };
  }

  // The Book's page, scrolling toward the beat line.
  function trackLayer() {
    const shapes = [rect(TRACK.x, TRACK.y, TRACK.w, TRACK.h, PALETTE.soot)];
    const y = TRACK.y + 34;
    shapes.push(rect(NOW_X - 3, y - 24, 6, 48, PALETTE.cream));

    beats().forEach((beat, i) => {
      const x = NOW_X + (beatAt(i) - game.clock) * TRACK_SPEED;
      if (x < NOW_X - 34 || x > TRACK.x + TRACK.w + 20) return;
      const mark = game.marks[i];
      const dye = mark === 'miss' || mark === 'wrong' ? PALETTE.bark
        : mark ? PALETTE.cream
          : PALETTE[REGISTERS[beat.register].dye];
      shapes.push(disc(x, y, mark === 'stretch' ? 15 : 12, dye));
    });
    return { flat: true, shapes };
  }

  // The dials: one per rod, at the outside edges of the sheet, marked where
  // the three zones change. The puppet's height on its dial is its depth.
  function dialShapes() {
    const shapes = [];
    const top = SHEET.y + 14;
    const span = SHEET.h - 40;
    game.rods.forEach((rod, i) => {
      const x = i === 0 ? court.x + 17 : court.x + court.w - 17;
      // A strip of the room behind each dial: a pale marker on a lit sheet is
      // not a marker, and this is the one piece of furniture the player reads
      // every beat.
      shapes.push(rect(x - 15, top - 10, 30, span + 20, PALETTE.soot));
      shapes.push(rect(x - 3, top, 6, span, PALETTE.lamp1));
      for (const zone of ZONES) {
        if (zone.upTo < 1) shapes.push(rect(x - 11, top + span * (1 - zone.upTo) - 2, 22, 4, PALETTE.lamp2));
      }
      const at = top + span * (1 - rod.depth);
      shapes.push(rect(x - 13, at - 7, 26, 14, i === game.active ? PALETTE.sun : PALETTE.lamp2));
    });
    return shapes;
  }

  function warmthShapes(warmth) {
    const w = 250;
    const x = mid.x - w / 2;
    const y = HUD.y + 38;
    const fill = warmth >= 66 ? PALETTE.sun : warmth >= 33 ? PALETTE.bark : PALETTE.ember;
    return [
      rect(x, y, w, 10, PALETTE.lamp0),
      rect(x, y, Math.max(4, (w * warmth) / 100), 10, fill),
    ];
  }

  function playScreen() {
    const { solid, joins } = sheetLayers(game.warmth);
    const here = readingOn(game.active);
    const other = readingOn(game.active === 0 ? 1 : 0);
    const curtain = game.clock < LEAD_IN - 0.5;

    const rodLabel = (i) => {
      const r = shadowLib.reading(cast[game.rods[i].at], game.rods[i].depth);
      const mark = i === game.active ? '▶' : ' ';
      return `${mark}${cast[game.rods[i].at].short} ${REGISTERS[r.register].label}`;
    };

    return {
      layers: [
        { flat: true, shapes: solid },
        { flat: true, alpha: 0.45, shapes: joins },
        { flat: true, alpha: 0.34, shapes: [...glowShapes(mid.x, GLOW), ...moteShapes(game.clock)] },
        ...puppetLayers(game.clock),
        crowdLayer(game.warmth),
        trackLayer(),
        { flat: true, shapes: [rect(HUD.x, HUD.y, HUD.w, HUD.h, PALETTE.soot), ...dialShapes(), ...warmthShapes(game.warmth)] },
      ],
      text: [
        centred(curtain ? book.SCENES[game.scene].title : game.said || '\u2014', HUD.y + 18, {
          scale: 2, fill: curtain ? PALETTE.sun : PALETTE.cream,
        }),
        // What the beat coming up wants, in its own dye, so the coloured marks
        // on the track are never something the player has to have memorised.
        ...(game.beat < beats().length
          ? [text(REGISTERS[beats()[game.beat].register].label, court.x + 10, TRACK.y + 15, {
            anchor: 'start', scale: 2, fill: PALETTE[REGISTERS[beats()[game.beat].register].dye],
          })]
          : []),
        ...(here.stretch ? [text('STRETCHING', court.x + 36, HUD.y + 34, { anchor: 'start', scale: 1, fill: PALETTE.moss })] : []),
        ...(other.register === here.register && !curtain
          ? [text('BOTH HANDS', court.x + court.w - 36, HUD.y + 34, { anchor: 'end', scale: 1, fill: PALETTE.moss })]
          : []),
        text(rodLabel(0), court.x + 40, HUD.y + 54, { anchor: 'start', scale: 2, fill: game.active === 0 ? PALETTE.cream : PALETTE.lamp2 }),
        text(rodLabel(1), court.x + court.w - 40, HUD.y + 54, { anchor: 'end', scale: 2, fill: game.active === 1 ? PALETTE.cream : PALETTE.lamp2 }),
      ],
    };
  }

  function pausedScreen() {
    const { solid } = sheetLayers(game.warmth);
    return {
      layers: [
        { flat: true, shapes: solid },
        // One faded layer, not one per puppet: the dither breaks the runs up
        // anyway and a scratch copy per sprite is the expensive way to do it.
        { inkOnly: true, fill: PALETTE.shade, alpha: 0.3, shapes: puppetLayers(game.clock)[1].shapes },
      ],
      text: [
        centred('HELD', SHEET.y + 54, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...PAUSE_MENU.map((item, i) => centred(`${i === game.cursor ? '▶ ' : '  '}${item.label}`, SHEET.y + 122 + i * 44, {
          scale: 2, fill: i === game.cursor ? PALETTE.sun : PALETTE.cream,
        })),
      ],
    };
  }

  function menuScreen() {
    const { solid, joins } = sheetLayers(80);
    // The title card is the instrument itself: one shadow, held at the lamp.
    const built = shadowLib.build(cast[0], {
      x: mid.x, base: GLOW + 96, size: 196, t: game.elapsed, phase: 0, dir: 1,
    });
    return {
      layers: [
        { flat: true, shapes: solid },
        { flat: true, alpha: 0.45, shapes: joins },
        { flat: true, alpha: 0.34, shapes: [...glowShapes(mid.x, GLOW), ...moteShapes(game.elapsed)] },
        { inkOnly: true, fill: PALETTE.shade, alpha: 0.4, shapes: built.body.map((s) => grow(s, 9)) },
        { inkOnly: true, fill: PALETTE.shade, shapes: built.body },
        { flat: true, shapes: (built.accent ?? []).map((s) => ({ ...s, fill: PALETTE[cast[0].accent] })) },
        crowdLayer(88),
        { flat: true, shapes: [rect(TRACK.x, TRACK.y, TRACK.w, TRACK.h, PALETTE.soot), rect(HUD.x, HUD.y, HUD.w, HUD.h, PALETTE.soot)] },
      ],
      text: [
        centred('TALLOW', TRACK.y + 34, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...MENU.map((item, i) => text(`${i === game.cursor ? '▶ ' : '  '}${item.label}`, court.x + 40, HUD.y + 14 + i * 24, {
          anchor: 'start', scale: 1, fill: i === game.cursor ? PALETTE.sun : PALETTE.cream,
        })),
        text('A SHADOW PLAY FOR A DROWNED VALLEY', court.x + court.w - 30, HUD.y + 78, { anchor: 'end', scale: 1, fill: PALETTE.lamp2 }),
      ],
    };
  }

  function rackScreen() {
    const shadow = cast[game.pick];
    const { solid, joins } = sheetLayers(80);
    const built = shadowLib.build(shadow, {
      x: court.x + 176, base: GLOW + 92, size: 188, t: game.elapsed, phase: 0, dir: 1,
    });
    const rows = ZONES.map((zone, i) => {
      const register = shadow.zones[zone.id];
      const isStretch = shadow.stretch === zone.id;
      return text(`${zone.label.padEnd(9)}${REGISTERS[register].label}${isStretch ? '  *' : ''}`,
        court.x + 352, SHEET.y + 108 + i * 26, {
          anchor: 'start', scale: 1, fill: PALETTE.shade,
        });
    });

    return {
      layers: [
        { flat: true, shapes: solid },
        { flat: true, alpha: 0.45, shapes: joins },
        { flat: true, alpha: 0.34, shapes: glowShapes(court.x + 190, GLOW, 0.86) },
        { inkOnly: true, fill: PALETTE.shade, alpha: 0.4, shapes: built.body.map((s) => grow(s, 7)) },
        { inkOnly: true, fill: PALETTE.shade, shapes: built.body },
        { flat: true, shapes: (built.accent ?? []).map((s) => ({ ...s, fill: PALETTE[shadow.accent] })) },
        {
          flat: true,
          shapes: [
            rect(TRACK.x, TRACK.y, TRACK.w, TRACK.h, PALETTE.soot),
            rect(HUD.x, HUD.y, HUD.w, HUD.h, PALETTE.soot),
            // The one patch of dyed paper this shadow is allowed, shown as a
            // swatch: printing the name in it would be unreadable on linen for
            // half the rack.
            disc(court.x + 340, SHEET.y + 34, 9, PALETTE[shadow.accent]),
            // A rule under the three readings.
            rect(court.x + 352, SHEET.y + 96, 250, 3, PALETTE.shade),
          ],
        },
      ],
      text: [
        centred('THE RACK', TRACK.y + 30, { scale: 2, fill: PALETTE.sun }),
        text(shadow.name, court.x + 360, SHEET.y + 20, { anchor: 'start', scale: 2, fill: PALETTE.shade }),
        ...book.paginate(shadow.was.toUpperCase(), 30).map((line, i) => text(line, court.x + 352, SHEET.y + 58 + i * 18, { anchor: 'start', scale: 1, fill: PALETTE.shade })),
        ...rows,
        text('* THE ONE IT IS BAD AT', court.x + 352, SHEET.y + 196, { anchor: 'start', scale: 1, fill: PALETTE.shade }),
        centred(`${game.pick + 1} OF ${cast.length}   LEFT RIGHT TO TURN   B BACK`, HUD.y + 40, { scale: 1, fill: PALETTE.lamp2 }),
      ],
    };
  }

  function howScreen() {
    const { solid } = sheetLayers(70);
    return {
      layers: [
        { flat: true, shapes: solid },
        { flat: true, shapes: [rect(TRACK.x, TRACK.y, TRACK.w, TRACK.h, PALETTE.soot), rect(HUD.x, HUD.y, HUD.w, HUD.h, PALETTE.soot)] },
      ],
      text: [
        centred('HOW TO PLAY', TRACK.y + 30, { scale: 2, fill: PALETTE.sun }),
        ...HOW_TO.map((line, i) => text(line, court.x + 60, SHEET.y + 14 + i * 18, { anchor: 'start', scale: 1, fill: PALETTE.shade })),
        centred('B TO GO BACK', HUD.y + 40, { scale: 1, fill: PALETTE.lamp2 }),
      ],
    };
  }

  function resultScreen() {
    const { solid } = sheetLayers(game.warmth);
    const verdict = game.walked ? 'THEY WALKED OUT'
      : game.warmth >= 70 ? 'THEY ASKED FOR IT AGAIN'
        : game.warmth >= 40 ? 'THEY STAYED TO THE END'
          : 'IT WAS A LONG NIGHT';
    const lines = [
      ['BEATS PLAYED', `${game.hits + game.stretches} OF ${beats().length}`],
      ['STRETCHED', String(game.stretches)],
      ['BOTH HANDS', String(game.duets)],
      ['MISSED', String(game.misses + game.wrongs)],
      ['WARMTH', `${Math.round(game.warmth)}`],
    ];
    return {
      layers: [
        { flat: true, shapes: solid },
        { flat: true, alpha: 0.32, shapes: glowShapes(mid.x, GLOW, 0.9) },
        crowdLayer(game.warmth),
        { flat: true, shapes: [rect(TRACK.x, TRACK.y, TRACK.w, TRACK.h, PALETTE.soot), rect(HUD.x, HUD.y, HUD.w, HUD.h, PALETTE.soot)] },
      ],
      text: [
        centred(book.SCENES[game.scene].title, TRACK.y + 24, { scale: 2, fill: PALETTE.sun }),
        centred(verdict, TRACK.y + 54, { scale: 1, fill: game.walked ? PALETTE.ember : PALETTE.cream }),
        ...lines.map(([label, value], i) => [
          text(label, mid.x - 140, SHEET.y + 40 + i * 30, { anchor: 'start', scale: 2, fill: PALETTE.shade }),
          text(value, mid.x + 150, SHEET.y + 40 + i * 30, { anchor: 'end', scale: 2, fill: PALETTE.shade }),
        ]).flat(),
        centred(`TAKINGS ${game.tally}`, HUD.y + 26, { scale: 2, fill: PALETTE.sun }),
        centred('PRESS A', HUD.y + 66, { scale: 1, fill: PALETTE.lamp2 }),
      ],
    };
  }

  const SCREENS = {
    menu: menuScreen, rack: rackScreen, how: howScreen,
    play: playScreen, paused: pausedScreen, result: resultScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Tallow (${game.screen})`,
      width,
      height,
      background: PALETTE.soot,
      matte: court,
      matteColour: PALETTE.soot,
      font: FONT,
      layers,
      text: labels,
    };
  }

  return {
    update,
    scene,
    drain() { return sounds.splice(0, sounds.length); },
    // One bed, so the room's mood is a change of track rather than a layer:
    // `lamplight` while the crowd is cold, `warmth` once it is not.
    music() {
      if (game.screen !== 'play') return 'tallow';
      return game.warmth >= 66 ? 'warmth' : 'lamplight';
    },
    state() {
      return {
        screen: game.screen, exit: game.exit, cursor: game.cursor, pick: game.pick,
        scene: game.scene, clock: game.clock, beat: game.beat,
        warmth: game.warmth, hits: game.hits, misses: game.misses, wrongs: game.wrongs,
        stretches: game.stretches, duets: game.duets, tally: game.tally, walked: game.walked,
        active: game.active, rods: game.rods.map((r) => ({ ...r })),
        marks: [...game.marks], said: game.said,
        reading: readingOn(game.active),
      };
    },
    court,
    beatAt,
    beats,
  };
}

// The shelf card: a lamp, and something standing in front of it.
function emblem({ x, y, w, h }) {
  const cx = x + w * 0.42;
  const base = y + h - 4;
  const built = shadowLib.build(shadowLib.CAST[0], { x: cx, base, size: h * 0.92, t: 0, phase: 0, dir: 1 });
  return [
    { type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill: PALETTE.lamp2 },
    { type: 'disc', x: Math.round(x + w * 0.62), y: Math.round(y + h * 0.42), r: Math.round(h * 0.34), fill: PALETTE.lamp4 },
    ...built.body.map((s) => ({ ...s, fill: PALETTE.shade })),
  ];
}

module.exports = {
  title: 'TALLOW',
  blurb: 'A SHADOW PLAY FOR A DROWNED VALLEY',
  meta: {
    players: [1],
    rating: '13',
    audio: '8-bit',
    graphics: '2d',
    content: ['a drowned town', 'the dead remembered'],
  },
  accent: 'sun',
  emblem,
  create, GAME, MENU, PAUSE_MENU, HOW_TO,
  BEAT_TIME, LEAD_IN, TAIL, WINDOW, WARMTH_START, SIZE_MIN, SIZE_MAX,
};

'use strict';
// Refugio: the town at the end of Border Patrol's dirt road.
//
// The run is a chase in 3D from behind a car; this is a town in 2D from above,
// on foot, and the two share nothing but the pad. border.js owns the state
// machine and hands the pad down here while its screen is `town`, the same
// way game.js hands a pad to a game -- update(dt, frame) moves it, parts()
// draws it, state() reports it -- so the chase never learns what a tile is.
//
// The shape is Kingpin's, deliberately: a tile map with a camera, doors named
// in a table and checked at require time, an intent() that is the only place
// the A button is decided, modal cards, and a talk box with a face in it. What
// is different is what the town is *for*. Kingpin's town is something you do
// things to; this one is something you do things with. Every activity here is
// a way of being useful to somebody, and TRUST is the town's memory of it.
//
// This is the first pass -- the walking, the doors, the jobs, the church and
// the day -- built so the story can be hung on it. Add a place to PLACES, a
// person to LOCALS, a thing to do to intent().

const path = require('path');
const { PALETTE } = require('../../gfx/palette');
const psf = require('../../psf');

const ASSETS = path.join(__dirname, '..', '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));    // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

// --- the shape of the town ---------------------------------------------------

const VIEW_COLS = 20;
const VIEW_ROWS = 11;

const COLS = 34;
const ROWS = 24;

const GLYPH = {
  '.': 'road',    // the dirt road in, and the one street
  ',': 'walk',    // packed earth, which is most of the town
  g: 'scrub',
  '+': 'door',
  '#': 'block',
  T: 'tree',
  c: 'cactus',
  f: 'fence',
  '=': 'bench',
  w: 'well',
  t: 'truck',     // Rosa's, parked where it stopped
  x: 'edge',      // the road out. Drawn as road, and you cannot take it yet
};
const SOLID = new Set(['block', 'tree', 'cactus', 'fence', 'bench', 'well', 'truck', 'edge']);

// One road in from the south, a church at the top of it, and everything else
// along the one street. Small on purpose: a town you can cross in ten seconds
// is a town whose people you meet twice a day.
const TOWN = [
  'cffffffffffffffffffffffffffffffffc',
  'fgggg,,,,,,,,,,,,,,,,,,,,,,,,ggggf',
  'fg,,,,#######,,,,,,,,,#######,,,gf',
  'fg,,,,#######,,,,,,,,,#######,,,gf',
  'fg,,,,###+###,,,,,,,,,###+###,,,gf',
  'fg,,,,,,,,,,#########,,,,,,,,,,,gf',
  'fgT,,,,,,,,,#########,,,,,,,,,,Tgf',
  'f,,,,,,,,,,,#########,,,,,,,,,,,,f',
  'f,,,,,,,,,,,####+####,,,,,,,,,,,,f',
  'f,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,f',
  'f,,,=,,,,,,,,,,,w,,,,,,,,,,,,=,,,f',
  'f................................f',
  'f................................f',
  'f................................f',
  'f,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,f',
  'fg,,##+##,,,,,,...,,,,###+###,,,gf',
  'fg,,#####,,,,,,...,,,,#######,,,gf',
  'fg,,#####,,,,,,...,,,,#######,,,gf',
  'fg,,,,,,,,,,,,,...,,,,,,,,,,,,,,gf',
  'fgg,,,,,,,,,,,,...,,fffff+ffffffgf',
  'fggc,,,,,,,,,,,...,,f,T,,,T,,T,fgf',
  'fgg,,,,,,,,,,,,...ttf,,,,,,,,,,fgf',
  'fggg,,,,,,,,,,,...,,f,T,,,T,,T,fgf',
  'cffffffffffffffxxxfffffffffffffffc',
];

// Where the truck stops, and where you get out of it.
const START = { col: 16, row: 21 };

// --- the doors ---------------------------------------------------------------
//
// Every one of these is a `+` in the map and the load check pairs them off.
// `kind` is what the door does; a `job` pays `wage` for one shift a day.

const PLACES = {
  house: { name: "ROSA'S HOUSE", at: [9, 4], kind: 'home', who: 'ROSA', paint: PALETTE.moss },
  store: { name: 'TIENDA MENDOZA', at: [25, 4], kind: 'store', who: 'DON MEMO', paint: PALETTE.sun },
  church: { name: 'SAN ISIDRO', at: [16, 8], kind: 'church', who: 'PADRE TOMAS', paint: PALETTE.violet },
  garage: {
    name: "RUBEN'S GARAGE", at: [6, 15], kind: 'job', who: 'RUBEN', paint: PALETTE.sky,
    wage: 34, task: 'PATCHING TYRES', offer: 'WORK A SHIFT',
  },
  diner: {
    name: 'LA PARADA', at: [25, 15], kind: 'job', who: 'CHELA', paint: PALETTE.ember,
    wage: 26, task: 'WASHING DISHES', offer: 'WASH DISHES',
  },
  orchard: {
    name: 'THE PECAN GROVE', at: [25, 19], kind: 'job', who: 'DON BETO', paint: PALETTE.leaf,
    wage: 30, task: 'SHAKING TREES', offer: 'WORK THE TREES',
  },
};

// --- the people --------------------------------------------------------------
//
// Rosa stands by her truck; everybody else wanders from the tile they start
// on. What each of them says is a function of the run, so the second time you
// talk to somebody they know you.

const LOCALS = [
  {
    id: 'rosa', name: 'ROSA', at: [18, 20], still: true, dir: 'left',
    look: { body: PALETTE.moss, head: PALETTE.bark, trim: PALETTE.cream },
    first: [
      'Go on. Have a look around. Nobody here bites.',
      'The church is at the top of the road. Chela at the diner could use a pair of hands, and so could Ruben.',
      'Work, eat, sleep. My spare room is yours. That is how everybody here started.',
    ],
    again: (run) => (run.trust < 20
      ? ['Do some work. Let them see your face. It is not charity if you earn it.']
      : ['People are talking about you. The good kind of talking.']),
  },
  {
    id: 'lupe', name: 'LUPE', at: [5, 9],
    look: { body: PALETTE.rose, head: PALETTE.sand, trim: PALETTE.ink },
    first: ['New face. Rosa bring you in?', 'Then you are all right by me. Most of us came in the back of that truck.'],
    again: () => ['Keep your head down and your hands busy. That is all anybody asks here.'],
  },
  {
    id: 'chuy', name: 'CHUY', at: [28, 12],
    look: { body: PALETTE.sky, head: PALETTE.barkDim, trim: PALETTE.sun },
    first: ['They chased you up the highway? All the way from the border?', 'They never come out here. Too far. No pavement. Nothing worth taking.'],
    again: () => ['Beto pays better than he lets on. Ask him.'],
  },
  {
    id: 'marisol', name: 'MARISOL', at: [10, 12],
    look: { body: PALETTE.sun, head: PALETTE.bark, trim: PALETTE.ember },
    first: ['I teach the little ones in the church hall. Four of them this year.', 'If you can read, you can help. If you cannot, you can sit at the back and learn.'],
    again: () => ['The padre says a town is people, not houses. He says it a lot.'],
  },
  {
    id: 'tito', name: 'TITO', at: [22, 9],
    look: { body: PALETTE.violet, head: PALETTE.sandLit, trim: PALETTE.stone },
    first: ['My brother went for the line last spring. Nobody has heard from him.', 'You made it this far. That is something.'],
    again: () => ['Ruben will let you sleep in the garage if Rosa snores. She does.'],
  },
  {
    id: 'nena', name: 'ABUELA NENA', at: [3, 12],
    look: { body: PALETTE.creamDim, head: PALETTE.bark, trim: PALETTE.stone },
    first: ['Come here. Let me look at you. Too thin.', 'Chela will feed you if you do her dishes. Go on.'],
    again: () => ['Sunday. Do not miss it. The padre notices who is missing.'],
  },
  {
    id: 'paco', name: 'PACO', at: [16, 17],
    look: { body: PALETTE.ember, head: PALETTE.barkDim, trim: PALETTE.sky },
    first: ['That your car they took? Shame. Ruben could have done something with it.', 'Grove pays cash. Diner pays cash and lunch.'],
    again: () => ['One road in. That is the whole trick of this place.'],
  },
];

// --- the day -----------------------------------------------------------------

const DAY_LENGTH = 150;       // seconds of clock in a day, seven in the morning to nine at night
const SHIFT_TIME = 4.5;       // real seconds a shift takes to watch
const SHIFT_CLOCK = 38;       // ...and how much of the day it uses up
const SERVICE_TIME = 4;
const SERVICE_CLOCK = 22;
const SERVICE_TRUST = 5;
const SHIFT_TRUST = 3;
const MEET_TRUST = 1;
const TRUST_MAX = 100;

const WRAP = 26;              // the talk box shares its width with a face
const CARD_WRAP = 30;
const LINE_H = 32;
const TYPE_RATE = 52;

const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const facing = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const money = (n) => `$${Math.round(n)}`;

function wrapTo(paragraphs, width) {
  const out = [];
  for (const para of paragraphs) {
    let line = '';
    for (const word of String(para).split(' ')) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function paginate(paragraphs, lines = 3) {
  const pages = [];
  for (const para of paragraphs) {
    const wrapped = wrapTo([para], WRAP);
    for (let i = 0; i < wrapped.length; i += lines) pages.push(wrapped.slice(i, i + lines));
  }
  return pages;
}

// --- the load check ----------------------------------------------------------
//
// A map is the one thing you cannot check by reading it, so it is checked
// here, once, and everything throws: a door into a wall, a door nobody named,
// a person standing in a wall, or a door you cannot walk to from the truck.

{
  if (TOWN.length !== ROWS) throw new Error(`town is ${TOWN.length} rows, expected ${ROWS}`);
  const doors = new Set();
  TOWN.forEach((line, r) => {
    if (line.length !== COLS) throw new Error(`town row ${r} is ${line.length} columns, expected ${COLS}`);
    [...line].forEach((ch, c) => {
      if (!GLYPH[ch]) throw new Error(`town row ${r}: unknown tile "${ch}"`);
      if (ch === '+') doors.add(`${c},${r}`);
    });
  });
  const named = new Set(Object.values(PLACES).map((p) => `${p.at[0]},${p.at[1]}`));
  for (const door of doors) if (!named.has(door)) throw new Error(`the door at ${door} belongs to no place`);
  for (const [id, place] of Object.entries(PLACES)) {
    if (!doors.has(`${place.at[0]},${place.at[1]}`)) throw new Error(`${id}'s door at ${place.at} is not a door`);
  }
  const walkable = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !SOLID.has(GLYPH[TOWN[r][c]]);
  for (const who of LOCALS) {
    if (!walkable(who.at[0], who.at[1])) throw new Error(`${who.name} starts inside something at ${who.at}`);
  }
  if (!walkable(START.col, START.row)) throw new Error('the start tile is solid');

  const seen = new Set([`${START.col},${START.row}`]);
  const queue = [[START.col, START.row]];
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${c + dc},${r + dr}`;
      if (seen.has(key) || !walkable(c + dc, r + dr)) continue;
      seen.add(key);
      queue.push([c + dc, r + dr]);
    }
  }
  for (const [id, place] of Object.entries(PLACES)) {
    if (!seen.has(`${place.at[0]},${place.at[1]}`)) throw new Error(`${id}'s door cannot be walked to from the truck`);
  }
  for (const who of LOCALS) {
    if (!seen.has(`${who.at[0]},${who.at[1]}`)) throw new Error(`${who.name} cannot be walked to from the truck`);
  }
}

// --- drawing helpers ---------------------------------------------------------

const rect = (x, y, w, h, fill) =>
  ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r, fill });

// --- the town ----------------------------------------------------------------

function create(width, height, { court, say, random }) {
  // Three rows of the body font for the HUD and the field takes what is left,
  // which on a 720x480 tube is a 30 pixel tile and a twenty by eleven window.
  const TILE = Math.max(8, Math.floor(Math.min(court.w / VIEW_COLS, (court.h - 104) / VIEW_ROWS)));
  const field = {
    x: court.x + Math.floor((court.w - VIEW_COLS * TILE) / 2),
    y: court.y + (court.h - VIEW_ROWS * TILE),
    w: VIEW_COLS * TILE,
    h: VIEW_ROWS * TILE,
  };
  const hud = { x: court.x, y: court.y, w: court.w, h: field.y - court.y };
  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const WORLD_W = COLS * TILE;
  const WORLD_H = ROWS * TILE;

  const cx = (col) => (col + 0.5) * TILE;
  const cy = (row) => (row + 0.5) * TILE;
  const colAt = (x) => Math.floor(x / TILE);
  const rowAt = (y) => Math.floor(y / TILE);

  // --- what a stay is -------------------------------------------------------

  const run = {
    day: 1,
    clock: 0,
    cash: 0,
    trust: 0,
    shifts: 0,
    services: 0,
    worked: {},           // place id -> the day you last worked there
    prayed: 0,            // the day you last sat through a service
    met: new Set(),
  };

  const player = { x: cx(START.col), y: cy(START.row), dir: 'up', walk: 0 };
  const cam = { x: 0, y: 0 };
  let elapsed = 0;

  const people = LOCALS.map((who) => ({
    ...who,
    x: cx(who.at[0]), y: cy(who.at[1]), dir: who.dir ?? 'down',
    dx: 0, dy: 0, until: random() * 2, walk: 0,
  }));

  let talk = null;
  let job = null;
  let service = null;
  const cards = [];

  // --- the map at runtime ---------------------------------------------------

  const tileAt = (col, row) => {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return 'fence';
    return GLYPH[TOWN[row][col]];
  };
  const solidAt = (x, y) => SOLID.has(tileAt(colAt(x), rowAt(y)));
  const boxed = (x, y, half) =>
    solidAt(x - half, y - half) || solidAt(x + half, y - half)
    || solidAt(x - half, y + half) || solidAt(x + half, y + half);

  // Axes resolved separately, so walking into a corner slides along it.
  function moveBox(ent, dx, dy, half) {
    if (dx && !boxed(ent.x + dx, ent.y, half)) ent.x += dx;
    if (dy && !boxed(ent.x, ent.y + dy, half)) ent.y += dy;
  }

  const placeAt = (col, row) => Object.entries(PLACES).find(([, p]) => p.at[0] === col && p.at[1] === row) ?? null;

  // --- cards and talk -------------------------------------------------------

  function card(title, lines) {
    cards.push({ title, lines, t: 0 });
  }

  function beginTalk({ who, look, lines, options = [] }) {
    talk = { who, look, pages: paginate(lines), page: 0, reveal: 0, options, cursor: 0, choosing: false };
    say('talk');
  }

  function advanceTalk(dt, frame) {
    if (talk.choosing) {
      const list = talk.options;
      if (frame.pressed.up) { talk.cursor = (talk.cursor + list.length - 1) % list.length; say('move'); }
      if (frame.pressed.down) { talk.cursor = (talk.cursor + 1) % list.length; say('move'); }
      if (frame.pressed.b) { say('back'); talk = null; return; }
      if (!frame.pressed.a && !frame.pressed.start) return;
      const choice = list[talk.cursor];
      say('select');
      talk = null;
      if (choice.act) choice.act();
      return;
    }

    const page = talk.pages[talk.page];
    const full = page.join(' ').length;
    talk.reveal = Math.min(full, talk.reveal + TYPE_RATE * dt);
    if (!(frame.pressed.a || frame.pressed.b || frame.pressed.start)) return;
    if (talk.reveal < full) { talk.reveal = full; return; }

    talk.page++;
    if (talk.page < talk.pages.length) { talk.reveal = 0; say('talk'); return; }
    if (talk.options.length) { talk.choosing = true; talk.cursor = 0; say('talk'); return; }
    talk = null;
  }

  function trust(amount) {
    run.trust = clamp(run.trust + amount, 0, TRUST_MAX);
  }

  // --- what there is to do --------------------------------------------------

  const LEAVE = { label: 'LEAVE IT', act: null };
  const clockLine = () => {
    const hour = 7 + (run.clock / DAY_LENGTH) * 14;
    const hh = Math.floor(hour) % 24;
    const mm = Math.floor(((hour % 1) * 60) / 5) * 5;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  function meet(who) {
    const first = !run.met.has(who.id);
    if (first) { run.met.add(who.id); trust(MEET_TRUST); }
    beginTalk({ who: who.name, look: who.look, lines: first ? who.first : who.again(run) });
  }

  function startShift(id) {
    const place = PLACES[id];
    job = { place: id, t: 0 };
    say('door');
    // You are inside; the door is where you are drawn. The clock jumps when
    // the shift ends, so the afternoon goes in one piece.
    void place;
  }

  function endShift() {
    const place = PLACES[job.place];
    run.cash += place.wage;
    run.shifts++;
    run.worked[job.place] = run.day;
    run.clock += SHIFT_CLOCK;
    trust(SHIFT_TRUST);
    job = null;
    say('coin');
    card('SHIFT DONE', [`${place.who} PAYS YOU ${money(place.wage)}.`, `TRUST +${SHIFT_TRUST}`]);
  }

  function startService() {
    service = { t: 0 };
    say('bell');
  }

  function endService() {
    run.services++;
    run.prayed = run.day;
    run.clock += SERVICE_CLOCK;
    trust(SERVICE_TRUST);
    service = null;
    card('SAN ISIDRO', ['YOU SIT AT THE BACK. NOBODY ASKS WHERE YOU CAME FROM.', `TRUST +${SERVICE_TRUST}`]);
  }

  function sleep() {
    say('snooze');
    endDay(['MORNING. THE ROOSTER FROM THE GROVE, AND COFFEE ON THE STOVE.']);
  }

  function endDay(lines) {
    run.day++;
    run.clock = 0;
    run.worked = {};
    const door = PLACES.house.at;
    player.x = cx(door[0]);
    player.y = cy(door[1] + 1);
    player.dir = 'down';
    follow(true);
    card(`DAY ${run.day}`, lines);
  }

  // What each door says and offers. Options are built when you knock, so
  // they close over what was true then; a shift already worked is not offered
  // twice, and it says so instead.
  function openPlace(id) {
    const place = PLACES[id];
    say('door');
    switch (place.kind) {
      case 'home':
        beginTalk({
          who: place.name, look: LOCALS[0].look,
          lines: ['THE SPARE ROOM. A COT, A BLANKET, A WINDOW ONTO THE GROVE.'],
          options: [{ label: 'SLEEP TILL MORNING', act: sleep }, LEAVE],
        });
        break;

      case 'store':
        beginTalk({
          who: place.who, look: { body: PALETTE.sun, head: PALETTE.barkDim, trim: PALETTE.stone },
          lines: run.cash < 20
            ? ['Rosa said you might come by. Beans, rice, candles, and not a lot else.',
              'Money is tight for all of us. Come back when you have some and I will find you something.']
            : ['Look at you, with money in your pocket. Give me a week and I will have something worth buying.'],
        });
        break;

      case 'church': {
        const done = run.prayed === run.day;
        beginTalk({
          who: place.who, look: { body: PALETTE.ink, head: PALETTE.sand, trim: PALETTE.cream },
          lines: run.services === 0
            ? ['You are welcome here. Everybody is. That is rather the point of the place.']
            : done
              ? ['Twice in a day? Sit with the little ones in the hall, then. Marisol could use you.']
              : ['Come in. Sit anywhere. We are about to start.'],
          options: done ? [LEAVE] : [{ label: 'SIT THROUGH A SERVICE', act: startService }, LEAVE],
        });
        break;
      }

      case 'job': {
        const done = run.worked[id] === run.day;
        const lines = done
          ? [`${place.who} waves you off. You have done enough for one day. Come back tomorrow.`]
          : run.worked[id]
            ? ['Back again. Good. Same as yesterday.']
            : [`${place.who} looks you up and down.`, `There is work if you want it. ${money(place.wage)} for the shift. Cash.`];
        beginTalk({
          who: place.who, look: { body: place.paint, head: PALETTE.bark, trim: PALETTE.stone },
          lines,
          options: done ? [LEAVE] : [{ label: place.offer, act: () => startShift(id) }, LEAVE],
        });
        break;
      }

      default:
        throw new Error(`unknown place kind: ${place.kind}`);
    }
  }

  // The one place A is decided. The HUD prints the label and interact() does
  // the kind, so the hint and the button cannot disagree.
  function intent() {
    const col = colAt(player.x);
    const row = rowAt(player.y);
    const near = (p) => Math.hypot(p.x - player.x, p.y - player.y) < TILE * 1.35;

    const who = people.filter(near)
      .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
    if (who) return { kind: 'person', who, label: run.met.has(who.id) ? `TALK TO ${who.name}` : 'SAY HELLO' };

    const found = placeAt(col, row);
    if (found) {
      const [id, place] = found;
      return { kind: 'place', place: id, label: place.name };
    }
    if (tileAt(col, row + 1) === 'well' || tileAt(col, row - 1) === 'well') return { kind: null, label: 'THE WELL. STILL GOOD.' };
    return { kind: null, label: '' };
  }

  function interact() {
    const what = intent();
    if (what.kind === 'person') meet(what.who);
    else if (what.kind === 'place') openPlace(what.place);
  }

  // --- people in the street -------------------------------------------------

  // Somebody standing beside you holds still: a neighbour who steps away as
  // you say hello is a neighbour you cannot say hello to.
  function wander(p, dt) {
    if (p.still) return;
    p.until -= dt;
    if (p.until <= 0) {
      p.until = 0.8 + random() * 2.4;
      const r = random();
      p.dx = 0;
      p.dy = 0;
      if (r < 0.22) p.dx = -1;
      else if (r < 0.44) p.dx = 1;
      else if (r < 0.62) p.dy = -1;
      else if (r < 0.8) p.dy = 1;
      if (p.dx || p.dy) p.dir = facing(p.dx, p.dy);
    }
    if (!(p.dx || p.dy)) return;
    if (Math.hypot(p.x - player.x, p.y - player.y) < TILE * 1.3) return;
    const wasX = p.x;
    const wasY = p.y;
    moveBox(p, p.dx * TILE * 1.5 * dt, p.dy * TILE * 1.5 * dt, TILE * 0.26);
    if (p.x === wasX && p.y === wasY) p.until = 0;
    else p.walk += dt * 7;
  }

  // --- the step -------------------------------------------------------------

  function follow(snap = false) {
    const wantX = clamp(player.x - field.w / 2, 0, Math.max(0, WORLD_W - field.w));
    const wantY = clamp(player.y - field.h / 2, 0, Math.max(0, WORLD_H - field.h));
    // Whole pixels: a half pixel of camera is a one pixel seam between tiles.
    cam.x = Math.round(snap ? wantX : cam.x + (wantX - cam.x) * 0.35);
    cam.y = Math.round(snap ? wantY : cam.y + (wantY - cam.y) * 0.35);
    buildGround();
  }

  function movePlayer(dt, frame) {
    let dx = 0;
    let dy = 0;
    if (frame.left) dx -= 1;
    if (frame.right) dx += 1;
    if (frame.up) dy -= 1;
    if (frame.down) dy += 1;
    if (dx || dy) {
      const m = Math.hypot(dx, dy);
      dx /= m; dy /= m;
      player.dir = facing(dx, dy);
      player.walk += dt * 9;
    }
    moveBox(player, dx * TILE * 4 * dt, dy * TILE * 4 * dt, TILE * 0.26);
  }

  // The street keeps moving while a card or a conversation is up.
  function drift(dt) {
    elapsed += dt;
    for (const p of people) wander(p, dt);
    follow();
  }

  function update(dt, frame) {
    drift(dt);

    if (cards.length) {
      const top = cards[0];
      top.t += dt;
      if (top.t > 0.35 && (frame.pressed.a || frame.pressed.b || frame.pressed.start)) {
        cards.shift();
        say('move');
      }
      return;
    }
    if (talk) { advanceTalk(dt, frame); return; }
    if (job) {
      job.t += dt;
      if (job.t >= SHIFT_TIME) endShift();
      return;
    }
    if (service) {
      service.t += dt;
      if (service.t >= SERVICE_TIME) endService();
      return;
    }

    run.clock += dt;
    movePlayer(dt, frame);
    if (frame.pressed.a) interact();

    // Nobody stays out all night. Rosa comes and finds you.
    if (run.clock > DAY_LENGTH) {
      endDay(['NIGHT. ROSA FINDS YOU ON THE BENCH AND WALKS YOU HOME.', 'MORNING COMES ANYWAY.']);
    }
  }

  // --- drawing --------------------------------------------------------------

  const sx = (x) => field.x + Math.round(x - cam.x);
  const sy = (y) => field.y + Math.round(y - cam.y);
  const onScreen = (x, y, pad = TILE * 2) =>
    x > cam.x - pad && x < cam.x + field.w + pad && y > cam.y - pad && y < cam.y + field.h + pad;

  const text = (body, x, y, opts = {}) => ({
    text: body, x: Math.round(x), y: Math.round(y),
    scale: opts.scale ?? 2, anchor: opts.anchor ?? 'middle',
    fill: opts.fill ?? PALETTE.cream, font: opts.font ?? FONT,
  });

  const churchWall = (col, row) => col >= 12 && col <= 20 && row >= 5 && row <= 8;

  function baseColour(col, row) {
    switch (tileAt(col, row)) {
      case 'road': case 'edge': return PALETTE.sandDim;
      case 'walk': case 'door': return PALETTE.sand;
      case 'scrub': case 'cactus': return PALETTE.sandLit;
      case 'block': return PALETTE.cream;
      default: {
        // Whatever it is standing on.
        for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const near = tileAt(col + dc, row + dr);
          if (near === 'scrub') return PALETTE.sandLit;
          if (near === 'walk') return PALETTE.sand;
          if (near === 'road') return PALETTE.sandDim;
        }
        return PALETTE.sand;
      }
    }
  }

  function prop(col, row) {
    const kind = tileAt(col, row);
    const x = col * TILE;
    const y = row * TILE;
    const t = TILE;

    switch (kind) {
      case 'block': {
        // Vigas along the top of each wall, a window now and then. The church
        // is trimmed in its own colour, which is how you tell it from a house.
        const trim = churchWall(col, row) ? PLACES.church.paint : PALETTE.bark;
        if ((col * 3 + row * 5) % 5 === 0) return [rect(x + t * 0.26, y + t * 0.28, t * 0.48, t * 0.36, PALETTE.barkDim)];
        return [rect(x, y + t * 0.82, t, t * 0.18, trim)];
      }

      case 'door': {
        const [, place] = placeAt(col, row);
        if (place.kind === 'job' && tileAt(col, row + 1) !== 'walk') {
          // A gate in a fence rather than a door in a wall.
          return [
            rect(x, y + t * 0.12, t * 0.2, t * 0.76, PALETTE.bark),
            rect(x + t * 0.8, y + t * 0.12, t * 0.2, t * 0.76, PALETTE.bark),
            rect(x + t * 0.2, y + t * 0.2, t * 0.6, t * 0.14, place.paint),
          ];
        }
        return [
          rect(x, y, t, t * 0.26, place.paint),                  // the awning, which is the sign
          rect(x + t * 0.24, y + t * 0.3, t * 0.52, t * 0.7, PALETTE.barkDim),
          rect(x + t * 0.62, y + t * 0.58, t * 0.1, t * 0.14, place.paint),
        ];
      }

      case 'scrub':
        return (col * 7 + row * 3) % 4 === 0
          ? [disc(x + t * 0.5, y + t * 0.55, t * 0.2, PALETTE.roughLit), disc(x + t * 0.3, y + t * 0.7, t * 0.14, PALETTE.rough)]
          : [];

      case 'tree':
        return [
          rect(x + t * 0.42, y + t * 0.4, t * 0.16, t * 0.56, PALETTE.bark),
          disc(x + t * 0.5, y + t * 0.34, t * 0.3, PALETTE.leaf),
          disc(x + t * 0.26, y + t * 0.44, t * 0.18, PALETTE.leafDim),
          disc(x + t * 0.74, y + t * 0.44, t * 0.18, PALETTE.leafLit),
        ];

      case 'cactus':
        return [
          rect(x + t * 0.4, y + t * 0.16, t * 0.2, t * 0.8, PALETTE.moss),
          rect(x + t * 0.14, y + t * 0.3, t * 0.16, t * 0.3, PALETTE.mossDim),
          rect(x + t * 0.14, y + t * 0.3, t * 0.34, t * 0.14, PALETTE.mossDim),
          rect(x + t * 0.7, y + t * 0.42, t * 0.16, t * 0.26, PALETTE.mossLit),
          rect(x + t * 0.52, y + t * 0.42, t * 0.34, t * 0.14, PALETTE.mossLit),
        ];

      case 'bench':
        return [
          rect(x + t * 0.1, y + t * 0.34, t * 0.8, t * 0.2, PALETTE.bark),
          rect(x + t * 0.16, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
          rect(x + t * 0.74, y + t * 0.54, t * 0.1, t * 0.3, PALETTE.barkDim),
        ];

      case 'well':
        return [
          disc(x + t * 0.5, y + t * 0.5, t * 0.42, PALETTE.stone),
          disc(x + t * 0.5, y + t * 0.5, t * 0.26, PALETTE.waterDim),
          rect(x + t * 0.44, y - t * 0.1, t * 0.12, t * 0.5, PALETTE.bark),
        ];

      case 'fence':
        return [
          rect(x, y + t * 0.3, t, t * 0.12, PALETTE.bark),
          rect(x + t * 0.2, y + t * 0.16, t * 0.12, t * 0.7, PALETTE.barkDim),
          rect(x + t * 0.7, y + t * 0.16, t * 0.12, t * 0.7, PALETTE.barkDim),
        ];

      case 'truck':
        // Two tiles, drawn from the left one: the cab on the right because it
        // came in nose first from the road and backed off it.
        if (tileAt(col - 1, row) === 'truck') return [];
        return [
          rect(x + t * 0.1, y + t * 0.24, t * 1.8, t * 0.52, PALETTE.moss),
          rect(x + t * 1.25, y + t * 0.16, t * 0.55, t * 0.68, PALETTE.mossLit),
          rect(x + t * 1.3, y + t * 0.26, t * 0.45, t * 0.24, PALETTE.stoneDim),
          rect(x + t * 0.2, y + t * 0.3, t * 0.9, t * 0.4, PALETTE.bark),
          disc(x + t * 0.45, y + t * 0.8, t * 0.14, PALETTE.stoneDim),
          disc(x + t * 1.5, y + t * 0.8, t * 0.14, PALETTE.stoneDim),
          disc(x + t * 0.45, y + t * 0.2, t * 0.14, PALETTE.stoneDim),
          disc(x + t * 1.5, y + t * 0.2, t * 0.14, PALETTE.stoneDim),
        ];

      case 'road': case 'edge':
        // A dashed line down the middle of each road, the way it runs.
        if (row === 12 && col % 2 === 0) return [rect(x + t * 0.3, y + t * 0.44, t * 0.4, t * 0.12, PALETTE.sand)];
        if (col === 16 && row > 13 && row % 2 === 0) return [rect(x + t * 0.44, y + t * 0.3, t * 0.12, t * 0.4, PALETTE.sand)];
        return [];

      default:
        return [];
    }
  }

  // The visible tiles, merged into runs and kept until the window moves.
  let ground = { col: -1, row: -1, shapes: [] };
  function buildGround() {
    const col0 = clamp(colAt(cam.x), 0, COLS - 1);
    const row0 = clamp(rowAt(cam.y), 0, ROWS - 1);
    if (ground.col === col0 && ground.row === row0) return;
    const col1 = Math.min(COLS - 1, col0 + VIEW_COLS + 1);
    const row1 = Math.min(ROWS - 1, row0 + VIEW_ROWS + 1);
    const shapes = [];

    for (let r = row0; r <= row1; r++) {
      let start = col0;
      for (let c = col0 + 1; c <= col1 + 1; c++) {
        if (c <= col1 && baseColour(c, r) === baseColour(start, r)) continue;
        shapes.push(rect(start * TILE, r * TILE, (c - start) * TILE, TILE, baseColour(start, r)));
        start = c;
      }
    }
    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) shapes.push(...prop(c, r));
    }
    ground = { col: col0, row: row0, shapes };
  }

  const shifted = () => {
    const dx = field.x - cam.x;
    const dy = field.y - cam.y;
    return ground.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  };

  // --- bodies ---------------------------------------------------------------

  function figure(x, y, look, { dir = 'down', bob = 0 } = {}) {
    const w = TILE * 0.52;
    const h = TILE * 0.58;
    const head = TILE * 0.23;
    const [fx, fy] = DIRV[dir] ?? DIRV.down;
    const hy = y - h / 2 - head * 0.6 + bob;
    return [
      rect(x - w / 2, y - h / 2 + bob, w, h, look.body),
      rect(x - w / 2, y + h / 2 - TILE * 0.04, w * 0.38, TILE * 0.15 + bob, look.trim),
      rect(x + w / 2 - w * 0.38, y + h / 2 - TILE * 0.04, w * 0.38, TILE * 0.15 - bob, look.trim),
      disc(x, hy, head, look.head),
      disc(x + fx * head * 0.7, hy + fy * head * 0.5, head * 0.4, look.trim),
    ];
  }

  const PLAYER_LOOK = { body: PALETTE.sky, head: PALETTE.bark, trim: PALETTE.emberDim };

  function bodyShapes() {
    const shapes = [];
    const all = people.filter((p) => onScreen(p.x, p.y)).map((p) => ({ ...p, look: p.look, bob: Math.sin(p.walk) * TILE * 0.05 }));
    all.push({ x: player.x, y: player.y, dir: player.dir, look: PLAYER_LOOK, bob: Math.sin(player.walk) * TILE * 0.05 });
    all.sort((a, b) => a.y - b.y);
    for (const p of all) shapes.push(...figure(sx(p.x), sy(p.y), p.look, { dir: p.dir, bob: p.bob }));
    return shapes;
  }

  function portraitShapes(look, x, y, size) {
    return [
      rect(x - size * 0.34, y + size * 0.16, size * 0.68, size * 0.34, look.body),
      disc(x, y - size * 0.06, size * 0.26, look.head),
      rect(x - size * 0.26, y - size * 0.36, size * 0.52, size * 0.16, look.trim),
      disc(x - size * 0.09, y - size * 0.06, size * 0.04, PALETTE.ink),
      disc(x + size * 0.09, y - size * 0.06, size * 0.04, PALETTE.ink),
    ];
  }

  // --- the chrome -----------------------------------------------------------

  function hudParts() {
    const shapes = [
      rect(court.x, court.y, court.w, hud.h, PALETTE.ink),
      rect(court.x, field.y, field.x - court.x, field.h, PALETTE.ink),
      rect(field.x + field.w, field.y, court.x + court.w - field.x - field.w, field.h, PALETTE.ink),
      rect(court.x + 10, court.y + hud.h - 5, court.w - 20, 3, PALETTE.barkDim),
    ];
    const barY = court.y + 40;
    shapes.push(rect(court.x + 92, barY, 140, 16, PALETTE.barkDim));
    shapes.push(rect(court.x + 92, barY, Math.max(3, 140 * (run.trust / TRUST_MAX)), 16, PALETTE.moss));

    return {
      shapes,
      labels: [
        text(`DAY ${String(run.day).padStart(2, '0')}  ${clockLine()}`, court.x + 12, court.y + 6, { anchor: 'start' }),
        text('REFUGIO', mid.x, court.y + 6, { anchor: 'middle', fill: PALETTE.sun }),
        text(money(run.cash), court.x + court.w - 12, court.y + 6, { anchor: 'end', fill: PALETTE.sun }),
        text('TRUST', court.x + 12, barY, { anchor: 'start', fill: PALETTE.bark }),
        text(`FRIENDS ${run.met.size}`, court.x + court.w - 12, barY, { anchor: 'end', fill: PALETTE.cream }),
        text(`${run.shifts} SHIFTS`, court.x + 12, court.y + 74, { anchor: 'start', fill: PALETTE.stone }),
        text(intent().label, court.x + court.w - 12, court.y + 74, { anchor: 'end', fill: PALETTE.moss }),
      ],
    };
  }

  function talkParts() {
    if (!talk) return { shapes: [], portrait: [], labels: [] };
    const rows = talk.choosing ? talk.options.length : talk.pages[talk.page].length;
    const boxH = Math.min(field.h - 16, Math.max(TILE * 5, 54 + rows * LINE_H + 22));
    const x = field.x + 8;
    const y = field.y + field.h - boxH - 8;
    const w = field.w - 16;
    const faceSize = Math.min(TILE * 4.2, boxH - 44);
    const textX = x + faceSize + 40;

    const shapes = [rect(x, y, w, boxH, PALETTE.cream), rect(x + 4, y + 4, w - 8, boxH - 8, PALETTE.ink)];
    const portrait = [
      rect(x + 16, y + 22, faceSize, faceSize, PALETTE.barkDim),
      ...portraitShapes(talk.look, x + 16 + faceSize / 2, y + 22 + faceSize * 0.5, faceSize * 0.92),
    ];
    const labels = [text(talk.who, textX, y + 12, { anchor: 'start', fill: PALETTE.sun })];

    if (talk.choosing) {
      talk.options.forEach((option, i) => {
        labels.push(text(`${i === talk.cursor ? '>' : ' '}${option.label}`, textX, y + 44 + i * LINE_H, {
          anchor: 'start', fill: i === talk.cursor ? PALETTE.sun : PALETTE.cream,
        }));
      });
    } else {
      const page = talk.pages[talk.page];
      let budget = Math.floor(talk.reveal);
      page.forEach((line, i) => {
        labels.push(text(line.slice(0, Math.max(0, budget)), textX, y + 44 + i * LINE_H, { anchor: 'start' }));
        budget -= line.length + 1;
      });
      if (Math.floor(talk.reveal) >= page.join(' ').length) {
        labels.push(text('>>', x + w - 44, y + boxH - 34, { anchor: 'start', fill: PALETTE.sun }));
      }
    }
    return { shapes, portrait, labels };
  }

  function cardParts() {
    if (!cards.length) return { shapes: [], labels: [] };
    const top = cards[0];
    const lines = wrapTo(top.lines, CARD_WRAP);
    const w = TILE * 17;
    const h = 60 + lines.length * 30 + 26;
    const x = mid.x - w / 2;
    const y = field.y + (field.h - h) / 2;
    return {
      shapes: [
        rect(x, y, w, h, PALETTE.cream),
        rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink),
        rect(x + 16, y + 44, w - 32, 3, PALETTE.barkDim),
      ],
      labels: [
        text(top.title, x + 18, y + 12, { anchor: 'start', fill: PALETTE.sun }),
        ...lines.map((line, i) => text(line, x + 18, y + 56 + i * 30, { anchor: 'start' })),
        text('A', x + w - 30, y + h - 30, { anchor: 'start', fill: PALETTE.bark }),
      ],
    };
  }

  // A shift or a service: one plate, one line, and a bar for how far through
  // it is. Time passes in a piece rather than a minigame, for now.
  function busyParts() {
    const doing = job ? [PLACES[job.place].task, job.t / SHIFT_TIME] : service ? ['THE PADRE SPEAKS', service.t / SERVICE_TIME] : null;
    if (!doing) return { shapes: [], labels: [] };
    const [line, through] = doing;
    const w = TILE * 12;
    const h = 96;
    const x = mid.x - w / 2;
    const y = field.y + (field.h - h) / 2;
    return {
      shapes: [
        rect(x, y, w, h, PALETTE.cream),
        rect(x + 4, y + 4, w - 8, h - 8, PALETTE.ink),
        rect(x + 24, y + 56, w - 48, 14, PALETTE.barkDim),
        rect(x + 24, y + 56, Math.max(3, (w - 48) * clamp(through, 0, 1)), 14, PALETTE.sun),
      ],
      labels: [text(line, mid.x, y + 18, { fill: PALETTE.cream })],
    };
  }

  function parts() {
    const chrome = hudParts();
    const box = talkParts();
    const note = cardParts();
    const busy = busyParts();
    return {
      layers: [
        { flat: true, shapes: shifted() },
        { ink: 3, shapes: bodyShapes() },
        { flat: true, shapes: [...chrome.shapes, ...box.shapes, ...note.shapes, ...busy.shapes] },
        ...(box.portrait.length ? [{ ink: 3, shapes: box.portrait }] : []),
      ],
      text: [...chrome.labels, ...box.labels, ...note.labels, ...busy.labels],
    };
  }

  follow(true);
  card('REFUGIO', ['POP. 340. ONE ROAD IN.', 'A TALK OR DO  ·  START PAUSE']);

  return {
    update,
    parts,
    busy: () => Boolean(talk || cards.length || job || service),
    music: () => 'refugio',
    state() {
      const what = intent();
      return {
        day: run.day,
        clock: Math.round(run.clock),
        cash: run.cash,
        trust: run.trust,
        shifts: run.shifts,
        services: run.services,
        met: [...run.met],
        intent: what.kind,
        who: what.kind === 'person' ? what.who.id : what.kind === 'place' ? what.place : null,
        hint: what.label,
        talking: talk ? talk.pages.length - talk.page : 0,
        options: talk && talk.choosing ? talk.options.map((o) => o.label) : [],
        cards: cards.length,
        card: cards.length ? cards[0].title : null,
        working: job ? job.place : null,
        service: Boolean(service),
        at: [Math.round(player.x), Math.round(player.y)],
        tile: [colAt(player.x), rowAt(player.y)],
        people: people.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) })),
      };
    },
    centreOf: (col, row) => [cx(col), cy(row)],
    field,
    TILE,
  };
}

module.exports = {
  create, TOWN, GLYPH, SOLID, COLS, ROWS, PLACES, LOCALS, START,
  DAY_LENGTH, SHIFT_TIME, SERVICE_TIME, SHIFT_TRUST, SERVICE_TRUST, MEET_TRUST, paginate, WRAP,
};

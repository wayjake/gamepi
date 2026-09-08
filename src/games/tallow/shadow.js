'use strict';
// The rack: what a shadow *is*, and how one is cut out of the light.
//
// Fifty of these is only affordable because a shadow is a recipe rather than a
// drawing. `look` is eight knobs -- height, bulk, head, stoop, hat, prop, hem,
// form -- and `build()` turns them into chains and discs. Two shadows with the
// same knobs and different numbers read as two different people at twelve feet
// from a 13" tube, which is the only test that matters.
//
// Everything here is shape only. Colour is decided by the game: the body goes
// into an inkOnly layer filled with PALETTE.shade, and `accent` -- the one
// patch of dyed paper a shadow is allowed -- into a flat layer of its own. A
// character is a silhouette plus one colour, and that is the whole art budget.
//
// Radii have a floor of MIN_R. A chain thinner than that survives the palette
// tests (they only police PALETTE.ink) and then strobes on a real interlaced
// field, which is a bug you cannot see on a Mac. See test/tallow.test.js, which
// runs the flicker check against `shade` for exactly this reason.

const { REGISTERS, ZONES } = require('./registers');

const MIN_R = 3;
const r = (v) => Math.max(MIN_R, v);
const point = (x, y, radius) => ({ x, y, r: r(radius) });
const chain = (...points) => ({ type: 'chain', points });
const disc = (x, y, radius) => ({ type: 'disc', x, y, r: r(radius) });

// Smooth back-and-forth. Duplicated from gfx/motion rather than imported with
// a different period every call site: a puppet's sway is one motion, and it
// wants one place to be tuned.
const sway = (t, period, amp, phase = 0) => Math.sin((t / period + phase) * Math.PI * 2) * amp;

// --- the body ---------------------------------------------------------------

// A jointed figure standing on `base`, `size` pixels tall, facing `dir`.
// `t` drives the idle sway; `phase` keeps two puppets from breathing together.
function figure(look, { x, base, size, t, phase, dir }) {
  const u = size / 100;
  const bulk = look.bulk ?? 1;
  const lean = (look.stoop ?? 0) * 9 * u * dir;
  const breath = sway(t, 3.4, 1.2 * u, phase);
  const arm = sway(t, 2.6, 5 * u, phase + 0.15);

  const foot = base;
  const knee = base - 21 * u;
  const hip = base - 44 * u;
  const shoulder = base - 76 * u + breath;
  const headR = 8.5 * u * (look.head ?? 1);
  const headY = shoulder - headR - 5 * u;
  const hipX = x;
  const shoulderX = x + lean;
  const headX = shoulderX + lean * 0.6;

  const legR = 3.6 * u * bulk;
  const armR = 3.4 * u * bulk;
  const body = [];

  // Legs, or a hem. A long silhouette is a different person from a pair of
  // legs before any other knob is touched, so it is the first thing to reach
  // for when two shadows are coming out too alike.
  if (look.hem) {
    body.push(chain(
      point(shoulderX, shoulder, 8.5 * u * bulk),
      point(hipX, hip, 11 * u * bulk),
      point(hipX - 2 * u * dir, foot - 1 * u, 13 * u * bulk),
    ));
  } else {
    for (const side of [-1, 1]) {
      const step = side * 5 * u;
      body.push(chain(
        point(hipX + step * 0.5, hip, legR * 1.15),
        point(hipX + step, knee, legR),
        point(hipX + step * 1.4, foot, legR * 0.95),
      ));
    }
    body.push(chain(
      point(hipX, hip + 2 * u, 10 * u * bulk),
      point(shoulderX, shoulder, 8.5 * u * bulk),
    ));
  }

  // Arms. The near one holds the rod; the far one swings. A figure in a hem
  // has to reach further out or the arms are swallowed by the robe and it
  // renders as a skittle -- which is exactly what the first version did.
  const reach = look.hem ? 1.45 : 1;
  const nearHand = { x: shoulderX + (14 * u * reach + arm) * dir, y: shoulder + 26 * u - arm * 0.5 };
  const farHand = { x: shoulderX - (11 * u * reach + arm * 0.6) * dir, y: shoulder + 29 * u + arm * 0.4 };
  body.push(chain(
    point(shoulderX + 5 * u * dir, shoulder + 2 * u, armR * 1.1),
    point(shoulderX + 12 * u * reach * dir, shoulder + 15 * u, armR),
    point(nearHand.x, nearHand.y, armR * 0.95),
  ));
  body.push(chain(
    point(shoulderX - 5 * u * dir, shoulder + 2 * u, armR * 1.1),
    point(shoulderX - 10 * u * reach * dir, shoulder + 16 * u, armR),
    point(farHand.x, farHand.y, armR * 0.95),
  ));

  body.push(disc(headX, headY, headR));
  body.push(...hat(look.hat, { x: headX, y: headY, r: headR, u, dir }));

  // The rod. A puppet that is not visibly held is a cartoon, and the whole
  // conceit here is that somebody in the room is working these.
  body.push(chain(
    point(nearHand.x, nearHand.y, 3),
    point(nearHand.x + 11 * u * dir, base + 7 * u, 3),
  ));

  const held = prop(look.prop, { hand: nearHand, u, dir });
  body.push(...held.body);

  return {
    body,
    // Where the one dyed patch goes, if the prop did not already claim it.
    accent: held.accent ?? accentPatch(look, { x: shoulderX, y: shoulder, headX, headY, headR, u, dir }),
  };
}

function hat(kind, { x, y, r: headR, u, dir }) {
  switch (kind) {
    case 'brim':
      return [
        chain(point(x - 15 * u, y - headR * 0.5, 3.2 * u), point(x + 15 * u, y - headR * 0.5, 3.2 * u)),
        disc(x, y - headR * 0.75, headR * 0.72),
      ];
    case 'cap':
      return [disc(x + 2 * u * dir, y - headR * 0.62, headR * 0.85)];
    case 'shawl':
      return [chain(
        point(x - headR * 1.15, y + headR * 0.35, 4.5 * u),
        point(x, y - headR * 0.9, 5.5 * u),
        point(x + headR * 1.15, y + headR * 0.35, 4.5 * u),
        point(x + headR * 0.9, y + headR * 2.4, 4 * u),
      )];
    case 'crop':
      return [chain(point(x - headR * 0.8, y - headR * 0.7, 3.4 * u), point(x + headR * 0.8, y - headR * 0.55, 3.4 * u))];
    default:
      return [];
  }
}

function prop(kind, { hand, u, dir }) {
  switch (kind) {
    case 'lantern': {
      const y = hand.y + 17 * u;
      return {
        body: [chain(point(hand.x, hand.y, 3), point(hand.x, y - 6 * u, 3)), disc(hand.x, y, 7 * u)],
        // The flame is the dyed patch: a lantern that is not lit is a bucket.
        accent: [disc(hand.x, y, Math.max(3, 3.4 * u))],
      };
    }
    case 'staff':
      return {
        body: [chain(point(hand.x + 2 * u * dir, hand.y - 33 * u, 3.4), point(hand.x + 2 * u * dir, hand.y + 20 * u, 3.4))],
        accent: null,
      };
    case 'basket':
      return {
        body: [chain(point(hand.x - 9 * u, hand.y + 9 * u, 5 * u), point(hand.x + 9 * u, hand.y + 9 * u, 5 * u))],
        accent: null,
      };
    case 'tripod': {
      const top = { x: hand.x + 10 * u * dir, y: hand.y - 6 * u };
      return {
        body: [
          chain(point(top.x - 13 * u, top.y + 52 * u, 3.2), point(top.x, top.y, 3.6), point(top.x + 13 * u, top.y + 52 * u, 3.2)),
          chain(point(top.x, top.y, 3.4), point(top.x + 3 * u, top.y + 52 * u, 3.2)),
          chain(point(top.x - 8 * u, top.y - 5 * u, 4.5 * u), point(top.x + 8 * u, top.y - 5 * u, 4.5 * u)),
        ],
        accent: [disc(top.x + 8 * u, top.y - 5 * u, Math.max(3, 3.2 * u))],
      };
    }
    default:
      return { body: [], accent: null };
  }
}

// The fallback dyed patch when the prop has not taken it: a sash across the
// chest, which reads at any size and never leaves the silhouette.
function accentPatch(look, { x, y, u, dir }) {
  return [chain(
    point(x - 6 * u * dir, y + 6 * u, 3.4 * u),
    point(x + 7 * u * dir, y + 19 * u, 3.4 * u),
  )];
}

// --- not everybody in the rack is a person ----------------------------------

function creature(look, { x, base, size, t, phase, dir }) {
  const u = size / 100;
  const mid = base - 40 * u;
  const wag = sway(t, 2.2, 7 * u, phase);
  const nose = { x: x + 46 * u * dir, y: mid + sway(t, 3.1, 3 * u, phase) };
  const tail = { x: x - 44 * u * dir, y: mid + wag };

  return {
    body: [
      chain(
        point(nose.x, nose.y, 5 * u),
        point(x + 14 * u * dir, mid - 2 * u, 15 * u),
        point(x - 16 * u * dir, mid + wag * 0.4, 11 * u),
        point(tail.x, tail.y, 4 * u),
      ),
      // Tail fin, dorsal, and the long low fin underneath.
      chain(point(tail.x, tail.y - 17 * u, 3.4), point(tail.x + 8 * u * dir, tail.y, 5 * u), point(tail.x, tail.y + 17 * u, 3.4)),
      chain(point(x + 6 * u * dir, mid - 15 * u, 3.6), point(x - 6 * u * dir, mid - 26 * u, 3.6)),
      chain(point(x + 4 * u * dir, mid + 14 * u, 3.4), point(x - 12 * u * dir, mid + 21 * u, 3.4)),
    ],
    accent: [disc(x + 27 * u * dir, mid - 4 * u, Math.max(3, 3.6 * u))],
  };
}

// --- the six ----------------------------------------------------------------

// The vertical slice's rack. Fifty is the target; six is what it takes to find
// out whether a silhouette and one dyed patch can tell two people apart at
// 720x480 through composite, which is the question the whole art direction
// rests on. Every register appears at least once as a natural reading and at
// least once as somebody's stretch -- test/tallow.test.js holds that.
//
// `zones` is the dial: the same puppet read three ways depending on how far
// back from the sheet it is held. `stretch` names the one it is bad at, which
// is the only zone that teaches it anything.
const CAST = [
  {
    id: 'marrow',
    short: 'HOB',
    name: 'HOB MARROW',
    was: 'lock-keeper; last man off the valley floor',
    accent: 'ember',
    zones: { sharp: 'grief', full: 'defiance', looming: 'dread' },
    stretch: 'looming',
    look: { form: 'figure', bulk: 1.15, head: 1, stoop: 0.35, hat: 'brim', prop: 'lantern' },
  },
  {
    id: 'nan',
    short: 'NAN',
    name: 'NAN SUTCLIFFE',
    was: 'kept the shop, and everyone else in order',
    accent: 'rose',
    zones: { sharp: 'tenderness', full: 'comedy', looming: 'defiance' },
    stretch: 'looming',
    look: { form: 'figure', bulk: 1.05, head: 1.05, stoop: 0.15, hat: 'shawl', prop: 'basket', hem: true },
  },
  {
    id: 'bell',
    short: 'BELL',
    name: 'FATHER BELL',
    was: 'buried the valley twice: once in ground, once in water',
    accent: 'sun',
    zones: { sharp: 'grief', full: 'tenderness', looming: 'wonder' },
    stretch: 'looming',
    look: { form: 'figure', bulk: 0.95, head: 1.08, stoop: 0.5, hat: 'crop', prop: 'staff', hem: true },
  },
  {
    id: 'tam',
    short: 'TAM',
    name: 'TAM ORCHARD',
    was: 'a boy who ran the lanes and never left them',
    accent: 'moss',
    zones: { sharp: 'comedy', full: 'wonder', looming: 'tenderness' },
    stretch: 'looming',
    look: { form: 'figure', bulk: 0.8, head: 1.2, stoop: 0, hat: 'cap', prop: 'none' },
  },
  {
    id: 'survey',
    short: 'SURVEYOR',
    name: 'THE SURVEYOR',
    was: 'measured the valley for the dam, and was civil about it',
    accent: 'violet',
    zones: { sharp: 'comedy', full: 'defiance', looming: 'dread' },
    stretch: 'sharp',
    look: { form: 'figure', bulk: 1, head: 0.95, stoop: 0, hat: 'brim', prop: 'tripod' },
  },
  {
    id: 'pike',
    short: 'PIKE',
    name: 'THE PIKE',
    was: 'not a person. The troupe uses him anyway',
    accent: 'sky',
    zones: { sharp: 'wonder', full: 'grief', looming: 'dread' },
    stretch: 'sharp',
    look: { form: 'creature', bulk: 1 },
  },
];

// A shadow's reading right now: which register the dial is producing, and
// whether that is the zone it has to stretch for.
function reading(shadow, depth) {
  const zone = ZONES.find((z) => depth <= z.upTo) ?? ZONES[ZONES.length - 1];
  return { zone: zone.id, register: shadow.zones[zone.id], stretch: shadow.stretch === zone.id };
}

function build(shadow, options) {
  return shadow.look.form === 'creature' ? creature(shadow.look, options) : figure(shadow.look, options);
}

// Everything a rack entry has to add up to, checked at require time -- the
// house rule (angels' ROOMS, kingpin's PLACES, song.validate, manifest).
// A shadow whose zones name a register that does not exist is a scene that
// cannot be cast, and that is not something a playthrough would show you.
function validate(cast = CAST) {
  const seen = new Set();
  for (const shadow of cast) {
    const where = `tallow cast: ${shadow.id ?? '(no id)'}`;
    if (!shadow.id) throw new Error('tallow cast: a shadow with no id');
    if (seen.has(shadow.id)) throw new Error(`${where}: two shadows share an id`);
    seen.add(shadow.id);
    if (!shadow.name || !shadow.was) throw new Error(`${where}: a shadow is a person, so it needs a name and a line`);
    // The HUD prints `short` beside a register on one line at scale 2, and
    // there is room for eight characters and no more.
    if (!shadow.short || shadow.short.length > 8) throw new Error(`${where}: short is missing or longer than 8 characters`);
    for (const zone of ZONES) {
      const register = shadow.zones?.[zone.id];
      if (!REGISTERS[register]) throw new Error(`${where}: zone ${zone.id} is ${JSON.stringify(register)}, not a register`);
    }
    if (!ZONES.some((z) => z.id === shadow.stretch)) throw new Error(`${where}: stretch is ${JSON.stringify(shadow.stretch)}, not a zone`);
    if (!shadow.accent) throw new Error(`${where}: no accent -- one patch of dyed paper is how it is told apart`);
  }
  return cast;
}

validate();

module.exports = { CAST, build, reading, validate, figure, creature, MIN_R };

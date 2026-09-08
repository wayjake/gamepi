'use strict';
// What the piece looks like.
//
// The rule this whole file works to: nothing here is a spectrum analyser. The
// rack hands over *musical* state -- which parts are sounding, how hard, at
// what pitch, where in the movement -- and the picture is drawn from that. A
// bar chart of FFT bins would move with the sound too, and it would tell you
// nothing you could not hear better; a sun that crosses the sky once per piece
// tells you where you are in ten minutes at a glance, and a horizon that lifts
// when the pad comes in tells you what the switch you just pressed did.
//
// So every part owns one thing on screen, and switching it off takes that thing
// away:
//
//   pad    the sky, and how far up it the light reaches
//   choir  the aurora over the hills
//   bass   the ground, breathing, and the size of the disc
//   beat   rings off the disc on the kick, sparks on the hats
//   keys   blooms, which open and close where the note was
//   arp    pillars standing on the horizon
//   lead   the tracer, drawing its own pitch across the sky
//   haze   the grain, which is the only thing always there
//
// State moves in update(); layers() is a pure read of it, because scene() is
// called twice on one state by the tests and has to draw the same picture both
// times.
//
// **There is no ink in this picture at all.** It is the second game here to go
// that way, for a different reason than tallow.js did: a poster outline has to
// be the last thing drawn over a shape or it shows through as a sliver, and
// this picture is full of things that pass behind other things -- a disc
// setting into a ridge, a ring growing off the bottom of the frame, dust laid
// over everything. The first version outlined the disc and the horizon cut a
// one-pixel-tall band of ink out of it, which is precisely the run an
// interlaced field strobes on. So value does the work instead: every mark is a
// dark shape with a bright one inside it, and the five-step wash is wide
// enough for that to read against any part of the sky.

const raster = require('../../gfx/raster');
const { Rng } = require('../../audio/tone');

const MOTES = 44;
const TRAIL = 64;          // frames of lead the tracer remembers
const TAIL = 12;           // and how many of them it draws
const TONES = 12;          // pillars: one per pitch class, not one per note
const MAX_BLOOMS = 18;
const MAX_RINGS = 6;
const MAX_SPARKS = 14;

const rect = (x, y, w, h, fill) => ({ type: 'rect', x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), fill });
const disc = (x, y, r, fill) => ({ type: 'disc', x: Math.round(x), y: Math.round(y), r: Math.max(1, Math.round(r)), fill });
const chain = (points, fill) => ({ type: 'chain', points, fill });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// A pitch, folded into the width of the view. Octaves stack rather than run
// off the side: the note an octave up lands in the same place, higher.
const across = (midi) => ((midi % 12) + 12) % 12 / 11;
const height = (midi) => clamp((midi - 36) / 54, 0, 1);

function create({ view, wash, seed = 1 }) {
  const rng = new Rng(seed * 2654435761 + 17);

  // The window the picture is drawn in. It comes from halcyon.js, which owns
  // the layout: the head, the strip, this, the hint line and the desk have to
  // add up to the picture rectangle exactly, and one file has to be able to see
  // all five at once to get that right.
  const horizon = view.y + Math.round(view.h * 0.60);

  const state = {
    t: 0,
    motes: [],
    // One pillar per pitch class rather than one per note. Notes arrive a
    // second apart at these tempos, so a pillar per note is two poles standing
    // in a field looking accidental; a bank of twelve that light and fade is an
    // instrument, and the shape of the sequence is legible in it.
    pillars: new Float32Array(TONES),
    blooms: [],
    rings: [],
    sparks: [],
    trail: [],
    lead: { x: 0, y: 0, tx: 0, ty: 0, started: false },
  };

  // The grain. Always there, because the tape is always running -- and because
  // it is the one thing on screen that differs between two seeds, which is what
  // makes a seeded frame a seeded frame.
  for (let i = 0; i < MOTES; i++) {
    state.motes.push({
      x: rng.range(view.x, view.x + view.w),
      y: rng.range(view.y, view.y + view.h),
      r: rng.range(1.6, 3.4),
      vx: rng.range(-9, 9),
      vy: rng.range(-5, -1),
      k: rng.range(0.4, 1),
    });
  }

  function update(dt, rig, fired) {
    state.t += dt;
    const meters = rig.meters;
    const on = (stem) => (rig.levels[stem] ?? 0) > 0;

    for (const mote of state.motes) {
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt * (0.4 + (meters.haze ?? 0) * 2.4);
      if (mote.y < view.y) { mote.y = view.y + view.h; mote.x = rng.range(view.x, view.x + view.w); }
      if (mote.x < view.x) mote.x += view.w;
      if (mote.x > view.x + view.w) mote.x -= view.w;
    }

    for (let i = 0; i < TONES; i++) {
      state.pillars[i] = Math.max(0, state.pillars[i] - dt * 0.85);
    }

    for (const list of [state.blooms, state.rings, state.sparks]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].life -= dt / list[i].span;
        if (list[i].life <= 0) list.splice(i, 1);
      }
    }

    // A muted part draws nothing. That is the whole interaction: the switch is
    // in the picture as much as it is in the sound.
    for (const event of fired) {
      if (!on(event.stem)) continue;
      switch (event.stem) {
        case 'arp': {
          const tone = ((event.midi % TONES) + TONES) % TONES;
          state.pillars[tone] = Math.max(state.pillars[tone], 0.35 + height(event.midi) * 0.65 * (0.4 + event.vel));
          break;
        }
        case 'keys':
          if (state.blooms.length < MAX_BLOOMS) {
            state.blooms.push({
              x: view.x + 30 + across(event.midi) * (view.w - 60),
              y: Math.max(view.y + 26, horizon - 12 - height(event.midi) * (view.h * 0.5)),
              r: 6 + event.vel * 16,
              life: 1, span: 1.5,
            });
          }
          break;
        case 'beat':
          if (event.voice === 'K' && state.rings.length < MAX_RINGS) {
            state.rings.push({ life: 1, span: 1.1, vel: event.vel });
          } else if ((event.voice === 'h' || event.voice === 'H') && state.sparks.length < MAX_SPARKS) {
            state.sparks.push({
              x: rng.range(view.x + 24, view.x + view.w - 24),
              y: horizon - rng.range(4, 26),
              life: 1, span: event.voice === 'H' ? 0.5 : 0.22,
            });
          }
          break;
        case 'lead': {
          // Side to side by pitch class, up and down by register. A tune that
          // returns to its tonic comes back to the same place on the screen,
          // which is what makes the shape of it legible rather than decorative.
          const sky = { top: view.y + 18, bottom: horizon - 56 };
          state.lead.tx = view.x + 40 + across(event.midi) * (view.w - 80);
          state.lead.ty = sky.bottom - height(event.midi) * (sky.bottom - sky.top);
          if (!state.lead.started) {
            state.lead.started = true;
            state.lead.x = state.lead.tx;
            state.lead.y = state.lead.ty;
          }
          break;
        }
        default:
          break;
      }
    }

    // The tune is a light with a tail. It slides to each new note rather than
    // jumping, so a step reads as a step and a leap reads as a leap; the tail
    // is where it has just been, and it goes out when the tune stops.
    const glide = Math.min(1, dt * 11);
    state.lead.x += (state.lead.tx - state.lead.x) * glide;
    state.lead.y += (state.lead.ty - state.lead.y) * glide;
    const live = on('lead') ? (meters.lead ?? 0) : 0;
    state.trail.push({ x: state.lead.x, y: state.lead.y, live });
    while (state.trail.length > TRAIL) state.trail.shift();
  }

  // --- drawing ---------------------------------------------------------------

  function sky(meters, where, glow) {
    const shapes = [];
    const lift = meters.pad ?? 0;
    const top = view.y;
    const span = horizon - view.y;
    // Four boundaries, drifting. The pad pushes the light up the sky; with the
    // pad off the bands sit low and the picture is mostly dark, which is what
    // that switch sounds like too.
    //
    // The edges are rounded to whole pixels *before* the bands are cut from
    // them, and each band runs from one edge to the next. Rounding a band's top
    // and its height separately leaves a row unpainted wherever the two round
    // opposite ways -- and the background here is ink, so that row is a
    // 640-pixel one-pixel-tall ink line, which is the one thing an interlaced
    // field cannot draw. Same reasoning as kingpin's whole-pixel camera.
    const base = [0.20, 0.40, 0.60, 0.80];
    const edges = [Math.round(top)];
    for (let k = 0; k < 4; k++) {
      const at = top + span * clamp(
        base[k] + 0.035 * Math.sin(state.t * 0.13 + k * 1.7) - lift * 0.16 * (1 - k / 4),
        0.04, 0.98,
      );
      edges.push(Math.max(edges[k], Math.round(at)));
    }
    edges.push(Math.max(edges[4], Math.round(horizon)));
    for (let k = 0; k < 5; k++) {
      const height = edges[k + 1] - edges[k];
      if (height > 0) shapes.push({ type: 'rect', x: view.x, y: edges[k], w: view.w, h: height, fill: wash[k] });
    }
    // The last of the light gathers where the disc meets the ground, and only
    // there: at noon the sky is even and the glow has gone.
    // Above the ridge line, or the hills would bury it.
    const spill = 20 + lift * 42;
    if (glow > 0.05) shapes.push(disc(where.x, horizon - 34, spill * glow, wash[4]));
    return shapes;
  }

  // A ridge line: a crest chain for the shape of it, and a slab under it that
  // starts *above* the nominal line rather than below. That overlap is the
  // whole trick -- with the slab starting under the crest, a bar where the
  // hills happened to be high left a one pixel band of unpainted background
  // showing at the horizon, and the background here is ink, which is exactly
  // the run an interlaced field strobes on.
  function ridge(depth, amp, speed, colour, meters) {
    const points = [];
    const drift = state.t * speed;
    const lean = 1 + (meters.choir ?? 0) * 0.9;
    for (let i = -1; i <= 9; i++) {
      const f = i / 8;
      const x = view.x + f * view.w;
      const y = horizon - depth
        - amp * lean * (0.55 + 0.45 * Math.sin(f * 5.1 + drift + depth))
        - amp * 0.4 * Math.sin(f * 11.3 - drift * 0.7);
      points.push({ x: Math.round(x), y: Math.round(y), r: 18 });
    }
    const floor = Math.round(horizon - depth - 2);
    return [
      chain(points, colour),
      { type: 'rect', x: view.x, y: floor, w: view.w, h: Math.max(1, view.y + view.h - floor), fill: colour },
    ];
  }

  function aurora(meters) {
    const level = meters.choir ?? 0;
    if (level < 0.02) return [];
    const shapes = [];
    for (let band = 0; band < 3; band++) {
      const points = [];
      for (let i = 0; i <= 7; i++) {
        const f = i / 7;
        points.push({
          x: Math.round(view.x + f * view.w),
          y: Math.round(Math.max(view.y + 18, horizon - 40 - band * 26 - level * 52
            - Math.sin(f * 4 + state.t * (0.5 + band * 0.17)) * (12 + level * 26))),
          r: Math.round(4 + level * 7),
        });
      }
      shapes.push(chain(points, wash[3 + (band % 2)]));
    }
    return shapes;
  }

  // Where the sun is: once across the sky over the length of the piece. It is
  // the clock as well as the light, and it is why the piece is called what it
  // is called.
  function discAt(rig) {
    const whole = rig.where().whole;
    const swell = (rig.meters.bass ?? 0) * 0.55 + (rig.meters.pad ?? 0) * 0.3;
    return {
      x: view.x + view.w * (0.11 + 0.78 * whole),
      y: horizon - Math.sin(Math.PI * whole) * (view.h * 0.44) - 10,
      r: 20 + swell * 15,
    };
  }

  function marks(rig, where) {
    const shapes = [];
    const meters = rig.meters;
    const on = (stem) => (rig.levels[stem] ?? 0) > 0;

    // The rings the kick knocks off the disc. The disc itself is behind the
    // hills, so that it sets into them rather than over them. A ring stops at
    // the edge of the window rather than growing out of it: nothing in this
    // picture is allowed to be drawn over by the desk below.
    if (on('beat')) {
      const limit = Math.min(where.y - view.y - 4, view.y + view.h - where.y - 4, 150);
      for (const ring of state.rings) {
        const r = where.r + (1 - ring.life) * 150 * ring.vel;
        if (r < 6 || r > limit) continue;
        const weight = 2 + ring.life * 3;
        shapes.push(chain(raster.arc(where.x, where.y, r, 0, 360, weight + 2, 14), wash[0]));
        shapes.push(chain(raster.arc(where.x, where.y, r, 0, 360, weight, 14), wash[4]));
      }
    }

    if (on('arp')) {
      const step = (view.w - 128) / (TONES - 1);
      for (let i = 0; i < TONES; i++) {
        const level = state.pillars[i];
        if (level < 0.03) continue;
        const x = view.x + 64 + i * step;
        const h = 12 + level * 104;
        shapes.push(rect(x - 5, horizon - h - 3, 10, h + 3, wash[0]));
        shapes.push(rect(x - 3, horizon - h, 6, h, wash[4]));
      }
    }

    if (on('keys')) {
      for (const bloom of state.blooms) {
        const grow = Math.sin(Math.min(1, (1 - bloom.life) * 2.2) * Math.PI * 0.5);
        const r = bloom.r * (0.35 + grow * 0.65) * (0.4 + bloom.life * 0.6);
        // Below about three pixels the dark ring swallows the bright middle and
        // a bloom closing looks like a hole punched in the hillside.
        if (r < 3) continue;
        shapes.push(disc(bloom.x, bloom.y, r * 1.3 + 1, wash[0]));
        shapes.push(disc(bloom.x, bloom.y, r, wash[4]));
      }
    }

    if (on('beat')) {
      for (const spark of state.sparks) {
        shapes.push(rect(spark.x - 3, spark.y - 3, 7, 7, wash[0]));
        shapes.push(rect(spark.x - 2, spark.y - 2, 5, 5, wash[4]));
      }
    }

    // The tune, and its tail. Only the live part of the trail is drawn, so the
    // light goes out when the tune stops rather than hanging in the sky.
    if (on('lead') && state.lead.started) {
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          shapes.push(chain(run.map((p) => ({ ...p, r: p.r + 1 })), wash[1]));
          shapes.push(chain(run, wash[4]));
        }
        run = [];
      };
      const from = Math.max(0, state.trail.length - TAIL);
      for (let i = from; i < state.trail.length; i++) {
        const point = state.trail[i];
        if (point.live < 0.03) { flush(); continue; }
        const f = (i - from) / TAIL;
        run.push({ x: Math.round(point.x), y: Math.round(point.y), r: 1 + Math.round(f * 1.5) });
      }
      flush();
      const head = state.trail[state.trail.length - 1];
      if (head && head.live >= 0.03) {
        shapes.push(disc(head.x, head.y, 6 + head.live * 5, wash[1]));
        shapes.push(disc(head.x, head.y, 3 + head.live * 4, wash[4]));
      }
    }

    return shapes;
  }

  function motes(meters) {
    const level = 0.35 + (meters.haze ?? 0) * 0.65;
    return state.motes.map((mote) => disc(mote.x, mote.y, mote.r * (0.6 + level * mote.k), wash[3]));
  }

  // The whole picture, back to front. Nothing here reads anything it has not
  // been handed, and nothing here writes.
  function layers(rig) {
    const meters = rig.meters;
    const where = discAt(rig);
    const out = [];

    const glow = 1 - Math.sin(Math.PI * rig.where().whole);

    out.push({ flat: true, shapes: sky(meters, where, glow) });
    if ((rig.levels.choir ?? 0) > 0) out.push({ flat: true, alpha: 0.7, shapes: aurora(meters) });
    // Three discs, not one with an outline: the widest step is dark enough to
    // separate it from a bright sky and the core is bright enough to separate
    // it from a dark one, so the disc reads at every hour of its arc.
    out.push({ flat: true, shapes: [
      disc(where.x, where.y, where.r + 7, wash[2]),
      disc(where.x, where.y, where.r + 3, wash[3]),
      disc(where.x, where.y, where.r, wash[4]),
    ] });
    out.push({ flat: true, shapes: ridge(6, 26, 0.055, wash[2], meters) });
    out.push({ flat: true, shapes: ridge(-16, 34, 0.09, wash[1], meters) });
    out.push({ flat: true, shapes: ridge(-46, 30, 0.14, wash[0], meters) });
    out.push({ flat: true, shapes: marks(rig, where) });
    out.push({ flat: true, alpha: 0.7, shapes: motes(meters) });
    return out;
  }

  return { update, layers, view, horizon, state };
}

module.exports = { create, TRAIL, TAIL, TONES, MOTES };

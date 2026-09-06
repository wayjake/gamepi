'use strict';

//
// A game is not a scene. A scene is `build(width, height, t)` -- a pure
// function of time that the tests can render at any instant and compare. This
// is a state machine that has to be *driven*: update() advances it by one fixed
// step, scene() draws whatever it currently is. What it keeps from the scene
// contract is that drawing has no side effects, so the same state always draws
// the same picture, and that time still arrives in fixed steps -- given the
// same sequence of inputs the whole match replays identically, which is what
// test/game.test.js leans on.
//
// Everything is laid out in the picture rectangle from gfx/safearea.js, so the
// CRT's overscan is accounted for before a single pixel is placed.

const path = require('path');
const { PALETTE } = require('../gfx/palette');
const { picture } = require('../gfx/safearea');
const scores = require('../scores');
const input = require('../input');
const psf = require('../psf');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const FONT = psf.load(path.join(ASSETS, 'Lat15-TerminusBold16.psf.gz'));   // 8x16
const HEAVY = psf.load(path.join(ASSETS, 'Lat15-TerminusBold32x16.psf.gz')); // 16x32

const GAME = 'pong';
const WIN = 11;

// Play field, in the design space the picture rectangle gives us.
const PADDLE_W = 14;
const PADDLE_H = 76;
const BALL = 14;
const WALL = 24;          // paddle inset from its end of the court
const PADDLE_SPEED = 340; // px/s
const CPU_SPEED = 280;    // deliberately slower than a player can move

// How far off the ball the CPU aims. Without the growth term a good player and
// a competent CPU rally forever -- measured: two of four seeds never finished a
// match at all. Letting the error widen as a rally goes on ends them, and ends
// them the way a real one ends, with somebody's concentration going rather than
// with a sudden change of rules. Tuned against a bot that never misses: a
// perfect player wins 11-9ish, a player who never moves loses 0-11.
const CPU_SPREAD = 60;
const CPU_SPREAD_PER_RALLY = 5;
const CPU_SPREAD_MAX = 140;
const BALL_START = 300;
const BALL_MAX = 620;
const SPEEDUP = 1.045;    // per return
const MAX_BOUNCE = 1.05;  // radians off the horizontal, at the paddle's tip
// ...and a floor, because a ball hit dead centre otherwise comes back exactly
// horizontal and the rally stops being about anything.
const MIN_BOUNCE = 0.12;
const SERVE_PAUSE = 1.0;  // seconds between a point and the next serve

// Scoring for the high table. Points alone would put every match between 11 and
// 11-and-a-bit, which makes a dull board, so rallies count too: you are ranked
// on how long you kept the ball alive as much as on winning.
const PER_RETURN = 1;
const PER_POINT = 25;
const MATCH_BONUS = 100;
const PER_POINT_SPARED = 10;

const MENU = [
  { id: '1p', label: '1 PLAYER' },
  { id: '2p', label: '2 PLAYERS' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'quit', label: 'QUIT' },
];
const PAUSE_MENU = [
  { id: 'resume', label: 'RESUME' },
  { id: 'restart', label: 'RESTART' },
  { id: 'quit', label: 'QUIT TO MENU' },
];

// Seeded, because a scene that used Math.random would render differently every
// time and nothing could be compared against anything. mulberry32.
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

function create(width = 720, height = 480, options = {}) {
  const court = picture(width, height);
  const random = rng(options.seed ?? 0x504f4e47);
  const table = options.scores ?? scores;

  const mid = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const sounds = [];
  const say = (name) => sounds.push(name);

  const game = {
    screen: 'menu',
    exit: false,     // the shell watches this; see src/shell.js
    elapsed: 0,      // seconds inside the current screen
    players: 1,
    cursor: 0,
    board: table.table(GAME),
    placing: 0,
    initials: [0, 0, 0],
    slot: 0,
    winner: null,
    tally: 0,        // what goes on the high score table
    score: [0, 0],
    serveIn: 0,
    rally: 0,
    left: { y: mid.y, up: false, down: false },
    right: { y: mid.y },
    ball: { x: mid.x, y: mid.y, vx: 0, vy: 0, speed: BALL_START },
    cpuError: 0,
  };

  const go = (screen) => {
    game.screen = screen;
    game.elapsed = 0;
  };

  // --- play -----------------------------------------------------------------

  function serve(toward) {
    game.ball.x = mid.x;
    game.ball.y = mid.y;
    game.ball.speed = BALL_START;
    game.serveIn = SERVE_PAUSE;
    game.rally = 0;
    // A shallow angle, never flat: a ball travelling exactly horizontally is
    // both dull and, at one pixel of vertical movement a second, prone to
    // sitting in a single interlaced field.
    const angle = (random() * 0.5 + 0.15) * (random() < 0.5 ? -1 : 1);
    game.ball.vx = Math.cos(angle) * BALL_START * toward;
    game.ball.vy = Math.sin(angle) * BALL_START;
    aimCpu();
  }

  const aimCpu = () => {
    const spread = Math.min(CPU_SPREAD_MAX, CPU_SPREAD + game.rally * CPU_SPREAD_PER_RALLY);
    game.cpuError = (random() - 0.5) * spread;
  };

  function newMatch(players) {
    game.players = players;
    game.score = [0, 0];
    game.tally = 0;
    game.winner = null;
    game.left.y = mid.y;
    game.right.y = mid.y;
    serve(random() < 0.5 ? -1 : 1);
    go('play');
  }

  const paddleTop = (y) => clamp(y, court.y + PADDLE_H / 2, court.y + court.h - PADDLE_H / 2);

  function movePaddle(paddle, frame, dt, speed) {
    let dy = 0;
    if (frame.up) dy -= 1;
    if (frame.down) dy += 1;
    paddle.y = paddleTop(paddle.y + dy * speed * dt);
  }

  function moveCpu(dt) {
    // Chases the ball's height, but only once the ball is coming this way, and
    // with a per-rally error so it isn't a wall. Beatable, but not a pushover.
    const target = game.ball.vx > 0 ? game.ball.y + game.cpuError : mid.y;
    const gap = target - game.right.y;
    const step = CPU_SPEED * dt;
    game.right.y = paddleTop(game.right.y + clamp(gap, -step, step));
  }

  // Reflects off a paddle. Where the ball lands on the paddle sets the angle,
  // so a player can aim -- that one rule is most of what makes pong a game.
  function bounceOff(paddle, direction) {
    const offset = clamp((game.ball.y - paddle.y) / (PADDLE_H / 2), -1, 1);
    const aimed = offset * MAX_BOUNCE;
    const up = aimed < 0 ? -1 : aimed > 0 ? 1 : random() < 0.5 ? -1 : 1;
    const angle = up * Math.max(MIN_BOUNCE, Math.abs(aimed));
    game.ball.speed = Math.min(BALL_MAX, game.ball.speed * SPEEDUP);
    game.ball.vx = Math.cos(angle) * game.ball.speed * direction;
    game.ball.vy = Math.sin(angle) * game.ball.speed;
    game.rally++;
    // The CPU picks a fresh aiming error each time it returns, not once a
    // serve: the same error all rally is a paddle you can read.
    if (direction < 0) aimCpu();
    if (game.players === 1 && direction > 0) game.tally += PER_RETURN;
    say('paddle');
  }

  function point(scorer) {
    game.score[scorer]++;
    if (game.players === 1 && scorer === 0) game.tally += PER_POINT;
    say('point');

    if (game.score[scorer] >= WIN) {
      game.winner = scorer;
      if (game.players === 1 && scorer === 0) {
        game.tally += MATCH_BONUS + PER_POINT_SPARED * (WIN - game.score[1]);
      }
      game.placing = game.players === 1 && game.tally > 0 ? table.placing(GAME, game.tally) : 0;
      game.initials = [0, 0, 0];
      game.slot = 0;
      go('over');
      return;
    }
    serve(scorer === 0 ? -1 : 1); // serve toward whoever just conceded
  }

  function play(dt, p1, p2) {
    movePaddle(game.left, p1, dt, PADDLE_SPEED);
    if (game.players === 2) movePaddle(game.right, p2, dt, PADDLE_SPEED);
    else moveCpu(dt);

    if (game.serveIn > 0) {
      game.serveIn -= dt;
      if (game.serveIn <= 0) say('serve');
      return;
    }

    const ball = game.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const top = court.y + BALL / 2;
    const bottom = court.y + court.h - BALL / 2;
    if (ball.y < top) { ball.y = top + (top - ball.y); ball.vy = Math.abs(ball.vy); say('wall'); }
    if (ball.y > bottom) { ball.y = bottom - (ball.y - bottom); ball.vy = -Math.abs(ball.vy); say('wall'); }

    const leftFace = court.x + WALL + PADDLE_W;
    const rightFace = court.x + court.w - WALL - PADDLE_W;
    const reach = PADDLE_H / 2 + BALL / 2;

    if (ball.vx < 0 && ball.x - BALL / 2 <= leftFace && ball.x > court.x) {
      if (Math.abs(ball.y - game.left.y) <= reach) {
        ball.x = leftFace + BALL / 2;
        bounceOff(game.left, 1);
      }
    }
    if (ball.vx > 0 && ball.x + BALL / 2 >= rightFace && ball.x < court.x + court.w) {
      if (Math.abs(ball.y - game.right.y) <= reach) {
        ball.x = rightFace - BALL / 2;
        bounceOff(game.right, -1);
      }
    }

    if (ball.x < court.x - BALL) point(1);
    else if (ball.x > court.x + court.w + BALL) point(0);
  }

  // --- menus ----------------------------------------------------------------

  function moveCursor(frame, length) {
    if (frame.pressed.up) { game.cursor = (game.cursor + length - 1) % length; say('move'); }
    if (frame.pressed.down) { game.cursor = (game.cursor + 1) % length; say('move'); }
  }

  const confirmed = (frame) => frame.pressed.a || frame.pressed.start;

  function editInitials(frame) {
    const size = scores.ALPHABET.length;
    if (frame.pressed.up) { game.initials[game.slot] = (game.initials[game.slot] + size - 1) % size; say('move'); }
    if (frame.pressed.down) { game.initials[game.slot] = (game.initials[game.slot] + 1) % size; say('move'); }
    if (frame.pressed.left && game.slot > 0) { game.slot--; say('move'); }
    if (frame.pressed.right && game.slot < 2) { game.slot++; say('move'); }

    if (!confirmed(frame)) return;
    if (game.slot < 2) { game.slot++; say('move'); return; }

    game.board = table.record(GAME, game.initials.map((i) => scores.ALPHABET[i]).join(''), game.tally);
    game.placing = 0;
    say('select');
    go('scores');
  }

  // --- the step -------------------------------------------------------------

  function update(dt, pads = {}) {
    const p1 = pads.p1 ?? input.idle();
    const p2 = pads.p2 ?? input.idle();
    const any = input.merge(p1, p2); // either pad may drive a menu
    game.elapsed += dt;

    switch (game.screen) {
      case 'menu': {
        moveCursor(any, MENU.length);
        if (!confirmed(any)) break;
        say('select');
        const choice = MENU[game.cursor].id;
        if (choice === 'quit') { game.exit = true; break; }
        if (choice === 'scores') { game.board = table.table(GAME); go('scores'); }
        else newMatch(choice === '2p' ? 2 : 1);
        break;
      }

      case 'scores':
        if (confirmed(any) || any.pressed.b) { say('back'); game.cursor = 0; go('menu'); }
        break;

      case 'play':
        if (any.pressed.start) { game.cursor = 0; say('select'); go('paused'); break; }
        play(dt, p1, p2);
        break;

      case 'paused': {
        moveCursor(any, PAUSE_MENU.length);
        if (any.pressed.b) { say('back'); go('play'); break; }
        if (!confirmed(any)) break;
        say('select');
        const choice = PAUSE_MENU[game.cursor].id;
        if (choice === 'resume') go('play');
        else if (choice === 'restart') newMatch(game.players);
        else { game.cursor = 0; go('menu'); }
        break;
      }

      case 'over':
        // A moment's grace, so the button that won the point doesn't skip the
        // screen it just produced.
        if (game.elapsed < 0.6) break;
        if (game.placing > 0) { editInitials(any); break; }
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

  // Vertically centres a line of the given font and scale on `y`.
  const centred = (body, y, opts = {}) => {
    const font = opts.font ?? FONT;
    const scale = opts.scale ?? 2;
    return text(body, mid.x, y - (font.height * scale) / 2, { ...opts, font, scale });
  };

  // `gap` blanks a band of the net so a line of text can sit across the centre
  // without the dashes running through the letters.
  const net = (gap = null) => {
    const dashes = [];
    for (let y = court.y + 6; y < court.y + court.h - 10; y += 30) {
      if (gap && y + 18 > gap.y0 && y < gap.y1) continue;
      dashes.push(rect(mid.x - 3, y, 6, 18, PALETTE.bark));
    }
    return dashes;
  };

  function courtLayers(gap = null) {
    return [{
      flat: true,
      shapes: [
        ...net(gap),
        rect(court.x + WALL, game.left.y - PADDLE_H / 2, PADDLE_W, PADDLE_H, PALETTE.cream),
        rect(court.x + court.w - WALL - PADDLE_W, game.right.y - PADDLE_H / 2, PADDLE_W, PADDLE_H, PALETTE.sky),
        // The ball is hidden between a point and the next serve.
        ...(game.serveIn > 0 ? [] : [rect(game.ball.x - BALL / 2, game.ball.y - BALL / 2, BALL, BALL, PALETTE.sun)]),
      ],
    }];
  }

  const scoreText = () => [
    text(String(game.score[0]), mid.x - 60, court.y + 14, { scale: 2, font: HEAVY, fill: PALETTE.cream, anchor: 'end' }),
    text(String(game.score[1]), mid.x + 60, court.y + 14, { scale: 2, font: HEAVY, fill: PALETTE.sky }),
  ];

  function menuList(items, cursor, top) {
    const out = [];
    items.forEach((item, i) => {
      const selected = i === cursor;
      out.push(centred(`${selected ? '▶ ' : '  '}${item.label}`, top + i * 44, {
        scale: 2, fill: selected ? PALETTE.sun : PALETTE.cream,
      }));
    });
    return out;
  }

  function menuScreen() {
    return {
      layers: [{ flat: true, shapes: [rect(mid.x - 150, court.y + 132, 300, 5, PALETTE.bark)] }],
      text: [
        centred('PONG', court.y + 78, { scale: 3, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(MENU, game.cursor, court.y + 210),
        centred('START OR A TO CHOOSE', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  function scoresScreen() {
    const rows = game.board.map((row, i) => [
      text(String(row.rank).padStart(2, ' '), mid.x - 180, court.y + 130 + i * 34, { anchor: 'start', fill: PALETTE.bark }),
      text(row.name, mid.x - 60, court.y + 130 + i * 34, { anchor: 'start', fill: PALETTE.cream }),
      text(row.score === null ? '  --' : String(row.score).padStart(5, ' '), mid.x + 190, court.y + 130 + i * 34,
        { anchor: 'end', fill: row.score === null ? PALETTE.bark : PALETTE.sun }),
    ]).flat();

    return {
      layers: [{ flat: true, shapes: [rect(court.x + 60, court.y + 116, court.w - 120, 4, PALETTE.bark)] }],
      text: [
        centred('HIGH SCORES', court.y + 68, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...rows,
        centred('B TO GO BACK', court.y + court.h - 30, { scale: 2, fill: PALETTE.bark }),
      ],
    };
  }

  const READY_Y = () => mid.y + 90;

  function playScreen() {
    const waiting = game.serveIn > 0;
    return {
      layers: courtLayers(waiting ? { y0: READY_Y() - 26, y1: READY_Y() + 26 } : null),
      text: [
        ...scoreText(),
        ...(waiting ? [centred('GET READY', READY_Y(), { scale: 2, fill: PALETTE.bark })] : []),
      ],
    };
  }

  function pausedScreen() {
    return {
      // The court stays, faded: a pause menu that hides the board makes you
      // forget where the ball was. alpha is the only way to fade anything here,
      // and it dithers on 2x2 cells so it survives the interlace.
      layers: [{ ...courtLayers()[0], alpha: 0.25 }],
      text: [
        centred('PAUSED', court.y + 96, { scale: 2, font: HEAVY, fill: PALETTE.sun }),
        ...menuList(PAUSE_MENU, game.cursor, court.y + 210),
      ],
    };
  }

  function overScreen() {
    const won = game.winner === 0;
    const headline = game.players === 2
      ? `PLAYER ${game.winner + 1} WINS`
      : won ? 'YOU WIN' : 'GAME OVER';

    const body = [
      centred(headline, court.y + 84, { scale: 2, font: HEAVY, fill: won ? PALETTE.sun : PALETTE.ember }),
      centred(`${game.score[0]} - ${game.score[1]}`, court.y + 160, { scale: 2, font: HEAVY, fill: PALETTE.cream }),
    ];

    if (game.players === 1) body.push(centred(`SCORE ${game.tally}`, court.y + 216, { scale: 2, fill: PALETTE.cream }));

    if (game.placing > 0) {
      const letters = game.initials.map((i) => scores.ALPHABET[i]);
      body.push(centred(`NEW HIGH SCORE  RANK ${game.placing}`, court.y + 262, { scale: 2, fill: PALETTE.moss }));
      letters.forEach((letter, i) => {
        const x = mid.x + (i - 1) * 52;
        body.push(text(letter, x, court.y + 288, { scale: 2, font: HEAVY, fill: i === game.slot ? PALETTE.sun : PALETTE.cream }));
      });
      body.push(centred('UP DOWN TO PICK   A TO ENTER', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    } else {
      body.push(centred('PRESS START', court.y + court.h - 46, { scale: 2, fill: PALETTE.bark }));
    }

    const carets = game.placing > 0
      ? [rect(mid.x + (game.slot - 1) * 52 - 16, court.y + 360, 32, 6, PALETTE.sun)]
      : [];

    return { layers: [{ flat: true, shapes: carets }], text: body };
  }

  const SCREENS = {
    menu: menuScreen, scores: scoresScreen,
    play: playScreen, paused: pausedScreen, over: overScreen,
  };

  function scene() {
    const { layers, text: labels } = SCREENS[game.screen]();
    return {
      title: `Pong (${game.screen})`,
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
    // Sounds are drained rather than pushed, so the game never has to know
    // whether anything is listening -- the tests aren't.
    drain() { return sounds.splice(0, sounds.length); },
    // The attract theme plays everywhere except in a rally, where the blips
    // are the whole point and music would bury them.
    music() { return game.screen === 'play' ? null : 'attract'; },
    state() {
      return {
        screen: game.screen, exit: game.exit, players: game.players, cursor: game.cursor,
        score: [...game.score], tally: game.tally, winner: game.winner,
        placing: game.placing, rally: game.rally, elapsed: game.elapsed,
        ball: { ...game.ball }, left: game.left.y, right: game.right.y,
      };
    },
    court,
  };
}

// What the shell's selector needs to draw a row for this game: a name, a line
// about it, a colour, and a small drawing of itself. Box art, essentially.
function emblem({ x, y, w, h }) {
  const r = (rx, ry, rw, rh, fill) =>
    ({ type: 'rect', x: Math.round(rx), y: Math.round(ry), w: Math.round(rw), h: Math.round(rh), fill });
  const cx = x + w / 2;
  const net = [];
  for (let ny = y + 5; ny < y + h - 6; ny += 13) net.push(r(cx - 2, ny, 4, 7, PALETTE.bark));
  return [
    ...net,
    r(x + 9, y + h * 0.26, 6, h * 0.34, PALETTE.cream),
    r(x + w - 15, y + h * 0.44, 6, h * 0.34, PALETTE.sky),
    r(cx + 13, y + h * 0.5, 8, 8, PALETTE.sun),
  ];
}

module.exports = {
  title: 'PONG',
  blurb: 'FIRST TO 11',
  meta: {
    players: [1, 2],
    rating: 'pg',
    audio: '8-bit',
    graphics: '2d',
  },
  accent: 'sky',
  emblem,
  create, WIN, GAME, MENU, PAUSE_MENU,
};

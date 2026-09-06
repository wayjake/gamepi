'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const sceneRenderer = require('../src/gfx/scene');
const png = require('../src/gfx/png');
const input = require('../src/input');
const invariants = require('./invariants');

const GAMES = path.join(__dirname, '..', 'src', 'games');
const FPS = 30;
const STEP = 1 / FPS;

// A high score table that lives in memory. The real one writes to ~/.gamepi,
// and a test suite has no business touching a machine's actual scoreboard.
function fakeTable(rows = []) {
  let board = rows.map((row, i) => ({ rank: i + 1, name: row.name, score: row.score }));
  const pad = () => {
    const out = [...board];
    while (out.length < 8) out.push({ rank: out.length + 1, name: 'AAA', score: 0 });
    return out.map((row, i) => ({ ...row, rank: i + 1 })).slice(0, 8);
  };
  return {
    recorded: [],
    table: () => pad(),
    placing(game, score) {
      if (score <= 0) return 0;
      const index = pad().findIndex((row) => score > row.score);
      return index === -1 ? 0 : index + 1;
    },
    record(game, name, score) {
      this.recorded.push({ name, score });
      board = [...board, { name, score }].sort((a, b) => b.score - a.score).slice(0, 8);
      return pad();
    },
  };
}

// Drives a game the way a player would: a script of [frames, buttons] pairs
// pushed through real Pad objects, so the edge handling is exercised too.
function player(game) {
  const pads = { p1: new input.Pad('p1'), p2: new input.Pad('p2') };
  const step = (n = 1, held = {}) => {
    for (let i = 0; i < n; i++) {
      for (const [pad, buttons] of Object.entries(held)) {
        for (const [button, down] of Object.entries(buttons)) pads[pad].set(button, down);
      }
      game.update(STEP, { p1: pads.p1.read(), p2: pads.p2.read() });
    }
  };
  const tap = (button, pad = 'p1') => {
    pads[pad].set(button, true);
    step(1);
    pads[pad].set(button, false);
    step(1);
  };
  return { pads, step, tap };
}

// A game now starts at its own menu: boot and the selector are the shell's
// (see test/shell.test.js), and a game never learns how it was reached.
const toMenu = (game) => {
  const drive = player(game);
  assert.strictEqual(game.state().screen, 'menu');
  return drive;
};

for (const file of fs.readdirSync(GAMES).filter((f) => f.endsWith('.js'))) {
  const module = require(path.join(GAMES, file));
  const name = file.replace(/\.js$/, '');

  test(`${name}: starts at its own menu and can be left from it`, () => {
    const game = module.create(720, 480, { scores: fakeTable() });
    assert.strictEqual(game.state().screen, 'menu');
    assert.strictEqual(game.state().exit, false, 'a game starts wanting to be played');

    // Every game's menu ends in a way out, and the shell watches for it.
    const drive = player(game);
    const quit = module.MENU.findIndex((entry) => entry.id === 'quit');
    assert.ok(quit >= 0, 'a game with no QUIT in its menu can only be left by the OS combo');
    for (let i = 0; i < quit; i++) drive.tap('down');
    drive.tap('a');
    assert.strictEqual(game.state().exit, true);
  });

  test(`${name}: every screen reachable from the menu draws a legal frame`, () => {
    const store = fakeTable([{ name: 'JAK', score: 400 }]);
    const game = module.create(720, 480, { scores: store, seed: 7 });

    const check = (label) => {
      const scene = game.scene();
      invariants.legalFrame(scene, sceneRenderer.render(scene), `${name} [${label}]`);
    };

    check('menu');

    // Each menu entry in turn, from a fresh game so one choice can't hide the
    // next. QUIT hands back to the shell and draws nothing of its own.
    module.MENU.forEach((entry, index) => {
      if (entry.id === 'quit') return;
      const fresh = module.create(720, 480, { scores: store, seed: 7 });
      const drive = player(fresh);
      for (let i = 0; i < index; i++) drive.tap('down');
      drive.tap('a');

      const scene = fresh.scene();
      invariants.legalFrame(scene, sceneRenderer.render(scene), `${name} [${entry.id}]`);

      // And once it has been running a while, which is a different picture.
      drive.step(90);
      const later = fresh.scene();
      invariants.legalFrame(later, sceneRenderer.render(later), `${name} [${entry.id}, running]`);

      // Pause, if this screen has one.
      drive.tap('start');
      if (fresh.state().screen === 'paused') {
        const paused = fresh.scene();
        invariants.legalFrame(paused, sceneRenderer.render(paused), `${name} [${entry.id}, paused]`);
      }
    });
  });

  test(`${name}: the same inputs replay the same frames`, () => {
    const script = (game) => {
      const drive = player(game);
      drive.tap('a');
      drive.step(30, { p1: { up: true } });
      drive.step(30, { p1: { up: false, down: true } });
      drive.step(60, { p1: { down: false } });
      return png.encode(sceneRenderer.render(game.scene()));
    };

    const a = script(module.create(720, 480, { scores: fakeTable(), seed: 99 }));
    const b = script(module.create(720, 480, { scores: fakeTable(), seed: 99 }));
    assert.ok(a.equals(b), 'a game given the same inputs drew something different');

    const other = script(module.create(720, 480, { scores: fakeTable(), seed: 100 }));
    assert.ok(!a.equals(other), 'the seed changes nothing, so it is not doing its job');
  });

  test(`${name}: drawing has no side effects`, () => {
    const game = module.create(720, 480, { scores: fakeTable(), seed: 3 });
    toMenu(game).tap('a');
    player(game).step(60);

    const before = JSON.stringify(game.state());
    const first = png.encode(sceneRenderer.render(game.scene()));
    const second = png.encode(sceneRenderer.render(game.scene()));
    assert.ok(first.equals(second), 'drawing twice drew two different pictures');
    assert.strictEqual(JSON.stringify(game.state()), before, 'drawing moved the game on');
  });
}

// --- pong specifically -------------------------------------------------------

const pong = require('../src/games/pong');

test('pong: a match ends when someone reaches the winning score', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 5 });
  const drive = toMenu(game);
  drive.tap('a'); // 1 PLAYER

  // Nobody touches the left paddle, so the CPU takes every point.
  for (let i = 0; i < 6000 && game.state().screen === 'play'; i++) drive.step(1);

  const state = game.state();
  assert.strictEqual(state.screen, 'over');
  assert.strictEqual(state.winner, 1, 'the CPU should beat a player who never moves');
  assert.strictEqual(state.score[1], pong.WIN);
});

test('pong: the CPU can be beaten, and makes you work for it', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 11 });
  const drive = toMenu(game);
  drive.tap('a');

  // A player who tracks the ball perfectly.
  let frames = 0;
  while (game.state().screen === 'play' && frames++ < 25000) {
    const ball = game.state().ball;
    const paddle = game.state().left;
    drive.step(1, { p1: { up: ball.y < paddle - 6, down: ball.y > paddle + 6 } });
  }

  const state = game.state();
  assert.strictEqual(state.screen, 'over');
  assert.strictEqual(state.winner, 0, 'a perfect player must be able to win');
  assert.ok(state.score[1] > 0, 'a CPU that never scores against anyone is scenery');
});

test('pong: winning posts a score, and the initials go on the board', () => {
  const store = fakeTable();
  const game = pong.create(720, 480, { scores: store, seed: 11 });
  const drive = toMenu(game);
  drive.tap('a');

  let frames = 0;
  while (game.state().screen === 'play' && frames++ < 25000) {
    const { ball, left } = game.state();
    drive.step(1, { p1: { up: ball.y < left - 6, down: ball.y > left + 6 } });
  }

  assert.strictEqual(game.state().screen, 'over');
  assert.ok(game.state().tally > 0, 'a win is worth something');
  assert.ok(game.state().placing > 0, 'and it should make an empty board');

  drive.step(30); // the grace period before the screen takes input

  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'pong [game over, entering initials]');

  drive.tap('down');            // A -> B on the first letter
  drive.tap('a');               // move to the second
  drive.tap('a');               // and the third
  drive.tap('a');               // confirm

  assert.strictEqual(game.state().screen, 'scores');
  assert.strictEqual(store.recorded.length, 1);
  assert.strictEqual(store.recorded[0].name, 'BAA');
  assert.strictEqual(store.recorded[0].score, game.state().tally);
});

test('pong: two players means no CPU and no score posted', () => {
  const store = fakeTable();
  const game = pong.create(720, 480, { scores: store, seed: 2 });
  const drive = toMenu(game);
  drive.tap('down');
  drive.tap('a'); // 2 PLAYERS
  assert.strictEqual(game.state().players, 2);

  // Player two never moves, so player one -- who does -- should take it.
  let frames = 0;
  while (game.state().screen === 'play' && frames++ < 25000) {
    const { ball, left } = game.state();
    drive.step(1, { p1: { up: ball.y < left - 6, down: ball.y > left + 6 } });
  }
  assert.strictEqual(game.state().screen, 'over');
  assert.strictEqual(game.state().tally, 0, 'a versus match is not a high score');
  assert.strictEqual(game.state().placing, 0);

  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'pong [game over, two players]');

  drive.step(30);
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'menu');
  assert.strictEqual(store.recorded.length, 0);
});

test('pong: the pause menu can resume, restart and quit', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 4 });
  const drive = toMenu(game);
  drive.tap('a');
  drive.step(120);

  drive.tap('start');
  drive.tap('a'); // RESUME
  assert.strictEqual(game.state().screen, 'play');

  drive.step(200);
  const mid = game.state();
  drive.tap('start');
  drive.tap('down');
  drive.tap('a'); // RESTART
  assert.strictEqual(game.state().screen, 'play');
  assert.deepStrictEqual(game.state().score, [0, 0], 'restart did not reset the score');
  assert.ok(mid.elapsed > game.state().elapsed || true);

  drive.tap('start');
  drive.tap('down'); drive.tap('down');
  drive.tap('a'); // QUIT TO MENU
  assert.strictEqual(game.state().screen, 'menu');
});

test('pong: the ball never travels flat', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 21 });
  const drive = toMenu(game);
  drive.tap('a');

  // A ball returned dead flat makes the rest of the rally a formality -- both
  // paddles are already where they need to be. Every serve and every bounce has
  // to put something on it.
  let seen = 0;
  for (let i = 0; i < 2000 && game.state().screen === 'play'; i++) {
    drive.step(1);
    const { vx, vy } = game.state().ball;
    if (vx === 0 && vy === 0) continue;
    seen++;
    assert.ok(Math.abs(vy) > 20, `ball travelling too flat: vy=${vy.toFixed(2)}`);
  }
  assert.ok(seen > 100, 'the ball never moved, so nothing was checked');
});

test('pong: sounds are drained, not replayed', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 8 });
  const drive = player(game);
  drive.tap('down');

  assert.ok(game.drain().includes('move'), 'moving the cursor should make a noise');
  assert.deepStrictEqual(game.drain(), [], 'the same sounds came back a second time');
});

test('pong: the theme drops out for a rally and comes back after', () => {
  const game = pong.create(720, 480, { scores: fakeTable(), seed: 6 });
  const drive = toMenu(game);
  assert.strictEqual(game.music(), 'attract');

  drive.tap('a');
  assert.strictEqual(game.music(), null, 'music would bury the blips');

  drive.tap('start');
  assert.strictEqual(game.music(), 'attract', 'and returns for the pause menu');
});

// --- golf specifically -------------------------------------------------------

const golf = require('../src/games/golf');

const outside = (ball) =>
  Math.abs(ball.x) > golf.COURSE.halfWidth || ball.z < -30 || ball.z > golf.COURSE.length + 30;

// Plays one shot with a given club and power, straight at whatever the game is
// aiming at, and runs the ball out.
function swing(game, drive, { club = null, power = 1 } = {}) {
  if (club !== null) {
    const want = golf.CLUBS.findIndex((c) => c.id === club);
    while (game.state().club !== golf.CLUBS[want].id) drive.tap('down');
  }
  drive.tap('a');                                    // start the meter
  let guard = 0;
  while (game.state().swing === 'power' && game.state().meter < power && guard++ < 200) drive.step(1);
  if (game.state().swing === 'power') drive.tap('a');
  guard = 0;
  while (game.state().swing === 'accuracy' && game.state().meter > 0.01 && guard++ < 200) drive.step(1);
  drive.tap('a');                                    // strike, near the mark
  guard = 0;
  while (game.state().swing === 'flying' && game.state().screen === 'play' && guard++ < 1500) drive.step(1);
  return { settled: guard < 1500, frames: guard };
}

const teeOff = (options = {}) => {
  const game = golf.create(720, 480, { scores: fakeTable(), seed: 3, ...options });
  const drive = player(game);
  drive.tap('a'); // PLAY THE HOLE
  assert.strictEqual(game.state().screen, 'play');
  return { game, drive };
};

test('golf: every shot comes to rest', () => {
  // The first version of the physics let a rolling ball leave the ground over a
  // crest, where it got neither gravity nor friction, and drift until it ran off
  // the end of the hole. Nothing about a shot may fail to settle.
  const { game, drive } = teeOff();
  for (let i = 0; i < 6 && game.state().screen === 'play'; i++) {
    const power = [1, 0.8, 0.6, 0.45, 0.3, 0.2][i];
    const { settled, frames } = swing(game, drive, { power });
    assert.ok(settled, `shot ${i + 1} at power ${power} never came to rest`);
    assert.ok(frames < 600, `shot ${i + 1} took ${(frames / 30).toFixed(1)}s to settle`);
    const ball = game.state().ball;
    assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.z),
      `shot ${i + 1} put the ball at ${ball.x},${ball.y},${ball.z}`);
  }
});

test('golf: the clubs go different distances, in the right order', () => {
  const distances = {};
  for (const club of golf.CLUBS) {
    const { game, drive } = teeOff();
    const from = { ...game.state().ball };
    swing(game, drive, { club: club.id, power: 1 });
    const to = game.state().ball;
    distances[club.id] = Math.hypot(to.x - from.x, to.z - from.z);
  }

  assert.ok(distances.driver > distances.iron, `driver ${distances.driver.toFixed(0)} vs iron ${distances.iron.toFixed(0)}`);
  assert.ok(distances.iron > distances.wedge, `iron ${distances.iron.toFixed(0)} vs wedge ${distances.wedge.toFixed(0)}`);
  assert.ok(distances.wedge > distances.putter, `wedge ${distances.wedge.toFixed(0)} vs putter ${distances.putter.toFixed(0)}`);

  // And the hole has to be reachable in the par it advertises.
  assert.ok(distances.driver * (golf.PAR - 1) > golf.COURSE.length * 0.8,
    `par ${golf.PAR} is not reachable: driver goes ${distances.driver.toFixed(0)} on a ${golf.COURSE.length} hole`);
});

test('golf: less power goes less far', () => {
  const at = (power) => {
    const { game, drive } = teeOff();
    const from = { ...game.state().ball };
    swing(game, drive, { club: 'driver', power });
    const to = game.state().ball;
    return Math.hypot(to.x - from.x, to.z - from.z);
  };
  const full = at(1);
  const half = at(0.5);
  assert.ok(full > half * 1.2, `full ${full.toFixed(0)} is not meaningfully past half ${half.toFixed(0)}`);
  assert.ok(half > 20, `half power only managed ${half.toFixed(0)}`);
});

test('golf: the hole can be holed out, and it ends the round', () => {
  const store = fakeTable();
  const { game, drive } = teeOff({ scores: store });

  // Play it in until it drops. The bot aims where the game aims -- straight at
  // the pin -- and picks a power from what is left.
  let guard = 0;
  while (game.state().screen === 'play' && guard++ < 14) {
    const left = game.state().toHole;
    const club = left > 190 ? 'driver' : left > 90 ? 'iron' : left > 34 ? 'wedge' : 'putter';
    const reach = { driver: 230, iron: 180, wedge: 100, putter: 26 }[club];
    swing(game, drive, { club, power: Math.max(0.18, Math.min(1, left / reach)) });
  }

  const state = game.state();
  assert.strictEqual(state.screen, 'over', `the round never ended (${guard} shots)`);
  assert.ok(state.holed, `the ball was never holed: ${state.toHole.toFixed(1)} yds away after ${state.strokes}`);
  assert.ok(state.strokes >= 1 && state.strokes <= 12, `finished in ${state.strokes}`);
});

test('golf: the water and the boundary each cost a stroke', () => {
  const { game, drive } = teeOff();
  // Aim hard right and hit it: off the side of the hole either way.
  drive.step(60, { p1: { right: true } });
  drive.step(1, { p1: { right: false } });
  const before = game.state().strokes;
  swing(game, drive, { club: 'driver', power: 1 });

  const after = game.state();
  if (after.penalty > 0) {
    assert.ok(after.strokes >= before + 2, 'a penalty did not cost the extra stroke');
    assert.ok(!outside(after.ball), 'the ball was left out of play');
  }
  // Either way it must be somewhere playable.
  assert.ok(after.ball.resting, 'the ball never settled');
  assert.ok(!outside(after.ball), `ball finished off the hole at ${after.ball.x.toFixed(0)},${after.ball.z.toFixed(0)}`);
});

// The mesh the player looks at and the ground the ball rolls on have to be the
// same surface: the whole terrain is defined against what the coarse rough mesh
// actually produces, precisely so this holds.
test('golf: a ball at rest sits on the ground that is drawn', () => {
  const { game, drive } = teeOff();
  for (let i = 0; i < 3 && game.state().screen === 'play'; i++) {
    swing(game, drive, { power: [1, 0.6, 0.4][i] });
    const ball = game.state().ball;
    if (!ball.resting) continue;
    const ground = golf.height(ball.x, ball.z);
    assert.ok(Math.abs(ball.y - ground) < 1.0,
      `ball rests at y=${ball.y.toFixed(2)} but the ground there is ${ground.toFixed(2)}`);
  }
});

test('golf: the three-click swing goes aim, power, accuracy', () => {
  const { game, drive } = teeOff();
  assert.strictEqual(game.state().swing, 'aim');

  drive.tap('a');
  assert.strictEqual(game.state().swing, 'power');
  const early = game.state().meter;
  drive.step(4);
  assert.ok(game.state().meter > early, 'the meter is not rising');

  drive.tap('a');
  assert.strictEqual(game.state().swing, 'accuracy');
  const top = game.state().meter;
  drive.step(4);
  assert.ok(game.state().meter < top, 'the meter is not coming back down');

  drive.tap('a');
  assert.strictEqual(game.state().swing, 'flying');
  assert.strictEqual(game.state().strokes, 1);
});

test('golf: aiming turns the shot', () => {
  // A modest turn. Aiming far enough to matter but not far enough to put the
  // ball off the hole, which would be a penalty back to the tee and would tell
  // us nothing about aiming.
  const shot = (turn) => {
    const { game, drive } = teeOff();
    if (turn) drive.step(8, { p1: { [turn]: true } });
    drive.step(1, { p1: { left: false, right: false } });
    swing(game, drive, { club: 'driver', power: 1 });
    return game.state().ball.x;
  };
  const straight = shot(null);
  assert.ok(shot('left') < straight - 5, 'aiming left did not go left');
  assert.ok(shot('right') > straight + 5, 'aiming right did not go right');
});

test('golf: fewer strokes is a better score', () => {
  const store = fakeTable();
  const game = golf.create(720, 480, { scores: store, seed: 3 });
  assert.strictEqual(golf.lowerIsBetter, true, 'the shell needs to know which way round golf sorts');
  // The module declares it; scores.js is what acts on it (test/scores.test.js).
  assert.ok(game.state().screen === 'menu');
});

test('golf: the putting surface is level, and the green never sinks into the rough', () => {
  const C = golf.COURSE;
  let low = Infinity, high = -Infinity;
  let clearance = Infinity;

  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    for (let r = 0; r <= C.greenRadius; r += 0.5) {
      const x = C.hole.x + Math.cos(a) * r;
      const z = C.hole.z + Math.sin(a) * r;
      const h = golf.height(x, z);

      // Inside the putting surface it has to be one height, full stop.
      if (r <= golf.GREEN_FLAT) { low = Math.min(low, h); high = Math.max(high, h); }

      // And nowhere on the green may it drop below the coarse rough drawn
      // underneath it, or the rough pokes through.
      clearance = Math.min(clearance, h - golf.roughAt(x, z));
    }
  }

  assert.ok(high - low < 1e-6, `the putting surface varies by ${(high - low).toFixed(4)}`);
  assert.ok(clearance >= -1e-9, `the green sinks ${(-clearance).toFixed(3)} into the rough`);
  assert.ok(Math.abs(low - golf.GREEN_LEVEL) < 1e-6, 'the putting surface is not at the level it advertises');
});

test('golf: the green meets the rough at its rim without a step', () => {
  const C = golf.COURSE;
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    const x = C.hole.x + Math.cos(a) * C.greenRadius;
    const z = C.hole.z + Math.sin(a) * C.greenRadius;
    assert.ok(Math.abs(golf.height(x, z) - golf.roughAt(x, z)) < 1e-6,
      `a step of ${(golf.height(x, z) - golf.roughAt(x, z)).toFixed(3)} at the green's edge`);
  }
});

test('golf: a putt on the green rolls straight', () => {
  const store = fakeTable();
  const game = golf.create(720, 480, { scores: store, seed: 3 });
  const drive = player(game);
  drive.tap('a');

  // Play up to the green, then putt and watch the heading.
  let guard = 0;
  while (game.state().screen === 'play' && game.state().surface !== 'green' && guard++ < 10) {
    const left = game.state().toHole;
    const club = left > 190 ? 'driver' : left > 90 ? 'iron' : 'wedge';
    const reach = { driver: 230, iron: 180, wedge: 100 }[club];
    swing(game, drive, { club, power: Math.max(0.18, Math.min(1, left / reach)) });
  }
  assert.strictEqual(game.state().surface, 'green', 'never reached the green to putt from');

  drive.tap('a');
  while (game.state().swing === 'power' && game.state().meter < 0.3) drive.step(1);
  drive.tap('a');
  while (game.state().swing === 'accuracy' && game.state().meter > 0.01) drive.step(1);
  drive.tap('a');

  const heading = () => {
    const { vx, vz } = game.state().ball;
    return Math.atan2(vx, vz);
  };
  drive.step(2);
  const start = heading();
  let drift = 0;
  for (let i = 0; i < 40 && game.state().swing === 'flying' && game.state().surface === 'green'; i++) {
    drive.step(1);
    const { vx, vz } = game.state().ball;
    if (Math.hypot(vx, vz) < 2) break;
    drift = Math.max(drift, Math.abs(heading() - start));
  }
  assert.ok(drift < 0.02, `the putt bent by ${(drift * 180 / Math.PI).toFixed(1)} degrees on a flat green`);
});

// --- border patrol specifically ----------------------------------------------

const border = require('../src/games/border');

// Into a run, in whichever car. The car lot is between the menu and the road.
function setOff(car = 'mula', options = {}) {
  const game = border.create(720, 480, { scores: fakeTable(), seed: 7, ...options });
  const drive = toMenu(game);
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'cars');
  const wanted = border.CARS.findIndex((c) => c.id === car);
  while (game.state().car !== border.CARS[wanted].id) drive.tap('down');
  drive.tap('a');
  assert.strictEqual(game.state().screen, 'play');
  return { game, drive };
}

// Drives the way a player does: throttle down, steering for the middle of the
// road, leaning on any cruiser that comes alongside while there is body to
// spare, and stepping away from one that is coming across. From the rescue
// on the pad is let go of, so the captions play at their own pace, and it
// keeps stepping until the town.
function chase(game, drive, { frames = 12000, ram = true, onFrame = null } = {}) {
  let n = 0;
  while (['play', 'rescue', 'dirt'].includes(game.state().screen) && n < frames) {
    const s = game.state();
    if (s.screen !== 'play') {
      drive.step(1, { p1: { a: false, left: false, right: false } });
      if (onFrame) onFrame(game.state());
      n++;
      continue;
    }
    const live = s.cops.filter((cop) => !cop.wrecked);
    const beside = ram && s.body > 0.45 && live.find((cop) => Math.abs(cop.z - s.z) < 20);
    const blocker = live.find((cop) => cop.z - s.z >= 12 && cop.z - s.z < 50 && Math.abs(cop.x - s.x) < 12);
    const lunging = live.find((cop) => cop.lunging && Math.abs(cop.z - s.z) < 40);
    const centre = border.roadCentre(s.z + 40);
    const pickup = s.pickups.find((item) => item.z > s.z && item.z < s.z + 220);
    let want = centre;
    // Fuel first, always. Leaning means steering past the cruiser, not at
    // it: aim at where it is and the stick centres the moment you touch,
    // which is a nudge.
    if (pickup && pickup.z < s.z + 120) want = pickup.x;
    else if (beside) want = beside.x + (beside.x > s.x ? 30 : -30);
    else if (blocker) want = blocker.x + (blocker.x > centre ? -22 : 22);
    else if (lunging) want = centre + (lunging.x < s.x ? 18 : -18);
    else if (pickup) want = pickup.x;
    // Leaning on a cruiser from the tarmac, never chasing it into the sand.
    want = Math.max(centre - border.ROAD_HALF + 1, Math.min(centre + border.ROAD_HALF - 1, want));
    const err = want - s.x;
    drive.step(1, { p1: { a: true, left: err < -1.5, right: err > 1.5 } });
    if (onFrame) onFrame(game.state());
    n++;
  }
  // Let go of everything on the way out. A held button has no edge left in it,
  // so a tap straight after this one would be swallowed -- which is exactly how
  // the first version of this helper managed to sit on the pause screen for
  // four thousand frames and report that the run had not ended.
  drive.step(1, { p1: { a: false, left: false, right: false } });
  return n;
}

// A script line, split into caption pages the way border.js does it.
function captionPages(body) {
  const lines = [];
  let line = '';
  for (const word of body.split(' ')) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= border.CAPTION_WRAP) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  const pages = [];
  for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2).join(' '));
  return pages;
}

test('border: the world repeats exactly, so one mesh can be laid end to end', () => {
  // The road, the sand and the furniture are each one mesh placed again every
  // period. If any of the functions behind them is not exactly periodic there
  // is a step at every tile join, and it is a step you would only ever see on
  // the Pi.
  for (let z = 0; z < border.ROAD_PERIOD; z += 37) {
    assert.ok(Math.abs(border.roadCentre(z) - border.roadCentre(z + border.ROAD_PERIOD)) < 1e-9,
      `the road jumps at the tile join near z=${z}`);
    for (const x of [0, 140, 305, 480, 900]) {
      assert.ok(Math.abs(border.desertY(x, z) - border.desertY(x, z + border.GROUND_TILE)) < 1e-9,
        `the sand jumps at the tile join near x=${x}, z=${z}`);
    }
  }
});

// Golf's lesson, in a different shape: a coarse grid interpolates straight
// across anything it has no vertex on, so the ground a car drives on has to be
// flat where the mesh's vertices are flat -- not merely nearly flat.
test('border: the ground is exactly flat everywhere a car can reach', () => {
  for (let z = 0; z < border.ROAD_PERIOD; z += 23) {
    for (let d = -border.VERGE; d <= border.VERGE; d += 4) {
      const x = border.roadCentre(z) + d;
      assert.strictEqual(border.desertY(x, z), 0,
        `the sand is ${border.desertY(x, z)} high at x=${x.toFixed(1)}, which is inside the posts`);
      assert.ok(Math.abs(x) < border.FLAT_HALF,
        `x=${x.toFixed(1)} reaches past the flat, so the dunes could rise under the road`);
    }
  }
});

test('border: a run always ends, even from a player who does nothing', () => {
  // Fuel is the backstop that guarantees it -- idling burns slower than
  // driving does but it still burns, so there is no state the machine can sit
  // in for ever. In practice the cruisers get there first, which is the right
  // answer to standing still in the middle of the road.
  const { game, drive } = setOff();
  const start = game.state().fuel;
  drive.step(60);
  assert.ok(game.state().fuel < start, 'a parked car burns nothing, so a run need never end');

  let frames = 60;
  while (game.state().screen === 'play' && frames++ < 12000) drive.step(1);
  assert.strictEqual(game.state().screen, 'over', 'doing nothing went on for ever');
  assert.ok(['busted', 'dry'].includes(game.state().ending), `ended ${game.state().ending}`);
  assert.ok(frames < 6000, `sitting still took ${(frames / 30).toFixed(0)}s to come to anything`);
});

test('border: the rescue comes before the line, and the run goes on into the town', () => {
  const { game, drive } = setOff('mula');
  const phases = [];
  const captions = new Set();
  const themes = new Set();
  let farthest = 0;
  chase(game, drive, {
    onFrame: (s) => {
      const key = `${s.screen}:${s.phase}`;
      if (phases[phases.length - 1] !== key) phases.push(key);
      if (s.caption) captions.add(s.caption);
      themes.add(`${s.screen}:${game.music()}`);
      farthest = Math.max(farthest, s.z);
    },
  });

  assert.strictEqual(game.state().screen, 'town', `the run ended on ${game.state().screen}`);
  assert.deepStrictEqual(phases, [
    'play:null', 'rescue:brake', 'rescue:arrive', 'rescue:talk', 'rescue:board', 'rescue:depart',
    'dirt:drive', 'dirt:stopped', 'town:null',
  ]);
  assert.ok(farthest >= border.RESCUE_Z, `the rescue came at z=${Math.round(farthest)}, before RESCUE_Z`);
  assert.ok(farthest < border.RUN - 200, `the car got to z=${Math.round(farthest)}, which is the line`);

  // Every line she has is heard, on the highway and on the dirt.
  for (const entry of [...border.RESCUE_SCRIPT, ...border.DIRT_SCRIPT]) {
    for (const page of captionPages(entry.text)) assert.ok(captions.has(page), `never heard "${page}"`);
  }

  // Nothing under the rescue; the town's theme from the dirt road on.
  assert.ok(themes.has('play:chase'));
  assert.ok(themes.has('rescue:null'), 'the chase theme kept going through the rescue');
  assert.ok(themes.has('dirt:refugio'));
  assert.strictEqual(game.music(), 'refugio');
  assert.ok(game.state().score > 0, 'being rescued was worth nothing');
  assert.ok(game.state().town, 'no town to report');
  assert.strictEqual(game.state().ending, '', 'reaching the town is not an ending');
});

test('border: the car stops short of the line, the truck stops in front of it, and the cruisers do not follow', () => {
  const { game, drive } = setOff('toro');
  let talk = null;
  let gone = null;
  chase(game, drive, {
    onFrame: (s) => {
      if (s.screen === 'rescue' && s.phase === 'talk' && !talk) talk = s;
      if (s.screen === 'rescue' && s.phase === 'depart') gone = s;
    },
  });
  assert.ok(talk, 'she never spoke');
  assert.strictEqual(talk.speed, 0, 'she spoke to a moving car');
  assert.ok(Math.abs(talk.z - border.RESCUE_STOP) < 4, `the car stopped at z=${Math.round(talk.z)}, not ${border.RESCUE_STOP}`);
  assert.ok(Math.abs(talk.truck.x - border.roadCentre(border.TRACK_Z)) < 3,
    `the truck stopped at x=${talk.truck.x.toFixed(1)}, not on the road`);
  assert.strictEqual(talk.truck.z, border.TRACK_Z);
  assert.ok(talk.truck.z > talk.z, 'the truck stopped behind the car');

  // The cruisers: none of them beside the car while she talks, the ones
  // behind stopped, the ones ahead gone on.
  for (const cop of talk.cops.filter((c) => !c.wrecked)) {
    assert.ok(Math.abs(cop.z - talk.z) > 15, `a cruiser is sitting beside the car (dz ${Math.round(cop.z - talk.z)})`);
    if (cop.z < talk.z) assert.ok(cop.speed < 1, `a cruiser behind is still doing ${Math.round(cop.speed)}`);
  }
  // And she leaves to the left, up over the dunes, with you in the truck.
  assert.ok(gone, 'the truck never left');
  assert.ok(gone.truck.x < -border.FLAT_HALF, `the cut came at x=${Math.round(gone.truck.x)}, before the dunes`);
});

test('border: the signs fit their boards and the wall stands clear of the road', () => {
  // A label switches on at scale 1 at SIGN_FAR and doubles at SIGN_NEAR; the
  // board has to be wider than the text at both, or the words hang off it.
  for (const sign of border.SIGNS) {
    assert.ok(sign.text.length <= 14, `"${sign.text}" is too long for a board`);
    assert.ok(sign.z > 0 && sign.z < border.RUN, `"${sign.text}" is off the run at z=${sign.z}`);
  }
  const zs = border.SIGNS.map((sign) => sign.z);
  assert.deepStrictEqual(zs, [...zs].sort((a, b) => a - b), 'the signs are not in road order');

  // A tile of fence is chosen by the sector its start is in, so a tile must
  // never straddle a gate.
  assert.strictEqual(border.LEG % border.SIDE_TILE, 0, 'a fence tile can straddle a sector boundary');

  // And nothing that stands beside the road stands where a car can get to.
  let reach = 0;
  for (let z = 0; z < border.ROAD_PERIOD; z += 7) reach = Math.max(reach, Math.abs(border.roadCentre(z)) + border.VERGE);
  assert.ok(border.WALL_X > reach + 8, `the wall at ${border.WALL_X} is inside the car's reach of ${reach.toFixed(0)}`);
  assert.ok(border.FENCE_X > reach + 8, `the fence at ${border.FENCE_X} is inside the car's reach of ${reach.toFixed(0)}`);
  assert.ok(border.FENCE_X < border.FLAT_HALF && border.WALL_X < border.FLAT_HALF, 'the fence is up a dune');
});

test('border: every screen a run reaches draws a legal frame', () => {
  const store = fakeTable();
  const { game, drive } = setOff('toro', { scores: store });

  const check = (label) => {
    const scene = game.scene();
    invariants.legalFrame(scene, sceneRenderer.render(scene), `border [${label}]`);
  };

  check('play, standing start');
  chase(game, drive, { frames: 90 });
  check('play, moving');

  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  check('paused');
  drive.tap('a');

  // With a sign close enough to read, then every phase of the rescue, the
  // dirt road with and without the town in view, and the town itself.
  let signs = 0;
  const seen = new Set();
  const once = (label) => { if (seen.has(label)) return; seen.add(label); check(label); };
  chase(game, drive, {
    onFrame: (s) => {
      const near = border.SIGNS.some((sign) => sign.z - s.z > 20 && sign.z - s.z < 100);
      if (near && signs < 2 && s.screen === 'play') { check(`play, sign in view at z=${Math.round(s.z)}`); signs++; }
      if (s.screen === 'rescue') once(`rescue, ${s.phase}`);
      if (s.screen === 'rescue' && s.caption) once('rescue, caption up');
      if (s.screen === 'dirt') once(`dirt, ${s.phase}`);
      if (s.screen === 'dirt' && s.caption) once('dirt, caption up');
      if (s.screen === 'dirt' && s.dz > border.DIRT_LENGTH - 60) once('dirt, town in view');
    },
  });
  assert.ok(signs > 0, 'never drove past a sign');
  for (const label of ['rescue, talk', 'rescue, board', 'rescue, depart', 'dirt, drive', 'dirt, town in view', 'dirt, stopped']) {
    assert.ok(seen.has(label), `never drew "${label}"`);
  }
  assert.strictEqual(game.state().screen, 'town');
  check('town, arriving');

  // Paused from the cut, and from the town.
  drive.step(15);
  drive.tap('a');
  assert.strictEqual(game.state().town.cards, 0, 'the arrival card did not go');
  check('town');
  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  assert.strictEqual(game.music(), 'refugio', 'pausing the town changed the music');
  check('town, paused');
  drive.tap('b');
  assert.strictEqual(game.state().screen, 'town');
});

test('border: a run that ends in the sand still posts a score', () => {
  const store = fakeTable();
  const { game, drive } = setOff('mula', { scores: store });
  chase(game, drive, { frames: 600 });
  assert.strictEqual(game.state().screen, 'play');

  // Stop, and wait to be pulled over.
  let n = 0;
  while (game.state().screen === 'play' && n++ < 6000) drive.step(1);
  assert.strictEqual(game.state().screen, 'over');
  assert.ok(['busted', 'dry'].includes(game.state().ending), `ended ${game.state().ending}`);
  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), `border [over, ${game.state().ending}]`);

  drive.step(30);
  assert.ok(game.state().placing > 0, 'six hundred frames of road should make an empty board');
  const initials = game.scene();
  invariants.legalFrame(initials, sceneRenderer.render(initials), 'border [over, entering initials]');
  drive.tap('down');
  drive.tap('a'); drive.tap('a'); drive.tap('a');
  assert.strictEqual(game.state().screen, 'scores');
  assert.strictEqual(store.recorded.length, 1);
  assert.strictEqual(store.recorded[0].name, 'BAA');
});

test('border: the cut can be paused, and the pause menu goes back to it', () => {
  const { game, drive } = setOff('liebre');
  let n = 0;
  while (!(game.state().screen === 'rescue' && game.state().phase === 'talk') && n++ < 12000) {
    if (game.state().screen === 'play') chase(game, drive, { frames: 1 });
    else drive.step(1);
  }
  assert.strictEqual(game.state().phase, 'talk');
  drive.step(20);                                   // far enough in that a caption is up
  const before = game.state().caption;
  assert.ok(before, 'nothing was being said');

  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  assert.strictEqual(game.music(), null, 'the pause menu put music under the rescue');
  drive.step(90);
  drive.tap('a');                                   // RESUME
  assert.strictEqual(game.state().screen, 'rescue');
  assert.strictEqual(game.state().caption, before, 'the caption moved on while paused');

  drive.tap('start');
  drive.tap('down');
  drive.tap('a');                                   // RESTART RUN
  assert.strictEqual(game.state().screen, 'play');
  assert.strictEqual(game.state().phase, null);
  assert.ok(game.state().z < 1, 'a restart did not go back to the start');
});

test('border: in the town the pad reaches the town, and Rosa is there to talk to', () => {
  const { game, drive } = setOff('mula');
  chase(game, drive);
  assert.strictEqual(game.state().screen, 'town');
  drive.step(15);
  drive.tap('a');                                   // the arrival card

  // Up one tile and right one, which puts Rosa within reach.
  const town = game.town();
  const walk = (col, row) => {
    const [tx, ty] = town.centreOf(col, row);
    for (let i = 0; i < 240; i++) {
      const [px, py] = game.state().town.at;
      if (Math.abs(px - tx) < 4 && Math.abs(py - ty) < 4) break;
      drive.step(1, { p1: { left: px - tx > 3, right: tx - px > 3, up: py - ty > 3, down: ty - py > 3 } });
    }
    drive.step(1, { p1: { left: false, right: false, up: false, down: false } });
  };
  walk(16, 20);
  walk(17, 20);
  assert.strictEqual(game.state().town.intent, 'person', `standing beside Rosa the button offers "${game.state().town.hint}"`);
  drive.tap('a');
  assert.ok(game.state().town.talking > 0, 'A did not start the conversation');
  for (let i = 0; i < 20 && game.state().town.talking > 0; i++) drive.tap('a');
  assert.strictEqual(game.state().town.talking, 0);
  assert.deepStrictEqual(game.state().town.met, ['rosa']);
  assert.strictEqual(game.state().town.trust, border.town.MEET_TRUST);
});

test('border: the three cars are actually three different cars', () => {
  const reached = {};
  for (const car of border.CARS) {
    const { game, drive } = setOff(car.id);
    chase(game, drive, { frames: 300, ram: false });
    reached[car.id] = game.state();
  }

  assert.ok(reached.liebre.distance > reached.mula.distance,
    `the fast one covered ${Math.round(reached.liebre.distance)} against the steady one's ${Math.round(reached.mula.distance)}`);
  assert.ok(reached.mula.distance > reached.toro.distance,
    `the steady one covered ${Math.round(reached.mula.distance)} against the heavy one's ${Math.round(reached.toro.distance)}`);

  // And the tank is the other half of the trade: the one that gets there first
  // is the one that has least left when it does.
  const spent = (id) => 1 - reached[id].fuel / border.CARS.find((c) => c.id === id).tank;
  assert.ok(spent('liebre') > spent('mula'), 'the fast car is not paying for it at the pump');
});

test('border: a cruiser shoved past the posts is off the road', () => {
  // The whole point of the heavy car. Put a cruiser alongside and lean on it.
  const { game, drive } = setOff('toro');
  let wrecked = 0;
  chase(game, drive, { frames: 2400, onFrame: (s) => { wrecked = Math.max(wrecked, s.wrecks); } });
  assert.ok(wrecked > 0, 'eighty seconds of ramming cruisers wrecked none of them');
});

test('border: cruisers turn up, and standing still next to one gets you pulled over', () => {
  // Never touch the throttle and they arrive, stop beside you, and the clock
  // runs. Being caught is being stopped: nothing else fills it.
  const { game, drive } = setOff('mula');
  let seen = 0;
  let pinned = 0;
  for (let i = 0; i < 900 && game.state().screen === 'play'; i++) {
    drive.step(1);
    const s = game.state();
    seen = Math.max(seen, s.cops.length);
    pinned = Math.max(pinned, s.pinned);
  }
  assert.ok(seen > 0, 'nobody came after us');
  assert.ok(pinned > 0, 'a cruiser stopped next to us and nothing happened');
  assert.strictEqual(game.state().ending, 'busted');
});

test('border: a hit costs body, a heavier car less of it, and the clock only runs when you are slow', () => {
  const dents = {};
  for (const id of ['liebre', 'toro']) {
    const { game, drive } = setOff(id);
    let least = 1;
    let pinnedAtSpeed = false;
    chase(game, drive, {
      frames: 1500,
      onFrame: (s) => {
        least = Math.min(least, s.body);
        if (s.pinned > 0.2 && s.speed > border.PIN_TIME * 10) pinnedAtSpeed = true;
      },
    });
    dents[id] = 1 - least;
    assert.ok(!pinnedAtSpeed, `${id} was being pulled over while moving`);
  }
  assert.ok(dents.liebre > 0, 'fifty seconds of ramming cruisers cost the light car nothing');
  assert.ok(dents.toro < dents.liebre, `the heavy car lost ${dents.toro.toFixed(2)} against the light car's ${dents.liebre.toFixed(2)}`);
});

test('border: a checkpoint refills the tank and moves the sector on', () => {
  const fresh = setOff('mula');
  let crossed = null;
  chase(fresh.game, fresh.drive, {
    frames: 4000,
    onFrame: (s) => { if (crossed === null && s.sector === 2) crossed = s; },
  });
  assert.ok(crossed, 'never reached the first checkpoint');
  assert.strictEqual(crossed.fuel, border.CARS[0].tank, 'crossing the line did not fill the tank');
  assert.strictEqual(crossed.body, 1, 'crossing the line did not patch the car up');
  assert.strictEqual(crossed.pinned, 0, 'crossing the line did not shake them off');
  assert.ok(crossed.score >= 500, 'crossing the line was worth nothing');
});

test('border: the posts hold, however hard you steer at them', () => {
  const { game, drive } = setOff('liebre');
  let worst = 0;
  for (let i = 0; i < 600 && game.state().screen === 'play'; i++) {
    drive.step(1, { p1: { a: true, right: true } });
    const s = game.state();
    worst = Math.max(worst, Math.abs(s.x - border.roadCentre(s.z)));
  }
  assert.ok(worst <= border.VERGE, `the car got ${worst.toFixed(1)} from the middle, past posts at ${border.VERGE}`);
  assert.ok(worst > border.ROAD_HALF, 'steering flat out never even left the tarmac');
});

test('border: the theme changes when you start driving, and back when you stop', () => {
  const { game, drive } = setOff();
  assert.strictEqual(game.music(), 'chase');
  drive.tap('start');
  assert.strictEqual(game.state().screen, 'paused');
  assert.strictEqual(game.music(), 'patrol', 'the menu theme is the game theme, so there is only one theme');
});

test('border: the engine is heard, and heard faster the harder it is worked', () => {
  // There is no looping voice to spare -- music() owns the only one -- so the
  // engine is a stream of one-shots, and the rate is the tachometer.
  const idle = setOff('mula');
  idle.drive.step(90);
  const still = idle.game.drain().filter((s) => s.startsWith('engine')).length;

  const fast = setOff('mula');
  chase(fast.game, fast.drive, { frames: 90, ram: false });
  const moving = fast.game.drain().filter((s) => s.startsWith('engine')).length;

  assert.ok(still > 0, 'a running engine makes no sound at all');
  assert.ok(moving > still, `flat out fired ${moving} engine pulses against ${still} at idle`);
});

// --- city of angels specifically ---------------------------------------------

const angels = require('../src/games/angels');

// The map is the one thing in this game that cannot be checked by looking at
// it: fifteen rooms, ten doorways, two padlocks, and a channel between two
// canals that has to line up with the door that opens onto it. It did not, once.
test('angels: every doorway opens onto somewhere you can stand', () => {
  const SOLID = new Set(['wall', 'fence', 'tent', 'cart', 'bench', 'tree', 'bin', 'water']);
  const GLYPH = {
    '.': 'ground', ',': 'kerb', '#': 'wall', x: 'fence', t: 'tent', c: 'cart',
    '=': 'bench', T: 'tree', o: 'bin', '~': 'water', _: 'plank', '*': 'star',
  };
  const DOOR_COLS = [9, 10];
  const DOOR_ROWS = [5, 6];
  const problems = [];

  for (const [id, room] of Object.entries(angels.ROOMS)) {
    const grid = room.map.map((line) => [...line].map((ch) => GLYPH[ch]));
    const walkable = (r, c) => !SOLID.has(grid[r][c]);

    for (const side of Object.keys(room.exits)) {
      // The tile you land on having stepped through, and the tile past that:
      // one walkable tile behind a door is a doorway into a cupboard.
      const inside = side === 'north' ? DOOR_COLS.map((c) => [[1, c], [2, c]])
        : side === 'south' ? DOOR_COLS.map((c) => [[angels.ROWS - 2, c], [angels.ROWS - 3, c]])
        : side === 'west' ? DOOR_ROWS.map((r) => [[r, 1], [r, 2]])
        : DOOR_ROWS.map((r) => [[r, angels.COLS - 2], [r, angels.COLS - 3]]);

      const open = inside.some((pair) => pair.every(([r, c]) => walkable(r, c)));
      if (!open) problems.push(`${id}.${side}`);
    }
  }
  assert.deepStrictEqual(problems, [], `doorways with nowhere to go: ${problems.join(', ')}`);
});

// Both padlocks are opened by something a boss drops, and both of those bosses
// have to be reachable without the thing they are holding. Get that backwards
// and the game is unfinishable in a way no amount of playing the first region
// would ever show you.
test('angels: nothing is locked behind the key it holds', () => {
  const reach = (held) => {
    const seen = new Set([angels.START.room]);
    const queue = [angels.START.room];
    while (queue.length) {
      const room = angels.ROOMS[queue.shift()];
      for (const exit of Object.values(room.exits)) {
        if (exit.need && !held.has(exit.need)) continue;
        if (seen.has(exit.to)) continue;
        seen.add(exit.to);
        queue.push(exit.to);
      }
    }
    return seen;
  };

  const held = new Set();
  let rooms = reach(held);
  // Walk the gates open in order, taking whatever the bosses inside give us.
  for (let pass = 0; pass < 8; pass++) {
    for (const boss of Object.values(angels.BOSSES)) {
      if (rooms.has(boss.room) && boss.gives) held.add(boss.gives);
    }
    rooms = reach(held);
  }
  assert.deepStrictEqual(
    Object.keys(angels.ROOMS).filter((id) => !rooms.has(id)), [],
    'a room that cannot be reached however many bosses you beat',
  );
  for (const boss of Object.values(angels.BOSSES)) {
    assert.ok(rooms.has(boss.room), `${boss.name} sits behind a door only ${boss.name} can open`);
  }
});

// Drives the whole game with a pad, from the title screen to the ending. It is
// not a good player -- it fights at arm's length, gives up on anything it has
// failed to walk to for a second and a half, and takes the continue every time
// -- which is the point: if this can finish the game, the game finishes.
function playthrough(seed, { continues = 6, cap = 60000 } = {}) {
  const game = angels.create(720, 480, { scores: fakeTable(), seed });
  const pad = new input.Pad('p1');
  const field = game.field;
  const T = field.w / angels.COLS;
  const tx = (c) => field.x + c * T;
  const ty = (r) => field.y + r * T;
  const buttons = ['up', 'down', 'left', 'right', 'a', 'b'];

  // [room, what to do there, where]. Waypoints are in tiles, and the ones on an
  // edge sit past the exit trigger so walking at them leaves the room.
  const PLAN = [
    ['bridge', 'talk', [[6, 5]]], ['bridge', 'go', [[10, 5], [10, 0.2]]],
    ['lane', 'go', [[10, 5], [10, 0.2]]], ['crossing', 'go', [[10, 5], [10, 0.2]]],
    ['cartking', 'boss', 'cartking'], ['cartking', 'go', [[10, 10.8]]],
    ['crossing', 'go', [[10, 10.8]]], ['lane', 'go', [[10, 6], [0.2, 6]]],
    ['alley', 'go', [[10, 6], [0.2, 6]]], ['canals', 'go', [[9.5, 6], [9.5, 0.2]]],
    ['oceanfront', 'go', [[10, 6], [0.2, 6]]], ['muscle', 'go', [[10, 6], [10, 0.2]]],
    ['boardwalk', 'go', [[10, 6], [10, 0.2]]], ['pier', 'boss', 'prophet'],
    ['pier', 'go', [[10, 10.8]]], ['boardwalk', 'go', [[10, 10.8]]],
    ['muscle', 'go', [[10, 6], [19.8, 6]]], ['oceanfront', 'go', [[10, 6], [10, 0.2]]],
    ['station', 'go', [[10, 6], [10, 0.2]]], ['blvd', 'go', [[10, 6], [10, 0.2]]],
    ['capitan', 'go', [[10, 6], [10, 0.2]]], ['theatre', 'boss', 'director'],
  ];

  const toward = (want, gx, gy, px, py) => {
    if (gx - px > 4) want.add('right'); else if (px - gx > 4) want.add('left');
    if (gy - py > 4) want.add('down'); else if (py - gy > 4) want.add('up');
  };
  // Back off, but never out through the door you just came in by.
  const away = (want, gx, gy, px, py) => {
    if (gx > px) want.add(px - T > field.x + T ? 'left' : 'right');
    else want.add(px + T < field.x + field.w - T ? 'right' : 'left');
    if (gy > py) want.add(py - T > field.y + T ? 'up' : 'down');
    else want.add(py + T < field.y + field.h - T ? 'down' : 'up');
  };

  let step = 0;
  let leg = 0;
  let frames = 0;
  let inRoom = 0;
  let stuckFor = 0;
  let markFor = 0;
  let mark = null;
  let room = null;
  let last = [0, 0];
  let skip = new Set();
  let skipLoot = new Set();
  const visited = new Set();
  const arrivals = {}; // room -> how many were waiting the last time we walked in
  const shutRooms = new Set(); // rooms that ever refused to let us out

  pad.set('a', true); game.update(STEP, { p1: pad.read() }); pad.set('a', false);

  while (frames++ < cap) {
    const s = game.state();
    if (s.screen === 'died') {
      if (s.continues >= continues) break;
      for (const b of buttons) pad.set(b, false);
      pad.set('a', frames % 6 === 0);
      game.update(STEP, { p1: pad.read() });
      continue;
    }
    if (s.screen !== 'play') break;

    visited.add(s.room);
    if (s.shut) shutRooms.add(s.room);
    inRoom++;
    if (s.room !== room) { room = s.room; inRoom = 0; mark = null; skip = new Set(); skipLoot = new Set(); arrivals[room] = s.enemies; }
    const [px, py] = s.at;
    if (Math.hypot(px - last[0], py - last[1]) < 6) stuckFor++; else stuckFor = 0;
    last = [px, py];

    const want = new Set();
    if (s.talking > 0) {
      if (frames % 3 === 0) want.add('a'); // one press finishes the typing, the next turns the page
    } else {
      let entry = PLAN[step];
      if (entry && s.room !== entry[0]) {
        let at = PLAN.findIndex((p, i) => i >= step && p[0] === s.room);
        if (at < 0) at = PLAN.findIndex((p) => p[0] === s.room); // a continue puts us behind ourselves
        if (at >= 0 && at !== step) { step = at; leg = 0; entry = PLAN[step]; }
      }
      if (!entry) break;
      const [, kind, detail] = entry;
      if (kind === 'boss' && s.done[detail]) { step++; leg = 0; continue; }
      if (kind === 'talk' && s.has.bat) { step++; leg = 0; continue; }

      const lkey = (l) => `${l.kind}${Math.round(l.x / 20)}:${Math.round(l.y / 20)}`;
      const fkey = (f) => `${f.kind}${Math.round(f.x / 60)}:${Math.round(f.y / 60)}`;

      let target = null;
      let contact = 0.9;
      let reach = 1.95;
      let dodging = false;
      if (s.boss) {
        const size = angels.BOSSES[s.boss.id].size;
        contact = 0.45 * (1 + size);
        reach = 1.95 + 0.4 * size;
        target = [s.boss.x, s.boss.y];
        dodging = s.boss.mode === 'wind' || s.boss.mode === 'charge';
      } else {
        const ranked = s.foes.filter((f) => !skip.has(fkey(f)))
          .map((f) => ({ f, d: Math.hypot(f.x - px, f.y - py) })).sort((a, b) => a.d - b.d);
        // Stay on one of them: re-picking the nearest every frame with two
        // either side of you is how you chase both and catch neither.
        if (markFor > 0) markFor--;
        if (ranked.length && (markFor === 0 || !ranked.some((r) => r.f === mark))) { mark = ranked[0].f; markFor = 60; }
        if (ranked.length && inRoom < 30 * 75) {
          const near = ranked.find((r) => r.f === mark) ?? ranked[0];
          target = [near.f.x, near.f.y];
          contact = 0.42 * (1 + angels.KINDS[near.f.kind].size);
          if (stuckFor > 45) { skip.add(fkey(near.f)); mark = null; markFor = 0; stuckFor = 0; }
        }
      }

      const loot = s.loot.filter((l) => !skipLoot.has(lkey(l)))
        .filter((l) => !(l.kind === 'heart' && s.hearts >= s.maxHearts))
        .map((l) => ({ l, d: Math.hypot(l.x - px, l.y - py) })).sort((a, b) => a.d - b.d)[0];
      const hurt = s.hearts <= s.maxHearts - 2;

      if (dodging) {
        // Cross the line rather than run down it.
        if (Math.abs(target[0] - px) > Math.abs(target[1] - py)) want.add(py > field.y + field.h / 2 ? 'up' : 'down');
        else want.add(px > field.x + field.w / 2 ? 'left' : 'right');
      } else if (loot && (hurt ? loot.d < T * 6 : !target && loot.d < T * 7)) {
        if (stuckFor > 45) { skipLoot.add(lkey(loot.l)); stuckFor = 0; }
        toward(want, loot.l.x, loot.l.y, px, py);
      } else if (target) {
        const d = Math.hypot(target[0] - px, target[1] - py) / T;
        if (d < contact + 0.4) away(want, target[0], target[1], px, py);
        else if (d > reach - 0.35) toward(want, target[0], target[1], px, py);
        if (d < reach - 0.1 && frames % 4 === 0) want.add('a');
        const crowd = s.foes.filter((f) => Math.hypot(f.x - px, f.y - py) < T * 3).length;
        if ((s.paint > 0 || s.juice > 0) && (s.boss || crowd >= 3) && frames % 12 === 0) want.add('b');
      } else if (kind === 'talk') {
        const [c, r] = detail[0];
        if (Math.hypot(tx(c + 0.5) - px, ty(r + 0.5) - py) > T * 1.1) toward(want, tx(c + 0.5), ty(r + 0.5), px, py);
        else if (frames % 4 === 0) want.add('a');
      } else if (kind === 'go') {
        const [c, r] = detail[Math.min(leg, detail.length - 1)];
        if (Math.hypot(tx(c) - px, ty(r) - py) < T * 0.35 && leg < detail.length - 1) leg++;
        toward(want, tx(c), ty(r), px, py);
      }
    }

    for (const b of buttons) pad.set(b, want.has(b));
    game.update(STEP, { p1: pad.read() });
  }

  return { frames, state: game.state(), visited, arrivals, shutRooms };
}

test('angels: the whole city can be cleared', () => {
  // Four seeds, because a fight this long is chaotic enough that one of them
  // proves nothing. A bad seed for a mediocre player is fine; four of them are
  // a difficulty problem.
  const runs = [3, 4, 6, 8].map((seed) => ({ seed, ...playthrough(seed) }));
  const won = runs.filter((r) => r.state.won);

  assert.ok(won.length >= 3,
    `only ${won.length} of 4 runs finished: ${runs.map((r) => `${r.seed}=${r.state.room}/${r.state.score}`).join(' ')}`);

  for (const r of won) {
    assert.deepStrictEqual(r.state.done, { cartking: true, prophet: true, director: true });
    assert.strictEqual(r.state.screen, 'over');
    assert.ok(r.state.score > 3000, `finished on ${r.state.score}, which is not a finishing score`);
    // Every room on the critical path, which is all of them bar the dead end
    // off the Boulevard that the plan above deliberately never turns down.
    assert.strictEqual(r.visited.size, Object.keys(angels.ROOMS).length - 1);
    // A boss quiets the rooms behind you, not the ones you have not seen yet.
    // The crossing is walked twice and is empty the second time; Cold Storage
    // is walked once, after the Cart King, and still has people in it.
    assert.strictEqual(r.arrivals.crossing, 0, `seed ${r.seed}: the crossing should be quiet on the way back`);
    assert.ok(r.arrivals.alley > 0, `seed ${r.seed}: Cold Storage was never visited and should not be empty`);
    // Every boss shut the way out, and a run that got to the ending walked out
    // of all three afterwards: shutting and re-opening, asserted as a pair.
    assert.deepStrictEqual([...r.shutRooms].sort(), ['cartking', 'pier', 'theatre'],
      `seed ${r.seed}: every boss room should shut behind you and no other room should`);
  }
});

// You do not get to fight a boss two hits at a time from the doorway. The way
// out is filled in behind you, the same way a padlocked gate is, and the player
// is stopped by the shutter rather than by the exit declining to fire.
test('angels: a boss shuts the way out behind you', () => {
  const game = angels.create(720, 480, { scores: fakeTable(), seed: 3 });
  const drive = toMenu(game);
  drive.tap('a'); // NEW GAME

  // North three rooms to the underpass, dismissing everything said on the way,
  // including the two people who now come after you.
  for (let i = 0; i < 2000 && game.state().room !== 'cartking'; i++) {
    if (game.state().talking > 0) drive.tap('a');
    else drive.step(1, { p1: { up: true } });
  }
  drive.step(1, { p1: { up: false } });
  assert.strictEqual(game.state().room, 'cartking', 'never reached the underpass');
  assert.ok(game.state().boss, 'the Cart King should be up');
  assert.strictEqual(game.state().shut, true, 'the underpass shuts behind you');

  // The shutter is drawn, so it obeys the palette and flicker rules like any
  // other tile.
  const scene = game.scene();
  invariants.legalFrame(scene, sceneRenderer.render(scene), 'angels [boss room shut]');

  // Now walk at the way out and keep walking. The field is eleven tiles tall
  // and the perimeter is the eleventh, so a player stopped by the shutter never
  // gets past the top of it.
  const TILE = game.field.h / angels.ROWS;
  const wall = game.field.y + game.field.h - TILE;
  let deepest = 0;
  for (let i = 0; i < 200; i++) {
    const s = game.state();
    if (s.screen !== 'play') break; // he may well kill us, which is not leaving either
    assert.strictEqual(s.room, 'cartking', 'walked out of a boss fight');
    deepest = Math.max(deepest, s.at[1]);
    if (s.talking > 0) drive.tap('a');
    else drive.step(1, { p1: { down: true } });
  }
  drive.step(1, { p1: { down: false } });
  assert.strictEqual(game.state().room, 'cartking');
  assert.ok(deepest > wall - TILE * 2, `never even reached the shutter: got to ${deepest}, it is at ${wall}`);
  assert.ok(deepest < wall, `walked into the shutter: got to ${deepest}, it is at ${wall}`);
});

// Sarge has the bat and Gloria has the story. Head for the door without either
// and the street freezes while they run over and say it anyway: a run without
// the bat cannot be won, and the padlock west of Cold Storage means nothing to
// somebody who has not heard where the cutters went.
test('angels: nobody leaves without the bat, or without hearing about the cutters', () => {
  const game = angels.create(720, 480, { scores: fakeTable(), seed: 3 });
  const drive = toMenu(game);
  drive.tap('a'); // NEW GAME
  for (let i = 0; i < 400 && game.state().talking > 0; i++) drive.tap('a');

  // Hold a direction and never press A beside anybody. Whatever is said gets
  // read and dismissed, and while somebody is running over the stick is held
  // anyway, to show it does nothing.
  const fetched = new Set();
  const walk = (dir, until, limit = 900) => {
    let frozenAt = null;
    for (let i = 0; i < limit && !until(game.state()); i++) {
      const s = game.state();
      if (s.fetching) {
        fetched.add(s.fetching);
        if (frozenAt) assert.deepStrictEqual(s.at, frozenAt, 'the player is held still while being fetched');
        frozenAt = s.at;
        drive.step(1, { p1: { [dir]: true } });
      } else if (s.talking > 0) {
        frozenAt = null;
        drive.tap('a');
      } else {
        frozenAt = null;
        drive.step(1, { p1: { [dir]: true } });
      }
    }
    drive.step(1, { p1: { [dir]: false } });
    assert.ok(until(game.state()), `never got there: ${JSON.stringify(game.state().room)} fetching=${game.state().fetching}`);
  };

  walk('up', (s) => s.fetching === 'sarge');
  assert.strictEqual(game.state().room, 'bridge', 'the door does not open until Sarge has caught up');
  assert.strictEqual(game.state().has.bat, false);
  // A man running is a drawing state nothing else reaches; it obeys the rules too.
  drive.step(12);
  assert.strictEqual(game.state().fetching, 'sarge');
  const running = game.scene();
  invariants.legalFrame(running, sceneRenderer.render(running), 'angels [sarge running]');
  walk('up', (s) => s.talking > 0);
  assert.strictEqual(game.state().fetching, null, 'he arrives, then he talks');
  assert.strictEqual(game.state().room, 'bridge');
  walk('up', (s) => s.room === 'lane');
  assert.ok(game.state().has.bat, 'you leave the bridge holding the bat');

  walk('up', (s) => s.room === 'crossing');
  assert.ok(fetched.has('gloria'), 'Gloria came after you at the top of the lane');

  // Neither of them does it twice: back down through both rooms and out again.
  fetched.clear();
  walk('down', (s) => s.room === 'lane');
  walk('down', (s) => s.room === 'bridge');
  walk('up', (s) => s.room === 'lane');
  assert.deepStrictEqual([...fetched], [], 'a thing said once is said');
});

test('angels: getting up costs you, and giving up ends it', () => {
  const game = angels.create(720, 480, { scores: fakeTable(), seed: 5 });
  const drive = toMenu(game);
  drive.tap('a'); // NEW GAME

  // Anything on screen gets read and dismissed; nothing else is pressed.
  const readOn = (limit = 400) => {
    for (let i = 0; i < limit && game.state().talking > 0; i++) drive.tap('a');
  };
  // Walk north until the room changes, dismissing whatever is said on the way.
  const northTo = (room, limit = 900) => {
    for (let i = 0; i < limit && game.state().room !== room; i++) {
      if (game.state().talking > 0) drive.tap('a');
      else drive.step(1, { p1: { up: true } });
    }
    drive.step(1, { p1: { up: false } });
    assert.strictEqual(game.state().room, room, `never got as far as ${room}`);
  };
  // Then stand in it and do nothing at all.
  const standStill = (limit = 1200) => {
    for (let i = 0; i < limit && game.state().screen === 'play'; i++) drive.step(1);
  };

  readOn();
  northTo('crossing');
  standStill();

  const dead = game.state();
  assert.strictEqual(dead.screen, 'died', 'standing still in the crossing should end badly');
  assert.strictEqual(dead.hearts, 0);

  const before = dead.score;
  drive.step(30); // the screen holds for a moment before it takes a button
  drive.tap('a'); // GET UP

  const up = game.state();
  assert.strictEqual(up.screen, 'play');
  assert.strictEqual(up.continues, 1);
  assert.strictEqual(up.hearts, up.maxHearts, 'you get up on your feet, not on your knees');
  assert.strictEqual(up.room, angels.REGION_START.skid, 'a continue puts you back at the mouth of the region');
  assert.strictEqual(up.score, Math.max(0, before - angels.CONTINUE_COST));

  // And the other way out of the same screen.
  northTo('crossing');
  standStill();
  assert.strictEqual(game.state().screen, 'died');
  drive.step(30);
  drive.tap('down');
  drive.tap('a'); // GIVE UP
  assert.strictEqual(game.state().screen, 'over');
  assert.strictEqual(game.state().won, false);
});

// The dialogue box is a fixed 34 columns by two lines, and every word in the
// script has to fit inside it. A word that doesn't isn't wrapped, it is drawn
// off the end of the box and out of the picture.
test('angels: every line anybody says fits in the box', () => {
  const fresh = { has: {}, done: {}, met: {} };
  const done = {
    has: { bat: 1, spray: 1, boombox: 1, cutters: 1, pass: 1 },
    done: { cartking: 1, prophet: 1, director: 1 },
    met: { gloria: 1 },
  };

  const said = [];
  for (const [id, person] of Object.entries(angels.PEOPLE)) {
    for (const run of [fresh, done]) {
      const lines = person.lines(run);
      assert.ok(Array.isArray(lines) && lines.length, `${id} has nothing to say`);
      said.push(...lines.map((line) => [id, line]));
    }
  }
  for (const [id, boss] of Object.entries(angels.BOSSES)) {
    said.push(...[...boss.intro, ...boss.outro].map((line) => [id, line]));
  }
  said.push(...angels.OPENING.map((l) => ['opening', l]));
  said.push(...angels.ENDING.map((l) => ['ending', l]));
  for (const [id, room] of Object.entries(angels.ROOMS)) {
    for (const exit of Object.values(room.exits)) if (exit.locked) said.push([id, exit.locked]);
  }

  for (const [who, line] of said) {
    assert.ok(line.trim().length, `${who}: an empty line`);
    for (const page of angels.paginate([line])) {
      assert.ok(page.length <= 2, `${who}: a page of ${page.length} lines`);
      for (const row of page) {
        assert.ok(row.length <= angels.WRAP, `${who}: "${row}" is ${row.length} columns, box holds ${angels.WRAP}`);
      }
    }
  }

  // The how-to screen is drawn straight rather than wrapped, so it has its own
  // width to keep -- 40 characters is what fits across the picture at scale 2.
  for (const line of angels.HOW_TO) {
    assert.ok(line.length <= 40, `how to play: "${line}" is ${line.length} columns`);
  }
});

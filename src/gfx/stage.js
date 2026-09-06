'use strict';
// The frame loop.
//
// Time is derived from the frame counter, not the wall clock: frame n renders
// at t = n / fps. That makes playback reproducible -- the same frame always
// draws the same picture -- at the cost of running slow rather than dropping
// frames if the renderer can't keep up. The loop reports when that happens
// instead of hiding it.
//
// Where the frames go is the caller's business. By default they go to the Pi's
// framebuffer; pass a `writer` and they go wherever it likes (src/preview.js
// streams them to a browser on the dev machine). A writer is anything with
// `fb: {width, height}`, `present(canvas) -> {pack, write}` and `close()`.

const sceneRenderer = require('./scene');
const fs = require('fs');
const framebuffer = require('../framebuffer');

// The CPU clock, read straight from sysfs. It belongs in the frame report
// because on a Pi the ondemand governor will happily drop to 1200 MHz while a
// 30 fps loop is only using a third of one core, and every CPU stage then costs
// 1.5x more for reasons that have nothing to do with the code. Reading it from
// inside the process matters: sampling it from a shell loop is itself enough
// load to hold the governor up and hide the effect.
const CLOCK = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
function cpuMHz() {
  try {
    return Math.round(Number(fs.readFileSync(CLOCK, 'utf8')) / 1000);
  } catch {
    return null;
  }
}

function run(build, { fps = 30, seconds = Infinity, onStop, writer = null, report = true } = {}) {
  const out = writer ?? framebuffer.open();
  const { width, height } = out.fb;
  const period = 1000 / fps;

  let frame = 0;
  let timer = null;
  let stopped = false;
  let paused = false;
  let due = performance.now();

  // Rolling stats, reported once a second.
  let windowStart = performance.now();
  let windowFrames = 0;
  let windowBusy = 0;
  let windowDraw = 0;
  let windowPack = 0;
  let windowWrite = 0;
  let late = 0;

  const onSignal = () => stop('interrupted');

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    out.close();
    if (onStop) onStop(reason, frame);
  };

  // Draws the frame the counter is sitting on. Split out of tick() so that a
  // paused preview can step or scrub a frame without the scheduling and the
  // rolling stats coming along with it. Time still comes from the counter, so
  // a scrubbed frame is the picture playback would have shown at that instant.
  const renderFrame = () => {
    const began = performance.now();
    const canvas = sceneRenderer.render(build(width, height, frame / fps));
    const drawn = performance.now();
    const cost = out.present(canvas);
    const shown = performance.now();
    return { began, draw: drawn - began, busy: shown - began, pack: cost.pack, write: cost.write };
  };

  const tick = () => {
    if (stopped || paused) return;
    const cost = renderFrame();

    frame++;
    windowFrames++;
    windowDraw += cost.draw;
    windowBusy += cost.busy;
    windowPack += cost.pack;
    windowWrite += cost.write;

    if (report && cost.began - windowStart >= 1000) {
      const busy = windowBusy / windowFrames;
      const mhz = cpuMHz();
      process.stderr.write(
        `${windowFrames} fps | ${busy.toFixed(1)} ms/frame ` +
        `(draw ${(windowDraw / windowFrames).toFixed(1)} + pack ${(windowPack / windowFrames).toFixed(1)} + write ${(windowWrite / windowFrames).toFixed(1)}) ` +
        `| ${(100 * busy / period).toFixed(0)}% of budget` +
        `${mhz ? ` | cpu ${mhz} MHz` : ''}${late ? ` | ${late} late` : ''}\n`
      );
      [windowStart, windowFrames, windowBusy, windowDraw, windowPack, windowWrite, late] = [cost.began, 0, 0, 0, 0, 0, 0];
    }

    if (frame / fps >= seconds) return stop('done');

    due += period;
    const now = performance.now();
    if (due < now) { late++; due = now; } // we fell behind; don't try to catch up
    timer = setTimeout(tick, due - now);
  };

  const pause = () => {
    if (paused || stopped) return;
    paused = true;
    clearTimeout(timer);
  };

  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    due = performance.now(); // start the schedule from here, don't replay the gap
    tick();
  };

  const seek = (n) => {
    if (stopped) return;
    frame = Math.max(0, Math.round(n));
    if (paused) renderFrame(); // playing, and the next tick draws it anyway
  };

  const state = () => ({ frame, fps, paused, stopped, at: frame / fps });

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  tick();

  return { stop, pause, resume, seek, state };
}

module.exports = { run };

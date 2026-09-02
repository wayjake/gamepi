'use strict';
// The frame loop.
//
// Time is derived from the frame counter, not the wall clock: frame n renders
// at t = n / fps. That makes playback reproducible -- the same frame always
// draws the same picture -- at the cost of running slow rather than dropping
// frames if the renderer can't keep up. The loop reports when that happens
// instead of hiding it.

const sceneRenderer = require('./scene');
const framebuffer = require('../framebuffer');

function run(build, { fps = 30, seconds = Infinity, onStop } = {}) {
  const writer = framebuffer.open();
  const { width, height } = writer.fb;
  const period = 1000 / fps;

  let frame = 0;
  let timer = null;
  let stopped = false;
  let due = performance.now();

  // Rolling stats, reported once a second.
  let windowStart = performance.now();
  let windowFrames = 0;
  let windowBusy = 0;
  let windowDraw = 0;
  let windowPack = 0;
  let windowWrite = 0;
  let late = 0;

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    writer.close();
    if (onStop) onStop(reason, frame);
  };

  const tick = () => {
    if (stopped) return;
    const began = performance.now();

    const t = frame / fps;
    const canvas = sceneRenderer.render(build(width, height, t));
    const drawn = performance.now();
    const cost = writer.present(canvas);
    const shown = performance.now();
    windowPack += cost.pack;
    windowWrite += cost.write;

    frame++;
    windowFrames++;
    windowDraw += drawn - began;
    windowBusy += shown - began;

    if (began - windowStart >= 1000) {
      const busy = windowBusy / windowFrames;
      process.stderr.write(
        `${windowFrames} fps | ${busy.toFixed(1)} ms/frame ` +
        `(draw ${(windowDraw / windowFrames).toFixed(1)} + pack ${(windowPack / windowFrames).toFixed(1)} + write ${(windowWrite / windowFrames).toFixed(1)}) ` +
        `| ${(100 * busy / period).toFixed(0)}% of budget${late ? ` | ${late} late` : ''}\n`
      );
      [windowStart, windowFrames, windowBusy, windowDraw, windowPack, windowWrite, late] = [began, 0, 0, 0, 0, 0, 0];
    }

    if (frame / fps >= seconds) return stop('done');

    due += period;
    const now = performance.now();
    if (due < now) { late++; due = now; } // we fell behind; don't try to catch up
    timer = setTimeout(tick, due - now);
  };

  process.on('SIGINT', () => stop('interrupted'));
  process.on('SIGTERM', () => stop('interrupted'));
  tick();

  return { stop };
}

module.exports = { run };

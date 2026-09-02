'use strict';
// The frame loop.
//
// Time is derived from the frame counter, not the wall clock: frame n renders
// at t = n / fps. That makes playback reproducible -- the same frame always
// draws the same picture -- at the cost of running slow rather than dropping
// frames if the renderer can't keep up. The loop reports when that happens
// instead of hiding it.

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
      const mhz = cpuMHz();
      process.stderr.write(
        `${windowFrames} fps | ${busy.toFixed(1)} ms/frame ` +
        `(draw ${(windowDraw / windowFrames).toFixed(1)} + pack ${(windowPack / windowFrames).toFixed(1)} + write ${(windowWrite / windowFrames).toFixed(1)}) ` +
        `| ${(100 * busy / period).toFixed(0)}% of budget` +
        `${mhz ? ` | cpu ${mhz} MHz` : ''}${late ? ` | ${late} late` : ''}\n`
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

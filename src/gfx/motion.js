'use strict';
// Motion helpers. Everything is a pure function of t (seconds), so a frame is
// reproducible from its number alone -- which is what lets the tests render
// frame N and compare it, and what keeps playback identical every run.

const TAU = Math.PI * 2;

// Smooth back-and-forth. period in seconds, phase in turns.
const sway = (t, period, amp = 1, phase = 0) => Math.sin((t / period + phase) * TAU) * amp;

// Always-positive arc, for hops and pulses that shouldn't go negative.
const hop = (t, period, height = 1, phase = 0) => Math.abs(Math.sin((t / period + phase) * Math.PI)) * height;

// Multiplier around 1, for breathing and squash.
const pulse = (t, period, amount = 0.05, phase = 0) => 1 + sway(t, period, amount, phase);

// 0..1 sawtooth, for anything that should cycle rather than oscillate.
const cycle = (t, period, phase = 0) => ((t / period + phase) % 1 + 1) % 1;

module.exports = { TAU, sway, hop, pulse, cycle };

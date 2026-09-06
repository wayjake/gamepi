'use strict';
// One gamepad's worth of state, and nothing about where it came from.
//
// Three things produce input -- a real gamepad through the browser's Gamepad
// API, a keyboard standing in for one, and /dev/input/js0 on the Pi (see
// joystick.js) -- and a game should not be able to tell them apart. They all
// end up calling set().
//
// Games read once per frame. Held buttons are what they sound like; `pressed`
// is the edge, cleared by the read, so a menu moves one line per press however
// long the stick is leaned on.

// `home` is the extra button a modern pad has beside START -- the star on an
// 8BitDo SN30 Pro, the guide on an X-input pad. Nothing in a game may use it:
// it belongs to the shell, which takes it as "back to the selector", the same
// way START+SELECT held is the way out of a game that has stopped listening.
const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select', 'home'];

class Pad {
  constructor(name = 'p1') {
    this.name = name;
    this.held = new Set();
    this.edges = new Set();
  }

  set(button, down) {
    if (!BUTTONS.includes(button)) return false;
    if (down) {
      if (!this.held.has(button)) this.edges.add(button);
      this.held.add(button);
    } else {
      this.held.delete(button);
    }
    return true;
  }

  read() {
    const frame = { pressed: {} };
    for (const button of BUTTONS) {
      frame[button] = this.held.has(button);
      frame.pressed[button] = this.edges.has(button);
    }
    this.edges.clear();
    return frame;
  }

  // Everything let go of. Used when a pad disconnects mid-game, so a paddle
  // doesn't carry on drifting into the wall on the last direction it saw.
  clear() {
    this.held.clear();
    this.edges.clear();
  }
}

// A frame in which nothing is pressed -- for a player who has no pad attached,
// and for tests that only care about one of the two.
function idle() {
  const frame = { pressed: {} };
  for (const button of BUTTONS) {
    frame[button] = false;
    frame.pressed[button] = false;
  }
  return frame;
}

// Either pad may drive a menu, so the two get folded into one frame.
function merge(...frames) {
  const out = idle();
  for (const frame of frames) {
    for (const button of BUTTONS) {
      out[button] = out[button] || frame[button];
      out.pressed[button] = out.pressed[button] || frame.pressed[button];
    }
  }
  return out;
}

module.exports = { Pad, BUTTONS, idle, merge };

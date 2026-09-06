'use strict';
// Reads a gamepad on the Pi from /dev/input/js0 and drives a Pad.
//
// The Linux joystick API is a stream of 8-byte records, little-endian:
//
//   0  uint32 time (ms)   6  uint8 type   0x01 button, 0x02 axis, |0x80 = synthetic
//   4  int16  value       7  uint8 number
//
// On open the driver replays the current state of every control with 0x80 set.
// Those are worth applying (so a stick already held registers) but not worth
// treating as presses, which is why they go in with the edge suppressed.
//
// Button numbering is not standardised across pads -- what a driver calls
// button 0 is whatever the manufacturer wired first -- so the numbers live in
// PROFILES below and one is picked from the pad's name at open. Force one with
// GAMEPI_PAD_PROFILE=dinput|xpad, or fix individual buttons with GAMEPI_PAD_MAP
// (a JSON object of the same shape) rather than editing this file.
// `node src/game.js --pad-test` prints the name, the profile and the numbers
// your pad actually sends.

const fs = require('fs');
const path = require('path');

const RECORD = 8;
const TYPE_BUTTON = 0x01;
const TYPE_AXIS = 0x02;
const SYNTHETIC = 0x80;
const DEADZONE = 8000; // of 32767

// Buttons by number, and axes as [what negative means, what positive means].
// Axis 0/1 are the left stick, 6/7 the d-pad on most drivers; both are wired up
// so either works.
//
// Button *numbers* are the part that isn't portable. A driver either sorts a
// pad into a layout it knows or passes on the order the pad's own firmware
// reports, and there is no numbering that is right for both:
//
//   xpad    a pad in X-input mode: 6 and 7 are BACK and START.
//   dinput  a generic HID pad through hid-generic, and most cheap USB pads:
//           SELECT and START at 8 and 9.
//   8bitdo  an 8BitDo in D-input or Switch mode, which is how one arrives out
//           of the box. It reports B A _ X Y _ L1 R1 L2 R2 SELECT START HOME
//           L3 R3, so 8 and 9 are the *triggers*, SELECT and START are 10 and
//           11, and the star beside them is 12.
//
// The first version of this map claimed several of those pairs at once so that
// any pad would work. That is what put SELECT and START on an 8BitDo's L2 and
// R2 -- and since the shell leaves a game on START+SELECT held, squeezing both
// triggers dropped you out of whatever you were playing. One profile is live at
// a time now, chosen by what the pad calls itself.
const PROFILES = {};

PROFILES.dinput = {
  buttons: { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 8: 'select', 9: 'start' },
  axes: { 0: ['left', 'right'], 1: ['up', 'down'], 6: ['left', 'right'], 7: ['up', 'down'] },
};
// B and X are the two buttons under your thumb on a Nintendo-order face, which
// is why both are A here and the other two are B.
PROFILES['8bitdo'] = {
  buttons: { 0: 'a', 1: 'b', 3: 'a', 4: 'b', 10: 'select', 11: 'start', 12: 'home' },
  axes: { 0: ['left', 'right'], 1: ['up', 'down'], 6: ['left', 'right'], 7: ['up', 'down'] },
};
// 9 is the left stick click here and not worth having; the triggers are axes 2
// and 5 and are left alone. 8 is the guide button, which is this pad's star.
PROFILES.xpad = {
  buttons: { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 6: 'select', 7: 'start', 8: 'home' },
  axes: { 0: ['left', 'right'], 1: ['up', 'down'], 6: ['left', 'right'], 7: ['up', 'down'] },
};

// What to use when the pad will not say what it is. It is the pad this machine
// has, which is a better guess than a generic one.
const DEFAULT_PROFILE = '8bitdo';
const DEFAULT_MAP = PROFILES[DEFAULT_PROFILE];

// The driver publishes the pad's name next to the device node, which is enough
// to tell the families apart without a native module. Unreadable (or not Linux)
// means the default.
function deviceName(device = '/dev/input/js0') {
  try {
    return fs.readFileSync(`/sys/class/input/${path.basename(device)}/device/name`, 'utf8').trim();
  } catch {
    return null;
  }
}

function profileFor(device) {
  const forced = process.env.GAMEPI_PAD_PROFILE;
  if (forced) {
    if (!PROFILES[forced]) throw new Error(`GAMEPI_PAD_PROFILE must be one of ${Object.keys(PROFILES).join(', ')}`);
    return forced;
  }
  const name = deviceName(device);
  if (!name) return DEFAULT_PROFILE;
  if (/8bitdo/i.test(name)) return '8bitdo';
  // xpad renames whatever is plugged into it to an Xbox pad, so a pad calling
  // itself anything else is being read by hid-generic.
  if (/x-?box|x-?input/i.test(name)) return 'xpad';
  return 'dinput';
}

function loadMap({ device = '/dev/input/js0', profile = profileFor(device) } = {}) {
  const base = PROFILES[profile] ?? DEFAULT_MAP;
  const override = process.env.GAMEPI_PAD_MAP;
  if (!override) return base;
  try {
    const parsed = JSON.parse(override);
    return { buttons: { ...base.buttons, ...parsed.buttons }, axes: { ...base.axes, ...parsed.axes } };
  } catch (err) {
    throw new Error(`GAMEPI_PAD_MAP is not valid JSON: ${err.message}`);
  }
}

// The stick and the d-pad both map to `left`, so a button is only released once
// every control asserting it has let go. Without this, easing the stick back to
// centre would cancel a d-pad press that is still being held.
function holder(pad) {
  const sources = new Map();
  return (button, source, on) => {
    if (!button) return;
    let set = sources.get(button);
    if (!set) sources.set(button, (set = new Set()));
    const before = set.size;
    if (on) set.add(source); else set.delete(source);
    if (before === 0 && set.size === 1) pad.set(button, true);
    if (before === 1 && set.size === 0) pad.set(button, false);
  };
}

// The protocol, with no device under it. Split out because the device itself
// only exists on the Pi: this half can be fed bytes and tested anywhere, which
// is the only way any of this gets exercised before it meets real hardware.
function decoder({ pad, map = loadMap(), onEvent = null } = {}) {
  const assert = holder(pad);
  const axisAt = new Map();
  let spare = Buffer.alloc(0);

  const record = (time, value, type, number) => {
    const synthetic = (type & SYNTHETIC) !== 0;
    const kind = type & ~SYNTHETIC;
    if (onEvent) onEvent({ kind: kind === TYPE_BUTTON ? 'button' : 'axis', number, value, synthetic });

    if (kind === TYPE_BUTTON) {
      assert(map.buttons[number], `b${number}`, value !== 0);
      // A synthetic report is the driver telling us what is already held, not
      // a press, so don't let it fire a menu action on startup.
      if (synthetic) pad.edges.clear();
      return;
    }
    if (kind !== TYPE_AXIS) return;

    const pair = map.axes[number];
    if (!pair) return;
    const now = value < -DEADZONE ? pair[0] : value > DEADZONE ? pair[1] : null;
    if (axisAt.get(number) === now) return;
    assert(axisAt.get(number), `a${number}`, false);
    assert(now, `a${number}`, true);
    axisAt.set(number, now);
    if (synthetic) pad.edges.clear();
  };

  return {
    map,
    feed(chunk) {
      const buf = spare.length ? Buffer.concat([spare, chunk]) : chunk;
      let o = 0;
      for (; o + RECORD <= buf.length; o += RECORD) {
        record(buf.readUInt32LE(o), buf.readInt16LE(o + 4), buf[o + 6], buf[o + 7]);
      }
      spare = buf.subarray(o); // a partial record; the rest arrives next chunk
    },
  };
}

function open({ device = '/dev/input/js0', pad, onError = () => {}, onEvent = null } = {}) {
  const profile = profileFor(device);
  const decode = decoder({ pad, map: loadMap({ device, profile }), onEvent });
  let stream = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    stream = fs.createReadStream(device);
    stream.on('data', (chunk) => decode.feed(chunk));
    stream.on('error', (err) => {
      pad.clear(); // whatever was held is not held any more
      onError(err);
      retry();
    });
    stream.on('close', () => { pad.clear(); retry(); });
  };

  // A USB pad unplugged mid-game takes the device node with it. Keep looking,
  // quietly: the game carries on, and plugging back in picks up where it was.
  let timer = null;
  const retry = () => {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; connect(); }, 1000);
    timer.unref?.();
  };

  connect();

  return {
    device,
    name: deviceName(device),
    profile,
    map: decode.map,
    close() {
      closed = true;
      clearTimeout(timer);
      stream?.destroy();
    },
  };
}

module.exports = { open, decoder, PROFILES, DEFAULT_MAP, DEFAULT_PROFILE, RECORD, loadMap, profileFor, deviceName };

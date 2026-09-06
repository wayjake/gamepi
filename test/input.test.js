'use strict';

const test = require('node:test');
const assert = require('node:assert');

const input = require('../src/input');
const joystick = require('../src/joystick');

const record = (value, type, number) => {
  const b = Buffer.alloc(joystick.RECORD);
  b.writeUInt32LE(0, 0);
  b.writeInt16LE(value, 4);
  b[6] = type;
  b[7] = number;
  return b;
};
const BUTTON = 0x01;
const AXIS = 0x02;
const SYNTHETIC = 0x80;

test('a press is delivered once, however long it is held', () => {
  const pad = new input.Pad();
  pad.set('up', true);

  const first = pad.read();
  const second = pad.read();
  assert.ok(first.up && second.up, 'the button is held across both frames');
  assert.ok(first.pressed.up, 'the first frame sees the press');
  assert.ok(!second.pressed.up, 'the second frame sees it again');

  pad.set('up', false);
  pad.set('up', true);
  assert.ok(pad.read().pressed.up, 'releasing and pressing again is a new press');
});

test('a pad refuses buttons it does not have', () => {
  const pad = new input.Pad();
  assert.strictEqual(pad.set('turbo', true), false);
  assert.ok(!Object.keys(input.idle()).includes('turbo'));
});

test('either pad can drive a menu', () => {
  const p1 = new input.Pad('p1');
  const p2 = new input.Pad('p2');
  p2.set('down', true);
  const merged = input.merge(p1.read(), p2.read());
  assert.ok(merged.down && merged.pressed.down);
  assert.ok(!merged.up);
});

// The device only exists on the Pi, so the protocol is where the testing has to
// happen. Everything below feeds bytes to the decoder directly.
test('the joystick decoder reads the 8-byte record format', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad });

  decode.feed(record(1, BUTTON, 0));
  decode.feed(record(-32767, AXIS, 1));
  let frame = pad.read();
  assert.ok(frame.a, 'button 0 is A');
  assert.ok(frame.up, 'a negative Y axis is up');

  decode.feed(record(0, AXIS, 1));
  assert.ok(!pad.read().up, 'centring the stick releases it');
});

test('the stick and the d-pad do not cancel each other', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad });

  decode.feed(record(-32767, AXIS, 1)); // stick up
  decode.feed(record(-32767, AXIS, 7)); // d-pad up as well
  decode.feed(record(0, AXIS, 1));      // stick returns to centre
  assert.ok(pad.read().up, 'the d-pad is still holding up');

  decode.feed(record(0, AXIS, 7));
  assert.ok(!pad.read().up, 'and now nothing is');
});

test('a record split across two reads is still one event', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad });
  const pair = Buffer.concat([record(1, BUTTON, 11), record(1, BUTTON, 1)]);

  decode.feed(pair.subarray(0, 3));
  assert.ok(!pad.read().start, 'half a record is not an event');
  decode.feed(pair.subarray(3, 11));
  decode.feed(pair.subarray(11));

  const frame = pad.read();
  assert.ok(frame.start && frame.b, 'both events arrived once the bytes did');
});

test('the state replayed at open is held, but is not a press', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad });

  decode.feed(record(1, BUTTON | SYNTHETIC, 11));
  const frame = pad.read();
  assert.ok(frame.start, 'a button already down is down');
  assert.ok(!frame.pressed.start, 'but it must not open the menu it is sitting on');
});

test('a small stick movement is not a direction', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad });
  decode.feed(record(-4000, AXIS, 0)); // inside the deadzone
  assert.ok(!pad.read().left);
  decode.feed(record(-20000, AXIS, 0));
  assert.ok(pad.read().left);
});

// An 8BitDo in D-input or Switch mode -- which is how one arrives out of the
// box -- reports B A _ X Y _ L1 R1 L2 R2 SELECT START, so 8 and 9 are the
// triggers. Every map here used to call one pair or another of those SELECT and
// START; since the shell leaves a game on START+SELECT held, that meant
// squeezing two triggers dropped you out of the game you were playing.
test('no profile puts START or SELECT on a trigger', () => {
  for (const [name, profile] of Object.entries(joystick.PROFILES)) {
    const triggers = name === '8bitdo' ? [8, 9] : name === 'xpad' ? [] : [6, 7];
    for (const number of triggers) {
      const meaning = profile.buttons[number];
      assert.ok(meaning !== 'start' && meaning !== 'select',
        `${name} puts ${meaning} on button ${number}, which is a trigger there`);
    }
  }
});

test('each profile finds START and SELECT where its driver puts them', () => {
  const pairs = { dinput: [8, 9], '8bitdo': [10, 11], xpad: [6, 7] };
  for (const [name, [select, start]] of Object.entries(pairs)) {
    const pad = new input.Pad();
    const decode = joystick.decoder({ pad, map: joystick.PROFILES[name] });
    decode.feed(record(1, BUTTON, select));
    decode.feed(record(1, BUTTON, start));
    const frame = pad.read();
    assert.ok(frame.select && frame.start, `${name}: ${select}/${start} are not SELECT/START`);
  }
});

test('every profile has a confirm button and a way to quit', () => {
  for (const [name, profile] of Object.entries(joystick.PROFILES)) {
    const wired = new Set(Object.values(profile.buttons));
    for (const button of ['a', 'b', 'select', 'start']) {
      assert.ok(wired.has(button), `${name} has no ${button}`);
    }
  }
});

// The shell's short way out. A pad that has the button gets it; one that
// doesn't still has START+SELECT held.
test('the star beside START is home, and no game may want it', () => {
  const pad = new input.Pad();
  const decode = joystick.decoder({ pad, map: joystick.PROFILES['8bitdo'] });
  decode.feed(record(1, BUTTON, 12));
  assert.ok(pad.read().pressed.home, 'button 12 is the star on an 8BitDo');

  const xbox = new input.Pad();
  joystick.decoder({ pad: xbox, map: joystick.PROFILES.xpad }).feed(record(1, BUTTON, 8));
  assert.ok(xbox.read().pressed.home, 'button 8 is the guide on an X-input pad');

  assert.ok(input.BUTTONS.includes('home'));
  assert.strictEqual(input.idle().home, false);
});

test('the profile comes from the pad name, and can be forced', () => {
  const before = process.env.GAMEPI_PAD_PROFILE;
  try {
    delete process.env.GAMEPI_PAD_PROFILE;
    // There is no /sys on this machine, so nothing can be sniffed and the
    // default -- the pad this console actually has -- stands.
    assert.strictEqual(joystick.profileFor('/dev/input/js0'), '8bitdo');

    process.env.GAMEPI_PAD_PROFILE = 'xpad';
    assert.strictEqual(joystick.profileFor('/dev/input/js0'), 'xpad');
    assert.strictEqual(joystick.loadMap().buttons[7], 'start');

    process.env.GAMEPI_PAD_PROFILE = 'nonsense';
    assert.throws(() => joystick.profileFor('/dev/input/js0'), /GAMEPI_PAD_PROFILE/);
  } finally {
    if (before === undefined) delete process.env.GAMEPI_PAD_PROFILE;
    else process.env.GAMEPI_PAD_PROFILE = before;
  }
});

test('a pad map can be overridden without editing the source', () => {
  const before = process.env.GAMEPI_PAD_MAP;
  process.env.GAMEPI_PAD_MAP = JSON.stringify({ buttons: { 4: 'start' } });
  try {
    const pad = new input.Pad();
    const decode = joystick.decoder({ pad, map: joystick.loadMap() });
    decode.feed(record(1, BUTTON, 4));
    assert.ok(pad.read().start, 'button 4 was remapped to start');
    assert.strictEqual(joystick.loadMap().buttons[0], 'a', 'and the rest of the map survives');
  } finally {
    if (before === undefined) delete process.env.GAMEPI_PAD_MAP;
    else process.env.GAMEPI_PAD_MAP = before;
  }
});

test('losing the pad lets go of everything', () => {
  const pad = new input.Pad();
  pad.set('right', true);
  pad.clear();
  assert.ok(!pad.read().right, 'a paddle must not drift into the wall on a dead pad');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const sfx = require('../src/audio/sfx');
const mixer = require('../src/audio/mixer');
const song = require('../src/audio/song');
const synth = require('../src/audio/synth');

const peak = (block) => {
  let loudest = 0;
  for (let i = 0; i < block.length; i += 2) loudest = Math.max(loudest, Math.abs(block.readInt16LE(i)));
  return loudest / 32767;
};

test('every sound effect renders, and none of them is silence', () => {
  const sounds = sfx.all();
  assert.deepStrictEqual(Object.keys(sounds).sort(), Object.keys(sfx.SOUNDS).sort());

  for (const [name, sound] of Object.entries(sounds)) {
    assert.strictEqual(sound.left.length, sound.right.length);
    const declared = sfx.SOUNDS[name].length * synth.SAMPLE_RATE;
    assert.ok(Math.abs(sound.left.length - declared) <= 1, `${name}: ${sound.left.length} samples for ${declared}`);

    let loudest = 0;
    for (const v of sound.left) loudest = Math.max(loudest, Math.abs(v));
    assert.ok(loudest > 0.05, `${name} is inaudible (peak ${loudest.toFixed(3)})`);
    assert.ok(loudest <= 1, `${name} is already clipping before it reaches the mixer`);
  }
});

test('the mixer always returns a full block, silent or not', () => {
  const m = mixer.create();
  const quiet = m.pull(1470);
  assert.strictEqual(quiet.length, 1470 * 4, 'a short block is a gap in the clock');
  assert.strictEqual(peak(quiet), 0);
});

test('a sound plays once and then lets go', () => {
  const sounds = sfx.all();
  const m = mixer.create();
  m.play(sounds.paddle);
  assert.strictEqual(m.playing.voices, 1);

  assert.ok(peak(m.pull(1470)) > 0, 'nothing came out');
  // paddle is 0.12s, so a third of a second is well past its tail.
  m.pull(Math.ceil(0.34 * synth.SAMPLE_RATE));
  assert.strictEqual(m.playing.voices, 0, 'a finished voice is still on the books');
  assert.strictEqual(peak(m.pull(1470)), 0);
});

test('music loops, and stops when it is told to', () => {
  const bed = mixer.fromPcm(song.render(require('../src/music/pong')).pcm);
  const m = mixer.create();
  m.music(bed);

  // Well past the end of a 12.8s track: if it didn't loop this would be silence.
  const seconds = Math.ceil(bed.left.length / synth.SAMPLE_RATE) + 2;
  let loudest = 0;
  for (let i = 0; i < seconds; i++) loudest = Math.max(loudest, peak(m.pull(synth.SAMPLE_RATE)));
  assert.ok(loudest > 0.05, 'the bed went quiet, so it did not loop');

  m.silence();
  assert.strictEqual(peak(m.pull(1470)), 0);
});

// The mix goes straight to ALSA and to the browser with no normalisation stage
// after it, so headroom has to be right here or it is nowhere.
test('the loudest thing the game can do does not clip', () => {
  const sounds = sfx.all();
  const bed = mixer.fromPcm(song.render(require('../src/music/pong')).pcm);
  const m = mixer.create();

  m.music(bed);
  m.pull(Math.round(0.5 * synth.SAMPLE_RATE)); // let the track get going
  for (const name of ['point', 'paddle', 'wall', 'select', 'fanfare']) m.play(sounds[name]);

  let loudest = 0;
  for (let i = 0; i < 40; i++) loudest = Math.max(loudest, peak(m.pull(1470)));
  assert.ok(loudest > 0.4, `suspiciously quiet at ${loudest.toFixed(3)} -- is anything mixing?`);
  assert.ok(loudest < 0.995, `mix has no headroom left: ${loudest.toFixed(3)}`);
});

// The limiter is only worth having if it stays out of the way the rest of the
// time. One blip on its own must come out very nearly as loud as it went in.
test('a single sound is not squashed by the limiter', () => {
  const sounds = sfx.all();
  const m = mixer.create();
  m.play(sounds.paddle);

  let loudest = 0;
  for (let i = 0; i < 8; i++) loudest = Math.max(loudest, peak(m.pull(1470)));

  let raw = 0;
  for (const v of sounds.paddle.left) raw = Math.max(raw, Math.abs(v));
  const expected = raw * 0.8;
  assert.ok(loudest > expected * 0.9, `blip lost ${((1 - loudest / expected) * 100).toFixed(0)}% of its level`);
});

test('the mixer drops the oldest voice rather than growing without bound', () => {
  const sounds = sfx.all();
  const m = mixer.create();
  for (let i = 0; i < mixer.MAX_VOICES + 20; i++) m.play(sounds.over);
  assert.strictEqual(m.playing.voices, mixer.MAX_VOICES);
});

test('PCM survives the round trip to floats and back', () => {
  const { pcm } = song.render(require('../src/music/pong'));
  const floats = mixer.fromPcm(pcm);
  assert.strictEqual(floats.left.length, pcm.length / 4);

  for (const i of [0, 1000, 44100, floats.left.length - 1]) {
    assert.ok(Math.abs(floats.left[i] - pcm.readInt16LE(i * 4) / 32767) < 1e-4, `sample ${i} drifted`);
  }
});

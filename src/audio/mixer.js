'use strict';
// A real-time mixer: pre-rendered buffers in, one block of S16_LE stereo per
// frame out.
//
// song.js renders a whole score in one go and normalises the result, which is
// right for a file and wrong for a stream -- normalising each block separately
// would make the gain pump with whatever happened to be playing. So the master
// gain is fixed and the sum is soft-limited instead.
//
// Soft, not clamped: the worst case the game can actually reach -- the bed plus
// a bounce plus a point plus a menu confirm plus the high-score fanfare, all
// landing in one block -- sums to about 3.3, and hard clipping that is audible
// as a tearing buzz at exactly the moment the player just did something good.
// tanh is near-linear below 0.4, so an ordinary blip is untouched, and it never
// reaches 1 however much is thrown at it. Measured at 19 us per block, which is
// 0.06% of a frame.

const synth = require('./synth');

const MAX_VOICES = 12;

function create({ master = 0.8, musicGain = 0.55 } = {}) {
  let voices = [];
  let bed = null;

  const start = (sound, gain) => ({ left: sound.left, right: sound.right, pos: 0, gain });

  // Adds one source into the accumulators and advances its cursor.
  const mixInto = (accL, accR, voice, frames, loop) => {
    const { left, right, gain } = voice;
    const length = left.length;
    for (let i = 0; i < frames; i++) {
      if (voice.pos >= length) {
        if (!loop) return;
        voice.pos = 0;
      }
      accL[i] += left[voice.pos] * gain;
      accR[i] += right[voice.pos] * gain;
      voice.pos++;
    }
  };

  return {
    // Newest wins when the cap is reached: during a rally the most recent
    // paddle hit matters more than the tail of the one before it.
    play(sound, { gain = 1 } = {}) {
      if (!sound) return;
      if (voices.length >= MAX_VOICES) voices.shift();
      voices.push(start(sound, gain));
    },

    music(sound, { gain = musicGain } = {}) {
      bed = sound ? start(sound, gain) : null;
    },

    silence() {
      bed = null;
    },

    get playing() {
      return { voices: voices.length, music: Boolean(bed) };
    },

    // One block. Always exactly `frames` frames, silence included -- the sink
    // downstream is a clock, and a short block is a gap in it.
    pull(frames) {
      const accL = new Float32Array(frames);
      const accR = new Float32Array(frames);

      if (bed) mixInto(accL, accR, bed, frames, true);
      for (const voice of voices) mixInto(accL, accR, voice, frames, false);
      voices = voices.filter((voice) => voice.pos < voice.left.length);

      const out = Buffer.allocUnsafe(frames * 4);
      for (let i = 0; i < frames; i++) {
        out.writeInt16LE(Math.round(Math.tanh(accL[i] * master) * 32767), i * 4);
        out.writeInt16LE(Math.round(Math.tanh(accR[i] * master) * 32767), i * 4 + 2);
      }
      return out;
    },
  };
}

// PCM from song.render() comes back as a Buffer of S16_LE; the mixer wants
// floats, so a rendered track has to come back the other way to be used as a bed.
function fromPcm(pcm) {
  const frames = Math.floor(pcm.length / 4);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = pcm.readInt16LE(i * 4) / 32767;
    right[i] = pcm.readInt16LE(i * 4 + 2) / 32767;
  }
  return { left, right };
}

module.exports = { create, fromPcm, MAX_VOICES, SAMPLE_RATE: synth.SAMPLE_RATE };

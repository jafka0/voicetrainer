import test from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker, cleanTrack, voicedSegments } from '../js/pitch.js';
import { median } from '../js/analysis.js';
import { voice, noise } from './synth.js';

function track(samples, rate = 48000) {
  const tracker = new PitchTracker(rate);
  const frames = [];
  // Feed in small chunks, as the audio thread does.
  for (let i = 0; i < samples.length; i += 2048) frames.push(...tracker.push(samples.subarray(i, i + 2048)));
  return frames;
}

for (const rate of [44100, 48000]) {
  for (const hz of [85, 110, 165, 180, 200, 260, 400]) {
    test(`detects ${hz} Hz within 5 cents at ${rate} Hz`, () => {
      const frames = cleanTrack(track(voice(() => hz, 1, rate), rate));
      const found = median(frames.filter((f) => f.hz).map((f) => f.hz));
      assert.ok(Math.abs(1200 * Math.log2(found / hz)) < 5, `found ${found}`);
    });
  }
}

test('follows a two-octave glide without octave errors', () => {
  const frames = cleanTrack(track(voice((t) => 90 * 4 ** (t / 2), 2)));
  const voiced = frames.filter((f) => f.hz);
  assert.ok(voiced.length > 80);
  for (const f of voiced) {
    const expected = 90 * 4 ** (f.t / 2);
    assert.ok(Math.abs(1200 * Math.log2(f.hz / expected)) < 60, `t=${f.t} hz=${f.hz} expected=${expected}`);
  }
});

test('treats noise as unvoiced', () => {
  const frames = cleanTrack(track(noise(1)));
  assert.equal(frames.filter((f) => f.hz).length, 0);
});

test('treats digital silence as unvoiced', () => {
  const frames = cleanTrack(track(new Float32Array(48000)));
  assert.equal(frames.filter((f) => f.hz).length, 0);
});

test('ignores quiet background sound relative to the voice', () => {
  const quiet = voice(() => 300, 0.5, 48000, 0.005);
  const loud = voice(() => 180, 1);
  const joined = new Float32Array(quiet.length + loud.length);
  joined.set(quiet);
  joined.set(loud, quiet.length);
  const voiced = cleanTrack(track(joined)).filter((f) => f.hz);
  assert.ok(voiced.every((f) => Math.abs(f.hz - 180) < 5));
});

test('repairs isolated octave errors', () => {
  const frames = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.02, hz: 180, rms: 0.1 }));
  frames[20].hz = 360;
  frames[21].hz = 90;
  for (const f of cleanTrack(frames)) assert.ok(Math.abs(f.hz - 180) < 1, `t=${f.t} hz=${f.hz}`);
});

test('removes voiced blips shorter than 60 ms', () => {
  const frames = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.02, hz: i === 20 ? 180 : null, rms: 0.1 }));
  assert.equal(cleanTrack(frames).filter((f) => f.hz).length, 0);
});

test('splits phrases at pauses of a quarter second or more', () => {
  const frames = Array.from({ length: 100 }, (_, i) => {
    const t = i * 0.02;
    return { t, hz: t > 0.8 && t < 1.2 ? null : 180, rms: 0.1 };
  });
  assert.equal(voicedSegments(frames).length, 2);
});

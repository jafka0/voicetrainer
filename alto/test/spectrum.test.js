import test from 'node:test';
import assert from 'node:assert/strict';
import { bandProfile, profileCentroid } from '../js/spectrum.js';
import { VOWELS } from '../js/resonance.js';
import { vowelSound } from './synth.js';

test('a voiceprint has 32 digits', () => {
  const print = bandProfile(vowelSound(180, VOWELS.ee.men, 1), 48000);
  assert.match(print, /^[0-9]{32}$/);
});

test('silence has no voiceprint', () => {
  assert.equal(bandProfile(new Float32Array(48000), 48000), null);
});

test('a brighter vowel moves the voiceprint toward higher bands', () => {
  for (const vowel of ['ee', 'ah']) {
    const dark = profileCentroid(bandProfile(vowelSound(180, VOWELS[vowel].men, 1), 48000));
    const bright = profileCentroid(bandProfile(vowelSound(180, VOWELS[vowel].women, 1), 48000));
    assert.ok(bright > dark, `${vowel}: ${dark.toFixed(2)} -> ${bright.toFixed(2)}`);
  }
});

test('a time window only uses that part of the take', () => {
  const rate = 48000;
  const joined = new Float32Array(rate * 2);
  joined.set(vowelSound(180, VOWELS.ee.men, 1));
  joined.set(vowelSound(180, VOWELS.ee.women, 1), rate);
  assert.equal(bandProfile(joined, rate, 0, 1), bandProfile(vowelSound(180, VOWELS.ee.men, 1), rate, 0, 1));
});

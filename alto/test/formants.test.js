import test from 'node:test';
import assert from 'node:assert/strict';
import { FormantTracker, attachCandidates } from '../js/formants.js';
import { VOWELS, analyzeCheck, analyzeContrast, analyzeResonanceSentence, assignVowelFormants, shiftPct, summarize, vowelPosition } from '../js/resonance.js';
import { RESONANCE } from '../js/content.js';
import { vowelSound } from './synth.js';

function measure(samples, rate, f0) {
  const tracker = new FormantTracker(rate);
  const frames = [];
  for (let i = 0; i < samples.length; i += 2048) frames.push(...tracker.push(samples.subarray(i, i + 2048)));
  return frames.map((f) => ({ ...f, hz: f0 }));
}

const accuracyCases = [
  ['ee', VOWELS.ee.men],
  ['ee', VOWELS.ee.women],
  ['ah', VOWELS.ah.men],
  ['ah', VOWELS.ah.women],
  ['oo', VOWELS.oo.men],
  ['oo', VOWELS.oo.women],
];

for (const rate of [44100, 48000]) {
  for (const f0 of [110, 150, 180, 220]) {
    for (const [vowel, formants] of accuracyCases) {
      test(`reads ${vowel} ${formants.join('/')} at ${f0} Hz pitch (${rate} Hz)`, () => {
        const frames = measure(vowelSound(f0, formants, 1, rate), rate, f0);
        const found = summarize(frames, { vowel, minFrames: 12 });
        assert.ok(found, 'nothing readable');
        // Only F2 and F3 feed the brightness measure, so those are what must be accurate.
        // Known limit: a dark "oo" has a weak F3 that may go unread, so it can be absent.
        for (const i of [1, 2]) {
          if (vowel === 'oo' && i === 2 && found.formants[i] === null) continue;
          const error = (100 * Math.abs(found.formants[i] - formants[i])) / formants[i];
          assert.ok(error < 13, `F${i + 1} expected ${formants[i]}, found ${found.formants[i]} (${error.toFixed(1)}%)`);
        }
      });
    }
  }
}

// The app's main job: noticing a real change in the same voice at the same pitch.
function recoveredShift(f0, vowel, pct) {
  const { men } = VOWELS[vowel];
  const read = (formants) => summarize(measure(vowelSound(f0, formants, 1), 48000, f0), { vowel, minFrames: 12 }).formants;
  return shiftPct(read([men[0], men[1] * (1 + pct / 100), men[2] * (1 + pct / 100)]), read(men));
}

for (const vowel of ['ee', 'ah']) {
  for (const pct of [5, 10, 15]) {
    for (const f0 of [150, 180]) {
      test(`recovers a +${pct}% brightening of ${vowel} at ${f0} Hz pitch`, () => {
        const found = recoveredShift(f0, vowel, pct);
        assert.ok(Math.abs(found - pct) < 5.5, `expected ${pct}, found ${found.toFixed(1)}`);
      });
    }
    // Known limit: around 220 Hz, readings can lock onto widely spaced harmonics and
    // miss a real change, so the app warns that a "no change" reading may be wrong.
    // It must still never report a real brightening as clearly darker.
    test(`does not report a +${pct}% brightening of ${vowel} as darker at 220 Hz pitch`, () => {
      assert.ok(recoveredShift(220, vowel, pct) > -2);
    });
  }
}

test('silence produces no formant candidates', () => {
  const frames = measure(new Float32Array(48000), 48000, 180);
  assert.ok(frames.every((f) => f.candidates.length === 0));
});

test('assigns formants by range and ignores a pole at the pitch itself', () => {
  assert.deepEqual(assignVowelFormants([230, 400, 2500, 3100], 'ee', 200), [400, 2500, 3100]);
  assert.deepEqual(assignVowelFormants([400, 2500], 'ee', 200), [400, 2500, null]);
});

test('labels a very dark vowel correctly instead of shifting every formant up', () => {
  assert.deepEqual(assignVowelFormants([430, 1650, 2600, 4400], 'ee', 180), [430, 1650, 2600]);
  assert.deepEqual(assignVowelFormants([650, 850, 2300, 4400], 'ah', 180), [650, 850, 2300]);
});

// Regression: dark sounds used to read as brighter than bright ones, because F3 was
// taken for F2. A real darker-to-brighter change must never be reported as darker.
const directionCases = [
  ['ee', [256, 1742, 2250], [342, 2322, 3000]],
  ['ee', [239, 1625, 2100], [325, 2206, 2850]],
  ['ee', [420, 1800, 2700], [380, 2500, 3200]],
  ['ee', [430, 1650, 2600], [380, 2500, 3200]],
  ['ee', [450, 1500, 2500], [380, 2400, 3100]],
  ['ee', [400, 1900, 2300], [380, 2400, 3100]],
  ['ah', [614, 1066, 2018], [768, 1333, 2522]],
  ['ah', [576, 1000, 1892], [768, 1333, 2522]],
  ['ah', [650, 850, 2300], [850, 1500, 2800]],
  ['ah', [650, 1100, 1900], [850, 1500, 2800]],
  ['ah', [700, 1300, 2500], [900, 2200, 3100]],
];
for (const f0 of [130, 165, 180]) {
  directionCases.forEach(([vowel, dark, bright]) => {
    test(`reads ${vowel} ${dark[1]}/${dark[2]} to ${bright[1]}/${bright[2]} as brighter at ${f0} Hz pitch`, () => {
      const read = (formants) => summarize(measure(vowelSound(f0, formants, 1), 48000, f0), { vowel, minFrames: 12 })?.formants;
      const [readDark, readBright] = [read(dark), read(bright)];
      if (!readDark || !readBright) return; // Saying "unreadable" is acceptable; a wrong direction is not.
      const found = shiftPct(readBright, readDark);
      assert.ok(found > 5, `true ${shiftPct(bright, dark).toFixed(1)}, found ${found.toFixed(1)}`);
    });
  });
}

test('positions the reference averages at 0 and 1', () => {
  assert.ok(Math.abs(vowelPosition('ah', VOWELS.ah.men)) < 0.001);
  assert.ok(Math.abs(vowelPosition('ah', VOWELS.ah.women) - 1) < 0.001);
});

test('attaches the nearest formant frame to each pitch frame', () => {
  const merged = attachCandidates(
    [{ t: 0.02, hz: 180 }, { t: 0.04, hz: 180 }],
    [{ t: 0.015, candidates: [1] }, { t: 0.041, candidates: [2] }],
  );
  assert.deepEqual(merged.map((f) => f.candidates), [[1], [2]]);
});

// Regression: speech used a median, which jumped between vowel clusters, so a real
// 10% change could read as anything from 1% to 20%.
for (const f0 of [130, 165, 180]) {
  for (const scale of [0.8, 1.1, 1.2]) {
    test(`a sentence with resonances scaled ${scale} reads correctly at ${f0} Hz pitch`, () => {
      const sentence = (factor) => {
        const order = ['ee', 'ah', 'oo', 'ah', 'ee', 'oo', 'ah', 'ee', 'ah', 'oo'];
        const parts = order.map((id) => vowelSound(f0, VOWELS[id].men.map((value) => value * factor), 0.3));
        const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
        parts.forEach((part, i) => joined.set(part, i * part.length));
        return measure(joined, 48000, f0);
      };
      const reference = analyzeResonanceSentence(sentence(1), { baseline: null });
      const result = analyzeResonanceSentence(sentence(scale), { baseline: reference.formants });
      const expected = (scale - 1) * 100;
      assert.ok(Math.abs(result.shiftPct - expected) < 9, `expected ${expected.toFixed(0)}, found ${result.shiftPct.toFixed(1)}`);
    });
  }
}

test('a pitch change alone does not read as a resonance change', () => {
  for (const vowel of ['ee', 'ah']) {
    const read = (f0) => summarize(measure(vowelSound(f0, VOWELS[vowel].men, 1), 48000, f0), { vowel, minFrames: 12 }).formants;
    for (const [low, high] of [[165, 185], [165, 200], [150, 180]]) {
      assert.ok(Math.abs(shiftPct(read(high), read(low))) < 4, `${vowel} ${low} to ${high} Hz`);
    }
  }
});

// Builds frames for a timed take from a formant set per time span.
function timedFrames(seconds, formantsAt, hzAt = () => 180) {
  const frames = [];
  for (let t = 0; t < seconds; t += 0.02) {
    const formants = formantsAt(t);
    frames.push({ t, hz: formants ? hzAt(t) : null, rms: 0.1, candidates: formants || [] });
  }
  return frames;
}
const ids = (result) => result.tips.map((tip) => tip.id);
const brighter = (formants, pct) => formants.map((f) => f * (1 + pct / 100));

function contrastTake(pct, hzAt) {
  const exercise = RESONANCE.contrastEe;
  const [dark, bright] = exercise.segments;
  const base = VOWELS.ee.men;
  const frames = timedFrames(exercise.total, (t) => {
    if (t >= dark.start && t <= dark.end) return base;
    if (t >= bright.start && t <= bright.end) return brighter(base, pct);
    return null;
  }, hzAt);
  return analyzeContrast(frames, { exercise });
}

test('a clear contrast gets praise and reports its size', () => {
  const result = contrastTake(10);
  assert.deepEqual(ids(result), ['res_good']);
  assert.ok(Math.abs(result.shiftPct - 10) < 1);
});

test('a small contrast and no contrast get coaching', () => {
  assert.deepEqual(ids(contrastTake(2.5)), ['res_small']);
  assert.deepEqual(ids(contrastTake(0)), ['res_none']);
});

test('a contrast flags pitch moving between the two parts', () => {
  const { segments } = RESONANCE.contrastEe;
  const result = contrastTake(10, (t) => (t < segments[1].start ? 180 : 215));
  assert.equal(ids(result)[0], 'res_pitch');
});

test('a contrast with too little sound is reported as unreadable', () => {
  const result = analyzeContrast(timedFrames(RESONANCE.contrastEe.total, () => null), { exercise: RESONANCE.contrastEe });
  assert.equal(result.ok, false);
});

function checkTake(pct) {
  const exercise = RESONANCE.check;
  return timedFrames(exercise.total, (t) => {
    const segment = exercise.segments.find((s) => t >= s.start && t <= s.end);
    return segment ? brighter(VOWELS[segment.vowel].men, pct) : null;
  });
}

test('the first check becomes the starting point', () => {
  const result = analyzeCheck(checkTake(0), { exercise: RESONANCE.check, baseline: null });
  assert.deepEqual(ids(result), ['res_baseline']);
  assert.deepEqual(Object.keys(result.vowels), ['ee', 'ah', 'oo']);
});

test('a starting point needs all three vowels, but a later check can use two', () => {
  const exercise = RESONANCE.check;
  const [, , last] = exercise.segments;
  const partial = checkTake(0).map((f) => (f.t >= last.start ? { ...f, hz: null, candidates: [] } : f));
  assert.equal(analyzeCheck(partial, { exercise, baseline: null }).ok, false);
  const baseline = analyzeCheck(checkTake(0), { exercise, baseline: null }).vowels;
  assert.equal(analyzeCheck(partial, { exercise, baseline }).ok, true);
});

test('a later check reports the change from the starting point', () => {
  const baseline = analyzeCheck(checkTake(0), { exercise: RESONANCE.check, baseline: null }).vowels;
  const result = analyzeCheck(checkTake(8), { exercise: RESONANCE.check, baseline });
  assert.deepEqual(ids(result), ['res_brighter']);
  assert.ok(Math.abs(result.shiftPct - 8) < 1);
  assert.deepEqual(ids(analyzeCheck(checkTake(1), { exercise: RESONANCE.check, baseline })), ['res_similar']);
});

test('the resonance sentence compares against its own reference', () => {
  const frames = timedFrames(3, () => [500, 1500, 2600]);
  const first = analyzeResonanceSentence(frames, { baseline: null });
  assert.deepEqual(ids(first), ['res_sentence_baseline']);
  const later = analyzeResonanceSentence(timedFrames(3, () => [550, 1650, 2860]), { baseline: first.formants });
  assert.deepEqual(ids(later), ['res_sentence_good']);
  assert.ok(Math.abs(later.shiftPct - 10) < 1);
});

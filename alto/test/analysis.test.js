import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRange, analyzeSpeech, analyzeTone, shiftHz, toneCenter, toneTarget, workingZone } from '../js/analysis.js';
import { TONES } from '../js/content.js';

const zone = { low: 165, high: 200, isStep: false };
const hop = 0.02;

function frames(seconds, hzAt) {
  const out = [];
  for (let t = 0; t < seconds; t += hop) out.push({ t, hz: hzAt(t), rms: 0.1 });
  return out;
}
const ids = (result) => result.tips.map((tip) => tip.id);
// A wavy melody of +/- `swing` semitones around `center`.
const melody = (center, swing) => (t) => shiftHz(center, swing * Math.sin(t * 3));

test('reports no voice for an almost silent take', () => {
  const result = analyzeSpeech(frames(2, () => null), { zone, pattern: 'statement' });
  assert.equal(result.ok, false);
  assert.deepEqual(ids(result), ['no_voice']);
});

test('praises a take in the zone with melody', () => {
  // Natural melody leaves this narrow zone often, so a modest share still counts as good.
  const result = analyzeSpeech(frames(3, melody(180, 2)), { zone, pattern: 'statement' });
  assert.ok(result.inZonePct > 50 && result.inZonePct < 80, `in zone ${result.inZonePct}`);
  assert.deepEqual(ids(result), ['good']);
});

test('suggests raising pitch when below the zone', () => {
  const result = analyzeSpeech(frames(3, melody(130, 2.5)), { zone, pattern: 'statement' });
  assert.equal(ids(result)[0], 'raise');
  assert.equal(result.tips[0].exercise.id, 'hold');
});

test('suggests settling when above the zone', () => {
  const result = analyzeSpeech(frames(3, melody(240, 2.5)), { zone, pattern: 'statement' });
  assert.equal(ids(result)[0], 'ease');
});

test('flags a monotone delivery', () => {
  assert.ok(ids(analyzeSpeech(frames(3, () => 180), { zone, pattern: 'statement' })).includes('monotone'));
});

test('expects more range from expressive sentences', () => {
  const hz = melody(180, 2);
  assert.ok(!ids(analyzeSpeech(frames(3, hz), { zone, pattern: 'statement' })).includes('monotone'));
  assert.ok(ids(analyzeSpeech(frames(3, hz), { zone, pattern: 'lively' })).includes('monotone'));
});

test('checks that a question rises at the end', () => {
  const rising = (t) => (t < 2 ? shiftHz(175, 2 * Math.sin(t * 6)) : shiftHz(175, (t - 2) * 6));
  const falling = (t) => (t < 2 ? shiftHz(175, 2 * Math.sin(t * 6)) : shiftHz(175, -(t - 2) * 2));
  const pattern = 'question';
  assert.ok(!ids(analyzeSpeech(frames(2.6, rising), { zone, pattern })).includes('question'));
  assert.ok(ids(analyzeSpeech(frames(2.6, falling), { zone, pattern })).includes('question'));
});

test('flags a statement that drops far below the zone', () => {
  const dropping = (t) => (t < 2.3 ? shiftHz(180, 2.5 * Math.sin(t * 6)) : 120);
  assert.ok(ids(analyzeSpeech(frames(3, dropping), { zone, pattern: 'statement' })).includes('ends'));
});

test('warns when the microphone is clipping', () => {
  const result = analyzeSpeech(frames(3, melody(180, 2.5)), { zone, pattern: 'statement', clipFraction: 0.05 });
  assert.equal(ids(result)[0], 'clipping');
});

test('gives at most two tips', () => {
  const result = analyzeSpeech(frames(3, () => 120), { zone, pattern: 'question', clipFraction: 0.05 });
  assert.equal(result.tips.length, 2);
});

const toneOptions = (tone, center, lead = 1.5) => ({
  target: toneTarget(tone, center),
  lead,
  duration: tone.points[tone.points.length - 1][0],
});

test('scores an accurate tone match highly, even when sung late', () => {
  const tone = TONES.glideUp;
  const options = toneOptions(tone, 180);
  const late = 0.32;
  const take = frames(5, (t) => options.target(t - options.lead - late));
  const result = analyzeTone(take, options);
  assert.ok(result.accuracyPct > 95, `accuracy ${result.accuracyPct}`);
  assert.deepEqual(ids(result), ['good']);
});

test('reports flat and sharp tone matches', () => {
  const options = toneOptions(TONES.hold, 180);
  const at = (cents) => frames(5.5, (t) => (t >= 1.5 && t <= 5 ? 180 * 2 ** (cents / 1200) : null));
  assert.equal(ids(analyzeTone(at(-90), options))[0], 'flat');
  assert.equal(ids(analyzeTone(at(90), options))[0], 'sharp');
});

test('recognizes a tone matched an octave low', () => {
  const options = toneOptions(TONES.hold, 180);
  const take = frames(5.5, (t) => (t >= 1.5 && t <= 5 ? 90 : null));
  assert.equal(ids(analyzeTone(take, options))[0], 'octave_low');
});

test('fails a tone take with hardly any voice', () => {
  const options = toneOptions(TONES.hold, 180);
  assert.equal(analyzeTone(frames(5, () => null), options).ok, false);
});

test('the step target jumps between its notes', () => {
  const target = toneTarget(TONES.steps, 180);
  assert.ok(Math.abs(target(0.5) - shiftHz(180, -2)) < 0.01);
  assert.ok(Math.abs(target(1.8) - 180) < 0.01);
  assert.ok(Math.abs(target(3) - shiftHz(180, 2)) < 0.01);
  assert.equal(target(4), null);
});

test('the working zone equals the goal without a history', () => {
  const zoneNow = workingZone({ goalLow: 165, goalHigh: 200 }, []);
  assert.deepEqual(zoneNow, { low: 165, high: 200, isStep: false });
});

test('the working zone steps up gradually from a low voice', () => {
  const takes = [{ kind: 'baseline', medianHz: 110 }];
  const zoneNow = workingZone({ goalLow: 165, goalHigh: 200 }, takes);
  assert.equal(zoneNow.isStep, true);
  assert.ok(zoneNow.low > 120 && zoneNow.low < 125, `low ${zoneNow.low}`);
  assert.ok(zoneNow.high > 145 && zoneNow.high < 150, `high ${zoneNow.high}`);
});

test('the working zone reaches the goal when the voice gets close', () => {
  const takes = [{ kind: 'speech', medianHz: 135 }];
  assert.equal(workingZone({ goalLow: 165, goalHigh: 200 }, takes).isStep, false);
});

test('tone exercises stay below a known comfortable top note', () => {
  const center = toneCenter(TONES.glideUp, zone, { comfortHigh: 170 });
  assert.ok(shiftHz(center, 3) < 170);
  assert.ok(Math.abs(toneCenter(TONES.hold, zone, { comfortHigh: null }) - Math.sqrt(165 * 200)) < 0.01);
});

test('reads a comfortable range from a glide', () => {
  const result = analyzeRange(frames(4, (t) => shiftHz(130, t * 3)));
  assert.equal(result.ok, true);
  assert.ok(result.comfortLow < 140 && result.comfortHigh > 200);
  assert.equal(analyzeRange(frames(1, () => 150)).ok, false);
});

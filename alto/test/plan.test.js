import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, focusPattern, needsRest, needsTechnique, pickSentence } from '../js/plan.js';
import { SENTENCES } from '../js/content.js';

const settings = { lang: 'both' };

test('every language has sentences for every pattern', () => {
  assert.deepEqual(Object.keys(SENTENCES.en).sort(), Object.keys(SENTENCES.de).sort());
  for (const language of Object.values(SENTENCES)) {
    for (const list of Object.values(language)) assert.ok(list.length >= 4);
  }
});

test('honors the chosen practice language', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(pickSentence('question', 'de').language, 'de');
    assert.equal(pickSentence('question', 'en').language, 'en');
  }
});

test('"both" uses both languages', () => {
  assert.equal(pickSentence('statement', 'both', () => 0.1).language, 'en');
  assert.equal(pickSentence('statement', 'both', () => 0.9).language, 'de');
});

test('a normal session warms up first, ends with a check, and has no repeats', () => {
  const { steps } = buildSession({ takes: [], checks: [], settings });
  assert.equal(steps[0].kind, 'warmup');
  assert.equal(steps[steps.length - 1].kind, 'check');
  const texts = steps.filter((s) => s.kind === 'speech').map((s) => s.sentence.text);
  assert.equal(texts.length, 4);
  assert.equal(new Set(texts).size, texts.length);
});

test('a first session takes a resonance starting point and teaches the technique', () => {
  const { steps } = buildSession({ takes: [], checks: [], settings });
  assert.equal(steps[1].exercise.id, 'check');
  assert.equal(steps[1].everyday, true);
  assert.equal(steps[2].kind, 'technique');
  assert.equal(steps.filter((s) => s.exercise?.id.startsWith('contrast')).length, 2);
  assert.equal(steps.filter((s) => s.kind === 'resonanceSentence').length, 1);
});

test('a resonance check returns once a week', () => {
  const now = 100 * 86400000;
  const withBaseline = { lang: 'en', resonanceBaseline: { ee: [1, 2, 3] } };
  const checksIn = (at) => buildSession({ takes: [{ kind: 'resonanceCheck', at }], checks: [], settings: withBaseline, now })
    .steps.filter((s) => s.exercise?.id === 'check').length;
  assert.equal(checksIn(now - 86400000), 0);
  assert.equal(checksIn(now - 8 * 86400000), 1);
});

test('the technique guide returns when recent contrasts stay small', () => {
  const contrast = (shiftPct) => ({ kind: 'resonanceContrast', shiftPct });
  assert.equal(needsTechnique([]), true);
  assert.equal(needsTechnique([8, 8, 8, 8, 8, 8].map(contrast)), false);
  assert.equal(needsTechnique([8, 8, 8, 1, 1, 1].map(contrast)), true);
});

test('the session focuses on the most frequent recent issue', () => {
  const takes = [
    { kind: 'speech', tips: ['question'] },
    { kind: 'speech', tips: ['monotone'] },
    { kind: 'speech', tips: ['monotone'] },
  ];
  assert.equal(focusPattern(takes), 'lively');
  const { steps, focus } = buildSession({ takes, checks: [], settings });
  assert.equal(focus, 'lively');
  assert.equal(steps.filter((s) => s.sentence?.pattern === 'lively').length, 2);
});

test('strain within the last day means a light session with no speech', () => {
  const now = 1_000_000_000;
  const checks = [{ at: now - 3600_000, level: 'strained' }];
  assert.equal(needsRest(checks, now), true);
  const session = buildSession({ takes: [], checks, settings, now });
  assert.equal(session.light, true);
  assert.equal(session.steps.filter((s) => s.kind === 'speech').length, 0);
});

test('old strain or a fine check does not limit the session', () => {
  const now = 1_000_000_000;
  assert.equal(needsRest([{ at: now - 2 * 86400000, level: 'strained' }], now), false);
  assert.equal(needsRest([{ at: now - 1000, level: 'tired' }], now), false);
  assert.equal(needsRest([], now), false);
});

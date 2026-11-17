// Chooses exercises: picks sentences and adapts a session to recent results.
import { RESONANCE, RESONANCE_SENTENCES, SENTENCES, TONES } from './content.js';

const DAY_MS = 86400000;
const CHECK_EVERY_DAYS = 7;

// New users get the technique guide, as does anyone whose recent contrasts stayed small.
export function needsTechnique(takes) {
  const contrasts = takes.filter((t) => t.kind === 'resonanceContrast');
  if (contrasts.length < 6) return true;
  return contrasts.slice(-3).every((t) => t.shiftPct < 2);
}

export function resonanceSentence(lang, rand = Math.random) {
  const language = lang === 'both' ? (rand() < 0.5 ? 'en' : 'de') : lang;
  return { kind: 'resonanceSentence', sentence: { language, text: RESONANCE_SENTENCES[language] } };
}

// Tips that a session can respond to, and the sentence pattern that trains each.
const FOCUS_BY_TIP = { question: 'question', monotone: 'lively', ends: 'statement', raise: 'voiced', ease: 'statement' };

export function pickSentence(pattern, lang, rand = Math.random) {
  const language = lang === 'both' ? (rand() < 0.5 ? 'en' : 'de') : lang;
  const list = SENTENCES[language][pattern];
  return { language, pattern, text: list[Math.floor(rand() * list.length)] };
}

// Picks the pattern that came up most in recent feedback.
export function focusPattern(takes) {
  const counts = {};
  for (const take of takes.filter((t) => t.kind === 'speech').slice(-15)) {
    for (const tip of take.tips || []) {
      const pattern = FOCUS_BY_TIP[tip];
      if (pattern) counts[pattern] = (counts[pattern] || 0) + 1;
    }
  }
  let best = null;
  for (const [pattern, count] of Object.entries(counts)) {
    if (!best || count > counts[best]) best = pattern;
  }
  return best;
}

export function needsRest(checks, now = Date.now()) {
  const last = checks[checks.length - 1];
  return Boolean(last && last.level === 'strained' && now - last.at < DAY_MS);
}

export function buildSession({ takes, checks, settings, now = Date.now(), rand = Math.random }) {
  const warmup = { kind: 'warmup' };
  const tone = (id) => ({ kind: 'tone', tone: TONES[id] });
  const check = { kind: 'check' };

  if (needsRest(checks, now)) {
    return { light: true, focus: null, steps: [warmup, tone('hold'), tone('glideDown'), check] };
  }

  const focus = focusPattern(takes);
  const used = new Set();
  const speech = (pattern) => {
    let picked = pickSentence(pattern, settings.lang, rand);
    for (let i = 0; i < 8 && used.has(picked.text); i++) picked = pickSentence(pattern, settings.lang, rand);
    used.add(picked.text);
    return { kind: 'speech', sentence: picked };
  };

  const focusTone = focus === 'question' ? 'glideUp' : focus === 'lively' ? 'wave' : 'steps';
  const patterns = ['voiced', focus || 'statement', 'question', focus || 'lively'];
  const resonance = (id, extra = {}) => ({ kind: 'resonance', exercise: RESONANCE[id], ...extra });

  const hasBaseline = Boolean(settings.resonanceBaseline);
  const lastCheck = [...takes].reverse().find((t) => t.kind === 'resonanceCheck');
  const checkDue = hasBaseline && (!lastCheck || now - lastCheck.at >= CHECK_EVERY_DAYS * DAY_MS);
  return {
    light: false,
    focus,
    steps: [
      warmup,
      ...(hasBaseline ? [] : [resonance('check', { everyday: true })]),
      ...(needsTechnique(takes) ? [{ kind: 'technique' }] : []),
      tone('hold'),
      tone(focusTone),
      resonance('contrastEe'),
      resonance('contrastAh'),
      ...(checkDue ? [resonance('check')] : []),
      ...patterns.map(speech),
      resonanceSentence(settings.lang, rand),
      check,
    ],
  };
}

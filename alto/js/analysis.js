// Turns a pitch track into measurements and coaching tips.
//
// The thresholds below are practical coaching heuristics, not clinically
// validated cut-offs. There is deliberately no overall "femininity" score:
// these measurements cannot predict how a listener will perceive a voice.
import { voicedSegments } from './pitch.js';

export const LIMITS = {
  minVoicedSeconds: 0.6,
  zoneMarginSt: 1, // Typical pitch can drift this far outside the zone before a tip.
  monotoneSt: 3, // Melody range below this reads as flat.
  livelySt: 5, // Range to aim for on expressive sentences.
  questionRiseSt: 1.5, // Rise wanted at the end of a yes/no question.
  endDropSt: 1.5, // How far below the zone a sentence ending may fall.
  toneToleranceCents: 50,
  toneOffsetCents: 40,
  toneWobbleCents: 45,
  octaveCents: 900,
  clipFraction: 0.002,
};

export const semitones = (hz, refHz) => 12 * Math.log2(hz / refHz);
export const shiftHz = (hz, st) => hz * 2 ** (st / 12);

export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const median = (values) => percentile(values, 0.5);

// Picks the zone to practice in right now. If the goal is far above the current
// voice, it returns an intermediate step, so that range is built up gradually.
export function workingZone(settings, takes) {
  const goal = { low: settings.goalLow, high: settings.goalHigh };
  const recent = takes
    .filter((t) => (t.kind === 'speech' || t.kind === 'baseline') && t.medianHz)
    .slice(-5)
    .map((t) => t.medianHz);
  if (!recent.length) return { ...goal, isStep: false };
  const current = median(recent);
  if (shiftHz(current, 4) >= goal.low) return { ...goal, isStep: false };
  return {
    low: shiftHz(current, 2),
    high: Math.min(shiftHz(current, 5), goal.high),
    isStep: true,
  };
}

// Target pitch for a tone exercise, as a function of time in seconds.
export function toneTarget(tone, centerHz) {
  const points = tone.points;
  return (t) => {
    if (t < points[0][0] || t > points[points.length - 1][0]) return null;
    for (let i = points.length - 1; i > 0; i--) {
      const [t0, s0] = points[i - 1];
      const [t1, s1] = points[i];
      if (t >= t0 && t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return shiftHz(centerHz, s0 + (s1 - s0) * f);
      }
    }
    return shiftHz(centerHz, points[0][1]);
  };
}

// Keeps a tone exercise inside the range the user has marked as comfortable.
export function toneCenter(tone, zone, settings) {
  const center = Math.sqrt(zone.low * zone.high);
  if (!settings.comfortHigh) return center;
  const top = Math.max(...tone.points.map((p) => p[1]));
  return Math.min(center, shiftHz(settings.comfortHigh, -top - 1));
}

const noVoice = {
  id: 'no_voice',
  title: "I couldn't hear enough voice",
  body: 'Check that the right microphone is selected, hold it about a hand-width from your mouth, and try again.',
};
const clipping = {
  id: 'clipping',
  title: 'The microphone is overloading',
  body: 'Move it slightly further from your mouth. There is no need to speak louder for this to work.',
};

export function analyzeSpeech(frames, { zone, pattern, clipFraction = 0 }) {
  const voiced = frames.filter((f) => f.hz !== null);
  const hopSeconds = 0.02;
  const voicedSeconds = voiced.length * hopSeconds;
  if (voicedSeconds < LIMITS.minVoicedSeconds) {
    return { ok: false, tips: [noVoice], voicedSeconds };
  }

  const pitches = voiced.map((f) => f.hz);
  const medianHz = median(pitches);
  const p10 = percentile(pitches, 0.1);
  const p90 = percentile(pitches, 0.9);
  const rangeSt = semitones(p90, p10);
  const inZonePct = (100 * pitches.filter((h) => h >= zone.low && h <= zone.high).length) / pitches.length;

  // The ending is measured on the final phrase: its last fifth against its middle.
  const segments = voicedSegments(frames).filter((s) => s.length >= 8);
  const finalPhrase = segments.length ? segments[segments.length - 1] : voiced;
  const n = finalPhrase.length;
  const tailStart = Math.max(n - Math.max(3, Math.round(n * 0.2)), 1);
  const tail = finalPhrase.slice(tailStart).map((f) => f.hz);
  const middle = finalPhrase
    .slice(Math.floor(n * 0.3), Math.max(Math.floor(n * 0.7), Math.floor(n * 0.3) + 1))
    .map((f) => f.hz);
  const endHz = median(tail);
  const endMoveSt = semitones(endHz, median(middle));

  const metrics = { voicedSeconds, medianHz, p10, p90, rangeSt, inZonePct, endHz, endMoveSt };
  const tips = speechTips(metrics, { zone, pattern, clipFraction });
  return { ok: true, ...metrics, tips };
}

function speechTips(m, { zone, pattern, clipFraction }) {
  const tips = [];
  if (clipFraction > LIMITS.clipFraction) tips.push(clipping);

  const belowSt = semitones(zone.low, m.medianHz);
  const aboveSt = semitones(m.medianHz, zone.high);
  if (belowSt > LIMITS.zoneMarginSt) {
    tips.push({
      id: 'raise',
      title: `Your typical pitch was ${Math.round(m.medianHz)} Hz, below your zone`,
      body: 'Hum a comfortable note in your zone, then say the first word on that same note. Keep your throat relaxed. Lift the pitch, not the volume.',
      exercise: { kind: 'tone', id: 'hold' },
    });
  } else if (aboveSt > LIMITS.zoneMarginSt) {
    tips.push({
      id: 'ease',
      title: `Your typical pitch was ${Math.round(m.medianHz)} Hz, above your zone`,
      body: 'You have room to settle a little lower, which often sounds more relaxed. Sigh gently on "hmm" and let the sentence start from there. If you prefer a higher voice, you can raise your goal in Settings.',
      exercise: { kind: 'tone', id: 'glideDown' },
    });
  }

  if (pattern === 'question' && m.endMoveSt < LIMITS.questionRiseSt) {
    tips.push({
      id: 'question',
      title: "The question's ending didn't rise much",
      body: 'Let the last stressed word lift upward. Overdo it at first; it is easier to scale back from too much.',
      exercise: { kind: 'tone', id: 'glideUp' },
    });
  } else if (pattern !== 'question' && semitones(zone.low, m.endHz) > LIMITS.endDropSt) {
    tips.push({
      id: 'ends',
      title: `Your sentence ending fell to ${Math.round(m.endHz)} Hz`,
      body: 'A gentle fall is natural, but keep the last word supported and inside your zone. Try thinking of the end of the sentence as still moving forward.',
      exercise: { kind: 'speech', pattern: 'statement' },
    });
  }

  const wantedRange = pattern === 'lively' ? LIMITS.livelySt : LIMITS.monotoneSt;
  if (m.rangeSt < wantedRange) {
    tips.push({
      id: 'monotone',
      title: 'Your melody stayed quite flat',
      body: 'Pick one word to highlight and let your pitch travel up on it, then glide back down. Think of it as smiling at that word.',
      exercise: { kind: 'speech', pattern: 'lively' },
    });
  }

  if (!tips.length) {
    tips.push({
      id: 'good',
      positive: true,
      title: 'That one was on target',
      body: 'Your pitch, melody and ending all met the goals for this exercise. Say it again in your own way to help it feel natural.',
    });
  }
  return tips.slice(0, 2);
}

// Scores a tone take against its target. The timing offset is searched for, so
// starting slightly early or late doesn't count as singing out of tune.
export function analyzeTone(frames, { target, lead, duration, clipFraction = 0 }) {
  const voiced = frames.filter((f) => f.hz !== null);
  let best = null;
  for (let offset = -0.5; offset <= 0.7001; offset += 0.04) {
    const errors = [];
    for (const f of voiced) {
      const hz = target(f.t - lead - offset);
      if (hz) errors.push(1200 * Math.log2(f.hz / hz));
    }
    if (errors.length < 10) continue;
    const score = median(errors.map(Math.abs)) - errors.length * 0.001;
    if (!best || score < best.score) best = { score, errors, offset };
  }

  const coverage = best ? (best.errors.length * 0.02) / duration : 0;
  if (!best || coverage < 0.3) {
    return { ok: false, tips: [noVoice], voicedSeconds: voiced.length * 0.02 };
  }

  const { errors } = best;
  const offsetCents = median(errors);
  const accuracyPct = (100 * errors.filter((e) => Math.abs(e) <= LIMITS.toneToleranceCents).length) / errors.length;
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const wobbleCents = Math.sqrt(errors.reduce((a, e) => a + (e - mean) ** 2, 0) / errors.length);
  const metrics = {
    voicedSeconds: voiced.length * 0.02,
    medianHz: median(voiced.map((f) => f.hz)),
    accuracyPct,
    offsetCents,
    wobbleCents,
    coverage,
  };

  const tips = [];
  if (clipFraction > LIMITS.clipFraction) tips.push(clipping);
  if (offsetCents < -LIMITS.octaveCents) {
    tips.push({
      id: 'octave_low',
      title: 'You matched this about an octave lower',
      body: 'Same note, wrong floor. Start from a light hum or a gentle "oo", as if calling softly to someone nearby. Slide up only as far as stays easy.',
    });
  } else if (offsetCents > LIMITS.octaveCents) {
    tips.push({
      id: 'octave_high',
      title: 'You matched this about an octave higher',
      body: 'Let your voice settle lower, into a fuller, relaxed sound rather than a light falsetto.',
    });
  } else if (offsetCents < -LIMITS.toneOffsetCents) {
    tips.push({
      id: 'flat',
      title: `You were a little under the target (about ${Math.round(-offsetCents)} cents)`,
      body: 'Listen once more, then hum it quietly before singing it out. Small adjustments are easier from a hum.',
    });
  } else if (offsetCents > LIMITS.toneOffsetCents) {
    tips.push({
      id: 'sharp',
      title: `You were a little over the target (about ${Math.round(offsetCents)} cents)`,
      body: 'Ease off slightly. Reaching often goes with tension, so drop your shoulders and try it softer.',
    });
  }
  if (coverage < 0.7) {
    tips.push({
      id: 'short',
      title: "You didn't voice the whole pattern",
      body: 'Take an easy breath first and keep the sound going until the end of the target line.',
    });
  }
  if (Math.abs(offsetCents) <= LIMITS.octaveCents && wobbleCents > LIMITS.toneWobbleCents * 2) {
    tips.push({
      id: 'wobble',
      title: 'Your pitch moved around the target',
      body: 'Try it more quietly and with less air. A slow, steady breath keeps the note stable.',
    });
  }
  if (!tips.length) {
    tips.push({
      id: 'good',
      positive: true,
      title: 'Nicely matched',
      body: 'You stayed close to the target. Notice how that felt physically, because that sensation is what you want to find again.',
    });
  }
  return { ok: true, ...metrics, tips: tips.slice(0, 2) };
}

// Reads a comfortable range from a gentle low-to-high glide.
export function analyzeRange(frames) {
  const pitches = frames.filter((f) => f.hz !== null).map((f) => f.hz);
  if (pitches.length * 0.02 < 2) return { ok: false, tips: [noVoice] };
  return {
    ok: true,
    comfortLow: percentile(pitches, 0.05),
    comfortHigh: percentile(pitches, 0.95),
    tips: [],
  };
}

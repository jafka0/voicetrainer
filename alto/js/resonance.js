// Turns formant measurements into resonance feedback.
//
// Reference values are adult averages from Hillenbrand et al. (1995), measured on
// American English vowels. They show where resonances typically sit. They do not
// predict how a listener will hear a voice. Comparing against the user's own
// starting point is the main measure. Thresholds are practical heuristics.
import { percentile, median, semitones } from './analysis.js';

export const VOWELS = {
  ee: {
    id: 'ee',
    label: '"ee"',
    hint: 'as in "see" / German "Sie"',
    men: [342, 2322, 3000],
    women: [437, 2761, 3372],
  },
  ah: {
    id: 'ah',
    label: '"ah"',
    hint: 'as in "father" / German "Vater"',
    men: [768, 1333, 2522],
    women: [936, 1551, 2815],
  },
  oo: {
    id: 'oo',
    label: '"oo"',
    hint: 'as in "food" / German "Mut"',
    men: [378, 997, 2343],
    women: [459, 1105, 2735],
  },
};

export const RESONANCE_LIMITS = {
  minVowelFrames: 12,
  minSpeechFrames: 40,
  clearShiftPct: 4,
  smallShiftPct: 1.5,
  pitchDriftSt: 1.5,
  unstableSpreadPct: 12,
};

const TRACT_SCALES = Array.from({ length: 25 }, (_, i) => 0.7 + i * 0.025);
const FORMANT_WEIGHTS = [0.25, 1, 1]; // F1 is the least reliable, so it counts least.
const MISSING_F1_COST = 0.1;
const MISSING_F3_COST = 0.35;
const SCALE_COST = 0.1;
const MAX_F3_HZ = 4000; // A peak above this is F4 or higher.
const F2_MIN_RATIO = 0.55;
const F2_MAX_RATIO = 1.6;

// Picks F1, F2 and F3 for a held vowel. It finds the labeling that best fits the
// vowel's pattern at some vocal tract length. Fixed frequency ranges would be wrong
// here: a very dark vowel falls below them, and its F3 then gets read as F2, which
// makes the darkest sounds appear the brightest.
export function assignVowelFormants(candidates, vowelId, f0 = 0) {
  return fitVowel(candidates, vowelId, f0).formants;
}

function fitVowel(candidates, vowelId, f0) {
  const { men, women } = VOWELS[vowelId];
  const template = men.map((value, i) => Math.sqrt(value * women[i]));
  const peaks = candidates.filter((c) => c > f0 * 1.25);
  let best = [null, null, null];
  let bestCost = Infinity;

  const score = (formants, baseCost) => {
    for (const scale of TRACT_SCALES) {
      let cost = baseCost + SCALE_COST * Math.abs(Math.log(scale));
      formants.forEach((value, i) => {
        if (value) cost += FORMANT_WEIGHTS[i] * Math.abs(Math.log(value / (template[i] * scale)));
      });
      if (cost < bestCost) {
        bestCost = cost;
        best = formants;
      }
    }
  };

  // F2 is required. F1 and F3 can be missing, at a cost. Peaks stay in frequency order.
  // A peak far from this vowel's F2 means the real one wasn't found. Reporting
  // "unreadable" is better than a confident reading in the wrong direction.
  peaks.forEach((f2, i) => {
    if (f2 < template[1] * F2_MIN_RATIO || f2 > template[1] * F2_MAX_RATIO) return;
    const lower = [null, ...peaks.slice(0, i)];
    const upper = [null, ...peaks.slice(i + 1).filter((peak) => peak <= MAX_F3_HZ)];
    for (const f1 of lower) {
      for (const f3 of upper) {
        score([f1, f2, f3], (f1 ? 0 : MISSING_F1_COST) + (f3 ? 0 : MISSING_F3_COST));
      }
    }
  });
  return { formants: best, cost: bestCost };
}

// In running speech the vowel keeps changing, so each frame uses whichever vowel fits.
function assignSpeechFormants(candidates, f0) {
  const fits = Object.keys(VOWELS).map((id) => fitVowel(candidates, id, f0));
  return fits.reduce((a, b) => (b.cost < a.cost ? b : a)).formants;
}

// A trimmed average. Speech values cluster by vowel, and a median would jump
// between those clusters, so it can't show a small overall change.
function trimmedLogMean(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.1);
  const kept = sorted.slice(cut, sorted.length - cut);
  return Math.exp(kept.reduce((sum, value) => sum + Math.log(value), 0) / kept.length);
}

// Typical formants for the voiced frames in a time span, or null if too little was
// readable. Pass `vowel` for a held vowel. Without it, frames are treated as speech.
export function summarize(frames, { vowel, start = -Infinity, end = Infinity, minFrames }) {
  const used = frames.filter((f) => f.hz && f.t >= start && f.t <= end && f.candidates?.length);
  const tracks = [[], [], []];
  const typical = vowel ? median : trimmedLogMean;
  for (const frame of used) {
    const assigned = vowel
      ? assignVowelFormants(frame.candidates, vowel, frame.hz)
      : assignSpeechFormants(frame.candidates, frame.hz);
    assigned.forEach((value, i) => {
      if (value) tracks[i].push(value);
    });
  }
  if (tracks[1].length < minFrames) return null;
  const f2 = median(tracks[1]);
  return {
    formants: tracks.map((track) => (track.length >= minFrames ? Math.round(typical(track)) : null)),
    spreadPct: (100 * (percentile(tracks[1], 0.75) - percentile(tracks[1], 0.25))) / f2,
    medianHz: median(used.map((f) => f.hz)),
  };
}

// F1 is measured but left out of brightness: at these pitches, harmonics are too
// widely spaced to read it reliably, while F2 and F3 stay accurate.
const BRIGHTNESS_FORMANTS = [1, 2];

// The average change in F2 and F3, in percent. Positive means brighter.
export function shiftPct(formants, reference) {
  const logs = [];
  BRIGHTNESS_FORMANTS.forEach((i) => {
    if (formants[i] && reference[i]) logs.push(Math.log(formants[i] / reference[i]));
  });
  if (!logs.length) return null;
  return 100 * (Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length) - 1);
}

// Where a vowel sits: 0 is the men's average, 1 is the women's average.
export function vowelPosition(vowelId, formants) {
  const { men, women } = VOWELS[vowelId];
  const values = [];
  BRIGHTNESS_FORMANTS.forEach((i) => {
    if (formants[i]) values.push(Math.log(formants[i] / men[i]) / Math.log(women[i] / men[i]));
  });
  return values.length ? median(values) : null;
}

// A rough, live reading from the most recent frames, for the on-screen gauge.
export function livePosition(frames, vowelId) {
  const summary = summarize(frames, { vowel: vowelId, minFrames: 4 });
  return summary ? vowelPosition(vowelId, summary.formants) : null;
}

const unreadable = {
  id: 'res_unreadable',
  title: "I couldn't read your resonance clearly",
  body: 'Hold each vowel steadily in a clear (not breathy or whispered) voice, in a quiet room, with the mic about a hand-width away.',
};

export function analyzeContrast(frames, { exercise }) {
  const options = (segment) => ({
    vowel: exercise.vowel,
    start: segment.start + 0.5,
    end: segment.end - 0.15,
    minFrames: RESONANCE_LIMITS.minVowelFrames,
  });
  const dark = summarize(frames, options(exercise.segments[0]));
  const bright = summarize(frames, options(exercise.segments[1]));
  if (!dark || !bright) return { ok: false, tips: [unreadable] };

  const shift = shiftPct(bright.formants, dark.formants);
  const pitchDriftSt = semitones(bright.medianHz, dark.medianHz);
  const position = vowelPosition(exercise.vowel, bright.formants);
  const tips = [];

  if (Math.abs(pitchDriftSt) > RESONANCE_LIMITS.pitchDriftSt) {
    tips.push({
      id: 'res_pitch',
      title: `Your pitch ${pitchDriftSt > 0 ? 'rose' : 'fell'} by ${Math.abs(pitchDriftSt).toFixed(1)} semitones between the two`,
      body: 'Try to keep the note the same while only the sound changes. Separating pitch from resonance is the core skill here.',
      exercise: { kind: 'contrast', id: exercise.id },
    });
  }
  if (shift < RESONANCE_LIMITS.smallShiftPct) {
    tips.push({
      id: 'res_none',
      title: shift < -RESONANCE_LIMITS.smallShiftPct ? 'The second part came out darker' : "The two sounded alike to the analysis",
      body: 'Revisit "big dog, small dog" to feel your throat space change, then keep that shape while voicing the vowel. If you clearly heard a difference, trust your ears: this reading can miss real changes, especially at higher pitches.',
      exercise: { kind: 'technique' },
    });
  } else if (shift < RESONANCE_LIMITS.clearShiftPct) {
    tips.push({
      id: 'res_small',
      title: `A small brighter shift: +${shift.toFixed(1)}%`,
      body: 'You are moving in the right direction. Exaggerate the difference: go darker on the first part and smaller on the second.',
      exercise: { kind: 'contrast', id: exercise.id },
    });
  }
  if (Math.max(dark.spreadPct, bright.spreadPct) > RESONANCE_LIMITS.unstableSpreadPct) {
    tips.push({
      id: 'res_unstable',
      title: 'The vowel shifted while you held it',
      body: 'Choose one shape and hold it still. The reading is more reliable when your mouth and tongue stay in place.',
    });
  }
  if (!tips.length) {
    tips.push({
      id: 'res_good',
      positive: true,
      title: `You brightened your resonance by ${shift.toFixed(1)}%`,
      body: 'That is a clear change at a steady pitch. Remember how the brighter shape feels, because you will be carrying it into words.',
    });
  }
  return {
    ok: true,
    shiftPct: shift,
    pitchDriftSt,
    position,
    dark: dark.formants,
    bright: bright.formants,
    tips: tips.slice(0, 2),
  };
}

// The three-vowel check. Without a baseline, this take becomes the starting point.
export function analyzeCheck(frames, { exercise, baseline }) {
  const vowels = {};
  const positions = [];
  const shifts = [];
  for (const segment of exercise.segments) {
    const summary = summarize(frames, {
      vowel: segment.vowel,
      start: segment.start + 0.5,
      end: segment.end - 0.15,
      minFrames: RESONANCE_LIMITS.minVowelFrames,
    });
    if (!summary) continue;
    vowels[segment.vowel] = summary.formants;
    const position = vowelPosition(segment.vowel, summary.formants);
    if (position !== null) positions.push(position);
    if (baseline?.[segment.vowel]) {
      const shift = shiftPct(summary.formants, baseline[segment.vowel]);
      if (shift !== null) shifts.push(shift);
    }
  }
  // A starting point affects every later comparison, so it must be complete.
  const needed = baseline ? 2 : exercise.segments.length;
  if (Object.keys(vowels).length < needed) return { ok: false, tips: [unreadable] };

  const shift = shifts.length ? median(shifts) : null;
  const tips = [];
  if (shift === null) {
    tips.push({
      id: 'res_baseline',
      positive: true,
      title: 'Starting point saved',
      body: 'Future checks are compared with this one. Your own change over time is the most useful thing to watch here.',
    });
  } else if (shift >= RESONANCE_LIMITS.clearShiftPct) {
    tips.push({
      id: 'res_brighter',
      positive: true,
      title: `${shift.toFixed(1)}% brighter than your starting point`,
      body: 'That is a measurable change. Now practice carrying it into sentences, where it counts.',
    });
  } else {
    tips.push({
      id: 'res_similar',
      title: `About ${shift >= 0 ? '+' : ''}${shift.toFixed(1)}% compared with your starting point`,
      body: 'Small differences can be measurement noise. Darker-versus-brighter practice is the fastest way to build this movement.',
      exercise: { kind: 'contrast', id: 'contrastEe' },
    });
  }
  return { ok: true, vowels, position: median(positions), shiftPct: shift, tips };
}

// A repeated sentence gives a comparable reading from running speech.
export function analyzeResonanceSentence(frames, { baseline }) {
  const summary = summarize(frames, { minFrames: RESONANCE_LIMITS.minSpeechFrames });
  if (!summary) return { ok: false, tips: [unreadable] };
  const shift = baseline ? shiftPct(summary.formants, baseline) : null;
  const tips = [];
  if (shift === null) {
    tips.push({
      id: 'res_sentence_baseline',
      positive: true,
      title: 'Saved as your reference for this sentence',
      body: 'Next time you read it, Alto compares your resonance with this take.',
    });
  } else if (shift >= RESONANCE_LIMITS.clearShiftPct) {
    tips.push({
      id: 'res_sentence_good',
      positive: true,
      title: `${shift.toFixed(1)}% brighter than your reference`,
      body: 'You are carrying the brighter shape into speech. Check by listening: it should still sound relaxed and like you.',
    });
  } else {
    tips.push({
      id: 'res_sentence_more',
      title: `About ${shift >= 0 ? '+' : ''}${shift.toFixed(1)}% compared with your reference`,
      body: 'Resonance often slips back when you start thinking about words. Find the bright "ee" first, then begin the sentence from that shape.',
      exercise: { kind: 'contrast', id: 'contrastEe' },
    });
  }
  return { ok: true, formants: summary.formants, medianHz: summary.medianHz, shiftPct: shift, tips };
}

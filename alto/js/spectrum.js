// The voiceprint: a take's average spectrum, reduced to a few loudness levels per
// frequency band. It is enough to draw where the resonances sit, and far too coarse
// to rebuild any sound from.

const SIZE = 2048;
const BANDS = 32;
const LOW_HZ = 150;
const HIGH_HZ = 5500;
const RANGE_DB = 36;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const p = i + k;
        const q = p + len / 2;
        const tr = re[q] * wr - im[q] * wi;
        const ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
    }
  }
}

// Returns a string of BANDS digits (0 quiet, 9 loudest) for the louder frames between
// `start` and `end` seconds, or null if there was too little sound.
export function bandProfile(samples, sampleRate, start = 0, end = Infinity) {
  const from = Math.max(1, Math.floor(start * sampleRate));
  const to = Math.min(samples.length, Math.floor(end * sampleRate));
  const positions = [];
  for (let at = from; at + SIZE <= to; at += SIZE / 2) {
    let energy = 0;
    for (let i = 0; i < SIZE; i++) energy += samples[at + i] ** 2;
    positions.push({ at, rms: Math.sqrt(energy / SIZE) });
  }
  const loudest = Math.max(0, ...positions.map((p) => p.rms));
  if (loudest < 0.002) return null;
  const used = positions.filter((p) => p.rms >= loudest * 0.3);

  const power = new Float64Array(SIZE / 2);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  for (const { at } of used) {
    for (let i = 0; i < SIZE; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));
      // Pre-emphasis flattens the voice's natural tilt, so higher resonances show up.
      re[i] = (samples[at + i] - 0.97 * samples[at + i - 1]) * hann;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < SIZE / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
  }

  const binHz = sampleRate / SIZE;
  const levels = [];
  for (let b = 0; b < BANDS; b++) {
    const lowHz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (b / BANDS);
    const highHz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((b + 1) / BANDS);
    const lowBin = Math.floor(lowHz / binHz);
    const highBin = Math.max(lowBin + 1, Math.ceil(highHz / binHz));
    let sum = 0;
    for (let k = lowBin; k < highBin; k++) sum += power[k];
    levels.push(10 * Math.log10(sum / (highBin - lowBin) + 1e-20));
  }
  const top = Math.max(...levels);
  return levels
    .map((db) => Math.round(9 * Math.max(0, Math.min(1, (db - (top - RANGE_DB)) / RANGE_DB))))
    .join('');
}

// The loudness-weighted average band, for comparing two prints in tests and summaries.
export function profileCentroid(profile) {
  let weight = 0;
  let sum = 0;
  [...profile].forEach((digit, i) => {
    weight += Number(digit);
    sum += Number(digit) * i;
  });
  return weight ? sum / weight : null;
}

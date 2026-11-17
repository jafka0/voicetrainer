// Pitch tracking: a streaming YIN detector plus post-processing for a finished take.
// Pure JavaScript with no browser APIs, so it can be unit-tested in Node.

const TARGET_RATE = 12000; // Speech F0 needs far less than the mic's 44.1/48 kHz.
const WINDOW_SECONDS = 0.04;
const HOP_SECONDS = 0.02;
const MIN_HZ = 65;
const MAX_HZ = 500;
const YIN_THRESHOLD = 0.15;
const YIN_REJECT = 0.3; // Above this, the frame is treated as unvoiced.
const SILENCE_RMS = 0.002;

export class PitchTracker {
  constructor(sampleRate) {
    this.factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
    this.rate = sampleRate / this.factor;
    this.window = Math.round(this.rate * WINDOW_SECONDS);
    this.hop = Math.round(this.rate * HOP_SECONDS);
    this.tauMin = Math.floor(this.rate / MAX_HZ);
    this.tauMax = Math.ceil(this.rate / MIN_HZ);
    this.size = this.window + this.tauMax + 1;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.frameIndex = 0;
    this.sum = 0;
    this.count = 0;
    this.diff = new Float32Array(this.tauMax + 1);
  }

  // Feeds raw mic samples and returns any completed frames.
  push(samples) {
    const frames = [];
    for (let i = 0; i < samples.length; i++) {
      // Averaging is a cheap anti-alias filter before decimation.
      this.sum += samples[i];
      if (++this.count < this.factor) continue;
      this.buffer[this.filled++] = this.sum / this.factor;
      this.sum = 0;
      this.count = 0;
      if (this.filled === this.size) {
        frames.push(this.analyzeFrame());
        this.buffer.copyWithin(0, this.hop);
        this.filled -= this.hop;
      }
    }
    return frames;
  }

  analyzeFrame() {
    const { buffer, window: w, tauMax, tauMin, diff } = this;
    const t = (this.frameIndex++ * this.hop + w / 2) / this.rate;

    let mean = 0;
    for (let i = 0; i < w; i++) mean += buffer[i];
    mean /= w;
    let energy = 0;
    for (let i = 0; i < w; i++) energy += (buffer[i] - mean) ** 2;
    const rms = Math.sqrt(energy / w);
    if (rms < SILENCE_RMS) return { t, hz: null, rms };

    // YIN: difference function, then cumulative-mean normalization.
    diff[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let d = 0;
      for (let j = 0; j < w; j++) {
        const delta = buffer[j] - buffer[j + tau];
        d += delta * delta;
      }
      running += d;
      diff[tau] = running > 0 ? (d * tau) / running : 1;
    }

    let best = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (diff[tau] < YIN_THRESHOLD) {
        while (tau + 1 < tauMax && diff[tau + 1] < diff[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let min = Infinity;
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (diff[tau] < min) {
          min = diff[tau];
          best = tau;
        }
      }
      if (min > YIN_REJECT) return { t, hz: null, rms };
    }

    // Parabolic interpolation gives sub-sample period accuracy.
    const a = diff[best - 1];
    const b = diff[best];
    const c = diff[best + 1];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const period = best + (Math.abs(shift) < 1 ? shift : 0);
    return { t, hz: this.rate / period, rms };
  }
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Cleans up a finished take: drops background noise, repairs octave errors,
// smooths the contour and removes isolated blips. Returns new frame objects.
export function cleanTrack(frames) {
  const out = frames.map((f) => ({ ...f }));

  // Gate relative to this take's loudness, so mic level doesn't matter.
  const levels = out.filter((f) => f.hz !== null).map((f) => f.rms).sort((a, b) => a - b);
  if (levels.length) {
    const loud = levels[Math.floor(levels.length * 0.95)];
    for (const f of out) if (f.rms < loud * 0.08) f.hz = null;
  }

  // A voice cannot jump an octave within one 20 ms frame, so frames that
  // disagree with their neighbours by a factor of two are detector errors.
  const voiced = out.filter((f) => f.hz !== null);
  const repaired = voiced.map((f, i) => {
    const neighbours = [];
    for (let j = Math.max(0, i - 5); j <= Math.min(voiced.length - 1, i + 5); j++) {
      if (j !== i && Math.abs(voiced[j].t - f.t) < 0.2) neighbours.push(voiced[j].hz);
    }
    if (neighbours.length < 3) return f.hz;
    const ratio = f.hz / medianOf(neighbours);
    if (ratio > 1.8 && ratio < 2.2) return f.hz / 2;
    if (ratio > 0.45 && ratio < 0.55) return f.hz * 2;
    return f.hz;
  });

  // Five-point median smoothing, staying inside the same voiced stretch.
  voiced.forEach((f, i) => {
    const near = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(voiced.length - 1, i + 2); j++) {
      if (Math.abs(voiced[j].t - f.t) < 0.07) near.push(repaired[j]);
    }
    f.hz = medianOf(near);
  });

  // Remove voiced islands shorter than 60 ms.
  for (const segment of voicedSegments(out, 0.03)) {
    if (segment.length < 3) for (const f of segment) f.hz = null;
  }
  return out;
}

// Splits frames into voiced stretches separated by gaps of at least minGap seconds.
export function voicedSegments(frames, minGap = 0.25) {
  const segments = [];
  let current = null;
  let last = -Infinity;
  for (const f of frames) {
    if (f.hz === null) continue;
    if (!current || f.t - last >= minGap + 1e-6) {
      current = [];
      segments.push(current);
    }
    current.push(f);
    last = f.t;
  }
  return segments;
}

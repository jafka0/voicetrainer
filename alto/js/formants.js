// Formant measurement using linear prediction (LPC). Resonances appear as poles
// of the filter that best predicts the sound. Pure JavaScript, testable in Node.

const RATE = 11000; // Gives a 5.5 kHz analysis ceiling on every device.
const WINDOW_SECONDS = 0.03;
const HOP_SECONDS = 0.02;
// Chosen by comparing variants against synthetic vowels at 110-220 Hz pitch. A low
// order keeps the model from locking onto individual harmonics, and strong
// pre-emphasis reduces the pull of the low buzz of the voice.
const ORDER = 10;
const PRE_EMPHASIS = Math.exp((-2 * Math.PI * 300) / RATE);
const MAX_BANDWIDTH = 700;
const SILENCE_RMS = 0.002;
const FIR_CUTOFF = 5200;

function lowPassKernel(sampleRate) {
  const taps = (Math.round((sampleRate / 1000) * 0.85) | 1);
  const middle = (taps - 1) / 2;
  const cutoff = FIR_CUTOFF / sampleRate;
  const kernel = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - middle;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * blackman;
    sum += kernel[i];
  }
  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  return kernel;
}

// Burg's method: returns [1, a1, ... aOrder] for the prediction filter.
function burg(signal, order) {
  const n = signal.length;
  const forward = Float64Array.from(signal);
  const backward = Float64Array.from(signal);
  let a = new Float64Array(order + 1);
  a[0] = 1;
  for (let m = 1; m <= order; m++) {
    let numerator = 0;
    let denominator = 0;
    for (let i = m; i < n; i++) {
      numerator += forward[i] * backward[i - 1];
      denominator += forward[i] ** 2 + backward[i - 1] ** 2;
    }
    if (denominator === 0) break;
    const k = (-2 * numerator) / denominator;
    const next = a.slice();
    for (let i = 1; i <= m; i++) next[i] = a[i] + k * a[m - i];
    a = next;
    for (let i = n - 1; i >= m; i--) {
      const f = forward[i];
      forward[i] = f + k * backward[i - 1];
      backward[i] = backward[i - 1] + k * f;
    }
  }
  return a;
}

// Durand-Kerner: finds all complex roots of a monic polynomial.
function polynomialRoots(coefficients) {
  const degree = coefficients.length - 1;
  const re = new Float64Array(degree);
  const im = new Float64Array(degree);
  for (let i = 0; i < degree; i++) {
    const angle = (2 * Math.PI * i) / degree + 0.4;
    re[i] = 0.95 * Math.cos(angle);
    im[i] = 0.95 * Math.sin(angle);
  }
  for (let iteration = 0; iteration < 80; iteration++) {
    let moved = 0;
    for (let i = 0; i < degree; i++) {
      let valueRe = 1;
      let valueIm = 0;
      for (let c = 1; c <= degree; c++) {
        const nextRe = valueRe * re[i] - valueIm * im[i] + coefficients[c];
        valueIm = valueRe * im[i] + valueIm * re[i];
        valueRe = nextRe;
      }
      let divisorRe = 1;
      let divisorIm = 0;
      for (let j = 0; j < degree; j++) {
        if (j === i) continue;
        const dRe = re[i] - re[j];
        const dIm = im[i] - im[j];
        const nextRe = divisorRe * dRe - divisorIm * dIm;
        divisorIm = divisorRe * dIm + divisorIm * dRe;
        divisorRe = nextRe;
      }
      const size = divisorRe ** 2 + divisorIm ** 2;
      if (size === 0) continue;
      const stepRe = (valueRe * divisorRe + valueIm * divisorIm) / size;
      const stepIm = (valueIm * divisorRe - valueRe * divisorIm) / size;
      re[i] -= stepRe;
      im[i] -= stepIm;
      moved = Math.max(moved, Math.abs(stepRe) + Math.abs(stepIm));
    }
    if (moved < 1e-7) break;
  }
  return { re, im };
}

// Returns resonance frequencies in Hz, lowest first, for one windowed frame.
export function findCandidates(frame, rate = RATE) {
  const { re, im } = polynomialRoots(burg(frame, ORDER));
  const candidates = [];
  for (let i = 0; i < re.length; i++) {
    if (im[i] <= 0) continue;
    const frequency = (Math.atan2(im[i], re[i]) * rate) / (2 * Math.PI);
    const radius = Math.hypot(re[i], im[i]);
    const bandwidth = (-Math.log(radius) * rate) / Math.PI;
    if (frequency > 150 && frequency < rate / 2 - 150 && bandwidth > 0 && bandwidth < MAX_BANDWIDTH) {
      candidates.push(Math.round(frequency));
    }
  }
  return candidates.sort((a, b) => a - b);
}

export class FormantTracker {
  constructor(sampleRate) {
    this.kernel = lowPassKernel(sampleRate);
    this.history = new Float32Array(this.kernel.length);
    this.historyAt = 0;
    this.step = sampleRate / RATE;
    this.position = 0;
    this.previous = 0;
    this.window = Math.round(RATE * WINDOW_SECONDS);
    this.hop = Math.round(RATE * HOP_SECONDS);
    this.buffer = new Float32Array(this.window);
    this.filled = 0;
    this.frameIndex = 0;
    this.hann = new Float32Array(this.window);
    for (let i = 0; i < this.window; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.window - 1));
  }

  push(samples) {
    const frames = [];
    const { kernel, history } = this;
    const taps = kernel.length;
    for (let s = 0; s < samples.length; s++) {
      history[this.historyAt] = samples[s];
      this.historyAt = (this.historyAt + 1) % taps;
      let filtered = 0;
      for (let k = 0; k < taps; k++) filtered += kernel[k] * history[(this.historyAt + k) % taps];

      // Linear interpolation is accurate here, since the signal is well oversampled.
      while (this.position <= 1) {
        this.buffer[this.filled++] = this.previous + (filtered - this.previous) * this.position;
        this.position += this.step;
        if (this.filled === this.window) {
          frames.push(this.analyzeFrame());
          this.buffer.copyWithin(0, this.hop);
          this.filled -= this.hop;
        }
      }
      this.position -= 1;
      this.previous = filtered;
    }
    return frames;
  }

  analyzeFrame() {
    const t = (this.frameIndex++ * this.hop + this.window / 2) / RATE;
    const n = this.window;
    const signal = new Float64Array(n);
    let energy = 0;
    let last = 0;
    for (let i = 0; i < n; i++) {
      const value = this.buffer[i];
      energy += value * value;
      signal[i] = (value - PRE_EMPHASIS * last) * this.hann[i];
      last = value;
    }
    if (Math.sqrt(energy / n) < SILENCE_RMS) return { t, candidates: [] };
    return { t, candidates: findCandidates(signal) };
  }
}

// Adds each formant frame's candidates to the nearest pitch frame.
export function attachCandidates(pitchFrames, formantFrames) {
  let at = 0;
  return pitchFrames.map((frame) => {
    while (at + 1 < formantFrames.length && Math.abs(formantFrames[at + 1].t - frame.t) <= Math.abs(formantFrames[at].t - frame.t)) at++;
    const nearest = formantFrames[at];
    return { ...frame, candidates: nearest && Math.abs(nearest.t - frame.t) < 0.03 ? nearest.candidates : [] };
  });
}

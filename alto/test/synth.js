// Synthesizes voice-like test signals: harmonic tones with a formant-style rolloff.
export function voice(hzAt, seconds, sampleRate = 48000, amplitude = 0.3) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const hz = hzAt(i / sampleRate);
    if (!hz) {
      phase = 0;
      continue;
    }
    phase += (2 * Math.PI * hz) / sampleRate;
    let value = 0;
    for (let n = 1; n <= 12; n++) value += Math.sin(n * phase) / n;
    samples[i] = (value * amplitude) / 2;
  }
  return samples;
}

// A source-filter vowel: a glottal-like pulse train through formant resonators,
// with light pitch jitter, as in a real held vowel.
export function vowelSound(f0, formants, seconds, sampleRate = 48000) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    phase += (f0 * (1 + 0.005 * Math.sin(2 * Math.PI * 5 * t))) / sampleRate;
    if (phase >= 1) phase -= 1;
    out[i] = phase < 0.6 ? Math.sin((Math.PI * phase) / 0.6) ** 2 : 0;
  }
  // Differentiating the pulse gives the spectral tilt of a voice source.
  for (let i = n - 1; i > 0; i--) out[i] -= out[i - 1];

  const bandwidths = [80, 110, 170, 250];
  const all = [...formants, 4400];
  all.forEach((frequency, index) => {
    const r = Math.exp((-Math.PI * bandwidths[index]) / sampleRate);
    const a1 = 2 * r * Math.cos((2 * Math.PI * frequency) / sampleRate);
    const a2 = -r * r;
    const gain = 1 - a1 - a2;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = gain * out[i] + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.3;
  return out;
}

export function noise(seconds, sampleRate = 48000, amplitude = 0.01) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  let seed = 12345;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = ((seed / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return samples;
}

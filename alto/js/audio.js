// Microphone capture and audio playback.
//
// Audio is held only in memory, for replaying the latest take. It is never
// written to storage and never sent anywhere. The mic is released after each take.
import { FormantTracker, attachCandidates } from './formants.js';
import { PitchTracker, cleanTrack } from './pitch.js';
import { bandProfile } from './spectrum.js';

let context = null;
let workletReady = null;
let lastTake = null;
let stopPlayback = null;

function getContext() {
  if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
  return context;
}

export class MicError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MicError';
  }
}

function micMessage(error) {
  if (!navigator.mediaDevices) return 'This page needs a secure (https) address to use the microphone.';
  if (error && error.name === 'NotAllowedError') {
    return "Microphone access is blocked. Allow it in your browser's site settings, then try again.";
  }
  if (error && error.name === 'NotFoundError') return "I couldn't find a microphone on this device.";
  if (error && error.name === 'NotReadableError') return 'Another app is using the microphone. Close it and try again.';
  return "The microphone couldn't start. Reload the page and try again.";
}

// Must be called from a click or tap, because browsers require a user gesture
// before audio can start. Resolves to { stop, cancel } once the mic is running.
export async function startRecording({ onFrame, maxSeconds = 25, onLimit, formants = false }) {
  const ctx = getContext();
  const resumed = ctx.resume();
  stopAudio();

  let stream;
  let source;
  let worklet;
  let silence;
  try {
    if (!navigator.mediaDevices) throw new Error('insecure');
    // Browser voice processing would distort the pitch and level measurements.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    await resumed;
    if (!workletReady) {
      workletReady = ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    }
    await workletReady;
    source = ctx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(ctx, 'capture-processor', { numberOfOutputs: 1 });
    silence = ctx.createGain();
  } catch (error) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    workletReady = null;
    throw new MicError(micMessage(error));
  }

  const tracker = new PitchTracker(ctx.sampleRate);
  const formantTracker = formants ? new FormantTracker(ctx.sampleRate) : null;
  const formantFrames = [];
  const chunks = [];
  const rawFrames = [];
  let clipped = 0;
  let total = 0;
  let released = false;

  silence.gain.value = 0; // Keeps the graph running without echoing the mic.
  source.connect(worklet);
  worklet.connect(silence);
  silence.connect(ctx.destination);

  const release = () => {
    if (released) return;
    released = true;
    worklet.port.onmessage = null;
    source.disconnect();
    worklet.disconnect();
    silence.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  };

  worklet.port.onmessage = ({ data }) => {
    chunks.push(data);
    total += data.length;
    for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) >= 0.99) clipped++;
    if (formantTracker) formantFrames.push(...formantTracker.push(data));
    const latest = formantFrames.length ? formantFrames[formantFrames.length - 1].candidates : [];
    for (const frame of tracker.push(data)) {
      rawFrames.push(frame);
      if (onFrame) onFrame(formantTracker ? { ...frame, candidates: latest } : frame);
    }
    if (total / ctx.sampleRate >= maxSeconds && onLimit) onLimit();
  };

  return {
    stop() {
      release();
      const samples = new Float32Array(total);
      let at = 0;
      for (const chunk of chunks) {
        samples.set(chunk, at);
        at += chunk.length;
      }
      lastTake = { samples, sampleRate: ctx.sampleRate };
      const cleaned = cleanTrack(rawFrames);
      return {
        frames: formantTracker ? attachCandidates(cleaned, formantFrames) : cleaned,
        duration: total / ctx.sampleRate,
        clipFraction: total ? clipped / total : 0,
      };
    },
    cancel: release,
  };
}

export function hasTake() {
  return Boolean(lastTake);
}

// The voiceprint of part of the latest take: coarse band levels only, no audio.
export function takeProfile(start, end) {
  return lastTake ? bandProfile(lastTake.samples, lastTake.sampleRate, start, end) : null;
}

export function clearTake() {
  lastTake = null;
}

export function stopAudio() {
  if (stopPlayback) stopPlayback();
  stopPlayback = null;
}

function playNodes(start) {
  stopAudio();
  return new Promise((resolve) => {
    const ctx = getContext();
    ctx.resume();
    const node = start(ctx);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stopPlayback = null;
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
      resolve();
    };
    node.onended = finish;
    stopPlayback = () => {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
      finish();
    };
  });
}

export function playTake() {
  if (!lastTake) return Promise.resolve();
  const { samples, sampleRate } = lastTake;
  return playNodes((ctx) => {
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.start();
    return node;
  });
}

// Plays a target pattern with a soft voice-like tone.
export function playTarget(target, duration) {
  return playNodes((ctx) => {
    const real = new Float32Array(12);
    const imag = new Float32Array(12);
    for (let n = 1; n < 12; n++) imag[n] = 1 / n ** 1.6;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));

    const now = ctx.currentTime + 0.03;
    const steps = Math.ceil(duration / 0.02);
    const curve = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) curve[i] = target(Math.min((i / steps) * duration, duration)) || 0;
    for (let i = 1; i <= steps; i++) if (!curve[i]) curve[i] = curve[i - 1];
    osc.frequency.setValueCurveAtTime(curve, now, duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.06);
    gain.gain.setValueAtTime(0.32, now + duration - 0.1);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    return osc;
  });
}

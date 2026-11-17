// Local persistence. Only settings and numbers are kept, never any audio.
const KEY = 'alto.v1';
const MAX_TAKES = 3000;
// Raise this when a change makes earlier resonance numbers untrustworthy.
const RESONANCE_READER = 2;
const RESONANCE_TAKES = ['resonanceCheck', 'resonanceContrast', 'resonanceSentence'];

const defaults = () => ({
  settings: { onboarded: false, goalLow: 165, goalHigh: 200, lang: 'both', comfortLow: null, comfortHigh: null, resonanceBaseline: null, sentenceBaseline: {}, resonanceReader: RESONANCE_READER },
  takes: [],
  checks: [],
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return defaults();
    const base = defaults();
    const loaded = { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
    if (saved.settings?.resonanceReader !== RESONANCE_READER) {
      loaded.settings.resonanceReader = RESONANCE_READER;
      loaded.settings.resonanceBaseline = null;
      loaded.settings.sentenceBaseline = {};
      loaded.takes = loaded.takes.filter((take) => !RESONANCE_TAKES.includes(take.kind));
    }
    return loaded;
  } catch {
    return defaults(); // Storage can be blocked, e.g. in a private window.
  }
}

export const state = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The app still works for this visit if storage is unavailable.
  }
}

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  persist();
}

export function addTake(take) {
  state.takes.push({ at: Date.now(), ...take });
  if (state.takes.length > MAX_TAKES) state.takes.splice(0, state.takes.length - MAX_TAKES);
  persist();
}

export function addCheck(level) {
  state.checks.push({ at: Date.now(), level });
  persist();
}

export function wipeAll() {
  Object.assign(state, defaults());
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}

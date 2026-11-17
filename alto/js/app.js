// The user interface: screens, navigation and the practice flow.
import {
  LIMITS, analyzeRange, analyzeSpeech, analyzeTone, median, toneCenter, toneTarget, workingZone,
} from './analysis.js';
import { MicError, clearTake, playTake, playTarget, startRecording, stopAudio, takeProfile } from './audio.js';
import { PitchChart } from './chart.js';
import { BASELINE_SENTENCES, GOAL_PRESETS, PATTERNS, RESONANCE, TECHNIQUES, TONES, WARMUPS } from './content.js';
import { buildSession, needsRest, pickSentence, resonanceSentence } from './plan.js';
import {
  RESONANCE_LIMITS, analyzeCheck, analyzeContrast, analyzeResonanceSentence, livePosition, shiftPct, summarize, vowelPosition,
} from './resonance.js';
import { addCheck, addTake, state, updateSettings, wipeAll } from './store.js';
import {
  dotCalendar, fanGauge, icon, milestoneMap, milestones, setFan, sparkles, stepDots, voiceprint,
} from './ui.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const TONE_LEAD_SECONDS = 2;
const DAILY_MINUTES_NOTE = 15;

let leaveScreen = null;
let session = null;

function show(html, tab = null) {
  if (leaveScreen) leaveScreen();
  leaveScreen = null;
  main.innerHTML = html;
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  nav.hidden = !tab;
  nav.querySelectorAll('button').forEach((button) => {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

const on = (selector, handler) => main.querySelector(selector).addEventListener('click', handler);
const zoneNow = () => workingZone(state.settings, state.takes);
const hzRange = (zone) => `${Math.round(zone.low)}–${Math.round(zone.high)} Hz`;
const pad2 = (n) => String(n).padStart(2, '0');
const signedPct = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;
const BACKGROUND_MESSAGE = 'Recording stopped because the app went to the background.';

// Spoken takes end after a clear pause. The minimum of voiced frames (about 0.3 s)
// keeps a stray click or cough from ending the take before speech has started.
const pausedAfterSpeaking = (voicedFrames, lastVoiced, now) => voicedFrames >= 15 && now - lastVoiced > 1.8;

function secondsToday() {
  const start = new Date().setHours(0, 0, 0, 0);
  return state.takes.filter((t) => t.at >= start).reduce((sum, t) => sum + (t.seconds || 0), 0);
}

/* ---------- Welcome ---------- */

function goalOptions(selected) {
  return GOAL_PRESETS.map((preset) => `
    <label class="choice">
      <input type="radio" name="goal" value="${preset.id}" ${preset.low === selected.goalLow && preset.high === selected.goalHigh ? 'checked' : ''}>
      <span><strong>${preset.label}</strong> · ${preset.low}–${preset.high} Hz<small>${preset.note}</small></span>
    </label>`).join('');
}

const LANGUAGE_OPTIONS = [['both', 'English and German'], ['en', 'English only'], ['de', 'German only']];

function languageOptions(selected) {
  return LANGUAGE_OPTIONS.map(([value, label]) => `
    <label class="choice">
      <input type="radio" name="lang" value="${value}" ${selected === value ? 'checked' : ''}>
      <span><strong>${label}</strong></span>
    </label>`).join('');
}

function readGoalAndLanguage() {
  const preset = GOAL_PRESETS.find((p) => p.id === main.querySelector('input[name=goal]:checked')?.value);
  const lang = main.querySelector('input[name=lang]:checked').value;
  return preset ? { goalLow: preset.low, goalHigh: preset.high, lang } : { lang };
}

function showWelcome() {
  show(`
    <div class="top"><h1 class="wordmark">alto<span>.</span></h1><span class="chip-meta">voice practice</span></div>
    <p class="lead">Private practice for finding your feminine voice, at whatever pitch feels like you.</p>
    <section class="card">
      <h2>Your starting goal</h2>
      <p class="muted small">Pitch is only part of how a voice comes across, so treat these as starting points. You can change this at any time.</p>
      <div class="choices">${goalOptions(state.settings)}</div>
    </section>
    <section class="card">
      <h2>Practice language</h2>
      <div class="choices">${languageOptions(state.settings.lang)}</div>
    </section>
    <section class="card quiet">
      <h2>Two promises</h2>
      <ul class="plain">
        <li><strong>Your voice stays on this device.</strong> Recordings are never saved or uploaded. Only the measurements are kept.</li>
        <li><strong>Comfort comes first.</strong> Stop if anything hurts. Pain or hoarseness is a sign to rest, not to push through.</li>
      </ul>
    </section>
    <button class="primary" id="begin">Continue →</button>`);
  on('#begin', () => {
    updateSettings({ ...readGoalAndLanguage(), onboarded: true });
    showBaselineIntro();
  });
}

function showBaselineIntro() {
  show(`
    <h1>First, a starting point</h1>
    <p class="lead">Read one sentence in your everyday voice, with no effort to change it. This lets Alto build toward your goal in small steps.</p>
    <button class="primary" id="go">Read a sentence →</button>
    <button class="ghost" id="skip">Skip for now</button>`);
  on('#go', () => startSession([baselineStep()], showToday));
  on('#skip', showToday);
}

function baselineStep() {
  const language = state.settings.lang === 'de' ? 'de' : 'en';
  return { kind: 'baseline', sentence: { language, pattern: 'statement', text: BASELINE_SENTENCES[language] } };
}

/* ---------- Today ---------- */

// Rough durations, for the session overview only.
const STEP_SECONDS = { warmup: 120, technique: 60, tone: 45, contrast: 75, check: 60, speech: 40, sentence: 45 };

function sessionRows(steps, focus) {
  const rows = [];
  const add = (key, iconName, seconds) => {
    let row = rows.find((r) => r.key === key);
    if (!row) {
      row = { key, iconName, seconds: 0, count: 0 };
      rows.push(row);
    }
    row.seconds += seconds;
    row.count++;
  };
  for (const step of steps) {
    if (step.kind === 'warmup') add('warmup', 'wave', STEP_SECONDS.warmup);
    else if (step.kind === 'technique') add('technique', 'burst', STEP_SECONDS.technique);
    else if (step.kind === 'tone') add('tone', 'hold', STEP_SECONDS.tone);
    else if (step.kind === 'resonance' && step.exercise.id === 'check') add('check', 'person', STEP_SECONDS.check);
    else if (step.kind === 'resonance') add('contrast', 'resonance', STEP_SECONDS.contrast);
    else if (step.kind === 'speech') add('speech', 'lines', STEP_SECONDS.speech);
    else if (step.kind === 'resonanceSentence') add('sentence', 'lines', STEP_SECONDS.sentence);
  }
  const both = state.settings.lang === 'both';
  const names = {
    warmup: () => 'Warm-up',
    technique: () => 'Finding brighter resonance',
    tone: (n) => (n === 1 ? 'One tone' : `${n} tones`),
    check: () => 'Resonance check',
    contrast: () => 'Darker to brighter',
    speech: (n) => `${n} sentences${both ? ', EN + DE' : ''}`,
    sentence: () => 'Resonance sentence',
  };
  const html = rows.map((row) => {
    const tag = row.key === 'contrast' ? 'focus'
      : row.key === 'speech' && focus ? PATTERNS[focus].label.toLowerCase() : '';
    const halves = Math.max(1, Math.round(row.seconds / 30));
    const time = `${Math.floor(halves / 2) || ''}${halves % 2 ? '½' : ''} min`;
    return `<li class="${row.key === 'contrast' ? 'focus' : ''}">${icon(row.iconName)}<span class="name">${names[row.key](row.count)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="meta">${time}</span></li>`;
  }).join('');
  return { html, seconds: rows.reduce((sum, row) => sum + row.seconds, 0) };
}

function todayLabel() {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
  return `${weekday} ${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}`;
}

function pitchStrip(zone, hz) {
  const low = Math.min(zone.low, hz) / 1.25;
  const high = Math.max(zone.high, hz) * 1.2;
  const at = (value) => (100 * Math.log(value / low)) / Math.log(high / low);
  return `<section class="card">
    <div class="strip-head"><span class="meta">speaking pitch</span><strong>${Math.round(hz)} hz</strong></div>
    <div class="zone-strip" role="img" aria-label="Your latest speaking pitch, ${Math.round(hz)} hertz, against your ${zone.isStep ? 'current step' : 'zone'} of ${hzRange(zone)}">
      <span class="zone" style="left:${at(zone.low).toFixed(1)}%;width:${(at(zone.high) - at(zone.low)).toFixed(1)}%"></span>
      <span class="you" style="left:${at(hz).toFixed(1)}%"></span>
    </div>
    <div class="strip-scale"><span>${Math.round(low)}</span><span class="sky">your ${zone.isStep ? 'step' : 'zone'} · ${Math.round(zone.low)}–${Math.round(zone.high)}</span><span>${Math.round(high)}</span></div>
  </section>`;
}

function showToday() {
  const zone = zoneNow();
  const rest = needsRest(state.checks);
  const preview = buildSession({ takes: state.takes, checks: state.checks, settings: state.settings });
  const minutesToday = secondsToday() / 60;
  const lastSpeech = [...state.takes].reverse().find((t) => (t.kind === 'speech' || t.kind === 'baseline') && t.medianHz);
  const rows = sessionRows(preview.steps, preview.focus);
  const totalMinutes = Math.max(3, Math.round(rows.seconds / 60));
  const calendar = dotCalendar(state.takes);
  const lastCheck = state.checks[state.checks.length - 1];
  const feeling = !lastCheck ? 'Ten easy minutes is plenty. Let’s see how your voice feels today.'
    : lastCheck.level === 'fine' ? 'Your voice felt comfy last time. Let’s keep it light and lovely.'
      : lastCheck.level === 'tired' ? 'Your voice was a little tired last time, so let’s go gently today.'
        : 'Your voice needed rest last time. Gentle is the whole goal today.';
  const streakNote = calendar.streak >= 3 ? `${calendar.streak} days in a row <span class="honey">✦</span> Little and often is perfect.`
    : calendar.streak === 2 ? 'Two days in a row. Little and often is perfect.'
      : 'Little and often is perfect.';

  show(`
    <div class="top"><span class="wordmark">alto<span>.</span></span><span class="chip-meta">${todayLabel()}</span></div>
    <div class="greeting">
      <h1>${state.takes.length ? 'hi again' : 'hi there'} <span class="honey">✦</span></h1>
      <p>${feeling}</p>
    </div>
    ${rest ? `<section class="card notice" role="status">
      <h2>Rest comes first today</h2>
      <p>You marked your voice as strained recently, so today's session is short and gentle. Skipping it is fine too. If pain or hoarseness keeps coming back, talk to a doctor or speech-language pathologist.</p>
    </section>` : ''}
    ${!rest && minutesToday >= DAILY_MINUTES_NOTE ? `<section class="card notice" role="status">
      <h2>You've done plenty today</h2>
      <p>You've recorded about ${Math.round(minutesToday)} minutes. Short, regular practice tends to beat long sessions, so this is a good place to stop.</p>
    </section>` : ''}
    <section class="card">
      <div class="session-head"><h2>${rest ? 'Gentle session' : 'Today’s session'}</h2><span class="meta">about ${totalMinutes} min</span></div>
      <ol class="path">${rows.html}</ol>
      <button class="primary" id="start">Let’s go ✦</button>
    </section>
    ${lastSpeech ? pitchStrip(zone, lastSpeech.medianHz) : '<button class="ghost" id="baseline">Record your everyday voice as a starting point</button>'}
    ${zone.isStep ? `<p class="muted small">Your goal is ${state.settings.goalLow}–${state.settings.goalHigh} Hz. Alto moves your practice zone up as your speaking pitch rises, so you can build range gradually.</p>` : ''}
    <div class="practice-days">
      ${calendar.html}
      <div>
        <strong>${calendar.count} cozy ${calendar.count === 1 ? 'day' : 'days'}</strong>
        <p>${streakNote}</p>
      </div>
    </div>`, 'today');
  on('#start', () => {
    const plan = buildSession({ takes: state.takes, checks: state.checks, settings: state.settings });
    startSession(plan.steps, showToday);
  });
  if (!lastSpeech) on('#baseline', () => startSession([baselineStep()], showToday));
}

/* ---------- Sessions ---------- */

function startSession(steps, onDone) {
  session = { steps: [...steps], index: 0, onDone, results: [] };
  renderStep();
}

function nextStep() {
  session.index++;
  renderStep();
}

function renderStep() {
  clearTake();
  const step = session.steps[session.index];
  if (!step) return session.onDone();
  if (step.kind === 'warmup') return renderWarmup();
  if (step.kind === 'check') return renderCheck();
  if (step.kind === 'technique') return renderTechnique();
  if (step.kind === 'resonance' || step.kind === 'resonanceSentence') return renderResonanceTake(step);
  renderTake(step);
}

function sessionHeader() {
  const total = session.steps.filter((s) => s.kind !== 'check').length;
  const index = Math.min(session.index, total - 1);
  return `<div class="session-top">
      <button class="link" id="exit">← exit</button>
      ${total > 1 ? `<span class="meta">step ${index + 1} of ${total}</span>` : ''}
    </div>
    ${total > 1 ? stepDots(total, index) : ''}`;
}

function exitSession() {
  const done = session.onDone;
  session = null;
  clearTake();
  done();
}

function renderWarmup() {
  show(`${sessionHeader()}
    <h1>Warm up</h1>
    <p class="how-to">Keep it easy and quiet. There's nothing to measure here.</p>
    <ol class="warmups">${WARMUPS.map((item) => `<li><strong>${item.title}</strong><span>${item.body}</span></li>`).join('')}</ol>
    <button class="primary" id="next">I'm warmed up →</button>`);
  on('#exit', exitSession);
  on('#next', nextStep);
}

function renderTechnique() {
  show(`${sessionHeader()}
    <h1>Finding brighter resonance</h1>
    <p class="how-to">Resonance is the size and shape of the space above your voice. You can change it without changing your pitch. Try these quietly.</p>
    <ol class="warmups">${TECHNIQUES.map((item) => `<li><strong>${item.title}</strong><span>${item.body}</span></li>`).join('')}</ol>
    <button class="primary" id="next">Continue →</button>`);
  on('#exit', exitSession);
  on('#next', nextStep);
}

/* ---------- A single take ---------- */

function describeStep(step) {
  if (step.kind === 'tone') {
    return { title: step.tone.title, prompt: `<p class="how-to">${step.tone.howTo}</p>` };
  }
  if (step.kind === 'range') {
    return {
      title: 'Find your comfortable range',
      prompt: '<p class="how-to">On a soft "ng" or "oo", glide slowly from a low, easy note up to a high, easy note and back. Stay where it feels effortless. This is not about reaching your limits.</p>',
    };
  }
  const { sentence } = step;
  const isBaseline = step.kind === 'baseline';
  return {
    title: isBaseline ? 'Your everyday voice' : PATTERNS[sentence.pattern].label,
    prompt: `
      <p class="sentence" lang="${sentence.language}">${sentence.text}</p>
      <p class="how-to">${isBaseline ? 'Read this as you normally would.' : PATTERNS[sentence.pattern].cue}</p>`,
  };
}

function renderTake(step) {
  const { title, prompt } = describeStep(step);
  const isTone = step.kind === 'tone';
  show(`${sessionHeader()}
    <h1>${title}</h1>
    ${prompt}
    <figure class="chart-box">
      <canvas id="chart" role="img" aria-label="Pitch over time. Your results are also given as text below."></canvas>
      <div class="chart-tip" id="tip" hidden></div>
      <figcaption class="legend">
        <span><i class="key voice"></i>You</span>
        ${isTone ? '<span><i class="key target"></i>Target</span>' : ''}
      </figcaption>
    </figure>
    <p class="status" id="status" role="status"></p>
    <div id="results"></div>
    <div class="controls" id="controls"></div>`);
  on('#exit', exitSession);

  const chart = new PitchChart(main.querySelector('#chart'), main.querySelector('#tip'));
  const status = main.querySelector('#status');
  const controls = main.querySelector('#controls');
  const results = main.querySelector('#results');
  const zone = zoneNow();

  let center = null;
  let target = null;
  let targetDuration = 0;
  if (isTone) {
    center = toneCenter(step.tone, zone, state.settings);
    target = toneTarget(step.tone, center);
    targetDuration = step.tone.points[step.tone.points.length - 1][0];
  }
  const takeSeconds = TONE_LEAD_SECONDS + targetDuration + 0.8;
  const resetChart = () => {
    if (isTone) chart.configure({ target, targetStart: TONE_LEAD_SECONDS, duration: takeSeconds, fixedDuration: true });
    else if (step.kind === 'range') chart.configure({ duration: 20, fixedDuration: true });
    else chart.configure({ zone: step.kind === 'baseline' ? null : zone, duration: 8 });
  };
  resetChart();

  let handle = null;
  let raf = null;
  let finished = false;

  const stopAnimation = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };
  const animatePlayhead = (seconds, onTick) => {
    const started = performance.now();
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t > seconds) return stopAnimation();
      chart.setPlayhead(t);
      if (onTick) onTick(t);
      raf = requestAnimationFrame(tick);
    };
    stopAnimation();
    raf = requestAnimationFrame(tick);
  };

  const abandon = () => {
    stopAnimation();
    stopAudio();
    if (handle) handle.cancel();
    handle = null;
  };
  const onHidden = () => {
    if (document.hidden && handle) {
      abandon();
      showReady();
      status.textContent = BACKGROUND_MESSAGE;
    }
  };
  document.addEventListener('visibilitychange', onHidden);
  let left = false;
  leaveScreen = () => {
    left = true;
    abandon();
    chart.destroy();
    document.removeEventListener('visibilitychange', onHidden);
    clearTake();
  };

  function showReady() {
    finished = false;
    results.innerHTML = '';
    chart.setPlayhead(null);
    if (isTone) {
      controls.innerHTML = `
        <button class="secondary" id="listen">Listen</button>
        <button class="primary" id="record">Your turn →</button>`;
      controls.querySelector('#listen').addEventListener('click', listen);
      status.textContent = `Target around ${Math.round(center)} Hz.`;
    } else {
      controls.innerHTML = '<button class="primary" id="record">Start recording</button>';
      status.textContent = step.kind === 'range' ? 'Take your time. It stops when you press Stop.' : 'It stops by itself when you finish.';
    }
    controls.querySelector('#record').addEventListener('click', record);
  }

  async function listen() {
    controls.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    status.textContent = 'Listen…';
    chart.configure({ target, targetStart: 0, duration: targetDuration, fixedDuration: true });
    animatePlayhead(targetDuration);
    await playTarget(target, targetDuration);
    stopAnimation();
    resetChart();
    controls.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    status.textContent = 'Now your turn, when you are ready.';
  }

  async function record() {
    resetChart();
    results.innerHTML = '';
    controls.innerHTML = '<button class="primary" disabled>Starting the microphone…</button>';
    let lastVoiced = null;
    let voicedFrames = 0;

    const finish = () => {
      if (finished || !handle) return;
      finished = true;
      stopAnimation();
      const take = handle.stop();
      handle = null;
      showResults(take);
    };

    try {
      handle = await startRecording({
        maxSeconds: isTone ? takeSeconds : step.kind === 'range' ? 20 : 25,
        onLimit: finish,
        onFrame(frame) {
          chart.addPoint(frame);
          if (frame.hz) {
            lastVoiced = frame.t;
            voicedFrames++;
          }
          if (!isTone && step.kind !== 'range' && pausedAfterSpeaking(voicedFrames, lastVoiced, frame.t)) finish();
        },
      });
    } catch (error) {
      if (!(error instanceof MicError)) throw error;
      if (left) return;
      showReady();
      status.textContent = error.message;
      return;
    }
    // The user may have left while the mic was still starting.
    if (left) {
      handle.cancel();
      handle = null;
      return;
    }
    if (document.hidden) {
      abandon();
      showReady();
      status.textContent = BACKGROUND_MESSAGE;
      return;
    }

    if (isTone) {
      controls.innerHTML = '<button class="secondary" id="cancel">Cancel</button>';
      controls.querySelector('#cancel').addEventListener('click', () => {
        abandon();
        resetChart();
        showReady();
      });
      animatePlayhead(takeSeconds, (t) => {
        if (t < TONE_LEAD_SECONDS) status.textContent = `Get ready… ${Math.ceil(TONE_LEAD_SECONDS - t)}`;
        else if (t < TONE_LEAD_SECONDS + targetDuration) status.textContent = 'Follow the dashed line.';
        else status.textContent = 'Finishing…';
      });
    } else {
      status.textContent = 'Recording…';
      controls.innerHTML = '<button class="primary stop" id="stop">Stop</button>';
      controls.querySelector('#stop').addEventListener('click', finish);
    }
  }

  function showResults(take) {
    chart.setPlayhead(null);
    chart.setPoints(take.frames);
    let result;
    if (isTone) {
      result = analyzeTone(take.frames, { target, lead: TONE_LEAD_SECONDS, duration: targetDuration, clipFraction: take.clipFraction });
    } else if (step.kind === 'range') {
      result = analyzeRange(take.frames);
    } else {
      result = analyzeSpeech(take.frames, { zone, pattern: step.sentence.pattern, clipFraction: take.clipFraction });
    }
    status.textContent = result.ok ? 'Done.' : '';

    if (result.ok) saveResult(step, result, take);

    results.innerHTML = `${resultTiles(step, result, zone)}${step.kind === 'baseline' ? baselineNote(result) : ''}${tipCards(step, result)}`;
    wireTipExercises(results, result);
    showAfterTakeControls(controls, () => {
      resetChart();
      showReady();
    });
  }

  showReady();
}

function wireTipExercises(results, result) {
  results.querySelectorAll('[data-exercise]').forEach((button) => {
    button.addEventListener('click', () => {
      const exercise = result.tips[Number(button.dataset.exercise)].exercise;
      session.steps.splice(session.index + 1, 0, stepFromExercise(exercise));
      nextStep();
    });
  });
}

function showAfterTakeControls(controls, onAgain) {
  const isLast = session.index === session.steps.length - 1;
  controls.innerHTML = `
    <button class="secondary" id="again">Try again</button>
    <button class="secondary" id="hear">▶ Hear it</button>
    <button class="primary" id="next">${isLast ? 'Done' : 'Next →'}</button>
    <p class="muted full">This recording disappears when you move on.</p>`;
  controls.querySelector('#again').addEventListener('click', () => {
    stopAudio();
    clearTake();
    onAgain();
  });
  const hear = controls.querySelector('#hear');
  hear.addEventListener('click', async () => {
    hear.disabled = true;
    await playTake();
    hear.disabled = false;
  });
  controls.querySelector('#next').addEventListener('click', nextStep);
}

function stepFromExercise(exercise) {
  if (exercise.kind === 'tone') return { kind: 'tone', tone: TONES[exercise.id] };
  if (exercise.kind === 'contrast') return { kind: 'resonance', exercise: RESONANCE[exercise.id] };
  if (exercise.kind === 'technique') return { kind: 'technique' };
  return { kind: 'speech', sentence: pickSentence(exercise.pattern, state.settings.lang) };
}

/* ---------- Resonance ---------- */

// The start marker must match what the gauge shows: one vowel, or the check's median.
function baselinePosition(exercise) {
  const baseline = state.settings.resonanceBaseline;
  if (!baseline) return null;
  const vowels = exercise.id === 'check' ? Object.keys(baseline) : [exercise.vowel];
  const positions = vowels.filter((v) => baseline[v]).map((v) => vowelPosition(v, baseline[v])).filter((p) => p !== null);
  return positions.length ? median(positions) : null;
}

// The timeline under the cue: lead-in, each held vowel, and the pauses between.
function trackParts(exercise) {
  const parts = [];
  let at = 0;
  exercise.segments.forEach((segment, i) => {
    if (segment.start > at) parts.push({ start: at, end: segment.start, label: i === 0 ? 'READY' : 'BREATHE', voice: false });
    const label = exercise.pitchTarget ? (i === 0 ? 'DARKER' : 'BRIGHTER') : `“${segment.vowel.toUpperCase()}”`;
    parts.push({ start: segment.start, end: segment.end, label, voice: true, first: exercise.pitchTarget && i === 0 });
    at = segment.end;
  });
  return parts;
}

function renderResonanceTake(step) {
  const { exercise = null, sentence = null, everyday = false } = step;
  const timed = Boolean(exercise);
  const zone = zoneNow();
  const title = timed ? exercise.title : 'Resonance sentence';
  const guidance = timed
    ? `<p class="how-to">${everyday ? 'Use your everyday voice, with no effort to change it. This is your starting point. ' : ''}${exercise.howTo}</p>`
    : `<p class="sentence" lang="${sentence.language}">${sentence.text}</p>
       <p class="how-to">Find your bright "ee" shape, then read this at your practice pitch. Using the same sentence each time keeps results comparable.</p>`;
  const parts = timed ? trackParts(exercise) : [];
  const track = parts.map((p) => `<div class="track-seg${p.voice ? ' voice' : ''}${p.first ? ' first' : ''}" style="flex:${(p.end - p.start).toFixed(2)}"><b><i></i></b><span>${p.label}</span></div>`).join('');

  show(`${sessionHeader()}
    <span class="meta">resonance${timed && exercise.vowel ? ` · “${exercise.vowel}”` : ''}</span>
    <h1>${title}</h1>
    ${guidance}
    ${timed ? `<div class="cue" id="cue"><div class="cue-head"><strong></strong><span></span></div><div class="track">${track}</div></div>` : ''}
    ${timed ? fanGauge(baselinePosition(exercise)) : ''}
    <figure class="chart-box">
      <canvas id="chart" role="img" aria-label="Pitch over time. Your results are also given as text below."></canvas>
      <div class="chart-tip" id="tip" hidden></div>
      <figcaption class="legend">
        <span><i class="key voice"></i>Your pitch</span>
        ${exercise?.pitchTarget ? '<span><i class="key target"></i>Keep to this note</span>' : ''}
      </figcaption>
    </figure>
    <p class="status" id="status" role="status"></p>
    <div id="results"></div>
    <div class="controls" id="controls"></div>`);
  on('#exit', exitSession);

  const chart = new PitchChart(main.querySelector('#chart'), main.querySelector('#tip'));
  const status = main.querySelector('#status');
  const controls = main.querySelector('#controls');
  const results = main.querySelector('#results');
  const cue = main.querySelector('#cue');
  const fan = main.querySelector('#fan');
  const trackSegments = [...main.querySelectorAll('.track-seg')];

  let target = null;
  let holdSeconds = 0;
  if (exercise?.pitchTarget) {
    const { segments } = exercise;
    holdSeconds = segments[segments.length - 1].end - segments[0].start;
    target = toneTarget({ points: [[0, 0], [holdSeconds, 0]] }, toneCenter(TONES.hold, zone, state.settings));
  }
  const resetChart = () => {
    if (timed) chart.configure({ target, targetStart: exercise.segments[0].start, duration: exercise.total, fixedDuration: true });
    else chart.configure({ zone, duration: 8 });
  };
  resetChart();

  let handle = null;
  let finished = false;
  const abandon = () => {
    stopAudio();
    if (handle) handle.cancel();
    handle = null;
  };
  const onHidden = () => {
    if (document.hidden && handle) {
      abandon();
      showReady();
      status.textContent = BACKGROUND_MESSAGE;
    }
  };
  document.addEventListener('visibilitychange', onHidden);
  let left = false;
  leaveScreen = () => {
    left = true;
    abandon();
    chart.destroy();
    document.removeEventListener('visibilitychange', onHidden);
    clearTake();
  };

  const setCue = (headline, detail = '') => {
    if (!cue) return;
    cue.hidden = false;
    cue.querySelector('.cue-head strong').textContent = headline;
    cue.querySelector('.cue-head span').textContent = detail;
  };
  const setTrack = (t) => {
    parts.forEach((part, i) => {
      const share = Math.max(0, Math.min(1, (t - part.start) / (part.end - part.start)));
      trackSegments[i].querySelector('i').style.width = `${(share * 100).toFixed(1)}%`;
      trackSegments[i].classList.toggle('active', t >= part.start && t < part.end);
    });
  };

  function showReady() {
    finished = false;
    results.innerHTML = '';
    chart.setPlayhead(null);
    setFan(fan, null, { label: 'READY' });
    setCue('Ready when you are', timed ? 'Prompts will guide you through each part.' : '');
    if (timed) setTrack(-1);
    controls.innerHTML = `
      ${target ? '<button class="secondary" id="listen">Hear the note</button>' : ''}
      <button class="primary" id="record">${timed ? 'Start →' : 'Start recording'}</button>`;
    controls.querySelector('#record').addEventListener('click', record);
    if (target) controls.querySelector('#listen').addEventListener('click', listen);
    status.textContent = timed ? '' : 'It stops by itself when you finish.';
  }

  async function listen() {
    controls.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    status.textContent = 'Listen…';
    await playTarget(target, 2);
    controls.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    status.textContent = 'Keep this note for both parts.';
  }

  // Prompts follow the recording clock, so they can't drift from the analysis windows.
  function updateCue(t) {
    setTrack(t);
    const { segments } = exercise;
    const active = segments.find((s) => t >= s.start && t <= s.end);
    if (active) return setCue(active.cue, active.detail);
    const upcoming = segments.find((s) => t < s.start);
    if (!upcoming) return setCue('Finishing…');
    return setCue(`Next in ${Math.ceil(upcoming.start - t)}…`, upcoming.cue);
  }

  async function record() {
    resetChart();
    results.innerHTML = '';
    setFan(fan, null, { label: 'LISTENING' });
    controls.innerHTML = '<button class="primary" disabled>Starting the microphone…</button>';
    const recent = [];
    const darkFrames = [];
    let darkReference = null;
    let darkTried = false;
    let lastVoiced = null;
    let voicedFrames = 0;

    const finish = () => {
      if (finished || !handle) return;
      finished = true;
      const take = handle.stop();
      handle = null;
      showResults(take);
    };

    // The live number compares with the darker half once it is done, else with the start.
    const liveReading = (active, index) => {
      const position = livePosition(recent, active.vowel);
      const now = summarize(recent, { vowel: active.vowel, minFrames: 4 });
      if (exercise.pitchTarget && index === 1) {
        if (!darkTried) {
          darkTried = true;
          darkReference = summarize(darkFrames, { vowel: active.vowel, minFrames: 8 })?.formants ?? null;
        }
        if (darkReference) {
          return { position, value: now ? shiftPct(now.formants, darkReference) : null, label: 'VS. DARKER HALF' };
        }
      }
      const start = state.settings.resonanceBaseline?.[active.vowel];
      if (start) return { position, value: now ? shiftPct(now.formants, start) : null, label: 'VS. YOUR START' };
      return { position, value: null, label: 'LISTENING' };
    };

    try {
      handle = await startRecording({
        formants: true,
        maxSeconds: timed ? exercise.total : 25,
        onLimit: finish,
        onFrame(frame) {
          chart.addPoint(frame);
          if (frame.hz) {
            lastVoiced = frame.t;
            voicedFrames++;
          }
          if (!timed) {
            if (pausedAfterSpeaking(voicedFrames, lastVoiced, frame.t)) finish();
            return;
          }
          chart.setPlayhead(frame.t);
          updateCue(frame.t);
          const index = exercise.segments.findIndex((s) => frame.t >= s.start && frame.t <= s.end);
          recent.push(frame);
          if (recent.length > 15) recent.shift();
          if (index === 0) darkFrames.push(frame);
          // The gauge updates about ten times a second, on the most recent frames.
          if (index >= 0 && Math.round(frame.t * 50) % 5 === 0) {
            const reading = liveReading(exercise.segments[index], index);
            setFan(fan, reading.position, reading);
          }
        },
      });
    } catch (error) {
      if (!(error instanceof MicError)) throw error;
      if (left) return;
      showReady();
      status.textContent = error.message;
      return;
    }
    // The user may have left while the mic was still starting.
    if (left) {
      handle.cancel();
      handle = null;
      return;
    }
    if (document.hidden) {
      abandon();
      showReady();
      status.textContent = BACKGROUND_MESSAGE;
      return;
    }

    status.textContent = 'Recording…';
    if (timed) {
      controls.innerHTML = '<button class="secondary" id="cancel">Cancel take</button>';
      controls.querySelector('#cancel').addEventListener('click', () => {
        abandon();
        resetChart();
        showReady();
      });
    } else {
      controls.innerHTML = '<button class="primary stop" id="stop">Stop</button>';
      controls.querySelector('#stop').addEventListener('click', finish);
    }
  }

  function showResults(take) {
    chart.setPlayhead(null);
    chart.setPoints(take.frames);
    if (cue) cue.hidden = true;
    let result;
    let prints = [];
    if (!timed) {
      result = analyzeResonanceSentence(take.frames, { baseline: state.settings.sentenceBaseline[sentence.language] });
      prints = [takeProfile(0, take.duration)];
    } else if (exercise.id === 'check') {
      result = analyzeCheck(take.frames, { exercise, baseline: state.settings.resonanceBaseline });
    } else {
      result = analyzeContrast(take.frames, { exercise });
      prints = exercise.segments.map((s) => takeProfile(s.start + 0.3, s.end));
    }
    status.textContent = '';
    if (result.ok) saveResonance(step, result, take, prints);
    if (!result.ok) setFan(fan, null, { label: 'NOT READ' });
    else if (exercise?.id === 'check') setFan(fan, result.position, { value: result.shiftPct, label: result.shiftPct === null ? 'STARTING POINT' : 'VS. YOUR START' });
    else if (timed) setFan(fan, result.position, { value: result.shiftPct, label: 'DARKER → BRIGHTER' });
    results.innerHTML = `${resonanceTiles(step, result, prints)}${tipCards(step, result)}`;
    wireTipExercises(results, result);
    showAfterTakeControls(controls, () => {
      resetChart();
      showReady();
    });
  }

  showReady();
}

function saveResonance(step, result, take, prints) {
  const seconds = Math.round(take.duration);
  const roundedShift = result.shiftPct === null ? null : Math.round(result.shiftPct * 10) / 10;
  if (step.kind === 'resonanceSentence') {
    const { language } = step.sentence;
    if (!state.settings.sentenceBaseline[language]) {
      updateSettings({ sentenceBaseline: { ...state.settings.sentenceBaseline, [language]: result.formants } });
    }
    addTake({ kind: 'resonanceSentence', language, seconds, shiftPct: roundedShift, formants: result.formants, print: prints[0] });
  } else if (step.exercise.id === 'check') {
    if (!state.settings.resonanceBaseline) updateSettings({ resonanceBaseline: result.vowels });
    addTake({ kind: 'resonanceCheck', seconds, shiftPct: roundedShift, vowels: result.vowels });
  } else {
    addTake({
      kind: 'resonanceContrast',
      exercise: step.exercise.id,
      seconds,
      shiftPct: roundedShift,
      pitchDriftSt: Math.round(result.pitchDriftSt * 10) / 10,
      prints,
    });
  }
  session.results.push({ step, result });
}

const REFERENCE_NOTE = 'The two dots on the gauge are adult averages from American English vowels. They show where resonances typically sit, not how you will be heard, and many women and men fall outside them. Your own change matters most.';

// The big number at the top of a resonance result, with sparkles when it went well.
function celebrate(label, value, note) {
  const good = value >= RESONANCE_LIMITS.clearShiftPct;
  return `<div class="celebrate${good ? ' good' : ''}">${good ? sparkles() : ''}
    <span class="meta">${label}</span>
    <strong>${signedPct(value)}</strong>
    ${note ? `<p>${note}</p>` : ''}
  </div>`;
}

function printRow(label, print, tone, value = '') {
  if (!print) return '';
  return `<div class="print-row${value ? '' : ' two'}"><span>${label}</span>${voiceprint(print, tone, `${label} voiceprint`)}${value ? `<span class="value">${value}</span>` : ''}</div>`;
}

function resonanceTiles(step, result, prints) {
  if (!result.ok) return '';
  if (step.kind === 'resonanceSentence') {
    const reference = state.takes.find((t) => t.kind === 'resonanceSentence' && t.language === step.sentence.language && t.print);
    const showReference = result.shiftPct !== null && reference && reference.print !== prints[0];
    return `
      ${result.shiftPct !== null ? celebrate('vs. your reference', result.shiftPct) : ''}
      <div class="prints">
        ${showReference ? printRow('reference', reference.print, 'sky') : ''}
        ${printRow(result.shiftPct === null ? 'reference' : 'this take', prints[0], result.shiftPct === null ? 'sky' : 'rose')}
      </div>
      <p class="print-note">Further right means higher resonances.</p>
      <div class="chips">
        <span class="chip sky">pitch ${Math.round(result.medianHz)} hz</span>
        ${result.shiftPct === null ? '<span class="chip lilac">saved as your reference</span>' : ''}
      </div>`;
  }
  if (step.exercise.id === 'check') {
    const rows = Object.entries(result.vowels).map(([vowel, f]) => `<tr><td>"${vowel}"</td><td>${f[1] ?? '—'} Hz</td><td>${f[2] ?? '—'} Hz</td></tr>`).join('');
    return `<div class="tiles">
      ${tile('Compared with your start', result.shiftPct === null ? 'Starting point' : signedPct(result.shiftPct))}
      ${tile('Vowels read', `${Object.keys(result.vowels).length} of 3`)}
    </div>
    <details class="card"><summary>Show the measurements</summary>
      <table><thead><tr><th scope="col">Vowel</th><th scope="col">F2</th><th scope="col">F3</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
    <p class="muted small">${REFERENCE_NOTE}</p>`;
  }
  const steady = Math.abs(result.pitchDriftSt) <= RESONANCE_LIMITS.pitchDriftSt;
  const drift = `${Math.abs(result.pitchDriftSt) < 0.05 ? '' : result.pitchDriftSt > 0 ? '+' : '−'}${Math.abs(result.pitchDriftSt).toFixed(1)} st`;
  const start = state.settings.resonanceBaseline?.[step.exercise.vowel];
  const brightPrint = prints[1] && prints[0] ? 'Your voiceprint moved to the right ✦' : '';
  return `
    ${celebrate('brightness change', result.shiftPct)}
    <div class="prints">
      ${printRow('darker', prints[0], 'sky')}
      ${printRow('brighter', prints[1], 'rose')}
    </div>
    ${result.shiftPct >= RESONANCE_LIMITS.smallShiftPct && brightPrint ? `<p class="print-note">${brightPrint}</p>` : ''}
    <div class="chips">
      <span class="chip ${steady ? 'sky' : ''}">${steady ? 'pitch steady' : 'pitch moved'} · ${drift}</span>
      ${start && result.bright ? `<span class="chip lilac">${signedPct(shiftPct(result.bright, start))} vs. your start</span>` : ''}
    </div>
    <p class="muted small">Only this picture is kept, never the sound. ${REFERENCE_NOTE}</p>`;
}

function saveResult(step, result, take) {
  const seconds = Math.round(take.duration);
  if (step.kind === 'range') {
    updateSettings({ comfortLow: result.comfortLow, comfortHigh: result.comfortHigh });
    addTake({ kind: 'range', seconds });
    return;
  }
  const tips = result.tips.map((tip) => tip.id);
  if (step.kind === 'tone') {
    addTake({ kind: 'tone', tone: step.tone.id, seconds, accuracyPct: Math.round(result.accuracyPct), tips });
  } else {
    addTake({
      kind: step.kind,
      pattern: step.sentence.pattern,
      language: step.sentence.language,
      seconds,
      medianHz: Math.round(result.medianHz),
      inZonePct: Math.round(result.inZonePct),
      rangeSt: Math.round(result.rangeSt * 10) / 10,
      endMoveSt: Math.round(result.endMoveSt * 10) / 10,
      tips,
    });
  }
  session.results.push({ step, result });
}

// A readout row: label, dotted leader, value, and an optional short note.
function tile(label, value, note = '') {
  return `<div class="tile"><span class="tile-label">${label}</span><span class="leader"></span><span class="tile-value">${value}</span>${note ? `<span class="tile-note">${note}</span>` : ''}</div>`;
}

function resultTiles(step, result, zone) {
  if (!result.ok) return '';
  if (step.kind === 'tone') {
    const off = Math.round(result.offsetCents);
    const offLabel = Math.abs(off) <= LIMITS.toneOffsetCents ? 'Centered' : `${Math.abs(off)} cents ${off < 0 ? 'under' : 'over'}`;
    return `<div class="tiles">${tile('Time on the note', `${Math.round(result.accuracyPct)}%`)}${tile('On average', offLabel)}</div>`;
  }
  if (step.kind === 'range') {
    return `<div class="tiles">${tile('Comfortable low', `${Math.round(result.comfortLow)} Hz`)}${tile('Comfortable high', `${Math.round(result.comfortHigh)} Hz`)}</div>
      <p class="muted small">Saved. Tone exercises will now stay below your comfortable high note.</p>`;
  }
  const direction = result.endMoveSt >= 1 ? 'Rising ↗' : result.endMoveSt <= -1 ? 'Falling ↘' : 'Level →';
  return `<div class="tiles">
    ${tile('Typical pitch', `${Math.round(result.medianHz)} Hz`)}
    ${tile('Melody range', `${result.rangeSt.toFixed(1)} st`)}
    ${tile('Ending', direction)}
  </div>
  ${step.kind === 'baseline' ? '' : `<p class="muted small">${Math.round(result.inZonePct)}% of this take was in your ${zone.isStep ? 'current step' : 'zone'} (${hzRange(zone)}). Melody naturally moves in and out, so your typical pitch matters more than this figure.</p>`}`;
}

function baselineNote(result) {
  if (!result.ok) return '';
  return '<p class="muted small">Saved as your starting point.</p>';
}

function tipCards(step, result) {
  if (step.kind === 'baseline' && result.ok) return '';
  return result.tips.map((tip, index) => `
    <section class="card tip ${tip.positive ? 'positive' : ''}">
      <h2><span aria-hidden="true">${tip.positive ? '✦' : '→'}</span>${tip.title}</h2>
      <p>${tip.body}</p>
      ${tip.exercise ? `<button class="secondary" data-exercise="${index}">Try an exercise for this</button>` : ''}
    </section>`).join('');
}

/* ---------- End of session ---------- */

function renderCheck() {
  show(`
    <h1>How does your voice feel?</h1>
    <p class="how-to">Your answer shapes the next session.</p>
    <div class="stack">
      <button class="secondary tall" data-level="fine">Comfortable<small>No tightness or effort</small></button>
      <button class="secondary tall" data-level="tired">A bit tired<small>Some effort, but no discomfort</small></button>
      <button class="secondary tall" data-level="strained">Strained or sore<small>Tightness, pain or hoarseness</small></button>
    </div>`);
  main.querySelectorAll('[data-level]').forEach((button) => {
    button.addEventListener('click', () => {
      addCheck(button.dataset.level);
      renderSummary(button.dataset.level);
    });
  });
}

function renderSummary(level) {
  const speech = session.results.filter((r) => r.step.kind === 'speech').map((r) => r.result);
  const tones = session.results.filter((r) => r.step.kind === 'tone').map((r) => r.result);
  const contrasts = session.results.filter((r) => r.step.exercise?.pitchTarget).map((r) => r.result);
  const advice = {
    fine: 'Good work. Consistency matters more than intensity, so a short session again tomorrow would be ideal.',
    tired: 'Have some water and give your voice a quiet stretch. A shorter session next time is fine.',
    strained: 'Please rest your voice for now. Your next session will be short and gentle. If pain or hoarseness keeps coming back, see a doctor or speech-language pathologist.',
  }[level];
  show(`
    <h1>Session complete</h1>
    <section class="card ${level === 'strained' ? 'notice' : ''}"><p>${advice}</p></section>
    <div class="tiles">
      ${tile('Typical pitch', speech.length ? `${Math.round(median(speech.map((r) => r.medianHz)))} Hz` : '—')}
      ${tile('Tone accuracy', tones.length ? `${Math.round(median(tones.map((r) => r.accuracyPct)))}%` : '—')}
      ${tile('Brightness change', contrasts.length ? signedPct(median(contrasts.map((r) => r.shiftPct))) : '—')}
    </div>
    <button class="primary" id="done">Done</button>`);
  on('#done', () => {
    const done = session.onDone;
    session = null;
    done();
  });
}

/* ---------- Free practice ---------- */

const TONE_ICONS = { hold: 'hold', steps: 'steps', glideUp: 'glide', glideDown: 'glide', wave: 'wave' };

function row(attributes, iconName, label, extraClass = '') {
  return `<button class="row ${extraClass}" ${attributes}>${icon(iconName)}<span>${label}</span></button>`;
}

function showPractice() {
  show(`
    <h1>Practice</h1>
    <p class="how-to">Choose anything you want to work on.</p>
    <h2 class="section">Resonance</h2>
    <div class="list">
      ${row('id="technique"', 'burst', 'How to find brighter resonance', 'resonance')}
      ${row('data-contrast="contrastEe"', 'resonance', RESONANCE.contrastEe.title, 'resonance')}
      ${row('data-contrast="contrastAh"', 'resonance', RESONANCE.contrastAh.title, 'resonance')}
      ${row('id="res-sentence"', 'lines', 'Resonance sentence', 'resonance')}
    </div>
    <h2 class="section">Tones</h2>
    <div class="list">${Object.values(TONES).map((tone) => row(`data-tone="${tone.id}"`, TONE_ICONS[tone.id], tone.title)).join('')}</div>
    <h2 class="section">Sentences</h2>
    <div class="list">${Object.entries(PATTERNS).map(([id, pattern]) => row(`data-pattern="${id}"`, 'lines', pattern.label)).join('')}</div>
    <h2 class="section">Check-ups</h2>
    <div class="list">
      ${row('id="res-check"', 'person', 'Resonance check')}
      ${row('id="range"', 'range', 'Find your comfortable range')}
      ${row('id="baseline"', 'person', 'Record your everyday voice')}
    </div>`, 'practice');
  on('#technique', () => startSession([{ kind: 'technique' }], showPractice));
  main.querySelectorAll('[data-contrast]').forEach((button) => {
    button.addEventListener('click', () => startSession([{ kind: 'resonance', exercise: RESONANCE[button.dataset.contrast] }], showPractice));
  });
  on('#res-sentence', () => startSession([resonanceSentence(state.settings.lang)], showPractice));
  on('#res-check', () => {
    const everyday = !state.settings.resonanceBaseline;
    startSession([{ kind: 'resonance', exercise: RESONANCE.check, everyday }], showPractice);
  });
  main.querySelectorAll('[data-tone]').forEach((button) => {
    button.addEventListener('click', () => startSession([{ kind: 'tone', tone: TONES[button.dataset.tone] }], showPractice));
  });
  main.querySelectorAll('[data-pattern]').forEach((button) => {
    button.addEventListener('click', () => {
      startSession([{ kind: 'speech', sentence: pickSentence(button.dataset.pattern, state.settings.lang) }], showPractice);
    });
  });
  on('#range', () => startSession([{ kind: 'range' }], showPractice));
  on('#baseline', () => startSession([baselineStep()], showPractice));
}

/* ---------- Progress ---------- */

function dailyPitch() {
  const days = new Map();
  for (const take of state.takes) {
    if (take.kind !== 'speech' || !take.medianHz) continue;
    const key = new Date(take.at).toDateString();
    if (!days.has(key)) days.set(key, { at: take.at, pitches: [] });
    days.get(key).pitches.push(take.medianHz);
  }
  return [...days.values()].slice(-30).map((day) => ({
    at: day.at,
    hz: Math.round(median(day.pitches)),
    takes: day.pitches.length,
  }));
}

// Brightness per day against your starting point, from checks and resonance sentences.
function dailyBrightness() {
  const days = new Map();
  for (const take of state.takes) {
    if ((take.kind !== 'resonanceCheck' && take.kind !== 'resonanceSentence') || take.shiftPct === null) continue;
    const key = new Date(take.at).toDateString();
    if (!days.has(key)) days.set(key, { at: take.at, shifts: [] });
    days.get(key).shifts.push(take.shiftPct);
  }
  return [...days.values()].slice(-30).map((day) => ({
    at: day.at,
    value: Math.round(median(day.shifts) * 10) / 10,
  }));
}

const shortDate = (at) => {
  const date = new Date(at);
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
};

// A single-series daily trend. Pitch uses a log scale, and percent change a linear one.
function trendChart(days, { low, high, log, ticks, format, band, label }) {
  const width = 340;
  const height = 170;
  const pad = { left: 36, right: 12, top: 10, bottom: 22 };
  const x = (i) => (days.length < 2
    ? (pad.left + width - pad.right) / 2
    : pad.left + (i / (days.length - 1)) * (width - pad.left - pad.right));
  const share = (v) => (log ? Math.log(v / low) / Math.log(high / low) : (v - low) / (high - low));
  const y = (v) => pad.top + (1 - share(v)) * (height - pad.top - pad.bottom);
  const line = days.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  return `
    <svg class="progress-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label} The same values are listed in the table below.">
      ${band ? `<rect class="zone" x="${pad.left}" y="${y(band.high).toFixed(1)}" width="${width - pad.left - pad.right}" height="${(y(band.low) - y(band.high)).toFixed(1)}"></rect>
      <text class="axis" x="${width - pad.right - 6}" y="${(y(band.high) + 13).toFixed(1)}" text-anchor="end">${band.label}</text>` : ''}
      ${ticks.map((tick) => `<line class="grid${!log && tick === 0 ? ' base' : ''}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}"></line>
        <text class="axis" x="${pad.left - 6}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end">${format(tick)}</text>`).join('')}
      <text class="axis" x="${pad.left}" y="${height - 6}">${shortDate(days[0].at)}</text>
      ${days.length > 1 ? `<text class="axis" x="${width - pad.right}" y="${height - 6}" text-anchor="end">${shortDate(days[days.length - 1].at)}</text>` : ''}
      ${days.length > 1 ? `<polyline class="trace" points="${line}"></polyline>` : ''}
      ${days.map((d, i) => `<circle class="dot${i === days.length - 1 ? ' last' : ''}" cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="${i === days.length - 1 ? 5 : 3.5}"><title>${shortDate(d.at)}: ${format(d.value)}</title></circle>`).join('')}
    </svg>`;
}

function pitchChart(days, goal) {
  const values = days.map((d) => d.hz);
  const low = Math.min(goal.low, ...values) / 1.1;
  const high = Math.max(goal.high, ...values) * 1.08;
  return trendChart(days.map((d) => ({ at: d.at, value: d.hz })), {
    low,
    high,
    log: true,
    ticks: [80, 100, 125, 150, 175, 200, 250, 300, 400].filter((hz) => hz > low && hz < high),
    format: (hz) => `${hz}`,
    band: { ...goal, label: 'your goal' },
    label: 'Typical speaking pitch per day.',
  });
}

function brightnessChart(days) {
  const values = days.map((d) => d.value);
  const reach = Math.max(10, ...values.map(Math.abs));
  const step = reach > 20 ? 10 : 5;
  const ticks = [];
  for (let tick = -Math.floor(reach / step) * step; tick <= reach; tick += step) ticks.push(tick);
  return trendChart(days, {
    low: -reach * 1.15,
    high: reach * 1.15,
    log: false,
    ticks,
    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`,
    label: 'Resonance brightness per day, compared with your starting point.',
  });
}

function voiceprintArchive() {
  const takes = state.takes.filter((t) => t.kind === 'resonanceSentence' && t.print);
  if (!takes.length) return '';
  const first = takes[0];
  const recent = takes.slice(-3).filter((t) => t !== first);
  const rows = [first, ...recent].map((take, i, list) => {
    const isFirst = take === first;
    const isLatest = i === list.length - 1 && !isFirst;
    const tone = isFirst ? 'sky' : isLatest ? 'rose' : 'lilac';
    const value = isFirst ? 'START' : take.shiftPct === null ? '—' : `${take.shiftPct >= 0 ? '+' : '−'}${Math.abs(take.shiftPct).toFixed(1)}`;
    return printRow(shortDate(take.at), take.print, tone, value);
  }).join('');
  return `<section>
    <h2 class="section">voiceprints · resonance sentence</h2>
    <div class="prints">${rows}</div>
    <p class="muted small">Each print is one reading of the same sentence. The dense bands drift right as your resonance rises.</p>
  </section>`;
}

function showProgress() {
  const days = dailyPitch();
  const goal = { low: state.settings.goalLow, high: state.settings.goalHigh };
  const toneTakes = state.takes.filter((t) => t.kind === 'tone').slice(-20);
  const totalMinutes = Math.round(state.takes.reduce((sum, t) => sum + (t.seconds || 0), 0) / 60);
  const baseline = state.takes.find((t) => t.kind === 'baseline');
  const latest = days[days.length - 1];
  const brightness = dailyBrightness();
  const contrasts = state.takes.filter((t) => t.kind === 'resonanceContrast').slice(-10);
  const map = milestoneMap(milestones(state));

  if (!state.takes.length) {
    show(`
      <h1>Progress</h1>
      <section class="card quiet"><p>Your trends appear here after your first exercises. Only numbers are stored, never your voice.</p></section>
      <h2 class="section">milestones · ${map.reachedCount} of 7</h2>
      ${map.html}`, 'progress');
    return;
  }

  show(`
    <h1>Progress</h1>
    ${brightness.length ? `<section>
      <div class="strip-head"><span class="meta">resonance vs. your start (%)</span><strong class="rose">${signedPct(brightness[brightness.length - 1].value)}</strong></div>
      ${brightnessChart(brightness)}
      <div class="chart-legend"><span><b style="color:var(--rose)">—●</b> YOU</span><span><b class="sky">- -</b> START</span></div>
    </section>` : ''}
    ${voiceprintArchive()}
    <h2 class="section">milestones · ${map.reachedCount} of 7</h2>
    ${map.html}
    ${days.length ? `<section>
      <h2 class="section">Speaking pitch per day (Hz)</h2>
      ${pitchChart(days, goal)}
    </section>` : ''}
    <div class="tiles">
      ${tile('Darker to brighter', contrasts.length ? signedPct(median(contrasts.map((t) => t.shiftPct))) : '—', contrasts.length ? 'TYPICAL' : '')}
      ${tile('Latest pitch', latest ? `${latest.hz} Hz` : '—', baseline ? `FROM ${baseline.medianHz}` : '')}
      ${tile('Tone accuracy', toneTakes.length ? `${Math.round(median(toneTakes.map((t) => t.accuracyPct)))}%` : '—')}
      ${tile('Practice', `${totalMinutes} min`)}
    </div>
    <details class="card">
      <summary>Show as a table</summary>
      ${days.length ? `<table>
        <thead><tr><th scope="col">Day</th><th scope="col">Typical pitch</th><th scope="col">Sentences</th></tr></thead>
        <tbody>${[...days].reverse().map((d) => `<tr><td>${shortDate(d.at)}</td><td>${d.hz} Hz</td><td>${d.takes}</td></tr>`).join('')}</tbody>
      </table>` : ''}
      ${brightness.length ? `<table>
        <thead><tr><th scope="col">Day</th><th scope="col">Resonance vs. start</th></tr></thead>
        <tbody>${[...brightness].reverse().map((d) => `<tr><td>${shortDate(d.at)}</td><td>${signedPct(d.value)}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    </details>
    <p class="muted small">Voices vary from day to day, and resonance readings also shift with your mic and its distance. Look at the trend over weeks rather than single days.</p>`, 'progress');
}

/* ---------- Settings ---------- */

function showSettings() {
  const { settings } = state;
  const isPreset = GOAL_PRESETS.some((p) => p.low === settings.goalLow && p.high === settings.goalHigh);
  show(`
    <h1>Settings</h1>
    <section class="card">
      <h2>Goal</h2>
      <div class="choices">${goalOptions(settings)}
        <label class="choice">
          <input type="radio" name="goal" value="custom" ${isPreset ? '' : 'checked'}>
          <span><strong>Custom</strong></span>
        </label>
      </div>
      <div class="custom-range">
        <label>From (Hz) <input id="low" type="number" inputmode="numeric" min="100" max="400" value="${settings.goalLow}"></label>
        <label>To (Hz) <input id="high" type="number" inputmode="numeric" min="100" max="400" value="${settings.goalHigh}"></label>
      </div>
      <p class="status" id="goal-status" role="status"></p>
    </section>
    <section class="card">
      <h2>Practice language</h2>
      <div class="choices">${languageOptions(settings.lang)}</div>
    </section>
    <section class="card quiet">
      <h2>Your data</h2>
      <p>Recordings are never saved or uploaded. They stay in memory for replay and are deleted when you move on. Your settings, measurements and voiceprints are stored only in this browser, so your phone and computer each keep their own history.</p>
      <div class="data-actions">
        <button class="secondary" id="reset-resonance">Reset resonance starting point</button>
        <button class="danger" id="wipe">Delete all my data</button>
      </div>
      <p class="status" id="data-status" role="status"></p>
    </section>
    <section class="card quiet">
      <h2>About the feedback</h2>
      <p>Alto measures pitch and melody, and estimates resonance from your F2 and F3 formants. Resonance readings are estimates, so small changes can be noise. Alto can't judge how someone will perceive your voice. Its targets and tips are practical guidelines, and it doesn't replace a speech-language pathologist.</p>
    </section>`, 'settings');

  main.querySelectorAll('input[name=goal]').forEach((input) => {
    input.addEventListener('change', () => {
      const preset = GOAL_PRESETS.find((p) => p.id === input.value);
      if (preset) {
        main.querySelector('#low').value = preset.low;
        main.querySelector('#high').value = preset.high;
        updateSettings({ goalLow: preset.low, goalHigh: preset.high });
        main.querySelector('#goal-status').textContent = 'Goal saved.';
      }
    });
  });
  const saveCustom = () => {
    const low = Number(main.querySelector('#low').value);
    const high = Number(main.querySelector('#high').value);
    const message = main.querySelector('#goal-status');
    main.querySelector('input[name=goal][value=custom]').checked = true;
    if (!(low >= 100 && high <= 400 && high - low >= 10)) {
      message.textContent = 'Enter values from 100 to 400 Hz, with "To" at least 10 Hz above "From".';
      return;
    }
    updateSettings({ goalLow: low, goalHigh: high });
    message.textContent = 'Goal saved.';
  };
  main.querySelector('#low').addEventListener('change', saveCustom);
  main.querySelector('#high').addEventListener('change', saveCustom);
  main.querySelectorAll('input[name=lang]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ lang: input.value }));
  });
  on('#reset-resonance', () => {
    if (window.confirm('Reset your resonance starting point? Your next resonance check and sentence will become the new references.')) {
      updateSettings({ resonanceBaseline: null, sentenceBaseline: {} });
      main.querySelector('#data-status').textContent = 'Resonance starting point reset.';
    }
  });
  on('#wipe', () => {
    if (window.confirm('Delete your settings and all measurements from this browser? This cannot be undone.')) {
      wipeAll();
      showWelcome();
    }
  });
}

/* ---------- Start ---------- */

const TABS = { today: showToday, practice: showPractice, progress: showProgress, settings: showSettings };
nav.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (button) {
    session = null;
    TABS[button.dataset.tab]();
  }
});

if (state.settings.onboarded) showToday();
else showWelcome();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The app works fine without offline support.
  });
}

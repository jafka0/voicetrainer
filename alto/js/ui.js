// Reusable visual parts, returned as HTML strings: icons, the dot gauge, voiceprints,
// the practice calendar, the milestone map, step progress and sparkles.

const ICON_PATHS = {
  hold: '<path d="M5 13h16"/><circle cx="13" cy="13" r="2.5"/>',
  glide: '<path d="M6 18c5 0 8-10 14-10"/>',
  wave: '<path d="M5 13c2.6-4.5 5.2-4.5 8 0s5.4 4.5 8 0"/>',
  steps: '<path d="M6 18h4v-4h4v-4h4v-2"/>',
  resonance: '<circle cx="13" cy="13" r="7"/><path d="M13 6a7 7 0 0 1 0 14z" fill="currentColor" stroke="none"/>',
  burst: '<path d="M13 4l2 6.5 6.5 2.5-6.5 2.5-2 6.5-2-6.5-6.5-2.5 6.5-2.5z"/>',
  lines: '<path d="M6 9h14M6 13h10M6 17h12"/>',
  range: '<path d="M8 18l5-10 5 10"/><path d="M10 14h6"/>',
  person: '<circle cx="13" cy="10" r="3"/><path d="M7.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/>',
};

// A soft line icon; CSS gives it a tinted round backdrop.
export function icon(name, { label = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="icon" ${a11y} viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

// A few honey sparkles and lavender dots, for good moments only.
export function sparkles() {
  return `<svg class="sparkles" aria-hidden="true" viewBox="0 0 180 70" fill="none">
    <g class="honey"><path d="M24 30l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z"/><path d="M156 18l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z"/><path d="M144 52l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z"/></g>
    <g class="lavender"><circle cx="44" cy="12" r="3"/><circle cx="132" cy="40" r="2.5"/><circle cx="12" cy="56" r="2"/></g>
  </svg>`;
}

/* ---------- Dot gauge ---------- */

const GAUGE_DOTS = 29;
const RADIUS = 140;
const PIVOT_TOP = 174;
const gaugeReading = (position) => Math.max(0, Math.min(100, ((position + 0.5) / 2) * 100));
const gaugeAngle = (reading) => -80 + 1.6 * reading;

function arcSpot(reading, radius = RADIUS) {
  const angle = (gaugeAngle(reading) * Math.PI) / 180;
  return { x: Math.sin(angle) * radius, y: PIVOT_TOP - Math.cos(angle) * radius };
}

// Position 0 is the adult men's average and 1 the women's, as in resonance.js.
export function fanGauge(startPosition) {
  const dots = Array.from({ length: GAUGE_DOTS }, (_, i) => {
    const at = (i / (GAUGE_DOTS - 1)) * 100;
    const { x, y } = arcSpot(at);
    return `<span class="fan-dot${i % 7 === 0 ? ' big' : ''}" data-at="${at}" style="left:calc(50% + ${x.toFixed(1)}px);top:${y.toFixed(1)}px"></span>`;
  }).join('');
  const averages = [0, 1].map((p) => {
    const { x, y } = arcSpot(gaugeReading(p), RADIUS - 22);
    return `<span class="fan-avg" style="left:calc(50% + ${x.toFixed(1)}px);top:${y.toFixed(1)}px"></span>`;
  }).join('');
  let start = '';
  if (startPosition !== null) {
    const { x, y } = arcSpot(gaugeReading(startPosition));
    start = `<span class="fan-start" style="left:calc(50% + ${x.toFixed(1)}px);top:${y.toFixed(1)}px"></span>`;
  }
  return `
    <div class="fan" id="fan" role="img" aria-label="Resonance gauge, from darker to brighter. Your results are also given as text.">
      ${dots}${averages}${start}
      <div class="fan-needle" hidden><span></span></div>
      <span class="fan-hub"></span>
      <div class="fan-read"><strong data-fan-value>—</strong><span data-fan-label>ready</span></div>
      <div class="fan-ends">
        <span>darker</span>
        <span>${startPosition === null ? '' : '<b class="sky">○</b> your start · '}<b>•</b> averages</span>
        <span>brighter</span>
      </div>
    </div>`;
}

export function setFan(fan, position, { value = null, label = '' } = {}) {
  if (!fan) return;
  const needle = fan.querySelector('.fan-needle');
  const reading = position === null ? null : gaugeReading(position);
  needle.hidden = reading === null;
  if (reading !== null) needle.style.setProperty('--a', `${gaugeAngle(reading)}deg`);
  fan.querySelectorAll('.fan-dot').forEach((dot) => {
    const at = Number(dot.dataset.at);
    const on = reading !== null && at <= reading;
    dot.classList.toggle('on', on);
    if (on) dot.style.setProperty('--o', (0.35 + 0.65 * (at / Math.max(reading, 1))).toFixed(2));
  });
  fan.querySelector('[data-fan-value]').textContent = value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;
  fan.querySelector('[data-fan-label]').textContent = label;
}

/* ---------- Voiceprint ---------- */

// Draws a voiceprint as soft rounded bars: brighter where the voice is louder.
export function voiceprint(print, tone = 'rose', label = 'Voiceprint') {
  if (!print) return '';
  const bars = [];
  const bandWidth = 300 / print.length;
  [...print].forEach((digit, band) => {
    const opacity = (0.08 + 0.92 * (Number(digit) / 9)).toFixed(2);
    for (let k = 0; k < 2; k++) {
      const x = (band * bandWidth + 2 + k * 4.5).toFixed(1);
      bars.push(`<rect x="${x}" y="0" width="2.2" height="18" rx="1.1" fill-opacity="${opacity}"/>`);
    }
  });
  return `<span class="print-pill"><svg class="print ${tone}" viewBox="0 0 300 18" preserveAspectRatio="none" role="img" aria-label="${label}"><g fill="currentColor">${bars.join('')}</g></svg></span>`;
}

/* ---------- Practice calendar ---------- */

const dayKey = (date) => new Date(date).toDateString();

// Five weeks of dots, Monday first, ending with the current week. A run of three or
// more days in a row, reaching today or yesterday, gets little sparkles.
export function dotCalendar(takes, now = new Date()) {
  const practiced = new Set(takes.map((take) => dayKey(take.at)));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const streakDays = new Set();
  const cursor = new Date(today);
  if (!practiced.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (practiced.has(dayKey(cursor))) {
    streakDays.add(dayKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  const streak = streakDays.size;

  const weekday = (today.getDay() + 6) % 7;
  const first = new Date(today);
  first.setDate(today.getDate() - weekday - 28);
  let count = 0;
  const dots = [];
  for (let i = 0; i < 35; i++) {
    const day = new Date(first);
    day.setDate(first.getDate() + i);
    const done = practiced.has(dayKey(day)) && day <= today;
    let kind = day > today ? 'future' : done ? 'on' : 'rest';
    if (day.getTime() === today.getTime()) kind += ' today';
    if (done) count++;
    const sparkle = done && streak >= 3 && streakDays.has(dayKey(day));
    dots.push(`<span class="dot ${kind}">${sparkle ? '✦' : ''}</span>`);
  }
  return {
    count,
    streak,
    html: `<div class="calendar" role="img" aria-label="Practice calendar for the last five weeks: ${count} days practiced${streak > 1 ? `, ${streak} days in a row` : ''}">${dots.join('')}</div>`,
  };
}

/* ---------- Milestones ---------- */

export function milestones(state) {
  const days = new Set(state.takes.map((take) => dayKey(take.at))).size;
  const sessions = state.checks.length;
  const best = Math.max(-Infinity, ...state.takes
    .filter((t) => (t.kind === 'resonanceCheck' || t.kind === 'resonanceSentence') && t.shiftPct !== null)
    .map((t) => t.shiftPct));
  return [
    { label: 'first take', reached: state.takes.length > 0 },
    { label: 'session 1', reached: sessions >= 1 },
    { label: '10 sessions', reached: sessions >= 10 },
    { label: 'first +2%', reached: best >= 2 },
    { label: '+5%', reached: best >= 5 },
    { label: '30 days', reached: days >= 30 },
    { label: '50 sessions', reached: sessions >= 50 },
  ];
}

const MAP_POINTS = [[14, 64], [62, 30], [118, 58], [172, 22], [228, 52], [280, 26], [328, 62]];
const LABEL_BELOW = [true, false, true, false, true, false, true];

export function milestoneMap(list) {
  const reachedCount = list.filter((m) => m.reached).length;
  const latest = list.map((m) => m.reached).lastIndexOf(true);
  const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [2, 4]].map(([a, b]) => {
    const both = list[a].reached && list[b].reached;
    const [x1, y1] = MAP_POINTS[a];
    const [x2, y2] = MAP_POINTS[b];
    return `<line class="${both ? 'link on' : 'link'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const nodes = list.map((m, i) => {
    const [x, y] = MAP_POINTS[i];
    const labelY = LABEL_BELOW[i] ? y + 21 : y - 13;
    const anchor = i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle';
    const labelX = i === 0 ? 4 : i === list.length - 1 ? 338 : x;
    const node = i === latest
      ? `<circle class="node on" cx="${x}" cy="${y}" r="8"/><path class="spark" d="M${x} ${y - 5}l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4z"/>`
      : `<circle class="node${m.reached ? ' on' : ''}" cx="${x}" cy="${y}" r="6"/>`;
    return `${node}<text class="${m.reached ? 'reached' : ''}" x="${labelX}" y="${labelY}" text-anchor="${anchor}">${m.label}</text>`;
  }).join('');
  const reached = list.filter((m) => m.reached).map((m) => m.label).join(', ') || 'none yet';
  return {
    reachedCount,
    html: `<svg class="milestones" viewBox="0 0 342 96" role="img" aria-label="Milestones reached: ${reached}">${links}${nodes}</svg>`,
  };
}

/* ---------- Session steps ---------- */

export function stepDots(total, index) {
  const bars = Array.from({ length: total }, (_, i) => `<span class="${i < index ? 'done' : i === index ? 'now' : ''}"></span>`).join('');
  return `<div class="steps" role="img" aria-label="Step ${Math.min(index + 1, total)} of ${total}">${bars}</div>`;
}

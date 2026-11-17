// The pitch chart: your voice over time, on a musical (logarithmic) pitch axis,
// over the target zone and/or target line.
const TICKS_HZ = [70, 80, 100, 125, 150, 175, 200, 250, 300, 400, 500];
const PAD = { left: 38, right: 10, top: 10, bottom: 22 };
const FLOOR_HZ = 60;
const CEILING_HZ = 520;

export class PitchChart {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.points = [];
    this.zone = null;
    this.target = null;
    this.targetStart = 0;
    this.duration = 8;
    this.fixedDuration = false;
    this.playhead = null;
    this.yLow = 110;
    this.yHigh = 260;

    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
    canvas.addEventListener('pointermove', (event) => this.showTooltip(event));
    canvas.addEventListener('pointerdown', (event) => this.showTooltip(event));
    canvas.addEventListener('pointerleave', () => this.hideTooltip());
  }

  destroy() {
    this.observer.disconnect();
  }

  configure({ zone = null, target = null, targetStart = 0, duration = 8, fixedDuration = false }) {
    this.zone = zone;
    this.target = target;
    this.targetStart = targetStart;
    this.duration = duration;
    this.fixedDuration = fixedDuration;
    this.points = [];
    this.playhead = null;

    let low = zone ? zone.low : Infinity;
    let high = zone ? zone.high : -Infinity;
    if (target) {
      for (let t = 0; t <= duration; t += 0.05) {
        const hz = target(t - targetStart);
        if (hz) {
          low = Math.min(low, hz);
          high = Math.max(high, hz);
        }
      }
    }
    if (!Number.isFinite(low)) {
      low = 110;
      high = 260;
    }
    this.baseLow = Math.max(FLOOR_HZ, low / 1.3);
    this.baseHigh = Math.min(CEILING_HZ, high * 1.2);
    this.yLow = this.baseLow;
    this.yHigh = this.baseHigh;
    this.draw();
  }

  addPoint(point) {
    this.points.push(point);
    if (point.hz) this.fit(point.hz);
    if (!this.fixedDuration && point.t > this.duration - 1) this.duration = point.t + 4;
    this.draw();
  }

  setPoints(points) {
    this.points = points;
    // Refit to the cleaned take, so a live noise spike doesn't flatten the final chart.
    this.yLow = this.baseLow;
    this.yHigh = this.baseHigh;
    for (const point of points) if (point.hz) this.fit(point.hz);
    this.draw();
  }

  setPlayhead(t) {
    this.playhead = t;
    this.draw();
  }

  fit(hz) {
    this.yLow = Math.max(FLOOR_HZ, Math.min(this.yLow, hz / 1.08));
    this.yHigh = Math.min(CEILING_HZ, Math.max(this.yHigh, hz * 1.08));
  }

  x(t, width) {
    return PAD.left + (t / this.duration) * (width - PAD.left - PAD.right);
  }

  y(hz, height) {
    const span = Math.log(this.yHigh / this.yLow);
    return PAD.top + (1 - Math.log(hz / this.yLow) / span) * (height - PAD.top - PAD.bottom);
  }

  draw() {
    const { canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    const g = canvas.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);

    const css = getComputedStyle(canvas);
    const color = (name) => css.getPropertyValue(name).trim();
    const right = width - PAD.right;
    const bottom = height - PAD.bottom;
    g.font = '10px "Geist Mono", ui-monospace, monospace';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Target zone.
    if (this.zone) {
      const top = this.y(Math.min(this.zone.high, this.yHigh), height);
      const base = this.y(Math.max(this.zone.low, this.yLow), height);
      g.fillStyle = color('--chart-zone');
      g.fillRect(PAD.left, top, right - PAD.left, base - top);
      g.fillStyle = color('--muted');
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.fillText(this.zone.isStep ? 'current step' : 'your zone', right - 6, top + 4);
    }

    // Recessive grid and axis labels.
    g.lineWidth = 1;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    let lastLabelY = Infinity;
    for (const hz of TICKS_HZ) {
      if (hz < this.yLow || hz > this.yHigh) continue;
      const y = Math.round(this.y(hz, height)) + 0.5;
      g.strokeStyle = color('--grid');
      g.beginPath();
      g.moveTo(PAD.left, y);
      g.lineTo(right, y);
      g.stroke();
      if (lastLabelY - y >= 14) {
        g.fillStyle = color('--muted');
        g.fillText(String(hz), PAD.left - 6, y);
        lastLabelY = y;
      }
    }
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = color('--muted');
    const stepSeconds = this.duration > 16 ? 5 : this.duration > 8 ? 2 : 1;
    for (let t = 0; t <= this.duration; t += stepSeconds) {
      g.fillText(`${t}s`, Math.min(this.x(t, width), right - 8), bottom + 6);
    }

    // Target line, dashed so it never relies on color alone.
    if (this.target) {
      g.strokeStyle = color('--chart-target');
      g.lineWidth = 2;
      g.setLineDash([6, 5]);
      g.beginPath();
      let drawing = false;
      let previous = null;
      for (let px = PAD.left; px <= right; px += 2) {
        const t = ((px - PAD.left) / (right - PAD.left)) * this.duration;
        const hz = this.target(t - this.targetStart);
        if (!hz) {
          drawing = false;
          continue;
        }
        const y = this.y(hz, height);
        if (drawing && Math.abs(y - previous) < 12) g.lineTo(px, y);
        else g.moveTo(px, y);
        drawing = true;
        previous = y;
      }
      g.stroke();
      g.setLineDash([]);
    }

    // Playhead.
    if (this.playhead !== null) {
      const x = this.x(Math.min(this.playhead, this.duration), width);
      g.strokeStyle = color('--muted');
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, PAD.top);
      g.lineTo(x, bottom);
      g.stroke();
    }

    // Your voice.
    g.strokeStyle = color('--chart-voice');
    g.lineWidth = 2.5;
    g.beginPath();
    let lastT = -Infinity;
    for (const point of this.points) {
      if (!point.hz) continue;
      const x = this.x(point.t, width);
      const y = this.y(point.hz, height);
      if (point.t - lastT > 0.09) g.moveTo(x, y);
      else g.lineTo(x, y);
      lastT = point.t;
    }
    g.stroke();
  }

  showTooltip(event) {
    const voiced = this.points.filter((point) => point.hz);
    if (!voiced.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const t = ((px - PAD.left) / (rect.width - PAD.left - PAD.right)) * this.duration;
    let nearest = voiced[0];
    for (const point of voiced) if (Math.abs(point.t - t) < Math.abs(nearest.t - t)) nearest = point;
    if (Math.abs(nearest.t - t) > 0.4) return this.hideTooltip();

    const target = this.target ? this.target(nearest.t - this.targetStart) : null;
    this.tooltip.textContent =
      `${nearest.t.toFixed(1)} s · ${Math.round(nearest.hz)} Hz` + (target ? ` · target ${Math.round(target)} Hz` : '');
    this.tooltip.hidden = false;
    const x = this.x(nearest.t, rect.width);
    const half = this.tooltip.offsetWidth / 2;
    this.tooltip.style.left = `${Math.max(half, Math.min(x, rect.width - half))}px`;
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }
}

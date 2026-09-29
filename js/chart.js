class TimeChart {
  constructor(canvas, series, windowMs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = series;
    this.windowMs = windowMs || 60000;
    this.points = [];
    this.colors = ['#4f8cff', '#2fbf71', '#e0a63a'];
  }

  push(ts, values) {
    this.points.push({ ts, values });
    const cutoff = ts - this.windowMs;
    while (this.points.length && this.points[0].ts < cutoff) this.points.shift();
    this.draw();
  }

  clear() {
    this.points = [];
    this.draw();
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 44, r: 8, t: 18, b: 16 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    ctx.strokeStyle = '#232c44';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (plotH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
    }

    if (!this.points.length) {
      ctx.fillStyle = '#8b96ad';
      ctx.font = '12px sans-serif';
      ctx.fillText('暂无数据', pad.l + 8, pad.t + 18);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const p of this.points) {
      for (const v of p.values) {
        if (v === null || v === undefined || Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) return;
    if (max - min < 1e-9) {
      min -= 1;
      max += 1;
    }
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;

    const now = this.points[this.points.length - 1].ts;
    const t0 = now - this.windowMs;

    ctx.fillStyle = '#8b96ad';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const val = max - ((max - min) * i) / 3;
      const y = pad.t + (plotH * i) / 3;
      ctx.fillText(this.formatTick(val), pad.l - 6, y + 3);
    }
    ctx.textAlign = 'left';

    const xOf = ts => pad.l + ((ts - t0) / this.windowMs) * plotW;
    const yOf = v => pad.t + (1 - (v - min) / (max - min)) * plotH;

    const seriesCount = this.series.length;
    for (let s = 0; s < seriesCount; s++) {
      ctx.strokeStyle = this.colors[s % this.colors.length];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      for (const p of this.points) {
        const v = p.values[s];
        if (v === null || v === undefined || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = xOf(p.ts);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    ctx.font = '11px sans-serif';
    let lx = pad.l + 4;
    for (let s = 0; s < seriesCount; s++) {
      ctx.fillStyle = this.colors[s % this.colors.length];
      ctx.fillText(this.series[s], lx, 12);
      lx += ctx.measureText(this.series[s]).width + 14;
    }
  }

  formatTick(v) {
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toFixed(0);
    if (abs >= 100) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toFixed(4);
  }
}

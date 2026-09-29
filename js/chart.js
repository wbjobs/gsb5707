/* 轻量 Canvas 折线图：多序列、滚动窗口、自动缩放 */
class LineChart {
  constructor(canvas, series, windowSize = 120) {
    this.canvas = canvas;
    this.series = series; // [{ key, color, label }]
    this.windowSize = windowSize;
    this.data = []; // [{ ts, values: { key: number } }]
    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.draw(); });
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 140;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  push(values, ts = Date.now()) {
    this.data.push({ ts, values });
    if (this.data.length > this.windowSize) this.data.shift();
    this.draw();
  }

  clear() {
    this.data = [];
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (this.h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.w, y);
      ctx.stroke();
    }
    if (this.data.length < 2) return;

    // 计算所有序列的取值范围
    let min = Infinity, max = -Infinity;
    for (const pt of this.data) {
      for (const s of this.series) {
        const v = pt.values[s.key];
        if (v == null || Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) return;
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    min -= pad; max += pad;

    const xStep = this.w / (this.windowSize - 1);
    const yOf = (v) => this.h - ((v - min) / (max - min)) * this.h;

    this.series.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      this.data.forEach((pt, i) => {
        const v = pt.values[s.key];
        if (v == null || Number.isNaN(v)) { started = false; return; }
        const x = i * xStep;
        const y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // 图例 + 范围
    ctx.font = '10px sans-serif';
    let lx = 6;
    for (const s of this.series) {
      ctx.fillStyle = s.color;
      ctx.fillText(s.label, lx, 12);
      lx += ctx.measureText(s.label).width + 14;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText(max.toFixed(1), this.w - 4, 12);
    ctx.fillText(min.toFixed(1), this.w - 4, this.h - 4);
    ctx.textAlign = 'left';
  }
}

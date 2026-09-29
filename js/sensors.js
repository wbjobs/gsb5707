/* 传感器通道：真实传感器 / 模拟数据 / 手动输入 三种数据源，
 * 统一经过 EMA 平滑 + 跳变钳制，权限状态实时同步。 */

// ---------- 平滑器：指数滑动平均 + 异常跳变钳制 ----------
function createSmoother({ alpha = 0.25, maxJump = Infinity, maxStep = Infinity }) {
  let value = null;
  return {
    next(raw) {
      if (raw == null || Number.isNaN(raw)) return value;
      if (value == null) { value = raw; return value; }
      // 数值跳变：偏离过大视为噪声尖峰，钳制到允许步长内
      if (Math.abs(raw - value) > maxJump) {
        raw = value + Math.sign(raw - value) * maxStep;
      }
      value = value + alpha * (raw - value);
      return value;
    },
    reset() { value = null; },
  };
}

// ---------- 模拟数据发生器：平滑连续信号，保证降级数据一致稳定 ----------
function createSimulator(spec) {
  // spec: { key: { base, amp, period, noise, min, max } }
  const t0 = Date.now();
  return function sample() {
    const t = (Date.now() - t0) / 1000;
    const out = {};
    for (const [key, s] of Object.entries(spec)) {
      const wave = s.base + s.amp * Math.sin((2 * Math.PI * t) / s.period);
      const noise = (Math.random() - 0.5) * 2 * s.noise;
      out[key] = Math.min(s.max, Math.max(s.min, wave + noise));
    }
    return out;
  };
}

// ---------- 传感器通道基类 ----------
class SensorChannel {
  constructor({ name, keys, onReading, onStatus, smoothing }) {
    this.name = name;                 // 'light' | 'orientation' | 'geolocation'
    this.keys = keys;                 // ['illuminance'] 等
    this.onReading = onReading;       // (values: {key: number}, ts) => void
    this.onStatus = onStatus;         // (state, detail) => void
    this.state = 'idle';
    this.mode = null;                 // 'real' | 'simulated' | 'manual'
    this.smoothers = {};
    keys.forEach((k, i) => {
      this.smoothers[k] = createSmoother(smoothing[k] || {});
    });
    this._simTimer = null;
    this._permStatus = null;
  }

  setStatus(state, detail = '') {
    this.state = state;
    this.onStatus(state, detail);
  }

  emit(rawValues) {
    const ts = Date.now();
    const smoothed = {};
    for (const k of this.keys) smoothed[k] = this.smoothers[k].next(rawValues[k]);
    this.onReading(smoothed, ts);
  }

  pause() {
    if (this.state === 'active' || this.state === 'simulated' || this.state === 'manual') {
      this._teardownSource();
      this.setStatus('paused');
    }
  }

  resume() {
    if (this.state !== 'paused') return;
    if (this.mode === 'simulated') this.startSimulated();
    else if (this.mode === 'manual') this.startManual();
    else this.startReal();
  }

  stop() {
    this._teardownSource();
    this._unwatchPermission();
    this.mode = null;
    Object.values(this.smoothers).forEach((s) => s.reset());
    this.setStatus('idle');
  }

  _teardownSource() {
    if (this._simTimer) { clearInterval(this._simTimer); this._simTimer = null; }
    this._stopReal && this._stopReal();
  }

  // ---- 模拟数据源 ----
  startSimulated() {
    this._teardownSource();
    this.mode = 'simulated';
    const sample = createSimulator(this.simSpec);
    this._simTimer = setInterval(() => this.emit(sample()), 250);
    this.setStatus('simulated');
  }

  // ---- 手动输入源 ----
  startManual() {
    this._teardownSource();
    this.mode = 'manual';
    this.setStatus('manual');
  }
  manualUpdate(values) {
    if (this.mode === 'manual' && this.state === 'manual') this.emit(values);
  }

  // ---- 权限状态监听（权限被撤销时实时更新）----
  _watchPermission(permName, onRevoked) {
    if (!('permissions' in navigator)) return;
    try {
      navigator.permissions.query({ name: permName }).then((status) => {
        this._permStatus = status;
        const handler = () => {
          if (status.state === 'denied') {
            this._teardownSource();
            this.setStatus('denied', '权限已被撤销');
            onRevoked && onRevoked();
          } else if (status.state === 'granted' && this.state === 'denied') {
            this.setStatus('idle', '权限已恢复，可重新启动');
          }
        };
        status.onchange = handler;
        handler();
      }).catch(() => {});
    } catch (_) { /* 某些浏览器不支持该权限名查询 */ }
  }

  _unwatchPermission() {
    if (this._permStatus) { this._permStatus.onchange = null; this._permStatus = null; }
  }
}

// ---------- 环境光 ----------
class LightChannel extends SensorChannel {
  constructor(cb) {
    super({
      name: 'light',
      keys: ['illuminance'],
      smoothing: { illuminance: { alpha: 0.3, maxJump: 2000, maxStep: 500 } },
      ...cb,
    });
    this.simSpec = { illuminance: { base: 350, amp: 250, period: 20, noise: 8, min: 0, max: 1200 } };
  }

  static isSupported() { return 'AmbientLightSensor' in window; }

  startReal() {
    if (!window.isSecureContext) { this.setStatus('insecure', '需要 HTTPS 或 localhost'); return; }
    if (!LightChannel.isSupported()) { this.setStatus('unsupported', '浏览器不支持 Ambient Light Sensor'); return; }
    this._teardownSource();
    this.mode = 'real';
    this.setStatus('requesting');
    try {
      this._sensor = new AmbientLightSensor({ frequency: 4 });
      this._sensor.addEventListener('reading', () => {
        if (this.state !== 'active') this.setStatus('active');
        this.emit({ illuminance: this._sensor.illuminance });
      });
      this._sensor.addEventListener('error', (e) => {
        if (e.error && e.error.name === 'NotAllowedError') {
          this.setStatus('denied', '环境光权限被拒绝');
        } else if (e.error && e.error.name === 'NotReadableError') {
          this.setStatus('error', '传感器读取失败（硬件不可用）');
        } else {
          this.setStatus('error', e.error ? e.error.message : '未知错误');
        }
      });
      this._sensor.start();
      this._watchPermission('ambient-light-sensor');
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        this.setStatus('denied', '环境光权限被拒绝');
      } else {
        this.setStatus('error', err.message);
      }
    }
  }

  _stopReal() {
    if (this._sensor) { try { this._sensor.stop(); } catch (_) {} this._sensor = null; }
  }
}

// ---------- 设备方向 ----------
class OrientationChannel extends SensorChannel {
  constructor(cb) {
    super({
      name: 'orientation',
      keys: ['alpha', 'beta', 'gamma'],
      smoothing: {
        alpha: { alpha: 0.2, maxJump: 90, maxStep: 15 },
        beta:  { alpha: 0.2, maxJump: 90, maxStep: 15 },
        gamma: { alpha: 0.2, maxJump: 90, maxStep: 15 },
      },
      ...cb,
    });
    this.simSpec = {
      alpha: { base: 180, amp: 120, period: 30, noise: 1.5, min: 0, max: 360 },
      beta:  { base: 0,   amp: 45,  period: 18, noise: 1.0, min: -180, max: 180 },
      gamma: { base: 0,   amp: 30,  period: 12, noise: 0.8, min: -90, max: 90 },
    };
    this._handler = null;
    this._dataTimer = null;
  }

  static isSupported() { return 'DeviceOrientationEvent' in window; }

  async startReal() {
    if (!window.isSecureContext) { this.setStatus('insecure', '需要 HTTPS 或 localhost'); return; }
    if (!OrientationChannel.isSupported()) { this.setStatus('unsupported', '浏览器不支持设备方向事件'); return; }
    this._teardownSource();
    this.mode = 'real';
    this.setStatus('requesting');
    // iOS 13+ 需要在用户手势中显式申请
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') { this.setStatus('denied', '设备方向权限被拒绝'); return; }
      }
    } catch (err) {
      this.setStatus('denied', '权限申请失败（需在用户点击中触发）');
      return;
    }
    this._handler = (e) => {
      if (e.alpha == null && e.beta == null && e.gamma == null) return;
      if (this._dataTimer) { clearTimeout(this._dataTimer); this._dataTimer = null; }
      if (this.state !== 'active') this.setStatus('active');
      this.emit({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
    };
    window.addEventListener('deviceorientation', this._handler);
    // 2 秒内无有效数据 → 视为设备不支持（如桌面浏览器）
    this._dataTimer = setTimeout(() => {
      this._teardownSource();
      this.setStatus('unsupported', '未收到方向数据，设备可能无陀螺仪');
    }, 2000);
  }

  _stopReal() {
    if (this._handler) { window.removeEventListener('deviceorientation', this._handler); this._handler = null; }
    if (this._dataTimer) { clearTimeout(this._dataTimer); this._dataTimer = null; }
  }
}

// ---------- 地理位置 ----------
class GeoChannel extends SensorChannel {
  constructor(cb) {
    super({
      name: 'geolocation',
      keys: ['lat', 'lng', 'acc'],
      smoothing: {
        lat: { alpha: 0.4, maxJump: 0.05, maxStep: 0.005 },
        lng: { alpha: 0.4, maxJump: 0.05, maxStep: 0.005 },
        acc: { alpha: 0.5 },
      },
      ...cb,
    });
    this.simSpec = {
      lat: { base: 39.9042, amp: 0.002, period: 40, noise: 0.00005, min: -90, max: 90 },
      lng: { base: 116.4074, amp: 0.002, period: 55, noise: 0.00005, min: -180, max: 180 },
      acc: { base: 20, amp: 10, period: 25, noise: 2, min: 3, max: 100 },
    };
    this._watchId = null;
  }

  static isSupported() { return 'geolocation' in navigator; }

  startReal() {
    if (!window.isSecureContext) { this.setStatus('insecure', '需要 HTTPS 或 localhost'); return; }
    if (!GeoChannel.isSupported()) { this.setStatus('unsupported', '浏览器不支持 Geolocation'); return; }
    this._teardownSource();
    this.mode = 'real';
    this.setStatus('requesting');
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.state !== 'active') this.setStatus('active');
        this.emit({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.setStatus('denied', '定位权限被拒绝');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          this.setStatus('error', '位置信息不可用');
        } else {
          this.setStatus('error', '定位超时');
        }
      },
      { enableHighAccuracy: false, maximumAge: 1000, timeout: 10000 }
    );
    this._watchPermission('geolocation');
  }

  _stopReal() {
    if (this._watchId != null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }
}

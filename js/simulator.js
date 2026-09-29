function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SimulatedSource {
  constructor(seed) {
    this.rand = mulberry32(seed);
    this.timer = null;
  }

  step() {}

  start(onData, intervalMs) {
    this.stop();
    this.timer = setInterval(() => onData(this.step()), intervalMs || 500);
    onData(this.step());
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

class LightSimulator extends SimulatedSource {
  constructor(seed) {
    super(seed);
    this.lux = 300;
  }

  step() {
    const drift = (this.rand() - 0.5) * 40;
    this.lux = Math.min(1000, Math.max(0, this.lux + drift));
    return { illuminance: this.lux };
  }
}

class OrientationSimulator extends SimulatedSource {
  constructor(seed) {
    super(seed);
    this.t = 0;
  }

  step() {
    this.t += 0.08;
    const noise = () => (this.rand() - 0.5) * 2;
    return {
      alpha: (180 + 120 * Math.sin(this.t * 0.6) + noise() + 360) % 360,
      beta: 45 * Math.sin(this.t) + noise(),
      gamma: 30 * Math.sin(this.t * 1.3) + noise()
    };
  }
}

class GeoSimulator extends SimulatedSource {
  constructor(seed) {
    super(seed);
    this.lat = 39.9042;
    this.lng = 116.4074;
  }

  step() {
    this.lat += (this.rand() - 0.5) * 0.0004;
    this.lng += (this.rand() - 0.5) * 0.0004;
    return {
      lat: this.lat,
      lng: this.lng,
      accuracy: 5 + this.rand() * 15
    };
  }
}

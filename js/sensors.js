const SensorState = {
  UNKNOWN: 'unknown',
  UNSUPPORTED: 'unsupported',
  INSECURE: 'insecure',
  PROMPT: 'prompt',
  GRANTED: 'granted',
  DENIED: 'denied',
  REVOKED: 'revoked'
};

class SensorChannel {
  constructor(name, permissionName) {
    this.name = name;
    this.permissionName = permissionName;
    this.state = SensorState.UNKNOWN;
    this.mode = null;
    this.onStateChange = null;
    this.onData = null;
    this.permStatus = null;
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    if (this.onStateChange) this.onStateChange(state, this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    if (this.onStateChange) this.onStateChange(this.state, this.mode);
  }

  emit(data) {
    if (this.onData) this.onData(data);
  }

  isSecure() {
    return window.isSecureContext !== false;
  }

  async queryPermission() {
    if (!this.permissionName || !navigator.permissions || !navigator.permissions.query) {
      return null;
    }
    try {
      this.permStatus = await navigator.permissions.query({ name: this.permissionName });
      this.permStatus.onchange = () => this.handlePermissionChange();
      return this.permStatus.state;
    } catch (e) {
      return null;
    }
  }

  handlePermissionChange() {
    const state = this.permStatus ? this.permStatus.state : null;
    if (state === 'denied' && this.mode === 'real') {
      this.stopReal();
      this.setState(SensorState.REVOKED);
      this.startSimulated();
    } else if (state === 'granted') {
      this.setState(SensorState.GRANTED);
    } else if (state === 'prompt') {
      this.setState(SensorState.PROMPT);
    } else if (state === 'denied') {
      this.setState(SensorState.DENIED);
    }
  }

  startSimulated() {
    this.setMode('simulated');
    this.simulator.start(data => this.emit(data), 500);
  }

  stopAll() {
    this.stopReal();
    if (this.simulator) this.simulator.stop();
    this.setMode(null);
  }

  stopReal() {}
}

class LightChannel extends SensorChannel {
  constructor() {
    super('light', 'ambient-light-sensor');
    this.simulator = new LightSimulator(20240901);
    this.sensor = null;
  }

  checkEnv() {
    if (!this.isSecure()) return SensorState.INSECURE;
    if (!('AmbientLightSensor' in window)) return SensorState.UNSUPPORTED;
    return null;
  }

  async startReal() {
    const env = this.checkEnv();
    if (env) {
      this.setState(env);
      this.startSimulated();
      return;
    }
    const perm = await this.queryPermission();
    if (perm === 'denied') {
      this.setState(SensorState.DENIED);
      this.startSimulated();
      return;
    }
    try {
      this.sensor = new AmbientLightSensor({ frequency: 2 });
      this.sensor.addEventListener('reading', () => {
        this.setState(SensorState.GRANTED);
        this.emit({ illuminance: this.sensor.illuminance });
      });
      this.sensor.addEventListener('error', e => {
        this.stopReal();
        if (e.error && e.error.name === 'NotAllowedError') {
          this.setState(SensorState.DENIED);
        } else {
          this.setState(SensorState.UNSUPPORTED);
        }
        this.startSimulated();
      });
      this.sensor.start();
      this.setMode('real');
      if (this.state === SensorState.UNKNOWN || this.state === SensorState.PROMPT) {
        this.setState(SensorState.PROMPT);
      }
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        this.setState(SensorState.DENIED);
      } else if (e && (e.name === 'SecurityError' || e.name === 'ReferenceError')) {
        this.setState(SensorState.INSECURE);
      } else {
        this.setState(SensorState.UNSUPPORTED);
      }
      this.startSimulated();
    }
  }

  stopReal() {
    if (this.sensor) {
      try { this.sensor.stop(); } catch (e) {}
      this.sensor = null;
    }
  }
}

class OrientationChannel extends SensorChannel {
  constructor() {
    super('orientation', null);
    this.simulator = new OrientationSimulator(20240902);
    this.listener = null;
    this.noDataTimer = null;
  }

  checkEnv() {
    if (!this.isSecure()) return SensorState.INSECURE;
    if (!('DeviceOrientationEvent' in window)) return SensorState.UNSUPPORTED;
    return null;
  }

  async startReal() {
    const env = this.checkEnv();
    if (env) {
      this.setState(env);
      this.startSimulated();
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') {
          this.setState(SensorState.DENIED);
          this.startSimulated();
          return;
        }
      } catch (e) {
        this.setState(SensorState.DENIED);
        this.startSimulated();
        return;
      }
    }
    this.listener = e => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      this.gotData = true;
      this.setState(SensorState.GRANTED);
      this.emit({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
    };
    this.gotData = false;
    window.addEventListener('deviceorientation', this.listener);
    this.setMode('real');
    this.setState(SensorState.PROMPT);
    this.noDataTimer = setTimeout(() => {
      if (!this.gotData && this.mode === 'real') {
        this.stopReal();
        this.setState(SensorState.UNSUPPORTED);
        this.startSimulated();
      }
    }, 3000);
  }

  stopReal() {
    if (this.listener) {
      window.removeEventListener('deviceorientation', this.listener);
      this.listener = null;
    }
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = null;
    }
  }
}

class GeoChannel extends SensorChannel {
  constructor() {
    super('geo', 'geolocation');
    this.simulator = new GeoSimulator(20240903);
    this.watchId = null;
  }

  checkEnv() {
    if (!this.isSecure()) return SensorState.INSECURE;
    if (!('geolocation' in navigator)) return SensorState.UNSUPPORTED;
    return null;
  }

  async startReal() {
    const env = this.checkEnv();
    if (env) {
      this.setState(env);
      this.startSimulated();
      return;
    }
    const perm = await this.queryPermission();
    if (perm === 'denied') {
      this.setState(SensorState.DENIED);
      this.startSimulated();
      return;
    }
    this.setMode('real');
    this.setState(SensorState.PROMPT);
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.setState(SensorState.GRANTED);
        this.emit({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      },
      err => {
        this.stopReal();
        if (err.code === err.PERMISSION_DENIED) {
          this.setState(this.state === SensorState.GRANTED ? SensorState.REVOKED : SensorState.DENIED);
        } else {
          this.setState(SensorState.UNSUPPORTED);
        }
        this.startSimulated();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  stopReal() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

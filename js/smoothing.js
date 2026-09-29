class Smoother {
  constructor(alpha, maxJump) {
    this.alpha = alpha;
    this.maxJump = maxJump;
    this.value = null;
  }

  update(raw) {
    if (raw === null || raw === undefined || Number.isNaN(raw)) return this.value;
    let v = raw;
    if (this.value !== null && this.maxJump > 0) {
      const diff = v - this.value;
      if (Math.abs(diff) > this.maxJump) {
        v = this.value + Math.sign(diff) * this.maxJump;
      }
    }
    this.value = this.value === null
      ? v
      : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset() {
    this.value = null;
  }
}

class AngleUnwrapper {
  constructor() {
    this.prev = null;
    this.offset = 0;
  }

  update(angle) {
    if (angle === null || angle === undefined || Number.isNaN(angle)) return null;
    if (this.prev !== null) {
      let delta = angle - this.prev;
      if (delta > 180) this.offset -= 360;
      else if (delta < -180) this.offset += 360;
    }
    this.prev = angle;
    return angle + this.offset;
  }

  reset() {
    this.prev = null;
    this.offset = 0;
  }
}

export class Coherence {
  constructor({ max = 1.0, value = 1.0, minDrain = 0.005, maxDrain = 0.10, regenThreshold = 0.7, regenRate = 0.15 } = {}) {
    this.max = max;
    this.value = value;
    this.minDrain = minDrain; // per second at bright regions (nd≈1)
    this.maxDrain = maxDrain; // per second at dark regions (nd≈0)
    this.regenThreshold = regenThreshold;
    this.regenRate = regenRate; // per second when above threshold (scaled by nd-threshold)
  }

  update(dt, normDensity01) {
    const nd = Math.max(0, Math.min(1, normDensity01));
    // Drain interpolates between max (dark) and min (bright)
    const drain = this.maxDrain + (this.minDrain - this.maxDrain) * nd;
    const regen = Math.max(0, nd - this.regenThreshold) * this.regenRate;
    this.value += (regen - drain) * dt;
    if (this.value < 0) this.value = 0;
    if (this.value > this.max) this.value = this.max;
    return this.value > 0;
  }

  reset() { this.value = this.max; }
}

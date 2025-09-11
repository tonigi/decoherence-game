export class Player {
  constructor({ x = 20, y = 90, baseSpeed = 20, radius = 3, speedProfile = { minFactor: 0.3, maxFactor: 3.0 } } = {}) {
    this.x = x;
    this.y = y;
    this.baseSpeed = baseSpeed; // grid units per second
    this.radius = radius;
    this.speedProfile = speedProfile;
  }

  update(input, dt, sampleNormDensity) {
    const dir = { x: 0, y: 0 };
    if (input.left) dir.x -= 1;
    if (input.right) dir.x += 1;
    if (input.up) dir.y -= 1;
    if (input.down) dir.y += 1;
    let len = Math.hypot(dir.x, dir.y);
    if (len > 0) { dir.x /= len; dir.y /= len; }

    const nd = Math.max(0, Math.min(1, sampleNormDensity(this.x, this.y)));
    const sp = this.speedProfile || { minFactor: 0.3, maxFactor: 3.0 };
    const factor = sp.minFactor + (sp.maxFactor - sp.minFactor) * Math.sqrt(nd);
    const v = this.baseSpeed * factor;
    this.x += dir.x * v * dt;
    this.y += dir.y * v * dt;
    return nd; // normalized density 0..1 for coherence calculations
  }

  clampToBounds(w, h) {
    this.x = Math.min(w - 1, Math.max(0, this.x));
    this.y = Math.min(h - 1, Math.max(0, this.y));
  }
}

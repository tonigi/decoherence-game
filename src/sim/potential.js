// Potential field generators

/**
 * Create a double-slit potential: vertical barrier at mid X with two gaps (slits).
 * V units assume ħ = m = 1 in sim; values are relative to kinetic term scale.
 */
export function makeDoubleSlit(width, height, {
  barrierX = Math.floor(width * 0.5),
  barrierThickness = 6,
  barrierV = 40.0,
  slitHeight = Math.floor(height * 0.12),
  slitSeparation = Math.floor(height * 0.20),
  slitOffsetY = 0,
} = {}) {
  const V = new Float32Array(width * height);
  const yCenter = Math.floor(height / 2) + slitOffsetY;
  const slit1Y0 = yCenter - Math.floor(slitSeparation / 2) - Math.floor(slitHeight / 2);
  const slit2Y0 = yCenter + Math.ceil(slitSeparation / 2) - Math.floor(slitHeight / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0.0;
      // Barrier region
      if (x >= barrierX - Math.floor(barrierThickness / 2) && x < barrierX + Math.ceil(barrierThickness / 2)) {
        // Carve out slits
        const inSlit1 = y >= slit1Y0 && y < slit1Y0 + slitHeight;
        const inSlit2 = y >= slit2Y0 && y < slit2Y0 + slitHeight;
        if (!(inSlit1 || inSlit2)) {
          val = barrierV;
        }
      }
      V[y * width + x] = val;
    }
  }
  return V;
}

export function makeSingleSlit(width, height, {
  barrierX = Math.floor(width * 0.5),
  barrierThickness = 6,
  barrierV = 40.0,
  slitHeight = Math.floor(height * 0.25),
  slitOffsetY = 0,
} = {}) {
  const V = new Float32Array(width * height);
  const yCenter = Math.floor(height / 2) + slitOffsetY;
  const slitY0 = yCenter - Math.floor(slitHeight / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0.0;
      if (x >= barrierX - Math.floor(barrierThickness / 2) && x < barrierX + Math.ceil(barrierThickness / 2)) {
        const inSlit = y >= slitY0 && y < slitY0 + slitHeight;
        if (!inSlit) val = barrierV;
      }
      V[y * width + x] = val;
    }
  }
  return V;
}

export function makePotentialWell(width, height, { cx, cy, r = Math.min(width, height) * 0.2, depth = -10 } = {}) {
  const V = new Float32Array(width * height);
  const centerX = cx ?? Math.floor(width / 2);
  const centerY = cy ?? Math.floor(height / 2);
  const r2 = r * r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      V[y * width + x] = (dx * dx + dy * dy <= r2) ? depth : 0.0;
    }
  }
  return V;
}


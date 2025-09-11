// Absorbing boundary mask (simple exponential damping near edges)

/**
 * Create a per-cell damping factor in [0,1], applied every step to both real and imag parts.
 * Interior cells have 1.0; near edges within `margin` the factor decreases to exp(-strength).
 */
export function makeAbsorbMask(width, height, { margin = 16, strength = 0.04 } = {}) {
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = x;
      const right = width - 1 - x;
      const top = y;
      const bottom = height - 1 - y;
      const d = Math.min(left, right, top, bottom);
      let m = 0.0;
      if (d >= margin) {
        m = 0.0;
      } else {
        const s = 1.0 - d / margin; // 0 at interior boundary of margin, 1 at edge
        m = Math.min(1.0, Math.max(0.0, s));
      }
      // Exponential damping weight; 0 -> 1.0, 1 -> exp(-strength)
      const damp = Math.exp(-strength * m * m);
      mask[y * width + x] = damp;
    }
  }
  return mask;
}


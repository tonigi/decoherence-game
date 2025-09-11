// CPU-based leapfrog FDTD solver for 2D time-dependent Schrödinger equation.
// Units: ħ = 1, m = 1

function idx(x, y, w) { return y * w + x; }

function laplacian(arr, x, y, w, h, invDx2) {
  // 5-point Laplacian with Neumann-like copy at borders
  const xm = x > 0 ? x - 1 : x;
  const xp = x < w - 1 ? x + 1 : x;
  const ym = y > 0 ? y - 1 : y;
  const yp = y < h - 1 ? y + 1 : y;
  const c = arr[idx(x, y, w)];
  const sum = arr[idx(xp, y, w)] + arr[idx(xm, y, w)] + arr[idx(x, yp, w)] + arr[idx(x, ym, w)] - 4 * c;
  return sum * invDx2;
}

export function createFDTDSim({ width, height, dx = 1.0, dt = 0.02, V, absorbMask }) {
  const w = width, h = height;
  const invDx2 = 1.0 / (dx * dx);
  const psiR = new Float32Array(w * h);
  const psiIhalf = new Float32Array(w * h); // imag at half-steps
  const density = new Float32Array(w * h);
  let lastMaxDensity = 0;
  const mask = absorbMask || new Float32Array(w * h).fill(1.0);
  const pot = V || new Float32Array(w * h);

  function seedGaussian({ x0, y0, sigma = 6, kx = 0.6, ky = 0 }) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx0 = x - x0;
        const dy0 = y - y0;
        const gauss = Math.exp(-(dx0 * dx0 + dy0 * dy0) / (2 * sigma * sigma));
        const phase = kx * x + ky * y;
        psiR[idx(x, y, w)] = gauss * Math.cos(phase);
        // Start with zero imag, then compute half-step below
      }
    }
    // Normalize roughly
    let sum = 0;
    for (let i = 0; i < psiR.length; i++) sum += psiR[i] * psiR[i];
    const norm = Math.sqrt(sum);
    for (let i = 0; i < psiR.length; i++) psiR[i] /= norm;
    // Initialize imag half-step from real
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const lap = laplacian(psiR, x, y, w, h, invDx2);
        const a = psiR[idx(x, y, w)];
        const v = pot[idx(x, y, w)];
        const bHalf = 0 + dt * (0.5 * lap - v * a) * 0.5; // half-step from t=0 imag=0
        psiIhalf[idx(x, y, w)] = bHalf;
      }
    }
  }

  function step(nSteps = 1) {
    for (let s = 0; s < nSteps; s++) {
      // imag half-step update: b^{n+1/2} = b^{n-1/2} + dt*(0.5*Lap(a^n) - V*a^n)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = idx(x, y, w);
          const a = psiR[i];
          const lapA = laplacian(psiR, x, y, w, h, invDx2);
          const v = pot[i];
          psiIhalf[i] += dt * (0.5 * lapA - v * a);
        }
      }
      // real full-step update: a^{n+1} = a^{n} + dt*(-0.5*Lap(b^{n+1/2}) + V*b^{n+1/2})
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = idx(x, y, w);
          const bHalf = psiIhalf[i];
          const lapB = laplacian(psiIhalf, x, y, w, h, invDx2);
          const v = pot[i];
          psiR[i] += dt * (-0.5 * lapB + v * bHalf);
        }
      }
      // Simple absorbing mask
      for (let i = 0; i < psiR.length; i++) {
        const m = mask[i];
        psiR[i] *= m;
        psiIhalf[i] *= m;
      }
    }
  }

  function computeDensity() {
    let dMax = 0;
    for (let i = 0; i < psiR.length; i++) {
      const a = psiR[i], b = psiIhalf[i];
      const d = a * a + b * b;
      density[i] = d;
      if (d > dMax) dMax = d;
    }
    lastMaxDensity = dMax;
    return density;
  }

  function getLastMaxDensity() {
    return lastMaxDensity || 1e-6;
  }

  function sampleDensity(x, y) {
    // Bilinear sampling in grid coords (x in [0,w-1], y in [0,h-1])
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    const d00 = density[idx(x0, y0, w)];
    const d10 = density[idx(x1, y0, w)];
    const d01 = density[idx(x0, y1, w)];
    const d11 = density[idx(x1, y1, w)];
    const d0 = d00 * (1 - fx) + d10 * fx;
    const d1 = d01 * (1 - fx) + d11 * fx;
    return d0 * (1 - fy) + d1 * fy;
  }

  function getState() {
    return { psiR, psiIhalf, V: pot, width: w, height: h };
  }

  return {
    width: w,
    height: h,
    dt,
    seedGaussian,
    step,
    computeDensity,
    sampleDensity,
    getState,
    getLastMaxDensity,
  };
}

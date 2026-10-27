// 2D time-dependent Schroedinger solver, hbar = m = 1, split-step Fourier with
// Strang splitting (V/2 -> T -> V/2). Exactly unitary except for the complex
// absorbing potential at the edges, whose lost probability is tracked as
// 1 - norm() - caught. Absorbing *elements* (e.g. a bomb) are a second
// imaginary potential Wel whose swallowed probability is accumulated exactly,
// step by step, in `caught`. psi is normalised so that sum |psi_i|^2 = 1.
import { FFT2 } from './fft.js';

const GATE_RAMP_STEPS = 10; // gates fade over this many steps to avoid shocks

export class Sim {
  constructor(N, L, dt, { absorbWidth = 6, absorbStrength = 2 } = {}) {
    this.N = N; this.L = L; this.dx = L / N; this.dt = dt;
    const n2 = N * N;
    this.re = new Float64Array(n2); this.im = new Float64Array(n2);
    this.Vstat = new Float64Array(n2);   // always-on potential
    this.Vdraw = new Float64Array(n2);   // statics + gates (no tilt), for display
    this.W = new Float64Array(n2);       // absorbing boundary (imaginary part)
    this.Wel = new Float64Array(n2);     // absorbing elements (imaginary part)
    this.fEl = new Float64Array(n2);     // per half-step fraction of |psi|^2 swallowed by elements
    this.hasWel = false;
    this.caught = 0;                     // probability absorbed by elements so far
    this.gates = [];                     // {V, level, target}
    this.tilt = [0, 0];
    this.cH = new Float64Array(n2); this.sH = new Float64Array(n2);
    this.kc = new Float64Array(n2); this.ks = new Float64Array(n2);
    this.fft = new FFT2(N);
    this.dirty = true;
    this.kmax = Math.PI / this.dx;
    this.scratchRe = new Float64Array(n2); this.scratchIm = new Float64Array(n2);

    // kinetic propagator exp(-i k^2 dt / 2), in the transposed [kx][ky] layout;
    // the 1/N^2 inverse-FFT normalisation is folded in.
    const dk = (2 * Math.PI) / L;
    for (let a = 0; a < N; a++) {
      const fa = (a < N / 2 ? a : a - N) * dk;
      for (let b = 0; b < N; b++) {
        const fb = (b < N / 2 ? b : b - N) * dk;
        const ang = -0.5 * (fa * fa + fb * fb) * dt;
        this.kc[a * N + b] = Math.cos(ang) / n2;
        this.ks[a * N + b] = Math.sin(ang) / n2;
      }
    }
    // absorbing boundary: smooth quadratic ramp in each axis
    const A = absorbWidth;
    for (let j = 0; j < N; j++) {
      const y = (j + 0.5) * this.dx;
      const wy = ramp(Math.min(y, L - y), A);
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) * this.dx;
        this.W[j * N + i] = absorbStrength * (ramp(Math.min(x, L - x), A) + wy);
      }
    }
  }

  addStatic(V) { for (let i = 0; i < V.length; i++) this.Vstat[i] += V[i]; this.dirty = true; }
  /** Smooth wells (harmonic) are drawn as equipotential contours, not as a tint. */
  addContour(V) { if (!this.Vcont) this.Vcont = new Float64Array(V.length); for (let i = 0; i < V.length; i++) this.Vcont[i] += V[i]; }
  addAbsorber(W) { for (let i = 0; i < W.length; i++) this.Wel[i] += W[i]; this.hasWel = true; this.dirty = true; }
  addGate(V, open) {
    this.gates.push({ V, level: open ? 0 : 1, target: open ? 0 : 1 });
    this.dirty = true;
    return this.gates.length - 1;
  }
  setGate(i, open) { this.gates[i].target = open ? 0 : 1; }
  setTilt(fx, fy) { this.tilt = [fx, fy]; this.dirty = true; }

  setGaussian({ x, y, kx, ky, sigma }, add = false) {
    const { N, dx, re, im } = this;
    if (!add) { re.fill(0); im.fill(0); }
    const tmpRe = new Float64Array(N * N), tmpIm = new Float64Array(N * N);
    let norm = 0;
    for (let j = 0; j < N; j++) {
      const yy = (j + 0.5) * dx;
      for (let i = 0; i < N; i++) {
        const xx = (i + 0.5) * dx;
        const a = Math.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (4 * sigma * sigma));
        const ph = kx * (xx - x) + ky * (yy - y);
        tmpRe[j * N + i] = a * Math.cos(ph); tmpIm[j * N + i] = a * Math.sin(ph);
        norm += a * a;
      }
    }
    const f = 1 / Math.sqrt(norm);
    for (let i = 0; i < re.length; i++) { re[i] += f * tmpRe[i]; im[i] += f * tmpIm[i]; }
  }

  _refresh() {
    let moving = false;
    for (const g of this.gates) {
      if (g.level !== g.target) {
        const d = g.target - g.level, st = 1 / GATE_RAMP_STEPS;
        g.level = Math.abs(d) <= st ? g.target : g.level + Math.sign(d) * st;
        moving = true;
      }
    }
    if (!this.dirty && !moving) return;
    const { N, dx, dt, Vstat, Vdraw, W, Wel, fEl, gates, tilt, cH, sH } = this;
    const hx = this.L / 2;
    for (let j = 0; j < N; j++) {
      const y = (j + 0.5) * dx - hx;
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let v = Vstat[k];
        for (const g of gates) v += g.level * g.V[k];
        Vdraw[k] = v;
        v -= tilt[0] * ((i + 0.5) * dx - hx) + tilt[1] * y;
        const a = 0.5 * dt, w = W[k] + Wel[k], d = Math.exp(-w * a);
        cH[k] = Math.cos(v * a) * d; sH[k] = -Math.sin(v * a) * d;
        fEl[k] = Wel[k] > 0 ? (1 - d * d) * Wel[k] / w : 0;
      }
    }
    this.dirty = false;
  }

  _mul(c, s, re = this.re, im = this.im) {
    for (let i = 0; i < re.length; i++) {
      const r = re[i], m = im[i];
      re[i] = r * c[i] - m * s[i]; im[i] = r * s[i] + m * c[i];
    }
  }

  /** sum fEl |psi|^2: what the next potential half-step lets the elements swallow. */
  _elLoss(re, im) {
    const f = this.fEl; let s = 0;
    for (let i = 0; i < re.length; i++) if (f[i]) s += f[i] * (re[i] * re[i] + im[i] * im[i]);
    return s;
  }

  /** One Strang step of state (re, im); returns the probability caught by absorbing elements. */
  _advance(re, im) {
    let caught = 0;
    if (this.hasWel) caught += this._elLoss(re, im);
    this._mul(this.cH, this.sH, re, im);
    this.fft.pass(re, im, false);
    this._mul(this.kc, this.ks, re, im);
    this.fft.pass(re, im, true);
    if (this.hasWel) caught += this._elLoss(re, im);
    this._mul(this.cH, this.sH, re, im);
    return caught;
  }

  /** Advance psi by n steps. `others` are extra {re, im, caught} states
   *  (measurement branches) stepped in lock-step under the same Hamiltonian, so
   *  gate ramps and tilt stay common to all of them. */
  step(n = 1, others = []) {
    for (let s = 0; s < n; s++) {
      this._refresh();
      this.caught += this._advance(this.re, this.im);
      for (const o of others) o.caught = (o.caught || 0) + this._advance(o.re, o.im);
    }
  }

  /** Run fn with psi (and its `caught` record) temporarily swapped for state
   *  {re, im, caught}, so every observable and operation below can act on a
   *  measurement branch. */
  withState(st, fn) {
    const re = this.re, im = this.im, c = this.caught;
    this.re = st.re; this.im = st.im; this.caught = st.caught || 0;
    try { return fn(this); } finally { st.caught = this.caught; this.re = re; this.im = im; this.caught = c; }
  }

  /** Kraus bookkeeping for `caught` after a detector outcome with probability p:
   *  an absorbed particle is never in the detector, so it belongs to the "no" branch. */
  conditionCaught(yes, p) { this.caught = yes ? 0 : this.caught / (1 - p); }

  // ---- observables -------------------------------------------------------
  norm() { let s = 0; const { re, im } = this; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return s; }
  /** sum_i m_i |psi_i|^2 */
  mass(m) { let s = 0; const { re, im } = this; for (let i = 0; i < re.length; i++) s += m[i] * (re[i] * re[i] + im[i] * im[i]); return s; }
  /** sum_i m_i^2 |psi_i|^2 */
  mass2(m) { let s = 0; const { re, im } = this; for (let i = 0; i < re.length; i++) s += m[i] * m[i] * (re[i] * re[i] + im[i] * im[i]); return s; }
  centroid() {
    const { N, dx, re, im } = this; let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = re[j * N + i] ** 2 + im[j * N + i] ** 2;
      sx += p * (i + 0.5) * dx; sy += p * (j + 0.5) * dx; n += p;
    }
    return n > 0 ? [sx / n, sy / n] : [this.L / 2, this.L / 2];
  }
  /** Fraction of probability with |kx| or |ky| above frac * kmax (aliasing risk). */
  kLeak(frac = 0.6) {
    const { N, re, im, scratchRe: a, scratchIm: b } = this;
    a.set(re); b.set(im);
    this.fft.forward(a, b);
    let tot = 0, out = 0;
    const lim = frac * N / 2;
    for (let j = 0; j < N; j++) {
      const fy = Math.abs(j < N / 2 ? j : j - N);
      for (let i = 0; i < N; i++) {
        const fx = Math.abs(i < N / 2 ? i : i - N);
        const p = a[j * N + i] ** 2 + b[j * N + i] ** 2;
        tot += p; if (fx > lim || fy > lim) out += p;
      }
    }
    return tot > 0 ? out / tot : 0;
  }
  /** |phi(k)|^2 fft-shifted into `out` (kx right, ky down), scaled so that it
   *  sums to norm() (Parseval): the probability density over momentum cells. */
  kDensity(out) {
    const { N, re, im, scratchRe: a, scratchIm: b } = this, n2 = N * N;
    a.set(re); b.set(im);
    this.fft.forward(a, b);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      out[((j + N / 2) % N) * N + ((i + N / 2) % N)] = (a[j * N + i] ** 2 + b[j * N + i] ** 2) / n2;
    }
    return out;
  }
  /** sum_k m_k |phi_k|^2 for a mask on the shifted k grid (see rasterKMask). */
  kMass(m) {
    const { N, re, im, scratchRe: a, scratchIm: b } = this, n2 = N * N;
    a.set(re); b.set(im);
    this.fft.forward(a, b);
    let s = 0;
    for (let j = 0; j < N; j++) {
      const row = ((j + N / 2) % N) * N;
      for (let i = 0; i < N; i++) { const w = m[row + ((i + N / 2) % N)]; if (w) s += w * (a[j * N + i] ** 2 + b[j * N + i] ** 2); }
    }
    return s / n2;
  }
  /** |phi(k)|^2 fft-shifted into `out` (kx right, ky down), scaled to sum 1. */
  momentumDensity(out) {
    const { N, re, im, scratchRe: a, scratchIm: b } = this;
    a.set(re); b.set(im);
    this.fft.forward(a, b);
    let tot = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = a[j * N + i] ** 2 + b[j * N + i] ** 2;
      out[((j + N / 2) % N) * N + ((i + N / 2) % N)] = p; tot += p;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot || 1;
  }

  // ---- operations --------------------------------------------------------
  kick(dkx, dky) {
    const { N, dx, re, im } = this, h = this.L / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ph = dkx * ((i + 0.5) * dx - h) + dky * ((j + 0.5) * dx - h);
      const c = Math.cos(ph), s = Math.sin(ph), k = j * N + i;
      const r = re[k]; re[k] = r * c - im[k] * s; im[k] = r * s + im[k] * c;
    }
  }
  scale(f) { const { re, im } = this; for (let i = 0; i < re.length; i++) { re[i] *= f; im[i] *= f; } }
  /** psi *= m (pointwise, m real) */
  applyMask(m, f = 1) { const { re, im } = this; for (let i = 0; i < re.length; i++) { re[i] *= m[i] * f; im[i] *= m[i] * f; } }
  applyComplement(m, f = 1) {
    const { re, im } = this;
    for (let i = 0; i < re.length; i++) { const w = Math.sqrt(Math.max(0, 1 - m[i] * m[i])) * f; re[i] *= w; im[i] *= w; }
  }
  /** Cell index sampled from the unnormalised density at cumulative position u. */
  sampleCell(u) {
    const { re, im } = this; let acc = 0;
    for (let i = 0; i < re.length; i++) {
      acc += re[i] * re[i] + im[i] * im[i];
      if (acc > u) return i;
    }
    return -1;
  }
  /** Position-measurement back-action: multiply by a Gaussian of density width sigmaM and renormalise to 1. */
  collapseTo(x, y, sigmaM) {
    const { N, dx, re, im } = this;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const g = Math.exp(-(((i + 0.5) * dx - x) ** 2 + ((j + 0.5) * dx - y) ** 2) / (4 * sigmaM * sigmaM));
      re[j * N + i] *= g; im[j * N + i] *= g;
    }
    const n = this.norm();
    if (n > 0) this.scale(1 / Math.sqrt(n));
  }
}

function ramp(d, A) { return d >= A ? 0 : ((A - d) / A) ** 2; }

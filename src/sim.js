// 2D time-dependent Schroedinger solver, hbar = m = 1, split-step Fourier with
// Strang splitting (V/2 -> T -> V/2). Exactly unitary except for the complex
// absorbing potential at the edges, whose lost probability is tracked as
// 1 - norm() - caught. Absorbing *elements* (e.g. a bomb) are a second
// imaginary potential Wel whose swallowed probability is accumulated exactly,
// step by step, in `caught`. psi is normalised so that sum |psi_i|^2 = 1.
import { FFT2 } from './fft.js';

const GATE_RAMP_STEPS = 10; // gates fade over this many steps to avoid shocks

export class Sim {
  constructor(N, L, dt, { absorbWidth = 6, absorbStrength = 2, spinor = false } = {}) {
    this.N = N; this.L = L; this.dx = L / N; this.dt = dt;
    const n2 = N * N;
    this.re = new Float64Array(n2); this.im = new Float64Array(n2);
    this.spinor = !!spinor;
    this.re2 = spinor ? new Float64Array(n2) : null; this.im2 = spinor ? new Float64Array(n2) : null;
    this.spinH = null;                   // per-cell spin Hamiltonian h0 + h.sigma (complex), see addSpin
    this.spinCells = null;               // sparse half-step propagator {idx, m}, built by _refresh
    this.Vstat = new Float64Array(n2);   // always-on potential
    this.Vdraw = new Float64Array(n2);   // statics + gates (no tilt), for display
    this.W = new Float64Array(n2);       // absorbing boundary (imaginary part)
    this.Wel = new Float64Array(n2);     // absorbing elements (imaginary part)
    this.fEl = new Float64Array(n2);     // per half-step fraction of |psi|^2 swallowed by elements
    this.hasWel = false;
    this.caught = 0;                     // probability absorbed by elements so far
    this.gates = [];                     // {V, W, level, target, ramp}
    this.Wshow = null;                   // element + gate absorption, for display
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
  addContour(V) {
    if (!this.Vcont) { this.Vcont = new Float64Array(V.length); this.Vcont0 = new Float64Array(V.length); }
    for (let i = 0; i < V.length; i++) this.Vcont0[i] += V[i];
    this.dirty = true;
  }
  addAbsorber(W) { for (let i = 0; i < W.length; i++) this.Wel[i] += W[i]; this.hasWel = true; this.dirty = true; }
  /** A switchable element: potential V and/or absorption W (an absorbing
   *  shutter, whose swallowed probability counts as lost, not as `caught`). */
  addGate(V, open, ramp = GATE_RAMP_STEPS, W = null, contour = false, spin = null) {
    if (spin) spin = this._spinArrays(spin.chi, spin.term);
    this.gates.push({ V, W, contour, spin, level: open ? 0 : 1, target: open ? 0 : 1, ramp: Math.max(1, ramp) });
    if (spin && !this.spinH) this.spinH = Array.from({ length: 8 }, () => new Float64Array(this.N * this.N));
    if (contour) this.addContour(new Float64Array(this.N * this.N));
    if (W && !this.Wshow) this.Wshow = new Float64Array(this.N * this.N);
    this.dirty = true;
    return this.gates.length - 1;
  }
  setGate(i, open) { this.gates[i].target = open ? 0 : 1; }
  setTilt(fx, fy) { this.tilt = [fx, fy]; this.dirty = true; }

  /** Gaussian packet. In spinor mode `pol` is the Jones vector [aH, aV] (each
   *  a real number or [re, im]); default horizontal. */
  setGaussian({ x, y, kx, ky, sigma, pol = [1, 0] }, add = false) {
    const { N, dx, re, im } = this;
    if (!add) for (const [r, m] of this.comps()) { r.fill(0); m.fill(0); }
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
    const J = this.spinor ? pol.map(c => (Array.isArray(c) ? c : [c, 0])) : [[1, 0]];
    const jn = Math.sqrt(J.reduce((a, [p, q]) => a + p * p + q * q, 0));
    this.comps().forEach(([cr, ci], c) => {
      const ar = J[c][0] / jn / Math.sqrt(norm), ai = J[c][1] / jn / Math.sqrt(norm);
      for (let i = 0; i < cr.length; i++) { cr[i] += ar * tmpRe[i] - ai * tmpIm[i]; ci[i] += ar * tmpIm[i] + ai * tmpRe[i]; }
    });
  }

  /** The wave function's components as [re, im] pairs: one, or two in spinor mode. */
  comps() { return this.re2 ? [[this.re, this.im], [this.re2, this.im2]] : [[this.re, this.im]]; }

  /** Add chi(x) * (h0 + h.sigma) to the spin Hamiltonian. `term` = {h0, hx, hy, hz},
   *  each a complex number [re, im] (missing = 0); chi is a smooth [0,1] mask. */
  addSpin(chi, term) {
    const A = this._spinArrays(chi, term);
    if (!this.spinH) { this.spinH = A; } else A.forEach((a, c) => { const H = this.spinH[c]; for (let i = 0; i < a.length; i++) H[i] += a[i]; });
    this.dirty = true;
  }
  _spinArrays(chi, term) {
    if (!this.spinor) throw new Error('optical elements need a spinor Sim (level "spinor": true)');
    const n2 = this.N * this.N, A = Array.from({ length: 8 }, () => new Float64Array(n2));
    ['h0', 'hx', 'hy', 'hz'].forEach((k, c) => {
      const [tr, ti] = term[k] || [0, 0];
      if (tr || ti) for (let i = 0; i < n2; i++) if (chi[i]) { A[2 * c][i] = chi[i] * tr; A[2 * c + 1][i] = chi[i] * ti; }
    });
    return A;
  }

  /** Sparse half-step propagator exp(-i a (h0 + h.sigma)), a = dt/2, on the cells
   *  with spin terms: 8 numbers per cell (m00, m01, m10, m11 as re, im). */
  _buildSpin() {
    const n2 = this.N * this.N, a = 0.5 * this.dt, idx = [];
    let H = this.spinH;
    const on = this.gates.filter(g => g.spin && g.level > 0);
    if (on.length) {
      H = H.map(h => h.slice());
      for (const g of on) g.spin.forEach((A, c) => { for (let i = 0; i < n2; i++) if (A[i]) H[c][i] += g.level * A[i]; });
    }
    for (let i = 0; i < n2; i++) { for (let c = 0; c < 8; c++) if (Math.abs(H[c][i]) > 1e-12) { idx.push(i); break; } }
    const m = new Float64Array(8 * idx.length);
    idx.forEach((i, n) => {
      const M = spinExp(a, H[0][i], H[1][i], H[2][i], H[3][i], H[4][i], H[5][i], H[6][i], H[7][i]);
      m.set(M, 8 * n);
    });
    this.spinCells = { idx: Int32Array.from(idx), m };
  }

  _spinStep(re, im, re2, im2) {
    const { idx, m } = this.spinCells;
    for (let n = 0; n < idx.length; n++) {
      const i = idx[n], o = 8 * n, ar = re[i], ai = im[i], br = re2[i], bi = im2[i];
      re[i] = m[o] * ar - m[o + 1] * ai + m[o + 2] * br - m[o + 3] * bi;
      im[i] = m[o] * ai + m[o + 1] * ar + m[o + 2] * bi + m[o + 3] * br;
      re2[i] = m[o + 4] * ar - m[o + 5] * ai + m[o + 6] * br - m[o + 7] * bi;
      im2[i] = m[o + 4] * ai + m[o + 5] * ar + m[o + 6] * bi + m[o + 7] * br;
    }
  }

  _refresh() {
    let moving = false;
    for (const g of this.gates) {
      if (g.level !== g.target) {
        const d = g.target - g.level, st = 1 / g.ramp;
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
        let v = Vstat[k], wg = 0, vc = this.Vcont ? this.Vcont0[k] : 0;
        for (const g of gates) { if (g.V) { v += g.level * g.V[k]; if (g.contour) vc += g.level * g.V[k]; } if (g.W) wg += g.level * g.W[k]; }
        if (this.Vcont) this.Vcont[k] = vc;
        Vdraw[k] = v;
        if (this.Wshow) this.Wshow[k] = Wel[k] + wg;
        v -= tilt[0] * ((i + 0.5) * dx - hx) + tilt[1] * y;
        const a = 0.5 * dt, w = W[k] + Wel[k] + wg, d = Math.exp(-w * a);
        cH[k] = Math.cos(v * a) * d; sH[k] = -Math.sin(v * a) * d;
        fEl[k] = Wel[k] > 0 ? (1 - d * d) * Wel[k] / w : 0;
      }
    }
    if (this.spinH) this._buildSpin();
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

  /** One Strang step of state st = {re, im, re2?, im2?}; returns the probability
   *  caught by absorbing elements. */
  _advance(st) {
    const C = st.re2 ? [[st.re, st.im], [st.re2, st.im2]] : [[st.re, st.im]], spin = this.spinCells && st.re2;
    let caught = 0;
    const half = () => {
      for (const [re, im] of C) { if (this.hasWel) caught += this._elLoss(re, im); this._mul(this.cH, this.sH, re, im); }
      if (spin) this._spinStep(st.re, st.im, st.re2, st.im2);
    };
    half();
    for (const [re, im] of C) {
      this.fft.pass(re, im, false);
      this._mul(this.kc, this.ks, re, im);
      this.fft.pass(re, im, true);
    }
    half();
    return caught;
  }

  /** Advance psi by n steps. `others` are extra {re, im, re2?, im2?, caught} states
   *  (measurement branches) stepped in lock-step under the same Hamiltonian, so
   *  gate ramps and tilt stay common to all of them. */
  step(n = 1, others = []) {
    for (let s = 0; s < n; s++) {
      this._refresh();
      this.caught += this._advance(this);
      for (const o of others) o.caught = (o.caught || 0) + this._advance(o);
    }
  }

  /** A copy of the current state {re, im, re2?, im2?, caught}. */
  snapshot() {
    const st = { re: this.re.slice(), im: this.im.slice(), caught: this.caught };
    if (this.re2) { st.re2 = this.re2.slice(); st.im2 = this.im2.slice(); }
    return st;
  }
  /** Overwrite the current state with st's components. */
  load(st) { this.re.set(st.re); this.im.set(st.im); if (this.re2) { this.re2.set(st.re2); this.im2.set(st.im2); } }

  /** Run fn with psi (and its `caught` record) temporarily swapped for state
   *  {re, im, re2?, im2?, caught}, so every observable and operation below can
   *  act on a measurement branch. */
  withState(st, fn) {
    const re = this.re, im = this.im, re2 = this.re2, im2 = this.im2, c = this.caught;
    this.re = st.re; this.im = st.im; this.caught = st.caught || 0;
    if (re2) { this.re2 = st.re2; this.im2 = st.im2; }
    try { return fn(this); } finally { st.caught = this.caught; this.re = re; this.im = im; this.re2 = re2; this.im2 = im2; this.caught = c; }
  }

  /** Kraus bookkeeping for `caught` after a detector outcome with probability p:
   *  an absorbed particle is never in the detector, so it belongs to the "no" branch. */
  conditionCaught(yes, p) { this.caught = yes ? 0 : this.caught / (1 - p); }

  // ---- observables -------------------------------------------------------
  norm() { let s = 0; for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return s; }
  /** |psi|^2 summed over components, into `out`. */
  density(out = new Float64Array(this.N * this.N)) {
    out.fill(0);
    for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) out[i] += re[i] * re[i] + im[i] * im[i];
    return out;
  }
  /** sum_i m_i |psi_i|^2 */
  mass(m) { let s = 0; for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) s += m[i] * (re[i] * re[i] + im[i] * im[i]); return s; }
  /** sum_i m_i^2 |psi_i|^2 */
  mass2(m) { let s = 0; for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) s += m[i] * m[i] * (re[i] * re[i] + im[i] * im[i]); return s; }
  /** Stokes parameters summed over the grid, normalised by S0: [S1, S2, S3]
   *  (S1 = H - V, S2 = diagonal - antidiagonal, S3 = circular). Optional mask m. */
  stokes(m = null) {
    if (!this.re2) return [1, 0, 0];
    const { re, im, re2, im2 } = this; let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < re.length; i++) {
      const w = m ? m[i] : 1; if (!w) continue;
      const a = re[i] * re[i] + im[i] * im[i], b = re2[i] * re2[i] + im2[i] * im2[i];
      s0 += w * (a + b); s1 += w * (a - b);
      s2 += 2 * w * (re[i] * re2[i] + im[i] * im2[i]); s3 += 2 * w * (re[i] * im2[i] - im[i] * re2[i]);
    }
    return s0 > 0 ? [s1 / s0, s2 / s0, s3 / s0] : [0, 0, 0];
  }
  /** sum_i m_i |<pol|psi_i>|^2: the probability in mask m that passes an analyzer at pol (deg). */
  polMass(m, pol) {
    if (!this.re2) return this.mass(m);
    const a = (pol * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), { re, im, re2, im2 } = this;
    let t = 0;
    for (let i = 0; i < re.length; i++) if (m[i]) { const r = c * re[i] + s * re2[i], q = c * im[i] + s * im2[i]; t += m[i] * (r * r + q * q); }
    return t;
  }
  /** |<pol|psi_i>|^2 / |psi_i|^2 in one cell. */
  polFraction(i, pol) {
    if (!this.re2) return 1;
    const a = (pol * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), { re, im, re2, im2 } = this;
    const r = c * re[i] + s * re2[i], q = c * im[i] + s * im2[i], n = re[i] ** 2 + im[i] ** 2 + re2[i] ** 2 + im2[i] ** 2;
    return n > 0 ? (r * r + q * q) / n : 0;
  }
  centroid() {
    const { N, dx } = this, p = this.density(this.scratchRe); let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const q = p[j * N + i];
      sx += q * (i + 0.5) * dx; sy += q * (j + 0.5) * dx; n += q;
    }
    return n > 0 ? [sx / n, sy / n] : [this.L / 2, this.L / 2];
  }
  /** Momentum-space |phi|^2 (unnormalised, normal fft layout [ky][kx]) summed over components, into `out`. */
  _kPower(out) {
    const { scratchRe: a, scratchIm: b } = this;
    out.fill(0);
    for (const [re, im] of this.comps()) {
      a.set(re); b.set(im); this.fft.forward(a, b);
      for (let i = 0; i < out.length; i++) out[i] += a[i] * a[i] + b[i] * b[i];
    }
    return out;
  }
  get _kbuf() { return this.__kbuf || (this.__kbuf = new Float64Array(this.N * this.N)); }
  /** Readouts for the HUD: position and momentum spreads along x, and <E> = <k^2>/2 + <V>. */
  stats() {
    const { N, dx, Vdraw } = this, dk = (2 * Math.PI) / this.L;
    const rho = this.density(this.scratchRe);
    let n = 0, mx = 0, mxx = 0, ev = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, p = rho[k], x = (i + 0.5) * dx;
      n += p; mx += p * x; mxx += p * x * x; ev += p * Vdraw[k];
    }
    const P = this._kPower(this._kbuf);
    let m = 0, kx = 0, kxx = 0, k2 = 0;
    for (let j = 0; j < N; j++) {
      const ky = (j < N / 2 ? j : j - N) * dk;
      for (let i = 0; i < N; i++) {
        const kk = (i < N / 2 ? i : i - N) * dk, p = P[j * N + i];
        m += p; kx += p * kk; kxx += p * kk * kk; k2 += p * (kk * kk + ky * ky);
      }
    }
    if (!(n > 0) || !(m > 0)) return null;
    const sx = Math.sqrt(Math.max(0, mxx / n - (mx / n) ** 2)), skx = Math.sqrt(Math.max(0, kxx / m - (kx / m) ** 2));
    return { sx, skx, E: 0.5 * k2 / m + ev / n };
  }
  /** Fraction of probability with |kx| or |ky| above frac * kmax (aliasing risk). */
  kLeak(frac = 0.6) {
    const { N } = this, P = this._kPower(this._kbuf);
    let tot = 0, out = 0;
    const lim = frac * N / 2;
    for (let j = 0; j < N; j++) {
      const fy = Math.abs(j < N / 2 ? j : j - N);
      for (let i = 0; i < N; i++) {
        const fx = Math.abs(i < N / 2 ? i : i - N);
        const p = P[j * N + i];
        tot += p; if (fx > lim || fy > lim) out += p;
      }
    }
    return tot > 0 ? out / tot : 0;
  }
  /** |phi(k)|^2 fft-shifted into `out` (kx right, ky down), scaled so that it
   *  sums to norm() (Parseval): the probability density over momentum cells. */
  kDensity(out) {
    const { N } = this, n2 = N * N, P = this._kPower(this._kbuf);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      out[((j + N / 2) % N) * N + ((i + N / 2) % N)] = P[j * N + i] / n2;
    }
    return out;
  }
  /** sum_k m_k |phi_k|^2 for a mask on the shifted k grid (see rasterKMask). */
  kMass(m) {
    const { N } = this, n2 = N * N, P = this._kPower(this._kbuf);
    let s = 0;
    for (let j = 0; j < N; j++) {
      const row = ((j + N / 2) % N) * N;
      for (let i = 0; i < N; i++) { const w = m[row + ((i + N / 2) % N)]; if (w) s += w * P[j * N + i]; }
    }
    return s / n2;
  }
  /** |phi(k)|^2 fft-shifted into `out` (kx right, ky down), scaled to sum 1. */
  momentumDensity(out) {
    const { N } = this, P = this._kPower(this._kbuf);
    let tot = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = P[j * N + i];
      out[((j + N / 2) % N) * N + ((i + N / 2) % N)] = p; tot += p;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot || 1;
  }

  // ---- operations --------------------------------------------------------
  kick(dkx, dky) {
    const { N, dx } = this, h = this.L / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ph = dkx * ((i + 0.5) * dx - h) + dky * ((j + 0.5) * dx - h);
      const c = Math.cos(ph), s = Math.sin(ph), k = j * N + i;
      for (const [re, im] of this.comps()) { const r = re[k]; re[k] = r * c - im[k] * s; im[k] = r * s + im[k] * c; }
    }
  }
  scale(f) { for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) { re[i] *= f; im[i] *= f; } }
  /** psi *= m (pointwise, m real) */
  applyMask(m, f = 1) { for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) { re[i] *= m[i] * f; im[i] *= m[i] * f; } }
  applyComplement(m, f = 1) {
    for (const [re, im] of this.comps()) for (let i = 0; i < re.length; i++) { const w = Math.sqrt(Math.max(0, 1 - m[i] * m[i])) * f; re[i] *= w; im[i] *= w; }
  }
  /** Cell index sampled from the unnormalised density at cumulative position u. */
  sampleCell(u) {
    const { re, im, re2, im2 } = this; let acc = 0;
    for (let i = 0; i < re.length; i++) {
      acc += re[i] * re[i] + im[i] * im[i];
      if (re2) acc += re2[i] * re2[i] + im2[i] * im2[i];
      if (acc > u) return i;
    }
    return -1;
  }
  /** Position-measurement back-action: multiply by a Gaussian of density width sigmaM and renormalise to 1. */
  collapseTo(x, y, sigmaM) {
    const { N, dx } = this;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const g = Math.exp(-(((i + 0.5) * dx - x) ** 2 + ((j + 0.5) * dx - y) ** 2) / (4 * sigmaM * sigmaM));
      for (const [re, im] of this.comps()) { re[j * N + i] *= g; im[j * N + i] *= g; }
    }
    const n = this.norm();
    if (n > 0) this.scale(1 / Math.sqrt(n));
  }
}

function ramp(d, A) { return d >= A ? 0 : ((A - d) / A) ** 2; }

// complex helpers for spinExp: numbers as [re, im]
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
function csqrt([x, y]) {
  const r = Math.hypot(x, y), u = Math.sqrt((r + Math.abs(x)) / 2);
  if (u === 0) return [0, 0];
  return x >= 0 ? [u, y / (2 * u)] : [Math.abs(y) / (2 * u), Math.sign(y || 1) * u];
}
const ccos = ([x, y]) => [Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y)];
const csin = ([x, y]) => [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y)];
function cdiv(a, b) { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; }

/** exp(-i a (h0 + h.sigma)) for complex h0, hx, hy, hz (given as re, im pairs):
 *  e^{-i a h0} (cos(a q) - i sin(a q)/q h.sigma), q^2 = h.h (no conjugation).
 *  Returns [m00, m01, m10, m11] flattened as re, im. */
export function spinExp(a, h0r, h0i, hxr, hxi, hyr, hyi, hzr, hzi) {
  const hx = [hxr, hxi], hy = [hyr, hyi], hz = [hzr, hzi];
  const q2 = [hx[0] ** 2 - hx[1] ** 2 + hy[0] ** 2 - hy[1] ** 2 + hz[0] ** 2 - hz[1] ** 2, 2 * (hx[0] * hx[1] + hy[0] * hy[1] + hz[0] * hz[1])];
  const q = csqrt(q2), aq = [a * q[0], a * q[1]];
  const C = ccos(aq);
  // S = sin(a q) / q, with the series a (1 - (aq)^2/6) near q = 0
  const S = Math.hypot(aq[0], aq[1]) < 1e-6 ? [a * (1 - (a * a * q2[0]) / 6), -a * a * a * q2[1] / 6] : cdiv(csin(aq), q);
  const mis = [S[1], -S[0]];                       // -i S
  // h.sigma = [[hz, hx - i hy], [hx + i hy, -hz]]
  const p01 = [hx[0] + hy[1], hx[1] - hy[0]], p10 = [hx[0] - hy[1], hx[1] + hy[0]];
  const e = [Math.exp(a * h0i) * Math.cos(a * h0r), -Math.exp(a * h0i) * Math.sin(a * h0r)]; // e^{-i a h0}
  const t = (c) => cmul(e, c);
  const m00 = t([C[0] + cmul(mis, hz)[0], C[1] + cmul(mis, hz)[1]]);
  const m11 = t([C[0] - cmul(mis, hz)[0], C[1] - cmul(mis, hz)[1]]);
  const m01 = t(cmul(mis, p01)), m10 = t(cmul(mis, p10));
  return [m00[0], m00[1], m01[0], m01[1], m10[0], m10[1], m11[0], m11[1]];
}

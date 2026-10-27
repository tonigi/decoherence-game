import test from 'node:test';
import assert from 'node:assert/strict';
import { FFT2 } from '../src/fft.js';
import { Sim } from '../src/sim.js';
import { rasterV, rasterMask, SOFTNESS } from '../src/shapes.js';
import { DT } from '../src/session.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('FFT round trip and Parseval', () => {
  const N = 32, f = new FFT2(N);
  const re = Float64Array.from({ length: N * N }, (_, i) => Math.sin(i * 0.37) + 0.1 * (i % 5));
  const im = Float64Array.from({ length: N * N }, (_, i) => Math.cos(i * 0.11));
  const r0 = re.slice(), i0 = im.slice();
  let e0 = 0; for (let i = 0; i < re.length; i++) e0 += re[i] ** 2 + im[i] ** 2;
  f.forward(re, im);
  let e1 = 0; for (let i = 0; i < re.length; i++) e1 += re[i] ** 2 + im[i] ** 2;
  near(e1 / (N * N), e0, 1e-8 * e0, 'Parseval');
  f.inverse(re, im);
  for (let i = 0; i < re.length; i++) { near(re[i], r0[i], 1e-10, 're'); near(im[i], i0[i], 1e-10, 'im'); }
});

test('FFT matches a direct DFT on a plane wave', () => {
  const N = 16, f = new FFT2(N);
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ph = 2 * Math.PI * (3 * x + 2 * y) / N; re[y * N + x] = Math.cos(ph); im[y * N + x] = Math.sin(ph);
  }
  f.forward(re, im); // e^{+i(3x+2y)} -> peak at [ky=2][kx=3]
  assert.ok(Math.abs(re[2 * N + 3] - N * N) < 1e-8);
});

test('unitary with barrier: norm conserved to machine precision without absorber', () => {
  const sim = new Sim(128, 40, DT, { absorbStrength: 0 });
  sim.addStatic(rasterV(sim, { type: 'rect', x: 20, y: 20, w: 1, h: 40, V: 3.5 }));
  sim.setGaussian({ x: 12, y: 20, kx: 2, ky: 0, sigma: 2 });
  sim.step(400);
  near(sim.norm(), 1, 1e-10, 'norm');
});

test('free spreading matches analytic sigma(t)', () => {
  const sim = new Sim(128, 40, DT), s0 = 1.5, k = 1.5;
  sim.setGaussian({ x: 10, y: 20, kx: k, ky: 0, sigma: s0 });
  const T = 8; sim.step(Math.round(T / DT));
  const [cx, cy] = sim.centroid();
  near(cx, 10 + k * T, 0.02, 'group velocity');
  near(cy, 20, 1e-6, 'no drift in y');
  // measure std in x
  let m = 0, v = 0; const N = sim.N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = sim.re[j * N + i] ** 2 + sim.im[j * N + i] ** 2, x = (i + 0.5) * sim.dx;
    m += p; v += p * (x - cx) ** 2;
  }
  const sig = Math.sqrt(v / m), want = s0 * Math.sqrt(1 + (T / (2 * s0 * s0)) ** 2);
  near(sig, want, 0.01 * want, 'sigma(t)');
});

// Exact 1D transmission through the *rasterised* smooth profile: integrate
// psi'' = 2(V-E) psi with RK4 from a pure transmitted wave, read off incident amplitude.
function transmission1D(profile, x0, x1, k) {
  const E = k * k / 2, h = 0.004;
  let r = 1, i = 0, dr = 0, di = k; // psi = e^{ikx} at x1
  const f = (x) => 2 * (profile(x) - E);
  const acc = (x, y) => f(x) * y;
  let x = x1;
  while (x > x0) {
    const k1r = dr, k1i = di, l1r = acc(x, r), l1i = acc(x, i);
    const m = x - h / 2;
    const k2r = dr - (h / 2) * l1r, k2i = di - (h / 2) * l1i, l2r = acc(m, r - (h / 2) * k1r), l2i = acc(m, i - (h / 2) * k1i);
    const k3r = dr - (h / 2) * l2r, k3i = di - (h / 2) * l2i, l3r = acc(m, r - (h / 2) * k2r), l3i = acc(m, i - (h / 2) * k2i);
    const k4r = dr - h * l3r, k4i = di - h * l3i, l4r = acc(x - h, r - h * k3r), l4i = acc(x - h, i - h * k3i);
    r -= (h / 6) * (k1r + 2 * k2r + 2 * k3r + k4r); i -= (h / 6) * (k1i + 2 * k2i + 2 * k3i + k4i);
    dr -= (h / 6) * (l1r + 2 * l2r + 2 * l3r + l4r); di -= (h / 6) * (l1i + 2 * l2i + 2 * l3i + l4i);
    x -= h;
  }
  // psi = A e^{ikx} + B e^{-ikx};  A = (psi + psi'/(ik)) e^{-ikx} / 2
  const pr = r + di / k, pi = i - dr / k; // psi + psi'/(ik)
  const A2 = (pr * pr + pi * pi) / 4;
  return 1 / A2;
}

test('tunnelling probability agrees with exact 1D transmission through the rasterised barrier', () => {
  const V0 = 3.5, a = 1.0, k0 = 2.0, sigma = 2.5;
  const sim = new Sim(128, 40, DT);
  sim.addStatic(rasterV(sim, { type: 'rect', x: 20, y: 20, w: a, h: 40, V: V0 }));
  const row = rasterV(sim, { type: 'rect', x: 20, y: 20, w: a, h: 40, V: V0 });
  // continuum profile: same tanh edge as the rasteriser
  const prof = (x) => V0 * 0.5 * (1 + Math.tanh((a / 2 - Math.abs(x - 20)) / SOFTNESS));
  assert.ok(Math.abs(prof(sim.dx * (64 + 0.5)) - row[64 * 128 + 64]) < 1e-9);
  sim.setGaussian({ x: 10, y: 20, kx: k0, ky: 0, sigma });
  sim.step(Math.round(9 / DT));
  const right = rasterMask(sim, { shape: 'rect', x: 31, y: 20, w: 20, h: 40 });
  const T = sim.mass(right) + (1 - sim.norm());
  const sk = 1 / (2 * sigma); let num = 0, den = 0;
  for (let k = k0 - 4 * sk; k <= k0 + 4 * sk; k += sk / 8) { const w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += w * transmission1D(prof, 15, 25, k); den += w; }
  const want = num / den;
  near(T, want, 0.03 * want + 0.003, `T=${T.toFixed(4)} exact=${want.toFixed(4)}`);
});

test('absorbing boundary swallows an outgoing packet with little reflection', () => {
  const sim = new Sim(128, 40, DT);
  sim.setGaussian({ x: 25, y: 20, kx: 2.5, ky: 0, sigma: 2 });
  sim.step(Math.round(20 / DT));
  assert.ok(sim.norm() < 5e-3, 'residual norm ' + sim.norm());
});

test('momentum ceiling: leak detector flags near-Nyquist content', () => {
  const sim = new Sim(64, 40, DT);
  sim.setGaussian({ x: 20, y: 20, kx: 2, ky: 0, sigma: 2 });
  assert.ok(sim.kLeak(0.6) < 1e-3);
  sim.setGaussian({ x: 20, y: 20, kx: 0.9 * sim.kmax, ky: 0, sigma: 2 });
  assert.ok(sim.kLeak(0.6) > 0.9);
});

test('rotated rects: 90 degrees swaps w and h; 45-degree splitter conserves probability', () => {
  const sim = new Sim(64, 40, DT);
  const a = rasterMask(sim, { shape: 'rect', x: 20, y: 18, w: 3, h: 9, angle: 90 });
  const b = rasterMask(sim, { shape: 'rect', x: 20, y: 18, w: 9, h: 3 });
  for (let i = 0; i < a.length; i++) near(a[i], b[i], 1e-9, 'mask ' + i);
  const u = new Sim(128, 40, DT, { absorbStrength: 0 });
  u.addStatic(rasterV(u, { type: 'rect', x: 16, y: 14, w: 0.4, h: 13, V: 4.2, angle: -45 }));
  u.setGaussian({ x: 8, y: 14, kx: 3, ky: 0, sigma: 1.5 });
  u.step(100);
  near(u.norm(), 1, 1e-10, 'norm');
});

test('ghost resolution sees the same barrier: tunnelling at 64^2 within 3% of 128^2', () => {
  const T = (N) => {
    const sim = new Sim(N, 40, DT);
    sim.addStatic(rasterV(sim, { type: 'rect', x: 20, y: 20, w: 1, h: 40, V: 3 }));
    sim.setGaussian({ x: 9, y: 20, kx: 2.2, ky: 0, sigma: 2.2 });
    sim.step(Math.round(8 / DT));
    return sim.mass(rasterMask(sim, { shape: 'rect', x: 28, y: 20, w: 14, h: 40 }));
  };
  const hi = T(128), lo = T(64);
  near(lo, hi, 0.03 * hi, 'transmission');
});

test('momentum density obeys Parseval and k-masks sit at the right momentum', async () => {
  const { rasterKMask } = await import('../src/shapes.js');
  const sim = new Sim(64, 40, DT);
  sim.setGaussian({ x: 20, y: 20, kx: 1.5, ky: -0.5, sigma: 3 });
  near(sim.kMass(new Float64Array(64 * 64).fill(1)), sim.norm(), 1e-10, 'Parseval');
  // a Gaussian of width sigma has sigma_k = 1/(2 sigma) per axis: P(|k - k0| < r) = 1 - exp(-r^2 / (2 sigma_k^2))
  const r = 0.4, sk = 1 / 6, want = 1 - Math.exp(-(r * r) / (2 * sk * sk));
  near(sim.kMass(rasterKMask(sim, { shape: 'circle', x: 1.5, y: -0.5, r })), want, 0.03, 'disc around k0');
  assert.ok(sim.kMass(rasterKMask(sim, { shape: 'circle', x: -1.5, y: 0.5, r })) < 1e-6, 'nothing at -k0');
});

test('absorbing elements: norm + caught is conserved exactly', () => {
  const sim = new Sim(64, 40, DT, { absorbStrength: 0 });
  sim.addAbsorber(rasterV(sim, { type: 'rect', x: 24, y: 20, w: 4, h: 6, V: 2 }));
  sim.setGaussian({ x: 14, y: 20, kx: 2, ky: 0, sigma: 2 });
  sim.step(200);
  assert.ok(sim.caught > 0.3, 'caught ' + sim.caught);
  near(sim.norm() + sim.caught, 1, 1e-10, 'probability bookkeeping');
  // branches carry their own record
  const b = { re: sim.re.slice(), im: sim.im.slice(), caught: sim.caught };
  sim.step(20, [b]);
  near(b.caught, sim.caught, 1e-14, 'lock-step branch');
});

test('harmonic well: coherent state keeps its width, others breathe to 1/(2 omega sigma) at T/4', () => {
  const w = 0.5, T = (2 * Math.PI) / w;
  const width = (sim) => {
    const [cx] = sim.centroid(); let m = 0, v = 0; const N = sim.N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const p = sim.re[j * N + i] ** 2 + sim.im[j * N + i] ** 2, x = (i + 0.5) * sim.dx; m += p; v += p * (x - cx) ** 2; }
    return Math.sqrt(v / m);
  };
  const run = (sigma, t) => {
    const sim = new Sim(128, 40, DT, { absorbStrength: 0 });
    sim.addStatic(rasterV(sim, { type: 'harmonic', x: 20, y: 20, omega: w }));
    sim.setGaussian({ x: 23, y: 20, kx: 0, ky: 0, sigma });
    sim.step(Math.round(t / DT));
    return sim;
  };
  const coh = run(1 / Math.sqrt(2 * w), (3 * T) / 8);
  near(width(coh), 1, 0.02, 'coherent width');
  near(coh.centroid()[0], 20 + 3 * Math.cos((3 * Math.PI) / 4), 0.03, 'classical motion');
  near(width(run(2.5, T / 4)), 1 / (2 * w * 2.5), 0.02, 'focused width at T/4');
});

test('HUD stats: a Gaussian saturates Heisenberg and has E = k0^2/2 + 1/(8 sigma^2) per axis', () => {
  const sim = new Sim(128, 40, DT), s0 = 2, k0 = 1.5;
  sim.setGaussian({ x: 20, y: 20, kx: k0, ky: 0, sigma: s0 });
  sim._refresh();
  const st = sim.stats();
  near(st.sx, s0, 1e-3, 'sigma_x'); near(st.skx, 1 / (2 * s0), 1e-3, 'sigma_k');
  near(st.sx * st.skx, 0.5, 1e-3, 'minimum uncertainty');
  near(st.E, 0.5 * k0 * k0 + 2 * (1 / (8 * s0 * s0)), 1e-3, '<E>');
});

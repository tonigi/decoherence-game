import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sim, spinExp } from '../src/sim.js';
import { rasterV } from '../src/shapes.js';
import { opticTerm, jones } from '../src/optics.js';
import { Session, defaultSetup, sanitizeSetup, replay, placeIn, DT } from '../src/session.js';
import { ledger } from '../src/ledger.js';
import { mulberry32 } from '../src/rng.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../levels/${id}.json`, import.meta.url), 'utf8'));
const deg = Math.PI / 180;

/** A polarization test bench: one slab optic across the whole height at x = 20. */
function bench(optic, { w = 2, pol = 0, N = 64, absorbStrength = 2 } = {}) {
  const sim = new Sim(N, 40, DT, { spinor: true, absorbStrength });
  if (optic) sim.addSpin(rasterV(sim, { type: 'rect', x: 20, y: 20, w, h: 40, V: 1 }), opticTerm(optic));
  sim.setGaussian({ x: 12, y: 20, kx: 2.5, ky: 0, sigma: 2, pol: jones(pol) });
  return sim;
}
/** Mask of x > cut (right) or x < cut. */
const side = (sim, right, cut = 20) => {
  const m = new Float64Array(sim.N * sim.N);
  for (let j = 0; j < sim.N; j++) for (let i = 0; i < sim.N; i++) { const x = (i + 0.5) * sim.dx; m[j * sim.N + i] = (right ? x > cut : x < cut) ? 1 : 0; }
  return m;
};

test('spin propagator: exact 2x2 exponential of a complex h0 + h.sigma', () => {
  const C = (r, i) => [r, i], mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mm = (A, B) => [0, 1, 2, 3].map(k => { const i = k >> 1, j = k & 1; return add(mul(A[2 * i], B[j]), mul(A[2 * i + 1], B[2 + j])); });
  const rng = mulberry32(7);
  for (let t = 0; t < 50; t++) {
    const h = Array.from({ length: 8 }, () => 4 * rng() - 2), a = 0.5 * rng();
    const [h0r, h0i, hxr, hxi, hyr, hyi, hzr, hzi] = h;
    const H = [add(C(h0r, h0i), C(hzr, hzi)), add(C(hxr, hxi), mul(C(0, -1), C(hyr, hyi))), add(C(hxr, hxi), mul(C(0, 1), C(hyr, hyi))), add(C(h0r, h0i), C(-hzr, -hzi))];
    const X = H.map(z => mul(C(0, -a), z));
    let term = [C(1, 0), C(0, 0), C(0, 0), C(1, 0)], S = term;
    for (let n = 1; n < 40; n++) { term = mm(term, X).map(z => [z[0] / n, z[1] / n]); S = S.map((z, i) => add(z, term[i])); }
    const M = spinExp(a, ...h);
    for (let i = 0; i < 4; i++) { near(M[2 * i], S[i][0], 1e-12, 're'); near(M[2 * i + 1], S[i][1], 1e-12, 'im'); }
  }
  // q = 0 with h != 0 (nilpotent h.sigma): exp = 1 - i a h.sigma
  const M = spinExp(0.3, 0, 0, 1, 0, 0, 1, 0, 0);
  assert.deepEqual(M.map(v => +v.toFixed(12)), [1, 0, 0, -0.6, 0, 0, 1, 0]);
});

test('spinor optics without absorption are unitary; a uniform rotator precesses exactly', () => {
  const sim = new Sim(64, 40, DT, { spinor: true, absorbStrength: 0 });
  const slab = (x) => rasterV(sim, { type: 'rect', x, y: 20, w: 3, h: 40, V: 1 });
  sim.addSpin(slab(14), opticTerm({ kind: 'rotator', omega: 0.7 }));
  sim.addSpin(slab(20), opticTerm({ kind: 'retarder', angle: 30, delta: 2 }));
  sim.addSpin(slab(26), opticTerm({ kind: 'polarizer', angle: 20, V: 4, absorb: 0 }));   // reflecting (PBS-like)
  sim.setGaussian({ x: 10, y: 20, kx: 2.5, ky: 0, sigma: 2, pol: jones(10, 0.3) });
  near(sim.norm(), 1, 1e-12, 'initial');
  sim.step(300);
  near(sim.norm(), 1, 1e-10, 'norm after optics');
  // whole-grid rotator: S1 = cos(2 omega t) for an H packet
  const u = new Sim(64, 40, DT, { spinor: true, absorbStrength: 0 });
  u.addSpin(new Float64Array(64 * 64).fill(1), opticTerm({ kind: 'rotator', omega: 0.3 }));
  u.setGaussian({ x: 20, y: 20, kx: 1, ky: 0, sigma: 2 });
  u.step(100);
  near(u.stokes()[0], Math.cos(2 * 0.3 * 100 * DT), 1e-9, 'S1(t)');
});

test("Malus's law: an absorbing polarizer passes cos^2 and leaves its own axis", () => {
  const T = (th) => { const s = bench({ kind: 'polarizer', angle: th }); s.step(100); const R = side(s, true, 22); return [s.mass(R), s.stokes(R)]; };
  const [T0] = T(0);
  for (const th of [30, 45, 60]) {
    const [t, st] = T(th);
    near(t / T0, Math.cos(th * deg) ** 2, 0.01, `T(${th})`);
    near(Math.atan2(st[1], st[0]) / 2 / deg, th, 1.5, `outgoing axis ${th}`);
  }
  assert.ok(T(90)[0] < 1e-3, 'crossed polarizer blocks');
});

test('reflecting polarizer: the crossed component is reflected, the parallel one passes', () => {
  const s = bench({ kind: 'polarizer', angle: 0, V: 12, absorb: 0 }, { pol: 45, absorbStrength: 0 });
  s.step(140);   // both packets clear of the slab (and of x = 20) by t = 7
  near(s.norm(), 1, 1e-10, 'lossless');
  const R = side(s, true), L = side(s, false);
  near(s.mass(R), 0.5, 0.03, 'transmitted half'); near(s.mass(L), 0.5, 0.03, 'reflected half');
  assert.ok(s.stokes(R)[0] > 0.97 && s.stokes(L)[0] < -0.97, 'transmitted H, reflected V');
});

test('Zeno corridor (6-2): N equally spaced polarizers pass cos^{2(N+1)}(pi / 2(N+1))', () => {
  const lv = load('6-2');
  const run = (xs) => {
    const s = new Session(lv, sanitizeSetup(lv, { placed: xs.map(x => ({ id: 'pol', x, y: 20 })) }), { N: 64 });
    let best = 0; while (s.t < lv.tmax) { s.step(2); best = Math.max(best, s.pT()); } return best;
  };
  const free = { ...lv, elements: [] }, s0 = new Session(free, defaultSetup(free), { N: 64 });
  let ref = 0; while (s0.t < lv.tmax) { s0.step(2); ref = Math.max(ref, s0.pT()); }
  assert.ok(run([]) / ref < 0.03, 'no polarizers: the rotator turns it vertical and the exit blocks it');
  for (const n of [1, 2, 3]) {
    const xs = Array.from({ length: n }, (_, i) => 11 + (16 * (i + 1)) / (n + 1));
    near(run(xs) / ref, Math.cos(Math.PI / 2 / (n + 1)) ** (2 * (n + 1)), 0.03, `N=${n}`);
  }
  assert.ok(run([13, 15, 17]) < 0.7 * run([15, 19, 23]), 'equal spacing is the optimum');
});

test('polarized targets: P_T counts |<pol|psi>|^2, and P(hit) = P_T exactly', () => {
  const lv = { id: 't', spinor: true, grid: { N: 64, L: 40 }, tmax: 10, launch: { x: 16, y: 20, k: 0, angle: 0, sigma: 2, pol: 30 },
    targets: [{ shape: 'circle', x: 18, y: 20, r: 3, pol: 0 }], stars: [0.1, 0.2, 0.3] };
  const s = new Session(lv, defaultSetup(lv), { N: 64 });
  const plain = new Session({ ...lv, targets: [{ shape: 'circle', x: 18, y: 20, r: 3 }] }, defaultSetup(lv), { N: 64 });
  near(s.pT(), plain.pT() * Math.cos(30 * deg) ** 2, 1e-12, 'analyzer');
  const pT = s.pT(), snap = s.sim.snapshot(), M = 3000; let hit = 0;
  for (let seed = 1; seed <= M; seed++) {
    s.sim.load(snap); s.result = null; s.rng = mulberry32(seed);
    if (s.observe().outcome === 'hit') hit++;
  }
  near(hit / M, pT, 4 * Math.sqrt(pT * (1 - pT) / M) + 1e-3, 'hit frequency');
});

test('switchable optics replay exactly; spinor branches go through the ledger', () => {
  const lv = { id: 'g', spinor: true, grid: { N: 64, L: 40 }, tmax: 12, launch: { x: 10, y: 20, k: 2.5, angle: 0, sigma: 2, pol: 45 },
    elements: [{ type: 'rect', x: 20, y: 20, w: 2, h: 40, optic: { kind: 'polarizer', angle: 0 }, gate: { open: true, label: 'Polarizer' } },
      { type: 'rect', x: 15, y: 20, w: 4, h: 40, optic: { kind: 'rotator', omega: 0.6 } }],
    detectors: [{ shape: 'rect', x: 26, y: 20, w: 6, h: 10, shots: 9 }],
    targets: [{ shape: 'circle', x: 28, y: 20, r: 3, pol: 0 }], stars: [0.1, 0.2, 0.3] };
  // the gate inserts the polarizer: closed it removes the crossed half
  const open = new Session(lv, defaultSetup(lv), { N: 64 }), shut = new Session(lv, defaultSetup(lv), { N: 64 });
  shut.toggleGate(0); open.step(120); shut.step(120);
  assert.ok(shut.alive() < 0.75 * open.alive(), `closed polarizer absorbs: ${shut.alive()} vs ${open.alive()}`);
  // record a run with gate toggles and detector firings, then replay it bit for bit
  const s = new Session(lv, defaultSetup(lv), { N: 64, seed: 5 });
  s.step(20); s.toggleGate(0); s.step(40); s.toggleGate(0);
  for (let k = 0; k < 6; k++) { s.step(10); s.fireDetector(0); }
  s.step(10); s.observe();
  const r = replay(lv, s.solution(), { N: 64 });
  assert.equal(r.result.pT, s.result.pT); assert.equal(r.result.outcome, s.result.outcome);
  // the ledger follows both spinor components: compression matches the exact tree
  const exact = ledger(lv, s.solution(), { maxBranches: 1e6 });
  near(exact.branches.reduce((a, b) => a + b.w, 0), exact.alive > 0 ? 1 : 0, 1e-9, 'weights');
  const L = ledger(lv, s.solution(), { maxBranches: 4 });
  assert.ok(L.resampled);
  assert.ok(Math.abs(L.score - exact.score) <= L.dropped + 1e-6, `${L.score} vs ${exact.score}, dropped ${L.dropped}`);
  // the branch states carry both components
  assert.ok(L.branches[0].state.re2 && L.branches[0].state.re2.length === 64 * 64);
});

test('Stern-Gerlach: the magnet splits along its axis with Born weights cos^2, up and down', () => {
  const lv = load('6-4'), N = 64;
  const split = (axis) => {
    const s = new Session(lv, sanitizeSetup(lv, { placed: [{ id: 'mag', x: 15, y: 20, pol: axis, gradient: 0.35 }] }), { N });
    s.step(180);
    const up = new Float64Array(N * N); for (let j = 0; j < N / 2; j++) for (let i = 0; i < N; i++) up[j * N + i] = 1;
    // the upper beam carries the axis polarization, the lower one the crossed polarization
    const lo = up.map(v => 1 - v), su = s.sim.stokes(up), sl = s.sim.stokes(lo);
    return { pUp: s.sim.mass(up) / s.sim.norm(), angUp: Math.atan2(su[1], su[0]) / 2 / deg, angLo: Math.atan2(sl[1], sl[0]) / 2 / deg };
  };
  for (const axis of [0, 30, 60]) {
    const r = split(axis);
    near(r.pUp, Math.cos((60 - axis) * deg) ** 2, 0.03, `P(up), axis ${axis}`);   // the upper beam's tail still reaches y = 20
    if (axis !== 60) {
      near(r.angUp, axis, 3, 'upper beam polarized along the axis');
      near((((r.angLo - axis) % 180) + 180) % 180, 90, 3, 'lower beam crossed');
    }
  }
});

test('bomb optics: what a polarization-selective bomb absorbs is caught, exactly, and per look it is sin^2', () => {
  const sim = new Sim(64, 40, DT, { spinor: true, absorbStrength: 0 });
  sim.addSpin(rasterV(sim, { type: 'rect', x: 20, y: 20, w: 1, h: 40, V: 1 }), opticTerm({ kind: 'polarizer', angle: 0 }), { bomb: true });
  sim.setGaussian({ x: 12, y: 20, kx: 2.5, ky: 0, sigma: 2, pol: jones(30) });
  sim.step(140);
  near(sim.norm() + sim.caught, 1, 1e-10, 'norm + caught');
  near(sim.caught, Math.sin(30 * deg) ** 2, 0.01, 'booms = sin^2 30');
  // in a session it is a mine and an observation's "boom" branch; 6-5's stations add sin^2 per look
  const lv = load('6-5'), one = new Session(lv, sanitizeSetup(lv, { placed: [{ id: 'st', x: 19.2, y: 20 }] }), { N: 64 });
  one.step(220);
  near(one.pM(), Math.sin(Math.PI / 4) ** 2, 0.03, 'one look after two plates: sin^2(pi/4)');
  near(one.alive() + one.sim.caught + one.lost(), 1, 1e-12, 'bookkeeping');
});

test('bomb tester (6-5): one station per cycle, and placement zones keep stations out of the plates', () => {
  const lv = load('6-5'), score = (xs) => {
    const s = new Session(lv, sanitizeSetup(lv, { placed: xs.map(x => ({ id: 'st', x, y: 20 })) }), { N: 64 });
    let b = 0; while (s.t < lv.tmax) { s.step(2); b = Math.max(b, s.pT()); } return b;
  };
  const none = score([]), perGap = score([13.6, 19.2, 24.8]), doubled = score([13.6, 18.4, 20]);
  assert.ok(none < 0.01, 'no stations: the photon arrives vertical');
  assert.ok(perGap > 1.25 * doubled, `one per gap ${perGap} beats doubling up ${doubled}`);
  // zones: an item dropped on a plate snaps into the nearest gap
  const zones = lv.inventory.items[0].area;
  assert.deepEqual(placeIn(zones, 16.4, 20), { x: 14.6, y: 20 });
  assert.deepEqual(placeIn(zones, 17, 25), { x: 18.2, y: 20 });
  assert.equal(sanitizeSetup(lv, { placed: [{ id: 'st', x: 22, y: 3 }] }).placed[0].x, 20.2);
});

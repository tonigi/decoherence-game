// Mechanics added for the textbook levels: state (fidelity) targets, pulse gates,
// the lattice element, anisotropic launches and two-particle exchange symmetry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session, defaultSetup, replay } from '../src/session.js';
import { Sim } from '../src/sim.js';
import { rasterV } from '../src/shapes.js';
import { mulberry32 } from '../src/rng.js';

const load = (id) => JSON.parse(fs.readFileSync(new URL(`../levels/${id}.json`, import.meta.url), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('state target: P_T is the fidelity with a coherent state, and P(hit) = P_T exactly', () => {
  const lv = load('4-4');
  const s = new Session(lv, defaultSetup(lv), { N: 64 });
  // a displaced coherent state: F = exp(-omega d^2 / 2) with d = 12, omega = 0.4 (tiny); at the target itself F = 1
  near(s.pT(), Math.exp(-0.4 * 144 / 2), 1e-9, 'displaced fidelity');
  const sim = s.sim, phi = sim.gaussianMode({ x: 26, y: 20, sigma: 1.118 });
  sim.re.set(phi.re); sim.im.set(phi.im);
  near(s.pT(), 1, 1e-12, 'fidelity of the target state');
  // a switch a little early leaves a partial fidelity: Born frequencies of the projective measurement
  const s2 = new Session(lv, defaultSetup(lv), { N: 64 });
  s2.toggleGate(0); s2.toggleGate(1); s2.step(140); s2.toggleGate(1); s2.toggleGate(2); s2.step(40);
  const pT = s2.pT(), re = s2.sim.re.slice(), im = s2.sim.im.slice();
  assert.ok(pT > 0.1 && pT < 0.9, 'a partial fidelity to test: ' + pT);
  const M = 2000; let hit = 0;
  for (let seed = 1; seed <= M; seed++) {
    sim.re.set(re); sim.im.set(im); s.result = null; s.rng = mulberry32(seed);
    if (s.observe().outcome === 'hit') hit++;
  }
  near(hit / M, pT, 4 * Math.sqrt(pT * (1 - pT) / M) + 1e-3, 'hit frequency');
  // a hit (u = 0 < F) collapses onto the target state
  sim.re.set(re); sim.im.set(im); s.result = null; s.rng = () => 0;
  assert.equal(s.observe().outcome, 'hit');
  near(s.pT(), 1, 1e-9, 'collapsed onto the target');
});

test('bang-bang transport: half a period in the midpoint trap parks the packet in B', () => {
  const lv = load('4-4'), s = new Session(lv, defaultSetup(lv), { N: 64 });
  s.toggleGate(0); s.toggleGate(1); s.step(157); s.toggleGate(1); s.toggleGate(2); s.step(40);
  const f = s.pT(); s.step(60);
  assert.ok(f > 0.9, 'fidelity after the switch ' + f);
  near(s.pT(), f, 2e-3, 'B0 is stationary in B, so the fidelity stays put');
});

test('pulse gates close for a fixed number of steps, start closed if asked, and replay exactly', () => {
  const lv = load('7-2'), s = new Session(lv, defaultSetup(lv), { N: 64, seed: 5 });
  s.step(20); s.toggleGate(0);
  assert.equal(s.gates[0].open, false);
  s.step(3); assert.equal(s.sim.gates[0].target, 1, 'still on mid-pulse');
  s.step(10); assert.equal(s.gates[0].open, true, 'reopened by itself');
  s.step(180 - s.stepCount); s.observe();
  const again = replay(lv, s.solution(), { N: 64 });
  assert.equal(again.result.pT, s.result.pT);
  // 6-6: the first gradient pulse fires by itself at t = 0
  const h = load('6-6'), hs = new Session(h, defaultSetup(h), { N: 64 });
  assert.equal(hs.sim.gates[0].target, 1);
  hs.step(45); assert.equal(hs.sim.gates[0].target, 0);
  assert.equal(hs.gates[0].open, true);
});

test('lattice element: V sin^2(pi u / a), minima at the centre, soft window', () => {
  const sim = new Sim(128, 40, 0.05);
  const V = rasterV(sim, { type: 'lattice', x: 20, y: 20, V: 2, period: 4 });
  const at = (x, y) => V[Math.floor(y / sim.dx) * 128 + Math.floor(x / sim.dx)];
  for (const i of [0, 37, 64, 70, 127]) near(V[5 * 128 + i], 2 * Math.sin((Math.PI * ((i + 0.5) * sim.dx - 20)) / 4) ** 2, 1e-12, 'profile at cell ' + i);
  assert.ok(at(20.1, 20.1) < 0.04 && at(22.1, 7) > 1.96, 'minimum at the centre, maximum half a period away');
  const W = rasterV(sim, { type: 'lattice', x: 20, y: 20, w: 8, h: 8, V: 2, period: 4 });
  assert.equal(Math.max(...W.slice(0, 128 * 20)), 0, 'nothing outside the window');
});

test('Kapitza-Dirac: a thin flash fills the orders with J_n(phi)^2', () => {
  const lv = load('7-1'), s = new Session(lv, defaultSetup(lv), { N: 64 });
  s.toggleGate(0); s.step(20); s.toggleGate(0); s.step(2);
  // phi = V tau / 2 = 2 * 1.0 / 2 = 1; 2 J1(1)^2 = 0.3874, J0(1)^2 = 0.5855 (the recoil shifts them slightly)
  near(s.pT(), 0.387, 0.03, 'first orders');
  near(s.pM(), 0.586, 0.03, 'zeroth order');
});

test('anisotropic launch: sigma along the motion, sigmaT across it', () => {
  const lv = { id: 't', grid: { N: 128, L: 40 }, tmax: 5, launch: { x: 20, y: 20, k: 1, angle: 90, sigma: 1, sigmaT: 3 }, targets: [{ shape: 'circle', x: 20, y: 20, r: 1 }] };
  const sim = new Session(lv, defaultSetup(lv), { N: 128 }).sim;
  let sx = 0, sy = 0;
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const p = sim.re[j * 128 + i] ** 2 + sim.im[j * 128 + i] ** 2, x = (i + 0.5) * sim.dx - 20, y = (j + 0.5) * sim.dx - 20;
    sx += p * x * x; sy += p * y * y;
  }
  near(Math.sqrt(sy), 1, 1e-3, 'width along the motion (y)');
  near(Math.sqrt(sx), 3, 1e-3, 'width across it (x)');
});

test('exchange symmetry: bosons symmetric, fermions antisymmetric and empty on the diagonal, kept by the evolution', () => {
  for (const [kind, sign] of [['bosons', 1], ['fermions', -1]]) {
    const lv = { ...load('8-1'), particles: kind }, s = new Session(lv, defaultSetup(lv), { N: 64 }), sim = s.sim, N = 64;
    near(s.alive(), 1, 1e-12, kind + ' normalised');
    s.step(60);
    let asym = 0, diag = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      asym = Math.max(asym, Math.abs(sim.re[j * N + i] - sign * sim.re[i * N + j]), Math.abs(sim.im[j * N + i] - sign * sim.im[i * N + j]));
      if (i === j) diag += sim.re[j * N + i] ** 2 + sim.im[j * N + i] ** 2;
    }
    assert.ok(asym < 1e-9, kind + ' exchange symmetry after evolution ' + asym);
    if (sign < 0) assert.ok(diag < 1e-12, 'Pauli: no two fermions at the same place');
  }
});

test('Hong-Ou-Mandel: at a 50/50 wall bosons leave together, distinguishable particles half the time', () => {
  const run = (particles) => {
    const lv = { ...load('8-1'), particles }, setup = defaultSetup(lv); setup.launch.k = 2.55;
    const s = new Session(lv, setup, { N: 64 }); s.step(200); return s.pT();
  };
  const b = run('bosons'), d = run('distinguishable');
  assert.ok(b > 0.85, 'bosons bunch ' + b);
  near(d, 0.5, 0.05, 'distinguishable: T^2 + R^2 at T = 1/2');
});

test('periodic boundaries: what leaves one side comes back on the other', () => {
  const lv = { id: 't', grid: { N: 64, L: 40 }, tmax: 30, boundary: { x: 'periodic', y: 'absorb' }, launch: { x: 30, y: 20, k: 2, angle: 0, sigma: 2 }, targets: [{ shape: 'circle', x: 10, y: 20, r: 3 }] };
  const s = new Session(lv, defaultSetup(lv), { N: 64 });
  s.step(200); // 10 time units at speed 2: 20 units, through the right edge to x = 10
  near(s.alive(), 1, 1e-5, 'nothing absorbed along the periodic axis (only the far tail in y)');
  assert.ok(s.pT() > 0.3, 'the packet wrapped round onto the target ' + s.pT());
  // absorbing along y still absorbs
  const lvUp = { ...lv, launch: { ...lv.launch, angle: 90 } }, up = new Session(lvUp, defaultSetup(lvUp), { N: 64 });
  up.step(400); assert.ok(up.alive() < 0.05, 'absorbed at the y edge');
  // the default stays absorbing on both axes
  const ab = new Session({ ...lv, boundary: undefined }, defaultSetup(lv), { N: 64 });
  ab.step(400); assert.ok(ab.alive() < 0.05, 'absorbed at the x edge by default');
});

test('periodic axes: kicks come in whole quanta 2 pi / L, lattices fit the box', () => {
  const lv = { id: 't', grid: { N: 64, L: 40 }, tmax: 10, boundary: 'periodic', launch: { x: 20, y: 20, k: 0, angle: 0, sigma: 2 }, inventory: { kick: { charges: 1, dk: 1 } }, targets: [{ shape: 'circle', x: 10, y: 20, r: 3 }] };
  const s = new Session(lv, defaultSetup(lv), { N: 64 });
  s.kick(1, 0);
  const q = (2 * Math.PI) / 40;
  near(s.events[0].dk[0], 6 * q, 1e-12, 'dk = 1 rounds to 6 quanta');
  assert.throws(() => new Session({ ...lv, observe: 'momentum', field: [0.1, 0] }, defaultSetup(lv), { N: 64 }), /momentum/);
  // every level with a periodic axis: full-length lattices along it must fit a whole number of periods
  const index = JSON.parse(fs.readFileSync(new URL('../levels/index.json', import.meta.url), 'utf8'));
  for (const id of index.levels) {
    const l = load(id); if (!l.boundary) continue;
    const per = new Session(l, defaultSetup(l), { N: 64 }).periodic;
    for (const el of l.elements || []) if (el.type === 'lattice' && el.w === undefined && per[(el.angle || 0) % 180 ? 1 : 0]) {
      const n = l.grid.L / el.period; near(n, Math.round(n), 1e-9, id + ' lattice periods around the box');
    }
  }
});

const centroidX = (sim) => {
  let m = 0, n = 0;
  for (let j = 0; j < sim.N; j++) for (let i = 0; i < sim.N; i++) { const p = sim.re[j * sim.N + i] ** 2 + sim.im[j * sim.N + i] ** 2; m += p * (i + 0.5) * sim.dx; n += p; }
  return m / n;
};

test('a force along a periodic axis is a growing flux: x = x0 + F t^2 / 2, the same as a tilt on an open axis', () => {
  const base = { id: 't', grid: { N: 64, L: 40 }, tmax: 10, field: [0.2, 0], launch: { x: 16, y: 20, k: 0, angle: 0, sigma: 2 }, targets: [{ shape: 'circle', x: 10, y: 20, r: 3 }] };
  const ring = new Session({ ...base, boundary: { x: 'periodic', y: 'absorb' } }, defaultSetup(base), { N: 64 });
  const open = new Session(base, defaultSetup(base), { N: 64 });
  ring.step(100); open.step(100);
  near(centroidX(ring.sim), 16 + 0.5 * 0.2 * 25, 0.02, 'ring: uniformly accelerated');
  near(centroidX(ring.sim), centroidX(open.sim), 0.02, 'ring and tilted open box agree');
  near(ring.sim.gauge[0], 0.2 * 5, 1e-12, 'the gauge is F t');
  near(ring.alive(), 1, 1e-6, 'unitary');
});

test('flux on a ring: the launch speed is the same for every flux, only the phase per lap changes (loop mirror)', () => {
  const lv = load('9-1'), at = (flux) => { const st = defaultSetup(lv); st.launch.flux = flux; return new Session(lv, st, { N: 64 }); };
  const a = at(0), b = at(0.25);
  a.step(40); b.step(40);
  near(centroidX(a.sim), centroidX(b.sim), 1e-3, 'same motion before any lap');
  a.step(400); b.step(400);
  assert.ok(a.pM() > 0.45 && a.pT() < 0.1, 'no flux: a mirror ' + a.pT() + ' / ' + a.pM());
  assert.ok(b.pT() > 0.55 && b.pM() < 0.05, 'a quarter flux quantum: a window ' + b.pT() + ' / ' + b.pM());
  const c = at(0.5); c.step(440);
  near(c.pT(), a.pT(), 0.03, 'period of half a flux quantum (each half makes one lap, in opposite senses)');
});

test('Bloch oscillations on a ring: holding the push brings the atom back, a quarter period sends it away', () => {
  const lv = load('9-2'), run = (off) => {
    const s = new Session(lv, defaultSetup(lv), { N: 64 }); s.setTilt(1, 0);
    for (let i = 0; i < 628; i++) { if (i === off) s.setTilt(0, 0); s.step(1); }
    return centroidX(s.sim);
  };
  near(run(Infinity), 10, 1.5, 'after one Bloch period T_B = 31.4 the atom is home');
  assert.ok(Math.abs(run(157) - 10) > 8, 'released at T_B/4 it has glided away');
});

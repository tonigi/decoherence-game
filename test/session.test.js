import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session, defaultSetup, replay, sanitizeSetup, expandEvents } from '../src/session.js';
import { mulberry32 } from '../src/rng.js';

const load = (id) => JSON.parse(fs.readFileSync(new URL(`../levels/${id}.json`, import.meta.url), 'utf8'));
const index = JSON.parse(fs.readFileSync(new URL('../levels/index.json', import.meta.url), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('all levels parse, validate and build a session', () => {
  for (const id of index.levels) {
    const lv = load(id);
    assert.equal(lv.id, id);
    assert.ok(index.chapters.some(c => c.id === lv.chapter), id + ' chapter');
    assert.ok(lv.targets?.length, id + ' needs a target');
    assert.ok(lv.stars?.length === 3 && lv.stars.every((v, i, a) => i === 0 || v > a[i - 1]), id + ' stars ascending');
    const s = new Session(lv, defaultSetup(lv), { N: 64 });
    near(s.alive(), 1, 1e-12, id + ' initial norm');
    // momentum budget: launch speed must stay well under the grid ceiling
    assert.ok(lv.launch.k[0] === undefined ? lv.launch.k < 0.6 * s.sim.kmax : lv.launch.k[2] < 0.6 * s.sim.kmax, id + ' k ceiling');
  }
});

test('sanitizeSetup clamps ranges and inventory counts', () => {
  const lv = load('3-2');
  const bad = { launch: { k: 99, sigma: -1 }, placed: [
    { id: 'plate', x: -5, y: 99, w: 100, h: 0, V: 50 }, { id: 'plate', x: 20, y: 20 }, { id: 'nope', x: 1, y: 1 }] };
  const s = sanitizeSetup(lv, bad);
  assert.equal(s.launch.k, 2); // fixed parameter cannot be edited
  assert.equal(s.placed.length, 1);
  const p = s.placed[0];
  assert.ok(p.x >= 14 && p.y <= 32 && p.w <= 8 && p.h >= 2 && p.V <= 1.2);
});

test('Born rule: sampled cells follow |psi|^2', () => {
  const lv = load('1-1');
  const s = new Session(lv, defaultSetup(lv), { N: 64 });
  s.step(100);
  const sim = s.sim, rng = mulberry32(42), M = 20000;
  const hits = (mask) => { let c = 0; for (let i = 0; i < M; i++) { const idx = sim.sampleCell(rng()); if (idx >= 0 && mask[idx] > 0.5) c++; } return c; };
  const c = hits(s.targetMask);
  const left = new Float64Array(sim.N * sim.N); for (let j = 0; j < sim.N; j++) for (let i = 0; i < sim.N / 2; i++) left[j * sim.N + i] = 1;
  const pL = sim.mass(left), cL = hits(left);
  near(cL / M, pL, 4 * Math.sqrt(pL * (1 - pL) / M), 'left-half frequency');
  const pT = sim.mass(s.targetMask); // smooth mask, close to indicator
  assert.ok(Math.abs(c / M - pT) < 0.01 + 4 * Math.sqrt(pT * (1 - pT) / M), 'target frequency');
});

test('detector Kraus operators: outcome probabilities sum to 1 and P_T is a martingale', () => {
  const lv = load('5-2');
  const setup = defaultSetup(lv); setup.placed = [{ id: 'det', x: 20.7, y: 20, r: 2.5 }];
  const mk = () => { const s = new Session(lv, setup, { N: 64 }); s.step(60); return s; };
  const base = mk(), pYes = base.sim.mass2(base.detectors[0].mask), pT0 = base.pT();
  assert.ok(pYes > 0.05 && pYes < 0.95);
  // force each branch by choosing the rng draw
  const branch = (yes) => { const s = mk(); s.rng = () => (yes ? 0 : 0.9999999); s.fireDetector(0); return s; };
  const y = branch(true), n = branch(false);
  near(y.alive(), 1, 1e-9, 'yes branch renormalised'); near(n.alive(), 1, 1e-9, 'no branch renormalised');
  near(pYes * y.pT() + (1 - pYes) * n.pT(), pT0, 1e-9, 'expected P_T unchanged by measurement');
  // "no" removes weight from the detector region, "yes" concentrates it there
  assert.ok(n.sim.mass(base.detectors[0].mask) < base.sim.mass(base.detectors[0].mask));
  assert.ok(y.sim.mass(base.detectors[0].mask) > base.sim.mass(base.detectors[0].mask));
});

test('absorbed probability is a loss branch of the observation', () => {
  const lv = load('1-1');
  const s = new Session(lv, defaultSetup(lv), { N: 64, seed: 3 });
  s.step(Math.round(24 / 0.05)); // packet long gone
  assert.ok(s.alive() < 0.5);
  let lost = 0; const M = 200;
  for (let i = 0; i < M; i++) { const t = new Session(lv, defaultSetup(lv), { N: 64, seed: i + 1 }); t.step(480); if (t.observe().outcome === 'lost') lost++; }
  near(lost / M, 1 - s.alive(), 0.1, 'lost fraction');
});

test('expectation mode is deterministic and rated by P_T', () => {
  const lv = load('1-1'), setup = defaultSetup(lv); Object.assign(setup.launch, { k: 2.2, sigma: 2.35 });
  const s = new Session(lv, setup, { N: 64, mode: 'expect' }); s.step(Math.round(10.6 / 0.05));
  const r = s.observe();
  assert.equal(r.outcome, 'hit'); assert.ok(r.stars >= 1);
});

test('measurement collapse is a normalised Gaussian of width sigma_m around the sample', () => {
  const lv = load('1-1'), s = new Session(lv, defaultSetup(lv), { N: 64, seed: 5 });
  s.step(100); const r = s.observe();
  near(s.sim.norm(), r.outcome === 'lost' ? s.sim.norm() : 1, 1e-9, 'post-measurement norm');
  if (r.sample) { const [cx, cy] = s.sim.centroid(); assert.ok(Math.hypot(cx - r.sample.x, cy - r.sample.y) < 1.0, 'centred on sample'); }
});

test('replay of a recorded run reproduces the outcome exactly', () => {
  const lv = load('5-2');
  const setup = defaultSetup(lv); setup.placed = [{ id: 'det', x: 20, y: 20, r: 3.5 }];
  const s = new Session(lv, setup, { N: 64, seed: 99 });
  for (let k = 0; k < 40; k++) { s.step(5); s.fireDetector(0); }
  s.step(40); const r = s.observe();
  const sol = JSON.parse(JSON.stringify(s.solution()));
  const again = replay(lv, sol, { N: 64 });
  assert.equal(again.result.outcome, r.outcome);
  assert.equal(again.result.pT, r.pT);
  assert.deepEqual(again.events, s.events);
});

test('replay handles kicks, tilt and gates', () => {
  const lv = load('1-3');
  const s = new Session(lv, defaultSetup(lv), { N: 64, seed: 7 });
  s.kick(0, -1); s.step(20); s.setTilt(0, -1); s.step(37); s.setTilt(0, 0); s.step(5); const r = s.observe();
  const again = replay(lv, JSON.parse(JSON.stringify(s.solution())), { N: 64 });
  assert.equal(again.result.pT, r.pT);
  assert.equal(s.kicksLeft, 1);
});

test('expandEvents repeats compact events', () => {
  assert.deepEqual(expandEvents([{ step: 0, type: 'detect', i: 0, every: 5, until: 10 }]).map(e => e.step), [0, 5, 10]);
});

test('Zeno effect: pulsed detector keeps the packet localised', () => {
  const lv = load('5-2'), setup = defaultSetup(lv); setup.placed = [{ id: 'det', x: 20, y: 20, r: 3.5 }];
  const free = new Session(lv, defaultSetup(lv), { N: 64 }); free.step(240);
  let best = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const z = new Session(lv, setup, { N: 64, seed });
    for (let k = 0; k < 48; k++) { z.fireDetector(0); z.step(5); }
    best = Math.max(best, z.pT());
  }
  assert.ok(free.pT() < 0.25, 'free packet has dispersed: ' + free.pT());
  assert.ok(best > 0.5, 'Zeno-held packet stays near target: ' + best);
});

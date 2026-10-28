import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session, defaultSetup, replay, sanitizeSetup, expandEvents } from '../src/session.js';
import { mulberry32 } from '../src/rng.js';
import { ledger } from '../src/ledger.js';

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
  assert.equal(s.launch.k, 3); // fixed parameter cannot be edited
  assert.equal(s.placed.length, 1);
  const p = s.placed[0];
  assert.ok(p.x >= 14.5 && p.y <= 27 && p.w <= 6 && p.h >= 2 && p.V <= 2.5);
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
  const lv = load('1-2'), s = new Session(lv, defaultSetup(lv), { N: 64, seed: 5 });
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

test('observation outcome: P(hit) = P_T and P(mine) = P_M exactly (smooth masks)', () => {
  const lv = load('1-2'), setup = defaultSetup(lv);
  const M = 3000; let hit = 0, mine = 0;
  // one evolved state, then many observations of copies of it
  const base = new Session(lv, setup, { N: 64 }); base.step(160);
  const pT = base.pT(), pM = base.pM();
  const re = base.sim.re.slice(), im = base.sim.im.slice();
  for (let seed = 1; seed <= M; seed++) {
    base.sim.re.set(re); base.sim.im.set(im); base.result = null; base.rng = mulberry32(seed);
    const r = base.observe(); if (r.outcome === 'hit') hit++; if (r.outcome === 'mine') mine++;
  }
  near(hit / M, pT, 4 * Math.sqrt(pT * (1 - pT) / M) + 1e-3, 'hit frequency');
  near(mine / M, pM, 4 * Math.sqrt(pM * (1 - pM) / M) + 1e-3, 'mine frequency');
});

test('ledger: without detectors the score is P_T; with one shot it is the exact branch average', () => {
  const lv = load('5-1'), setup = sanitizeSetup(lv, lv.reference.setup);
  const plain = new Session(lv, setup, { N: 64 }); plain.step(204);
  const L0 = ledger(lv, { setup, events: [{ step: 204, type: 'observe' }] });
  near(L0.score, plain.pT(), 1e-12, 'no detector');
  assert.equal(L0.branches.length, 1);
  // fire at step 70, observe right away: the average must equal P_T before the shot (martingale)
  const pre = new Session(lv, setup, { N: 64 }); pre.step(70);
  const L1 = ledger(lv, { setup, events: [{ step: 70, type: 'detect', i: 0 }, { step: 70, type: 'observe' }] });
  assert.equal(L1.branches.length, 2);
  near(L1.branches.reduce((a, b) => a + b.w, 0), 1, 1e-12, 'weights sum to 1');
  near(L1.score, pre.pT(), 1e-9, 'martingale');
  // and observing later, it matches forcing each outcome by hand
  const L2 = ledger(lv, { setup, events: [{ step: 70, type: 'detect', i: 0 }, { step: 204, type: 'observe' }] });
  let want = 0;
  for (const yes of [true, false]) {
    const s = new Session(lv, setup, { N: 64 }); s.step(70); s.rng = () => (yes ? 0 : 0.9999999);
    const { pYes } = s.fireDetector(0); s.step(134); want += (yes ? pYes : 1 - pYes) * s.pT();
  }
  near(L2.score, want, 1e-9, 'branch average');
});

test('ledger: density-matrix compression reproduces the exact tree, strong and weak detectors', () => {
  for (const strength of [1, 0.5]) {
    const lv = load('5-2'); lv.inventory.items[0].strength = [1, 0.05, 1];
    const setup = sanitizeSetup(lv, { placed: [{ id: 'det', x: 20, y: 20, r: 3.5, strength }] });
    const events = []; for (let k = 0; k < 7; k++) events.push({ step: 5 * k, type: 'detect', i: 0 }); events.push({ step: 60, type: 'observe' });
    const exact = ledger(lv, { setup, events }, { maxBranches: 1e6 });
    assert.equal(exact.branches.length, 128);
    near(exact.branches.reduce((a, b) => a + b.w, 0), 1, 1e-9, 'exact weights');
    const L = ledger(lv, { setup, events }, { maxBranches: 8 });
    assert.ok(L.resampled && L.branches.length <= 8);
    // the error is bounded by the discarded eigenvalue weight
    assert.ok(Math.abs(L.score - exact.score) <= L.dropped + 1e-6, `s=${strength}: ${L.score} vs ${exact.score}, dropped ${L.dropped}`);
    near(L.score, exact.score, 0.01, 's=' + strength);
    assert.equal(L.score, ledger(lv, { setup, events }, { maxBranches: 8 }).score, 'deterministic');
  }
});

test('Jacobi eigen-decomposition and compression of an exactly rank-2 ensemble', async () => {
  const { jacobiEigen, compress } = await import('../src/ledger.js');
  const { values } = jacobiEigen([2, 1, 0, 1, 2, 0, 0, 0, 5], 3);
  assert.deepEqual(values.map(v => Math.round(v * 1e9) / 1e9).sort(), [1, 3, 5]);
  // four states that are combinations of two orthonormal ones: rank 2, nothing dropped
  const n = 16, u = { re: new Float64Array(n), im: new Float64Array(n) }, v = { re: new Float64Array(n), im: new Float64Array(n) };
  u.re[0] = 1; v.im[3] = 1;
  const mix = (a, b, w) => ({ re: u.re.map((x, i) => a * x + b * v.re[i]), im: u.im.map((x, i) => a * x + b * v.im[i]), w, caught: 0 });
  const st = [mix(1, 0, 0.4), mix(0.6, 0.8, 0.3), mix(0, 1, 0.2), mix(0.8, -0.6, 0.1)];
  const P = new Float64Array(n); P[0] = 1; // projector on u
  const expect = st.reduce((a, s) => a + s.w * (s.re[0] ** 2 + s.im[0] ** 2), 0);
  const c = compress(st, 2);
  assert.equal(c.states.length, 2); near(c.dropped, 0, 1e-9, 'dropped');
  near(c.states.reduce((a, s) => a + s.w * (s.re[0] ** 2 + s.im[0] ** 2), 0), expect, 1e-9, '<P> preserved');
});

test('detector runs are scored by the ledger, so a lucky post-selection earns nothing', () => {
  const lv = load('5-1');
  lv.inventory.items[0].area = [0, 0, 40, 40]; // let the detector reach the target port
  // detector over the target port, fired as the packet arrives: a "yes" puts P_T near 1
  const setup = sanitizeSetup(lv, { placed: [{ id: 'det', x: 23, y: 30, w: 8, h: 7 }] });
  const s = new Session(lv, setup, { N: 64, seed: 1, mode: 'expect' });
  s.step(200); s.rng = () => 0; const { yes } = s.fireDetector(0); s.step(4);
  assert.ok(yes && s.pT() > 0.5, 'post-selected P_T ' + s.pT());
  const r = s.observe();
  assert.ok(r.pending);
  const L = ledger(lv, s.solution());
  s.scoreWith(L.score, L);
  assert.ok(L.score < lv.stars[0], 'branch-averaged score ' + L.score);
  assert.equal(r.outcome, 'miss'); assert.equal(r.stars, 0);
});

test('momentum levels: the Born sample is drawn from |phi(k)|^2', () => {
  const lv = load('1-4'), setup = sanitizeSetup(lv, { launch: { sigma: 2 } });
  const base = new Session(lv, setup, { N: 64 }); base.step(160);
  const pT = base.pT(), M = 2000; let hit = 0;
  const re = base.sim.re.slice(), im = base.sim.im.slice();
  for (let seed = 1; seed <= M; seed++) {
    base.sim.re.set(re); base.sim.im.set(im); base.result = null; base.rng = mulberry32(seed);
    if (base.observe().outcome === 'hit') hit++;
  }
  assert.ok(pT > 0.2 && pT < 0.6, 'pT ' + pT);
  near(hit / M, pT, 4 * Math.sqrt(pT * (1 - pT) / M), 'hit frequency');
});

test('a bomb (absorbing element) counts as a mine and as a loss branch', () => {
  const lv = load('1-1');
  lv.elements = [{ type: 'rect', x: 20, y: 20, w: 4, h: 12, V: 0, absorb: 3 }];
  const s = new Session(lv, defaultSetup(lv), { N: 64 }); s.step(200);
  assert.ok(s.sim.caught > 0.5);
  near(s.pM(), s.sim.caught, 1e-12, 'no mines: P_M is what the bomb caught');
  near(s.alive() + s.sim.caught + s.lost(), 1, 1e-12, 'bookkeeping');
  let boom = 0; const M = 400;
  for (let seed = 1; seed <= M; seed++) { const t = new Session(lv, defaultSetup(lv), { N: 64, seed }); t.step(200); if (t.observe().outcome === 'boom') boom++; }
  near(boom / M, s.sim.caught, 0.08, 'boom frequency');
});

test('absorbing gate (shutter): what it swallows is lost, not caught by a bomb', () => {
  const lv = load('1-1');
  lv.elements = [{ type: 'rect', x: 16, y: 20, w: 3, h: 40, V: 0, absorb: 3, gate: { key: 1, label: 'Shutter', open: false, ramp: 2 } }];
  const s = new Session(lv, defaultSetup(lv), { N: 64 }); s.step(120);
  assert.equal(s.sim.caught, 0);
  assert.ok(s.lost() > 0.3, 'shutter absorbed ' + s.lost());
  const o = new Session(lv, defaultSetup(lv), { N: 64 }); o.toggleGate(0); o.step(120);
  assert.ok(o.lost() < 0.05, 'open shutter lets it pass: ' + o.lost());
});

test('worlds: one setup in every world, P_T is the product, an item can be absent in a world', () => {
  const lv = load('6-8'), s = new Session(lv, lv.reference.setup, { N: 64 });
  assert.equal(s.worlds.length, 2);
  assert.equal(s.worlds[0], s);
  assert.equal(s.worlds[1].setup.placed.filter(p => p.id === 'st').length, 0, 'no stations without the bomb');
  s.step(120);
  near(s.pT(), s.ownPT() * s.worlds[1].ownPT(), 1e-15, 'product');
  assert.ok(s.sim.caught > 0.05, 'the bomb world loses photons to the bomb: ' + s.sim.caught);
  assert.equal(s.worlds[1].sim.caught, 0, 'nothing to set off without the bomb');
  near(s.worlds[1].alive() + s.worlds[1].lost(), 1, 1e-12, 'bookkeeping in the second world');
});

test('worlds: inputs reach every world, and replay reproduces all of them', () => {
  const base = load('1-3'), lv = { ...base, worlds: [{ name: 'a' }, { name: 'b' }] };
  const s = new Session(lv, defaultSetup(lv), { N: 64, seed: 5 });
  s.kick(0, -1); s.step(20); s.setTilt(0, -1); s.step(37); s.setTilt(0, 0); s.step(5);
  const [a, b] = s.worlds;
  assert.deepEqual(b.sim.re, a.sim.re, 'identical worlds stay identical');
  near(s.pT(), a.ownPT() ** 2, 1e-15, 'P_T of two identical worlds');
  const plain = new Session(base, defaultSetup(base), { N: 64 });
  plain.kick(0, -1); plain.step(20); plain.setTilt(0, -1); plain.step(37); plain.setTilt(0, 0); plain.step(5);
  near(a.ownPT(), plain.pT(), 1e-15, 'a world is the plain level');
  const r = s.observe(), again = replay(lv, JSON.parse(JSON.stringify(s.solution())), { N: 64 });
  assert.deepEqual(again.result.worlds, r.worlds);
  assert.equal(again.result.outcome, r.outcome);
  assert.equal(r.hit, r.worlds.every(w => w.outcome === 'hit'));
});

test('worlds: P(hit) = product of the worlds\' P_T (each world rolls its own dice)', () => {
  const lv = load('6-8'), base = new Session(lv, lv.reference.setup, { N: 64 });
  base.step(180);
  const pT = base.pT(), saved = base.worlds.map(w => w.sim.snapshot());
  const M = 3000; let hit = 0;
  for (let seed = 1; seed <= M; seed++) {
    base.worlds.forEach((w, k) => { w.sim.load(saved[k]); w.sim.caught = saved[k].caught; w.result = null; w.rng = mulberry32(seed * 7919 + k); });
    if (base.observe().hit) hit++;
  }
  near(hit / M, pT, 4 * Math.sqrt(pT * (1 - pT) / M) + 1e-3, 'hit frequency');
});

test('eraser: polOffset turns a world\'s analyzer to the other exit; 45° erases the which-way tag', () => {
  const lv = load('6-9'), at = (pol) => { const s = new Session(lv, { ...defaultSetup(lv), placed: pol == null ? [] : [{ id: 'an', x: 17, y: 20, pol }] }, { N: 64 }); s.step(160); return s; };
  const s = at(45), placed = (w) => w.optics.find(o => o.placed).optic.angle;
  assert.equal(placed(s.worlds[0]), 45); assert.equal(placed(s.worlds[1]), 135);
  const none = at(null), tag = at(0);
  assert.ok(s.pT() > 3 * none.pT(), `erasing beats no analyzer: ${s.pT()} vs ${none.pT()}`);
  near(tag.pT(), none.pT(), 0.01, 'an analyzer along a tag only reads it');
  // the two exits share out the particles: together they hold what the slits let through
  near(s.worlds[0].alive() + s.worlds[1].alive(), none.alive(), 0.01, 'exits add up');
});

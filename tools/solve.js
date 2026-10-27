// Level solver: random-restart (1+lambda) evolution search over the setup-phase
// parameters (launch + placed inventory) on a coarse grid. Used to verify that a
// level is solvable, to rate how sharp the optimum is, and to calibrate star
// thresholds. (A gradient/adjoint version would be the natural upgrade.)
//   node tools/solve.js levels/1-1.json [--iters 200] [--N 64] [--net]
import fs from 'node:fs';
import { simulateCurve } from '../src/ghost.js';
import { param, defaultSetup, defaultItem, itemKeys, sanitizeSetup, areaBounds } from '../src/session.js';
import { mulberry32 } from '../src/rng.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? +args[i + 1] : d; };
const level = JSON.parse(fs.readFileSync(file, 'utf8'));
const iters = opt('iters', 200), N = opt('N', 64), seed = opt('seed', 7);
const rand = mulberry32(seed);
const events = level.reference?.events || [];

// variable table
const vars = [];
for (const k of ['x', 'y', 'k', 'angle', 'sigma']) {
  const p = param(level.launch[k]); if (p.max > p.min) vars.push({ path: ['launch', k], ...p });
}
const items = [];
for (const spec of level.inventory?.items || []) {
  for (let c = 0; c < spec.count; c++) {
    const a = areaBounds(spec.area || [0, 0, level.grid.L, level.grid.L]);   // zones: sanitizeSetup snaps into one
    items.push(spec);
    const idx = items.length - 1;
    vars.push({ path: ['placed', idx, 'x'], min: a[0], max: a[2], v: (a[0] + a[2]) / 2 });
    vars.push({ path: ['placed', idx, 'y'], min: a[1], max: a[3], v: (a[1] + a[3]) / 2 });
    for (const k of itemKeys(spec)) { const p = param(spec[k]); if (p.max > p.min) vars.push({ path: ['placed', idx, k], ...p }); }
  }
}
function build(x) {
  const s = defaultSetup(level);
  items.forEach((spec) => s.placed.push(defaultItem(spec, level)));
  vars.forEach((v, i) => {
    if (v.path[0] === 'launch') s.launch[v.path[1]] = x[i]; else s.placed[v.path[1]][v.path[2]] = x[i];
  });
  return sanitizeSetup(level, s);
}
function evaluate(x, n = N) {
  const setup = build(x);
  // detector outcomes are random: average the curve over a few seeds when events can fire detectors
  const seeds = events.some(e => e.type === 'detect') ? [1, 2, 3, 4] : [1];
  const cs = seeds.map(seed => simulateCurve(level, setup, { N: n, events, seed }));
  const c = { t: cs[0].t, pT: cs[0].pT.map((_, i) => cs.reduce((a, q) => a + q.pT[i], 0) / cs.length), pM: cs[0].pM.map((_, i) => cs.reduce((a, q) => a + q.pM[i], 0) / cs.length) };
  const minT = level.minObserveTime || 0;
  let best = -1, bi = 0;
  c.t.forEach((t, i) => { if (t >= minT) { const f = c.pT[i] - (opt('net', 1) ? c.pM[i] : 0); if (f > best) { best = f; bi = i; } } });
  return { f: best, t: c.t[bi], pT: c.pT[bi], pM: c.pM[bi], setup };
}
const rnd = (v) => v.min + (v.max - v.min) * rand();
let best = null;
const restarts = Math.max(1, Math.round(iters / 40));
for (let r = 0; r < restarts; r++) {
  let x = vars.map(v => (r === 0 ? v.v : rnd(v)));
  let cur = evaluate(x);
  let step = 0.25;
  for (let it = 0; it < iters / restarts; it++) {
    const y = x.map((xi, i) => Math.min(vars[i].max, Math.max(vars[i].min, xi + (vars[i].max - vars[i].min) * step * (rand() + rand() + rand() - 1.5) * (rand() < 0.5 ? 1 : 0.2))));
    const e = evaluate(y);
    if (e.f > cur.f) { x = y; cur = e; } else step = Math.max(0.02, step * 0.985);
  }
  if (!best || cur.f > best.f) best = { ...cur, x };
}
const fine = evaluate(best.x, level.grid.N);
const stars = level.stars || [];
console.log(JSON.stringify({
  level: level.id, N, iters,
  best: { net: +best.f.toFixed(3), t: +best.t.toFixed(2), pT: +best.pT.toFixed(3), pM: +best.pM.toFixed(3) },
  atFullRes: { net: +fine.f.toFixed(3), t: +fine.t.toFixed(2), pT: +fine.pT.toFixed(3), pM: +fine.pM.toFixed(3) },
  stars, setup: fine.setup,
}, null, 1));

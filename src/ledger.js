// Branch ledger: the skill score of a run with detector firings.
//
// A single run's normalised P_T after detector outcomes is an unbiased but very
// noisy estimate of the strategy's win probability (a lucky "yes" can post-select
// the packet onto the target). The ledger replays the run's open-loop inputs and
// follows *every* detector outcome: each firing splits each live branch into
// M_yes psi and M_no psi with weights p and 1-p. The score is the weight-averaged
// P_T at the observation step, i.e. the win probability of the run's input
// sequence over all dice -- the same number for every roll.
//
// Small trees (one-shot detectors) are followed exactly. When the tree outgrows
// `maxBranches` (pulsed Zeno detectors split every branch on every pulse) it is
// thinned by Russian roulette: a branch lighter than a cut c survives with
// probability w/c and then carries weight c, so the expected score is unchanged
// (the ledger stays an unbiased estimator, just with far less variance than one
// run). c is chosen so that about maxBranches survive, and the roulette uses a
// fixed seed, so the score is a deterministic function of the run's inputs.
// Kicks, tilt and gates act identically on every branch.
import { Session } from './session.js';
import { mulberry32 } from './rng.js';

/** Roulette cut c such that #{w >= c} + sum_{w < c} w / c = K. */
function rouletteCut(ws, K) {
  let lo = 0, hi = Math.max(...ws);
  for (let it = 0; it < 60; it++) {
    const c = 0.5 * (lo + hi);
    let n = 0; for (const w of ws) n += w >= c ? 1 : w / c;
    if (n > K) lo = c; else hi = c;
  }
  return hi;
}

export function* ledgerSteps(level, solution, { N = 64, maxBranches = 32, chunk = 8, seed = 0x5eed } = {}) {
  const rng = mulberry32(seed);
  const s = new Session(level, solution.setup, { N, seed: 1 });
  const sim = s.sim;
  let branches = [{ re: sim.re.slice(), im: sim.im.slice(), caught: 0, w: 1, path: '' }];
  let dropped = 0, resampled = false;
  const advanceTo = function* (step) {
    while (s.stepCount < step) {
      const n = Math.min(chunk, step - s.stepCount);
      sim.withState(branches[0], () => sim.step(n, branches.slice(1)));
      s.stepCount += n;
      yield s.stepCount;
    }
  };
  for (const ev of solution.events) {
    yield* advanceTo(ev.step);
    if (ev.type === 'kick') for (const b of branches) sim.withState(b, () => sim.kick(ev.dk[0], ev.dk[1]));
    else if (ev.type === 'tilt') s.setTilt(ev.u[0], ev.u[1]);
    else if (ev.type === 'gate') s.toggleGate(ev.i);
    else if (ev.type === 'detect') {
      const mask = s.detectors[ev.i].mask, next = [];
      for (const b of branches) {
        const p = sim.withState(b, () => sim.mass2(mask));
        if (p > 1e-12) {
          const y = { re: b.re.slice(), im: b.im.slice(), caught: 0, w: b.w * p, path: b.path + 'Y' };
          sim.withState(y, () => sim.applyMask(mask, 1 / Math.sqrt(p)));
          next.push(y);
        }
        if (p < 1 - 1e-12) {
          sim.withState(b, () => { sim.applyComplement(mask, 1 / Math.sqrt(1 - p)); sim.conditionCaught(false, p); });
          b.w *= 1 - p; b.path += 'N'; next.push(b);
        }
      }
      if (next.length > maxBranches) {
        resampled = true;
        const c = rouletteCut(next.map(b => b.w), maxBranches);
        branches = [];
        for (const b of next) {
          if (b.w >= c) branches.push(b);
          else if (rng() < b.w / c) { b.w = c; branches.push(b); }
        }
        branches.sort((a, b) => b.w - a.w);
        for (const b of branches.splice(2 * maxBranches)) dropped += b.w; // hard cap, practically never hit
      } else branches = next;
      if (!branches.length) break;
    } else if (ev.type === 'observe') break;
  }
  const rows = branches.map(b => sim.withState(b, () => ({ w: b.w, path: b.path, pT: s.pT(), pM: s.pM(), alive: s.alive() })));
  const sum = (k) => rows.reduce((a, r) => a + r.w * r[k], 0);
  rows.sort((a, b) => b.w - a.w);
  return { score: sum('pT'), pM: sum('pM'), alive: sum('alive'), branches: rows, dropped, resampled, N };
}

/** Synchronous ledger (tests, tools/verify.js). */
export function ledger(level, solution, opts) {
  const g = ledgerSteps(level, solution, opts);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** Browser variant: runs in ~12 ms slices between frames. */
export function ledgerAsync(level, solution, { onDone, shouldCancel, ...opts } = {}) {
  const g = ledgerSteps(level, solution, opts);
  const tick = () => {
    if (shouldCancel && shouldCancel()) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 12) { const r = g.next(); if (r.done) { onDone(r.value); return; } }
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

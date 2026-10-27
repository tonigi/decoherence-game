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
// `maxBranches` K (pulsed Zeno detectors split every branch on every pulse) it is
// compressed deterministically. The branches only ever enter the score through
// the density matrix rho = sum_b w_b |psi_b><psi_b|, and every later operation
// (stepping, kicks, detector channels, the final P_T) is linear in rho, so any
// other decomposition of the same rho scores the same. compress() replaces the
// branches with the K leading eigenvectors of rho (the best rank-K
// approximation), found from the small Gram matrix sqrt(w_i w_j) <psi_i|psi_j>.
// The discarded eigenvalue weight bounds the error of the score; it is reported
// as `dropped`. No dice are involved: the score is a deterministic function of
// the run's inputs.
//
// Absorbing elements: w_b * caught_b is invariant under detector conditioning, so
// at compression the expected caught probability is moved to a bank.
// Kicks, tilt and gates act identically on every branch.
import { Session } from './session.js';

/** Eigen-decomposition of a real symmetric n x n matrix (row-major), cyclic Jacobi.
 *  Returns {values, vectors} with vectors[k] the k-th eigenvector (length n). */
export function jacobiEigen(A, n) {
  const a = Float64Array.from(A), v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < n; p++) { diag += a[p * n + p] ** 2; for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2; }
    if (off <= 1e-26 * (diag + 1e-300)) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < n; k++) {           // A <- J^T A J
        const akp = a[k * n + p], akq = a[k * n + q];
        a[k * n + p] = c * akp - sn * akq; a[k * n + q] = sn * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p * n + k], aqk = a[q * n + k];
        a[p * n + k] = c * apk - sn * aqk; a[q * n + k] = sn * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k * n + p], vkq = v[k * n + q];
        v[k * n + p] = c * vkp - sn * vkq; v[k * n + q] = sn * vkp + c * vkq;
      }
    }
  }
  const values = [], vectors = [];
  for (let k = 0; k < n; k++) { values.push(a[k * n + k]); const e = new Float64Array(n); for (let i = 0; i < n; i++) e[i] = v[i * n + k]; vectors.push(e); }
  return { values, vectors };
}

/** Replace weighted states by the K leading eigenvectors of rho = sum w |psi><psi|.
 *  Returns {states, dropped}; each new state is normalised and carries weight lambda. */
export function compress(states, K) {
  const M = states.length, n2 = states[0].re.length;
  // Hermitian Gram matrix G = A + iB, G_ij = sqrt(w_i w_j) <psi_i|psi_j>
  const A = new Float64Array(M * M), B = new Float64Array(M * M);
  for (let i = 0; i < M; i++) for (let j = i; j < M; j++) {
    const a = states[i], b = states[j]; let sr = 0, si = 0;
    for (let k = 0; k < n2; k++) { sr += a.re[k] * b.re[k] + a.im[k] * b.im[k]; si += a.re[k] * b.im[k] - a.im[k] * b.re[k]; }
    const f = Math.sqrt(a.w * b.w);
    A[i * M + j] = A[j * M + i] = f * sr; B[i * M + j] = f * si; B[j * M + i] = -f * si;
  }
  // real embedding [[A, -B], [B, A]]: each complex eigenvector x + iy appears as [x; y] (and as i times itself)
  const n = 2 * M, R = new Float64Array(n * n);
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    R[i * n + j] = A[i * M + j]; R[(i + M) * n + j + M] = A[i * M + j];
    R[i * n + j + M] = -B[i * M + j]; R[(i + M) * n + j] = B[i * M + j];
  }
  const { values, vectors } = jacobiEigen(R, n);
  const order = values.map((_, k) => k).sort((x, y) => values[y] - values[x]);
  const picked = []; // complex unit vectors {re, im, lambda}
  for (const k of order) {
    if (picked.length >= K || values[k] <= 1e-15) break;
    const vr = vectors[k].slice(0, M), vi = vectors[k].slice(M);
    for (const q of picked) { // project out vectors already taken (the partner i*v, degeneracies)
      let cr = 0, ci = 0;
      for (let i = 0; i < M; i++) { cr += q.re[i] * vr[i] + q.im[i] * vi[i]; ci += q.re[i] * vi[i] - q.im[i] * vr[i]; }
      for (let i = 0; i < M; i++) { vr[i] -= cr * q.re[i] - ci * q.im[i]; vi[i] -= cr * q.im[i] + ci * q.re[i]; }
    }
    let nn = 0; for (let i = 0; i < M; i++) nn += vr[i] ** 2 + vi[i] ** 2;
    if (nn < 0.25) continue;
    nn = Math.sqrt(nn); for (let i = 0; i < M; i++) { vr[i] /= nn; vi[i] /= nn; }
    picked.push({ re: vr, im: vi, lambda: values[k] });
  }
  const total = states.reduce((a, b) => a + b.w * normOf(b), 0);
  const out = picked.map(({ re: cr, im: ci, lambda }, k) => {
    const re = new Float64Array(n2), im = new Float64Array(n2);
    for (let i = 0; i < M; i++) {
      const f = Math.sqrt(states[i].w / lambda), ar = cr[i] * f, ai = ci[i] * f, s = states[i];
      for (let q = 0; q < n2; q++) { re[q] += ar * s.re[q] - ai * s.im[q]; im[q] += ar * s.im[q] + ai * s.re[q]; }
    }
    return { re, im, caught: 0, w: lambda, path: '~' + (k + 1) };
  });
  const kept = out.reduce((a, b) => a + b.w, 0);
  return { states: out, dropped: Math.max(0, total - kept) };
}
const normOf = (b) => { let s = 0; for (let i = 0; i < b.re.length; i++) s += b.re[i] * b.re[i] + b.im[i] * b.im[i]; return s; };

export function* ledgerSteps(level, solution, { N = 64, maxBranches = 16, chunk = 8 } = {}) {
  const s = new Session(level, solution.setup, { N, seed: 1 });
  const sim = s.sim;
  let branches = [{ re: sim.re.slice(), im: sim.im.slice(), caught: 0, w: 1, path: '' }];
  let dropped = 0, resampled = false, bank = 0;
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
        for (const b of next) { bank += b.w * b.caught; b.caught = 0; }
        const c = compress(next, maxBranches);
        branches = c.states; dropped += c.dropped;
      } else branches = next;
      if (!branches.length) break;
    } else if (ev.type === 'observe') break;
  }
  // each row keeps its state, so the UI can show what that branch looks like (on `sim`)
  const rows = branches.map(b => sim.withState(b, () => ({ w: b.w, path: b.path, pT: s.pT(), pM: s.pM(), alive: s.alive(), state: b })));
  const sum = (k) => rows.reduce((a, r) => a + r.w * r[k], 0);
  rows.sort((a, b) => b.w - a.w);
  return { score: sum('pT'), pM: sum('pM') + bank, alive: sum('alive'), branches: rows, dropped, resampled, N, sim };
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

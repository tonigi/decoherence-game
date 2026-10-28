// Game core: one playthrough of a level. DOM-free so the same code runs in the
// browser, in node tests, and in tools/verify.js (deterministic replay).
import { Sim } from './sim.js';
import { rasterMask, rasterV, rasterKMask } from './shapes.js';
import { mulberry32 } from './rng.js';
import { opticTerm, jones } from './optics.js';

export const DT = 0.05;
export const SIGMA_M = 1.0; // position-measurement collapse width

/** Level params are either a fixed number or [value, min, max]. */
export function param(p) { return Array.isArray(p) ? { v: p[0], min: p[1], max: p[2] } : { v: p, min: p, max: p }; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LAUNCH_KEYS = ['x', 'y', 'k', 'angle', 'sigma'];
// spinor levels may also set the launch polarization: angle `pol` (deg) and ellipticity `ellip`
const SPIN_LAUNCH_KEYS = ['pol', 'ellip'];
// any level may give the packet a different width across its direction of motion, `sigmaT`
export function launchKeys(level) {
  return [...LAUNCH_KEYS, ...(level.launch.sigmaT !== undefined ? ['sigmaT'] : []), ...(level.spinor ? SPIN_LAUNCH_KEYS.filter(k => level.launch[k] !== undefined) : [])];
}
export const ITEM_KEYS = {
  rect: ['w', 'h', 'V'], absorber: ['w', 'h'], detector_rect: ['w', 'h'], detector_circle: ['r'],
  // optics (spinor levels): `pol` is the polarization axis in degrees, not a rotation of the shape
  lattice: ['w', 'h', 'V', 'period'],
  polarizer: ['w', 'h', 'pol'], rotator: ['w', 'h', 'omega'], retarder: ['w', 'h', 'pol', 'delta'], zeeman: ['w', 'h', 'pol', 'gradient'],
};
export const OPTIC_KINDS = ['polarizer', 'rotator', 'retarder', 'zeeman'];
export function itemKeys(spec) {
  if (spec.kind === 'detector') return [...ITEM_KEYS['detector_' + (spec.shape || 'rect')], ...(spec.strength !== undefined ? ['strength'] : [])];
  return ITEM_KEYS[spec.kind] || ITEM_KEYS.rect;
}
/** The optic of a placed optical item, in the element format of optics.js. */
export function itemOptic(spec, it) {
  return { kind: spec.kind, angle: it.pol, omega: it.omega, delta: it.delta, gradient: it.gradient, absorb: spec.absorb, V: spec.reflect, bomb: spec.bomb };
}

/** chi(x) of an optic element; a Zeeman magnet's field term grows linearly across
 *  it, so its chi is scaled by the transverse (rect-local v) coordinate. */
function opticChi(sim, el, optic) {
  const chi = rasterV(sim, { ...el, V: 1 });
  if (optic.kind !== 'zeeman') return chi;
  const { N, dx } = sim, a = ((el.angle || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const X = (i + 0.5) * dx - el.x, Y = (j + 0.5) * dx - el.y;
    chi[j * N + i] *= -s * X + c * Y;
  }
  return chi;
}

/** Per-axis boundary of a level: `boundary` is "absorb" (default), "periodic", or
 *  {x, y} with either value per axis. Returns [periodicX, periodicY]. */
export function boundaryOf(level) {
  const b = level.boundary || 'absorb', ax = (v) => {
    if (v !== 'absorb' && v !== 'periodic') throw new Error(level.id + ': boundary must be "absorb" or "periodic"');
    return v === 'periodic';
  };
  return typeof b === 'string' ? [ax(b), ax(b)] : [ax(b.x || 'absorb'), ax(b.y || 'absorb')];
}

export function defaultSetup(level) {
  const launch = {};
  for (const k of launchKeys(level)) launch[k] = param(level.launch[k]).v;
  return { launch, placed: [] };
}

export function defaultItem(spec, level) {
  const it = { id: spec.id, x: spec.x ?? level.grid.L / 2, y: spec.y ?? level.grid.L / 2 };
  for (const k of itemKeys(spec)) it[k] = param(spec[k]).v;
  return it;
}

/** Clamp a setup to what the level allows (ranges, inventory counts, placement area). */
export function sanitizeSetup(level, setup) {
  const out = defaultSetup(level);
  for (const k of launchKeys(level)) {
    const p = param(level.launch[k]);
    const v = setup?.launch?.[k];
    out.launch[k] = clamp(typeof v === 'number' ? v : p.v, p.min, p.max);
  }
  const used = {}, L = level.grid.L;
  for (const it of setup?.placed || []) {
    const spec = (level.inventory?.items || []).find(s => s.id === it.id);
    if (!spec) continue;
    used[it.id] = (used[it.id] || 0) + 1;
    if (used[it.id] > spec.count) continue;
    const o = { id: it.id, ...placeIn(spec.area || [0, 0, L, L], it.x, it.y) };
    for (const k of itemKeys(spec)) { const p = param(spec[k]); o[k] = clamp(typeof it[k] === 'number' ? it[k] : p.v, p.min, p.max); }
    out.placed.push(o);
  }
  return out;
}

/** Clamp (x, y) into a placement area: one rect [x0, y0, x1, y1], or a list of
 *  rects (placement zones), in which case the nearest zone wins. */
export function placeIn(area, x, y) {
  const zones = Array.isArray(area[0]) ? area : [area];
  let best = null, bd = Infinity;
  for (const a of zones) {
    const p = { x: clamp(x, a[0], a[2]), y: clamp(y, a[1], a[3]) }, d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
/** Bounding box of a placement area (one rect or a list of zones). */
export function areaBounds(area) {
  const zones = Array.isArray(area[0]) ? area : [area];
  return [Math.min(...zones.map(a => a[0])), Math.min(...zones.map(a => a[1])), Math.max(...zones.map(a => a[2])), Math.max(...zones.map(a => a[3]))];
}

export class Session {
  /**
   * @param level  parsed level JSON
   * @param setup  {launch:{x,y,k,angle,sigma}, placed:[{id,x,y,w,h,V|r}]}
   * @param opts   {N, seed, mode:'born'|'expect'}
   */
  constructor(level, setup, opts = {}) {
    this.level = level;
    this.setup = sanitizeSetup(level, setup);
    this.mode = opts.mode || 'born';
    this.seed = opts.seed ?? 1;
    this.rng = mulberry32(this.seed);
    const g = level.grid;
    this.periodic = boundaryOf(level);
    this.sim = new Sim(opts.N || g.N, g.L, DT, { spinor: !!level.spinor, periodic: this.periodic });
    // a constant force along a periodic axis would be a sawtooth with a jump at the seam
    // (the consistent version is a growing flux, not built yet); refuse it
    const forced = [level.field?.[0] || level.inventory?.tilt?.max, level.field?.[1] || level.inventory?.tilt?.max];
    if (this.periodic.some((p, a) => p && forced[a])) throw new Error(level.id + ': no field or tilt along a periodic axis');
    this.stepCount = 0;
    this.events = [];
    this.result = null;
    this.kicksLeft = level.inventory?.kick?.charges || 0;
    this.tiltMax = level.inventory?.tilt?.max || 0;
    this.tilt = [0, 0];
    // a level `field` [Fx, Fy] is a constant force (gravity) on top of the player's tilt
    this.field = level.field || [0, 0];

    const sim = this.sim;
    this.gates = [];
    this.optics = [];   // {shape, optic, gate?} for display
    const shapeOf = (el) => (el.type === 'disc' ? { shape: 'circle', x: el.x, y: el.y, r: el.r } : { shape: 'rect', x: el.x, y: el.y, w: el.w, h: el.h, angle: el.angle });
    for (const el of level.elements || []) {
      // `optic` makes an element a polarization optic (src/optics.js), optionally switchable
      if (el.optic) {
        const spin = { chi: opticChi(sim, el, el.optic), term: opticTerm(el.optic) }, entry = { shape: shapeOf(el), optic: el.optic };
        if (el.gate) {
          const i = sim.addGate(null, el.gate.open !== false, el.gate.ramp, null, false, spin, el.gate.pulse || 0);
          entry.gate = this.gates.length;
          this.gates.push({ index: i, key: el.gate.key, label: el.gate.label || 'Optic', open: el.gate.open !== false, pulse: el.gate.pulse || 0 });
        } else sim.addSpin(spin.chi, spin.term, { bomb: !!el.optic.bomb });
        this.optics.push(entry);
        continue;
      }
      // `absorb` makes an element (e.g. a bomb) swallow probability: an imaginary potential
      // with a `gate` it is an absorbing shutter instead, whose loss counts as lost
      if (el.absorb && !el.gate) { sim.addAbsorber(rasterV(sim, { ...el, V: el.absorb })); if (!el.V) continue; }
      const V = el.V || el.type === 'harmonic' ? rasterV(sim, el) : null;
      if (el.type === 'harmonic' && !el.gate) sim.addContour(V);
      if (el.gate) {
        const W = el.absorb ? rasterV(sim, { ...el, V: el.absorb }) : null;
        const i = sim.addGate(V, el.gate.open !== false, el.gate.ramp, W, el.type === 'harmonic', null, el.gate.pulse || 0);
        this.gates.push({ index: i, key: el.gate.key, label: el.gate.label || 'Gate', open: el.gate.open !== false, pulse: el.gate.pulse || 0 });
      } else if (V) sim.addStatic(V);
    }
    this.detectors = [];
    // A detector of strength s (0..1] is a weak measurement: Kraus operators
    // M_yes = sqrt(s) m, M_no = sqrt(1 - s m^2), i.e. the mask scaled by sqrt(s).
    const addDetector = (shape, shots, label, cooldown, hold, strength = 1) => {
      const mask = rasterMask(sim, shape), f = Math.sqrt(Math.min(1, Math.max(0, strength)));
      if (f < 1) for (let i = 0; i < mask.length; i++) mask[i] *= f;
      this.detectors.push({ shape, mask, shots, label, cooldown: cooldown || 0, hold: !!hold, fired: 0, strength });
    };
    for (const d of level.detectors || []) addDetector(d, d.shots ?? 1, d.label || 'Detector', d.cooldown, d.hold, d.strength ?? 1);
    for (const it of this.setup.placed) {
      const spec = level.inventory.items.find(s => s.id === it.id);
      if (spec.kind === 'detector') {
        const shape = spec.shape === 'circle' ? { shape: 'circle', x: it.x, y: it.y, r: it.r } : { shape: 'rect', x: it.x, y: it.y, w: it.w, h: it.h };
        addDetector(shape, spec.shots ?? 1, spec.label || 'Detector', spec.cooldown, spec.hold, it.strength ?? 1);
      } else if (OPTIC_KINDS.includes(spec.kind)) {
        const el = { type: 'rect', x: it.x, y: it.y, w: it.w, h: it.h, angle: spec.tilt }, optic = itemOptic(spec, it);
        sim.addSpin(opticChi(sim, el, optic), opticTerm(optic), { bomb: !!spec.bomb });
        this.optics.push({ shape: { shape: 'rect', ...el }, optic, placed: true });
      } else if (spec.kind === 'lattice') sim.addStatic(rasterV(sim, { type: 'lattice', x: it.x, y: it.y, w: it.w, h: it.h, V: it.V, period: it.period, angle: spec.tilt }));
      else if (spec.kind === 'absorber') sim.addAbsorber(rasterV(sim, { type: 'rect', x: it.x, y: it.y, w: it.w, h: it.h, V: spec.absorb ?? 3 }));
      else sim.addStatic(rasterV(sim, { type: 'rect', x: it.x, y: it.y, w: it.w, h: it.h, V: it.V }));
    }
    // level.observe === 'momentum': the final measurement is of momentum, and
    // targets / mines are regions of k-space ({x: kx, y: ky, ...})
    this.kSpace = level.observe === 'momentum';
    const raster = this.kSpace ? rasterKMask : rasterMask;
    // a target with `pol` (deg) is behind a polarization analyzer: it scores
    // |<pol|psi>|^2 instead of |psi|^2 (spinor levels, position space)
    const plain = (level.targets || []).filter(t => t.pol === undefined && t.shape !== 'state');
    // a target {shape: 'state', x, y, sigma, kx?, ky?} is a quantum state, not a region: the
    // observation asks "is the particle in this coherent state?", a projective measurement
    // that says yes with probability F = |<phi|psi>|^2 (the fidelity), which is then P_T
    const states = (level.targets || []).filter(t => t.shape === 'state');
    if (states.length > 1 || (states.length && (this.kSpace || plain.length || (level.mines || []).length))) throw new Error(level.id + ': a state target must be the only target, in position space, without mines');
    this.stateMode = states.length ? sim.gaussianMode(states[0]) : null;
    this.analyzers = (level.targets || []).filter(t => t.pol !== undefined).map(t => ({ mask: raster(sim, t), pol: t.pol }));
    if (this.analyzers.length && (this.kSpace || !level.spinor)) throw new Error(level.id + ': polarized targets need a spinor, position-space level');
    this.targetMask = unionMask(sim, plain, raster);
    this.mineMask = unionMask(sim, level.mines || [], raster);

    if (level.field) sim.setTilt(this.field[0], this.field[1]);
    const l = this.setup.launch, a = (l.angle * Math.PI) / 180;
    sim.setGaussian({ x: l.x, y: l.y, kx: l.k * Math.cos(a), ky: l.k * Math.sin(a), sigma: l.sigma, sigmaT: l.sigmaT ?? l.sigma, dir: a, pol: jones(l.pol, l.ellip) });
    // `particles: "bosons" | "fermions"`: the grid is psi(x1, x2) of two particles on a line,
    // (anti)symmetrised under exchange; "distinguishable" (or nothing) keeps the product state
    const ex = { bosons: 1, fermions: -1 }[level.particles];
    if (ex) { if (level.spinor) throw new Error(level.id + ': exchange symmetry needs a scalar level'); sim.exchange(ex); }
    sim._refresh();
  }

  get t() { return this.stepCount * DT; }
  get finished() { return !!this.result; }
  _mass(m) { return this.kSpace ? this.sim.kMass(m) : this.sim.mass(m); }
  pT() {
    if (this.stateMode) return this.sim.modeMass(this.stateMode);
    let p = this._mass(this.targetMask); for (const A of this.analyzers) p += this.sim.polMass(A.mask, A.pol); return p; }
  /** Probability that cell idx, once found, counts as on target (analyzers pass |<pol|psi_idx>|^2 / |psi_idx|^2). */
  _targetAt(idx) {
    let t = this.targetMask[idx];
    for (const A of this.analyzers) if (A.mask[idx]) t += A.mask[idx] * this.sim.polFraction(idx, A.pol);
    return t;
  }
  /** Mines include probability already swallowed by absorbing elements (bombs). */
  pM() { return this._mass(this.mineMask) + this.sim.caught; }
  alive() { return this.sim.norm(); }
  /** Probability lost at the boundary absorber. */
  lost() { return Math.max(0, 1 - this.sim.norm() - this.sim.caught); }

  step(n) {
    if (this.result) return;
    this.sim.step(n);
    this.stepCount += n;
    for (const g of this.gates) if (g.pulse) g.open = this.sim.gates[g.index].target === 0;
  }

  _log(ev) { this.events.push({ step: this.stepCount, ...ev }); }

  kick(dkx, dky) {
    if (this.result || this.kicksLeft <= 0) return false;
    const dk = this.level.inventory.kick.dk, m = Math.hypot(dkx, dky) || 1, q = (2 * Math.PI) / this.sim.L;
    // along a periodic axis only whole momentum quanta 2 pi / L are kicks without a seam
    const v = [(dkx / m) * dk, (dky / m) * dk].map((c, a) => (this.periodic[a] ? Math.round(c / q) * q : c));
    this.kicksLeft--;
    this.sim.kick(v[0], v[1]);
    this._log({ type: 'kick', dk: v });
    return true;
  }

  /** Field tilt as a unit-range vector; scaled by the level's tilt.max. */
  setTilt(ux, uy) {
    if (this.result || this.tiltMax <= 0) return;
    const m = Math.hypot(ux, uy);
    if (m > 1) { ux /= m; uy /= m; }
    if (ux === this.tilt[0] && uy === this.tilt[1]) return;
    this.tilt = [ux, uy];
    this.sim.setTilt(ux * this.tiltMax + this.field[0], uy * this.tiltMax + this.field[1]);
    this._log({ type: 'tilt', u: [ux, uy] });
  }

  /** Switch gate i; a pulse gate (`gate.pulse` steps) fires one pulse instead. */
  toggleGate(i) {
    if (this.result || !this.gates[i]) return;
    const g = this.gates[i]; g.open = g.pulse ? false : !g.open;
    this.sim.setGate(g.index, g.open);
    this._log({ type: 'gate', i, open: g.open });
  }

  /** Fire detector i: a projective-style yes/no measurement with smooth mask m.
   *  Kraus operators M_yes = m, M_no = sqrt(1-m^2) satisfy M_yes^2 + M_no^2 = 1. */
  fireDetector(i) {
    const d = this.detectors[i];
    if (this.result || !d || d.shots <= 0) return null;
    d.shots--; d.fired++;
    const sim = this.sim, pYes = sim.mass2(d.mask), u = this.rng();
    const yes = u < pYes || 1 - pYes < 1e-9;
    if (yes) { sim.applyMask(d.mask, 1 / Math.sqrt(pYes)); }
    else sim.applyComplement(d.mask, 1 / Math.sqrt(1 - pYes));
    sim.conditionCaught(yes, pYes);
    this._log({ type: 'detect', i, yes });
    return { yes, pYes };
  }

  canObserve() { return !this.result && this.t >= (this.level.minObserveTime || 0); }

  /** Final position measurement. Born mode samples |psi|^2 (u >= norm means the
   *  particle was already absorbed); expect mode is deterministic on the score.
   *  The score is P_T, except after detector firings: then it is the ledger's
   *  branch-averaged P_T (src/ledger.js), the result is `pending` and the caller
   *  completes it with scoreWith(). */
  observe() {
    if (!this.canObserve()) return null;
    const sim = this.sim, S = sim.norm(), pT = this.pT(), pM = this.pM();
    let outcome = null, sample = null;
    const pending = this.events.some(e => e.type === 'detect');
    if (this.mode !== 'expect') {
      const u = this.rng();
      if (u >= S) outcome = u < S + sim.caught ? 'boom' : 'lost';
      else if (this.stateMode) {
        // the projective "is it in the target state?" measurement: yes with probability F
        // (u < F <= S). The no branch is shown by a position sample of the remainder.
        const hit = u < pT;
        outcome = hit ? 'hit' : 'miss';
        sim.projectMode(this.stateMode, hit);
        const idx = sim.sampleCell(this.rng() * sim.norm()), N = sim.N;
        sample = { x: ((idx % N) + 0.5) * sim.dx, y: (Math.floor(idx / N) + 0.5) * sim.dx };
        if (!hit) sim.collapseTo(sample.x, sample.y, SIGMA_M); else sim.scale(1 / Math.sqrt(sim.norm()));
      } else if (this.kSpace) {
        // momentum measurement: sample |phi(k)|^2 on the shifted k grid
        const dens = sim.kDensity(new Float64Array(sim.N * sim.N)), N = sim.N, dk = (2 * Math.PI) / sim.L;
        let idx = 0; for (let acc = 0; idx < dens.length - 1; idx++) { acc += dens[idx]; if (acc > u) break; }
        sample = { kx: ((idx % N) - N / 2) * dk, ky: (Math.floor(idx / N) - N / 2) * dk, space: 'k' };
        const v = this.rng(), m = this.mineMask[idx];
        outcome = v < m ? 'mine' : v < m + Math.min(this.targetMask[idx], 1 - m) ? 'hit' : 'miss';
      } else {
        const idx = sim.sampleCell(u);
        const N = sim.N;
        sample = { x: ((idx % N) + 0.5) * sim.dx, y: (Math.floor(idx / N) + 0.5) * sim.dx };
        // the masks are smooth, so a cell is on a mine / target with probability
        // mask[idx]: this makes P(hit) = P_T and P(mine) = P_M exactly
        const v = this.rng(), m = this.mineMask[idx];
        outcome = v < m ? 'mine' : v < m + Math.min(this._targetAt(idx), 1 - m) ? 'hit' : 'miss';
        sim.collapseTo(sample.x, sample.y, SIGMA_M);
      }
    }
    this._log({ type: 'observe' });
    this.result = { outcome, hit: outcome === 'hit', pT, pM, lost: this.lost(), sample, stars: 0, step: this.stepCount, score: null, pending };
    if (!pending) this.scoreWith(pT);
    return this.result;
  }

  /** Rate the run: stars from `score`; in expect mode it also decides the outcome. */
  scoreWith(score, ledger = null) {
    const r = this.result;
    if (this.mode === 'expect') { r.outcome = score >= (this.level.expectThreshold ?? 0.5) ? 'hit' : 'miss'; r.hit = r.outcome === 'hit'; }
    const th = this.level.stars || [0.3, 0.5, 0.7];
    r.score = score; r.ledger = ledger; r.pending = false;
    r.stars = r.hit ? Math.max(1, th.filter(v => score >= v).length) : 0;
    return r;
  }

  /** Serialisable record: enough to replay deterministically (see tools/verify.js). */
  solution() {
    return {
      level: this.level.id, seed: this.seed, mode: this.mode, setup: this.setup,
      events: this.events, outcome: this.result && { outcome: this.result.outcome, pT: this.result.pT, score: this.result.score, stars: this.result.stars },
    };
  }

  /** Actions exposed to the UI with hotkeys: gates first, then detectors. */
  actions() {
    const list = [];
    this.gates.forEach((g, i) => list.push({ type: 'gate', i, label: g.label }));
    this.detectors.forEach((d, i) => list.push({ type: 'detector', i, label: d.label }));
    return list;
  }

  apply(ev) {
    switch (ev.type) {
      case 'kick': this.kick(ev.dk[0], ev.dk[1]); break;
      case 'tilt': this.setTilt(ev.u[0], ev.u[1]); break;
      case 'gate': this.toggleGate(ev.i); break;
      case 'detect': this.fireDetector(ev.i); break;
      case 'observe': this.observe(); break;
    }
  }
}

/** Replay a stored solution headlessly. */
export function replay(level, solution, opts = {}) {
  const s = new Session(level, solution.setup, { seed: solution.seed, mode: solution.mode, ...opts });
  for (const ev of solution.events) {
    if (ev.step > s.stepCount) s.step(ev.step - s.stepCount);
    s.apply(ev);
  }
  return s;
}

function unionMask(sim, shapes, raster = rasterMask) {
  const out = new Float64Array(sim.N * sim.N);
  for (const sh of shapes) {
    const m = raster(sim, sh);
    for (let i = 0; i < out.length; i++) if (m[i] > out[i]) out[i] = m[i];
  }
  return out;
}

/** Expand compact reference events: {step, type, ..., every, until} -> repeated events. */
export function expandEvents(events) {
  const out = [];
  for (const e of events || []) {
    const { every, until, ...rest } = e;
    if (every) for (let s = e.step; s <= (until ?? e.step); s += every) out.push({ ...rest, step: s });
    else out.push(rest);
  }
  return out.sort((a, b) => a.step - b.step);
}

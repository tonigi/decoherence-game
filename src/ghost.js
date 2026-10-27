// Ghost preview / level solver kernel: forward-simulate a setup (plus an
// optional scripted event list) on a coarse grid and return the P_T(t) curve.
import { Session, DT, expandEvents } from './session.js';

/** Synchronous; returns {t:[], pT:[], pM:[]} sampled every `every` steps. */
export function simulateCurve(level, setup, { N = 64, events = [], every = 4, tmax = level.tmax, seed = 1 } = {}) {
  const s = new Session(level, setup, { N, seed });
  const total = Math.round(tmax / DT);
  const out = { t: [], pT: [], pM: [], alive: [] };
  const evs = expandEvents(events);
  let e = 0;
  const sample = () => { out.t.push(s.t); out.pT.push(s.pT()); out.pM.push(s.pM()); out.alive.push(s.alive()); };
  sample();
  while (s.stepCount < total) {
    const next = Math.min(total, s.stepCount + every);
    // apply events at exact steps
    while (e < evs.length && evs[e].step <= s.stepCount) s.apply(evs[e++]);
    let stop = next;
    if (e < evs.length) stop = Math.min(stop, evs[e].step);
    s.step(stop - s.stepCount);
    if (stop === next) sample();
  }
  return out;
}

/** Async variant for the browser: yields to the event loop between chunks, cancellable. */
export function simulateCurveAsync(level, setup, { N = 64, every = 4, onDone, shouldCancel } = {}) {
  const s = new Session(level, setup, { N });
  const total = Math.round(level.tmax / DT);
  const out = { t: [s.t], pT: [s.pT()], pM: [s.pM()], alive: [s.alive()] };
  const tick = () => {
    if (shouldCancel && shouldCancel()) return;
    const t0 = performance.now();
    while (s.stepCount < total && performance.now() - t0 < 12) {
      s.step(every);
      out.t.push(s.t); out.pT.push(s.pT()); out.pM.push(s.pM()); out.alive.push(s.alive());
    }
    if (s.stepCount < total) setTimeout(tick, 0); else onDone(out);
  };
  setTimeout(tick, 0);
}

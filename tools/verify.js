// Level checker. For every level it scores
//   * the `reference` solution: must reach the 2-star threshold, and
//   * the `naive` play (what you get by ignoring the level's mechanic; defaults
//     to the level's default setup with no events): must stay below 1 star,
// so each level demonstrably rewards its lesson. The score is P_T at the
// observation, or the branch-averaged P_T (src/ledger.js) when detectors fire,
// exactly as the game rates a run. It also warns when the reference sits on a
// slider limit (the optimum is then "max the slider", not an insight).
//   node tools/verify.js                    # all levels
//   node tools/verify.js levels/5-2.json    # one level
//   node tools/verify.js --replay file.json # deterministic replay of a stored solution
import fs from 'node:fs';
import { Session, defaultSetup, defaultItem, expandEvents, replay, param, itemKeys, DT } from '../src/session.js';
import { ledger } from '../src/ledger.js';

const args = process.argv.slice(2);
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../levels/${id}.json`, import.meta.url), 'utf8'));

if (args[0] === '--replay') {
  const sol = JSON.parse(fs.readFileSync(args[1], 'utf8')), lv = load(sol.level);
  const s = replay(lv, sol);
  if (s.result?.pending) s.scoreWith(ledger(lv, s.solution()).score);
  const ok = s.result && sol.outcome && s.result.outcome === sol.outcome.outcome && Math.abs(s.result.pT - sol.outcome.pT) < 1e-6
    && (sol.outcome.score == null || Math.abs(s.result.score - sol.outcome.score) < 1e-6);
  console.log(JSON.stringify({ level: sol.level, recorded: sol.outcome, replayed: s.result && { outcome: s.result.outcome, pT: s.result.pT, score: s.result.score, stars: s.result.stars }, match: !!ok }));
  process.exit(ok ? 0 : 1);
}

/** Build a full setup from a level-file solution {setup:{launch, placed}, events, observeAt}. */
function setupOf(lv, sol) {
  const setup = defaultSetup(lv);
  Object.assign(setup.launch, sol?.setup?.launch || {});
  const specs = lv.inventory?.items || [];
  setup.placed = (sol?.setup?.placed || []).map(p => ({ ...defaultItem(specs.find(s => s.id === p.id), lv), ...p }));
  return setup;
}

/** Score a scripted run the way the game does. Without `observeAt` (and without
 *  detector events) the run is observed at its best moment, which is how the
 *  naive check gives naive play the benefit of perfect timing. */
export function scoreRun(lv, sol) {
  const setup = setupOf(lv, sol), events = expandEvents(sol?.events);
  if (sol?.observeAt == null) {
    if (events.some(e => e.type === 'detect')) throw new Error(lv.id + ': a run with detector events needs observeAt');
    const s = new Session(lv, setup, { seed: 1 }), minStep = Math.round((lv.minObserveTime || 0) / DT);
    let best = 0, bestT = 0, e = 0;
    for (const end = Math.round(lv.tmax / DT); s.stepCount <= end; s.step(1)) {
      while (e < events.length && events[e].step <= s.stepCount) s.apply(events[e++]);
      if (s.stepCount >= minStep && s.pT() > best) { best = s.pT(); bestT = s.t; }
    }
    return { score: best, pT: best, t: bestT, setup };
  }
  const observeStep = Math.round(sol.observeAt / DT);
  const s = new Session(lv, setup, { seed: 1, mode: 'expect' });
  let e = 0;
  while (s.stepCount < observeStep) {
    while (e < events.length && events[e].step <= s.stepCount) s.apply(events[e++]);
    const stop = e < events.length ? Math.min(observeStep, events[e].step) : observeStep;
    s.step(Math.max(1, stop - s.stepCount));
  }
  while (e < events.length && events[e].step <= s.stepCount) s.apply(events[e++]);
  const pT = s.pT();
  s.observe();
  if (!s.result.pending) return { score: pT, pT, setup };
  const L = ledger(lv, s.solution());
  return { score: L.score, pT, setup, ledger: L };
}

function limitWarnings(lv, sol) {
  const out = [], at = (v, p) => p.max > p.min && (Math.abs(v - p.min) < 1e-6 || Math.abs(v - p.max) < 1e-6);
  for (const [k, v] of Object.entries(sol?.setup?.launch || {})) if (at(v, param(lv.launch[k]))) out.push(`launch.${k}=${v}`);
  for (const p of sol?.setup?.placed || []) {
    const spec = (lv.inventory?.items || []).find(s => s.id === p.id);
    for (const k of itemKeys(spec)) if (k in p && at(p[k], param(spec[k]))) out.push(`${p.id}.${k}=${p[k]}`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = JSON.parse(fs.readFileSync(new URL('../levels/index.json', import.meta.url), 'utf8'));
  const ids = args[0] ? [args[0].replace(/.*\//, '').replace('.json', '')] : index.levels;
  const pct = (v) => (v * 100).toFixed(1).padStart(5) + '%';
  let failed = 0;
  for (const id of ids) {
    const lv = load(id), th = lv.stars || [];
    if (!lv.reference) { console.log(id.padEnd(4), 'no reference solution'); failed++; continue; }
    // `naive: false` opts a level out of the contrast check; it must say why in `naiveSkip`
    const skip = lv.naive === false;
    if (skip && !lv.naiveSkip) { console.log(id.padEnd(4), 'naive: false needs a naiveSkip reason'); failed++; continue; }
    const ref = scoreRun(lv, lv.reference), naive = skip ? null : scoreRun(lv, lv.naive || {});
    const stars = (v) => th.filter(t => v >= t).length;
    const okRef = ref.score >= (th[1] ?? 0), okNaive = skip || naive.score < (th[0] ?? 0);
    if (!okRef || !okNaive) failed++;
    const warn = limitWarnings(lv, lv.reference);
    console.log(id.padEnd(4),
      `reference ${pct(ref.score)} (${stars(ref.score)}★${ref.ledger ? `, ${ref.ledger.branches.length} branches` : ''})`,
      skip ? `naive check skipped (${lv.naiveSkip})` : `naive ${pct(naive.score)} (${stars(naive.score)}★${naive.t != null ? ` at t=${naive.t.toFixed(1)}` : ''})`,
      `stars ${th.map(v => (v * 100).toFixed(1)).join('/')}%`,
      okRef ? '' : ' REFERENCE BELOW 2 STARS', okNaive ? '' : ' NAIVE PLAY EARNS A STAR',
      warn.length ? ` warn: reference on slider limit (${warn.join(', ')})` : '');
  }
  process.exit(failed ? 1 : 0);
}

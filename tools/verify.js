// Replays each level's reference solution headlessly over many dice seeds and
// reports win rate and star distribution. Also usable on a saved replay:
//   node tools/verify.js                    # all levels that ship a reference
//   node tools/verify.js levels/5-2.json    # one level
//   node tools/verify.js --replay file.json # deterministic replay of a stored solution
import fs from 'node:fs';
import { Session, defaultSetup, expandEvents, replay, DT } from '../src/session.js';

const args = process.argv.slice(2);
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../levels/${id}.json`, import.meta.url), 'utf8'));

if (args[0] === '--replay') {
  const sol = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const s = replay(load(sol.level), sol);
  const ok = s.result && sol.outcome && s.result.outcome === sol.outcome.outcome && Math.abs(s.result.pT - sol.outcome.pT) < 1e-6;
  console.log(JSON.stringify({ level: sol.level, recorded: sol.outcome, replayed: s.result && { outcome: s.result.outcome, pT: s.result.pT, stars: s.result.stars }, match: !!ok }));
  process.exit(ok ? 0 : 1);
}

const index = JSON.parse(fs.readFileSync(new URL('../levels/index.json', import.meta.url), 'utf8'));
const ids = args[0] ? [args[0].replace(/.*\//, '').replace('.json', '')] : index.levels;
const SEEDS = 16;
let failed = 0;
for (const id of ids) {
  const lv = load(id);
  if (!lv.reference) { console.log(id.padEnd(4), 'no reference solution (setup-only level; use tools/solve.js)'); continue; }
  const setup = defaultSetup(lv);
  Object.assign(setup.launch, lv.reference.setup?.launch || {});
  setup.placed = lv.reference.setup?.placed || [];
  const events = expandEvents(lv.reference.events);
  const observeStep = Math.round((lv.reference.observeAt ?? lv.tmax) / DT);
  const random = events.some(e => e.type === 'detect'); // trajectories only depend on the dice when detectors fire
  let wins = 0, pTsum = 0, n = 0; const stars = [0, 0, 0, 0];
  const runTo = (seed) => {
    const s = new Session(lv, setup, { seed });
    let e = 0;
    while (s.stepCount < observeStep) {
      while (e < events.length && events[e].step <= s.stepCount) s.apply(events[e++]);
      const stop = e < events.length ? Math.min(observeStep, events[e].step) : observeStep;
      s.step(Math.max(1, stop - s.stepCount));
    }
    return s;
  };
  if (random) {
    for (let seed = 1; seed <= SEEDS; seed++) { const r = runTo(seed).observe(); pTsum += r.pT; wins += r.hit ? 1 : 0; stars[r.stars]++; n++; }
  } else {
    const s = runTo(1), pT = s.pT(); // deterministic: win chance is P_T itself
    const th = lv.stars || []; pTsum = pT; wins = pT; n = 1; stars[th.filter(v => pT >= v).length] = 1;
  }
  const need = lv.stars?.[1] ?? 0, meanP = pTsum / n;
  const ok = meanP >= need;
  if (!ok) failed++;
  console.log(id.padEnd(4), `mean P_T at observe ${(meanP * 100).toFixed(1)}%  win ${(100 * wins / n).toFixed(0)}%  ${random ? `stars[0..3] over ${SEEDS} dice = ${stars.join('/')}` : 'deterministic path'}  2-star threshold ${(need * 100).toFixed(0)}%  ${ok ? 'OK' : 'BELOW 2-STAR THRESHOLD'}`);
}
process.exit(failed ? 1 : 0);

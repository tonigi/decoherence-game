import { Session, defaultSetup, defaultItem, itemKeys, launchKeys, param, sanitizeSetup, DT } from './session.js';
import { Renderer, dialPos } from './render.js';
import { simulateCurveAsync } from './ghost.js';
import { ledgerAsync } from './ledger.js';
import { Sonifier } from './audio.js';
import { startTitle, buildMap } from './screens.js';
import { Tutorial } from './tutorial.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('born-rule:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('born-rule:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const ui = {
  index: null, levels: {}, level: null, session: null, renderer: null,
  setup: null, phase: 'setup', playing: false, speed: 1, acc: 0, mode: 'born',
  selected: -1, ghost: null, ghostToken: 0, history: { t: [], pT: [], pM: [] },
  keys: new Set(), lastFire: {}, frame: 0, leak: 0, stars: store.get('stars', {}),
  rebuildPending: false, drag: null, screen: null, view: 'phase', resultShownAt: 0,
};
const audio = new Sonifier();

// ---------------------------------------------------------------- loading and screens
async function init() {
  ui.index = await (await fetch('levels/index.json')).json();
  await Promise.all(ui.index.levels.map(async (id) => { ui.levels[id] = await (await fetch(`levels/${id}.json`)).json(); }));
  route();
  addEventListener('hashchange', route);
  requestAnimationFrame(loop);
}

/** #title, #map or #<level id>; no hash: the title on a first visit, else the last level. */
function route() {
  const h = location.hash.slice(1);
  if (ui.levels[h]) { if (ui.level?.id !== h || ui.screen !== 'game') openLevel(h); }
  else if (h === 'map') showScreen('map');
  else if (h === 'title' || !store.get('last', null)) showScreen('title');
  else openLevel(store.get('last'));
}
function go(hash) { if (location.hash.slice(1) === hash) route(); else location.hash = hash; }

function showScreen(name) {
  ui.screen = name;
  for (const n of ['title', 'map', 'game']) $(n + 'Screen').hidden = n !== name;
  if (name !== 'game') { if (ui.session) audio.update(ui.session, 'done', false); ui.playing = false; updatePanelsSafe(); tutorial.active && ($('coachLayer').hidden = true); }
  if (name === 'title') {
    const last = store.get('last', null);
    $('btnContinue').hidden = !last || !ui.levels[last];
    if (last && ui.levels[last]) $('btnContinue').textContent = `Continue ${last} ${ui.levels[last].title}`;
    $('btnStart').classList.toggle('prime', !last); $('btnContinue').classList.toggle('prime', !!last);
    startTitle($('titleField'), () => ui.screen === 'title');
  }
  if (name === 'map') {
    $('mapStars').textContent = `★ ${totalStars()} / ${3 * ui.index.levels.length}`;
    $('mapBack').hidden = !ui.level;
    buildMap($('chapters'), ui.index, ui.levels, ui.stars, ui.level?.id, (id) => go(id));
  }
}
$('btnStart').onclick = () => go(ui.index.levels[0]);
$('btnContinue').onclick = () => go(store.get('last'));
$('btnChapters').onclick = () => go('map');
$('mapHome').onclick = $('btnHome').onclick = () => go('title');
$('mapBack').onclick = () => ui.level && go(ui.level.id);
$('btnMap').onclick = () => go('map');

const updatePanelsSafe = () => { if (ui.session) updatePanels(); };
const totalStars = () => ui.index.levels.reduce((n, id) => n + (ui.stars[id] || 0), 0);
function buildNav() {
  const L = ui.index.levels, i = ui.level ? L.indexOf(ui.level.id) : 0, n = ui.stars[ui.level.id] || 0;
  $('btnMap').innerHTML = `${ui.level.id} <span class="note">of ${L.length}</span> <span class="st">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
  $('lvlPrev').disabled = i <= 0; $('lvlNext').disabled = i >= L.length - 1;
}
function stepLevel(d) {
  const L = ui.index.levels, i = L.indexOf(ui.level.id) + d;
  if (i >= 0 && i < L.length) go(L[i]);
}
$('lvlPrev').onclick = () => stepLevel(-1);
$('lvlNext').onclick = () => stepLevel(1);

function openLevel(id) { showScreen('game'); loadLevel(id); }

function loadLevel(id) {
  ui.level = ui.levels[id]; store.set('last', id);
  ui.setup = defaultSetup(ui.level); ui.selected = -1;
  const lv = ui.level, chap = ui.index.chapters.find(x => x.id === lv.chapter);
  $('crumb').innerHTML = `Ch ${lv.chapter} · ${chap?.name || ''} · <strong></strong>`;
  $('crumb').querySelector('strong').textContent = `${id} ${lv.title}`;
  $('lvlTitle').textContent = lv.title;
  // the textbook name of the experiment the level re-enacts
  $('lvlExperiment').textContent = lv.experiment || ''; $('lvlExperiment').hidden = !lv.experiment;
  $('lvlGoal').textContent = lv.goal || lv.intro;
  $('lvlGoal').title = lv.goal ? lv.intro : '';
  const ph = lv.physics;
  $('physCard').hidden = !ph;
  if (ph) { $('physPoint').textContent = ph.point; $('physEq').textContent = ph.eq || ''; $('btnWhy').hidden = !ph.learn; }
  closeDrawer();
  buildNav(); buildLaunchSliders(); buildInventory();
  resetToSetup();
  // momentum-measurement levels open in the (zoomed) momentum view, polarization levels in the polarization view
  ui.renderer.kView = lv.kView;
  const kLevel = lv.observe === 'momentum', pLevel = !!lv.spinor;
  $('viewToggle').querySelector('[data-view=polarization]').hidden = !pLevel;
  if (kLevel || pLevel || ui.autoView || ui.view === 'polarization') setView(kLevel ? 'momentum' : pLevel ? 'polarization' : 'phase');
  else setView(ui.view);
  ui.autoView = kLevel || pLevel;
  // guided levels run their tutorial the first time (and on request)
  tutorial.stop();
  if (lv.tutorial && !store.get('tut:' + id, false)) tutorial.start(lv);
  updateTutorialChrome();
}

// Born-mode and expectation-mode stars are kept apart: expectation mode removes
// the final roll, so its stars are not comparable.
const starKey = (id, mode) => (mode === 'expect' ? id + '@expect' : id);

function newSeed() { return (Math.random() * 2 ** 32) >>> 0; }

function resetToSetup(keepSeed) {
  ui.setup = sanitizeSetup(ui.level, ui.setup);
  ui.seed = keepSeed ? ui.seed : newSeed();
  if (tutorial.active && ui.phase !== 'setup') tutorial.reset();
  ui.session = new Session(ui.level, ui.setup, { seed: ui.seed, mode: ui.mode });
  if (!ui.renderer) ui.renderer = new Renderer(canvas, ui.session.sim); else ui.renderer.setSim(ui.session.sim);
  ui.phase = 'setup'; ui.playing = false; ui.history = { t: [], pT: [], pM: [] };
  ui.lastFire = {}; ui.keys.clear();
  $('banner').hidden = true; $('ledgerPanel').hidden = true; ui.viewBranch = null;
  clearTimeout(ui.resultTimer);
  buildActions(); updatePanels(); scheduleGhost();
}

function rebuildSetupView() { ui.rebuildPending = true; }

// ---------------------------------------------------------------- setup UI
function buildLaunchSliders() {
  const host = $('launchSliders'); host.innerHTML = '';
  const names = { x: 'x', y: 'y', k: '|k₀| speed', angle: 'angle °', sigma: 'σ width', sigmaT: 'σ⊥ width', pol: 'polarization °', ellip: 'ellipticity' };
  for (const key of launchKeys(ui.level)) {
    const p = param(ui.level.launch[key]), deg = DEGREE_KEYS.has(key);
    const row = document.createElement('div'); row.className = 'slider' + (p.max > p.min ? '' : ' fixed');
    row.innerHTML = `<span>${names[key]}</span><input type="range" min="${p.min}" max="${p.max}" step="${deg ? 1 : 0.05}" value="${p.v}" ${p.max > p.min ? '' : 'disabled'}><output></output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    out.textContent = (+p.v).toFixed(deg ? 0 : 2);
    inp.oninput = () => { ui.setup.launch[key] = +inp.value; out.textContent = (+inp.value).toFixed(deg ? 0 : 2); rebuildSetupView(); };
    inp.dataset.key = key; host.append(row);
  }
}

const DEGREE_KEYS = new Set(['angle', 'pol']);
function syncLaunchSliders() {
  for (const inp of document.querySelectorAll('#launchSliders input')) {
    const k = inp.dataset.key; inp.value = ui.setup.launch[k];
    inp.parentElement.querySelector('output').textContent = ui.setup.launch[k].toFixed(DEGREE_KEYS.has(k) ? 0 : 2);
  }
}

function buildInventory() {
  const host = $('inventory'); host.innerHTML = '';
  const items = ui.level.inventory?.items || [];
  if (!items.length) { $('itemPanel').innerHTML = ''; return; }
  host.innerHTML = '<h3>Inventory</h3>';
  for (const spec of items) {
    const b = document.createElement('button'); b.dataset.spec = spec.id;
    b.onclick = () => {
      if (ui.phase !== 'setup') return;
      if (countPlaced(spec.id) >= spec.count) return;
      ui.setup.placed.push(defaultItem(spec, ui.level)); ui.selected = ui.setup.placed.length - 1;
      rebuildSetupView(); updatePanels();
    };
    host.append(b);
  }
}
const countPlaced = (id) => ui.setup.placed.filter(p => p.id === id).length;

function buildItemPanel() {
  const host = $('itemPanel'); host.innerHTML = '';
  const it = ui.setup.placed[ui.selected]; if (!it || ui.phase !== 'setup') return;
  const spec = ui.level.inventory.items.find(s => s.id === it.id);
  const names = { w: 'width', h: 'height', V: 'strength V', r: 'radius', strength: 'meas. strength', pol: 'axis °', omega: 'rotation rate ω', delta: 'retardance rate δ', gradient: 'field gradient', period: 'period' };
  host.innerHTML = `<h3>${spec.label || spec.kind}</h3>`;
  for (const k of itemKeys(spec)) {
    const p = param(spec[k]), deg = DEGREE_KEYS.has(k), fix = (v) => (+v).toFixed(deg ? 0 : 2);
    if (!(p.max > p.min)) continue;   // fixed properties have no slider
    const row = document.createElement('div'); row.className = 'slider';
    row.innerHTML = `<span>${names[k] || k}</span><input type="range" min="${p.min}" max="${p.max}" step="${deg ? 1 : 0.05}" value="${it[k]}"><output>${fix(it[k])}</output>`;
    const inp = row.querySelector('input'); inp.dataset.key = k;
    inp.oninput = () => { const cur = ui.setup.placed[ui.selected]; if (cur) cur[k] = +inp.value; row.querySelector('output').textContent = fix(inp.value); rebuildSetupView(); };
    host.append(row);
  }
  const del = document.createElement('button'); del.textContent = 'Remove  (Del)';
  del.onclick = removeSelected; host.append(del);
}
function syncItemPanel() {
  const it = ui.setup.placed[ui.selected]; if (!it) return;
  for (const inp of document.querySelectorAll('#itemPanel input[data-key]')) {
    const k = inp.dataset.key; inp.value = it[k]; inp.parentElement.querySelector('output').textContent = (+it[k]).toFixed(DEGREE_KEYS.has(k) ? 0 : 2);
  }
}
function removeSelected() {
  if (ui.selected < 0) return;
  ui.setup.placed.splice(ui.selected, 1); ui.selected = -1; rebuildSetupView(); updatePanels();
}

function buildActions() {
  const host = $('actions'); host.innerHTML = '';
  const acts = ui.session.actions();
  acts.forEach((a, n) => {
    const b = document.createElement('button'); b.dataset.n = n; b.dataset.type = a.type; b.dataset.i = a.i;
    b.innerHTML = `${a.label} <kbd>${n + 1}</kbd>`;
    b.onpointerdown = () => doAction(n, true);
    b.onpointerup = b.onpointerleave = () => ui.keys.delete('act' + n);
    host.append(b);
  });
}

function updatePanels() {
  const s = ui.session, lv = ui.level, inv = lv.inventory || {};
  $('setupPanel').hidden = ui.phase !== 'setup';
  $('optExpect').disabled = ui.phase !== 'setup';
  for (const b of document.querySelectorAll('#inventory button')) {
    const spec = lv.inventory.items.find(x => x.id === b.dataset.spec);
    const left = spec.count - countPlaced(spec.id);
    b.textContent = `+ ${spec.label} (${left} left)`; b.disabled = left <= 0;
  }
  buildItemPanel();
  $('playIcon').textContent = ui.playing ? '❚❚' : '▶';
  $('btnPlay').setAttribute('aria-label', ui.playing ? 'Pause' : ui.phase === 'setup' ? 'Play' : 'Resume');
  $('btnPlay').disabled = ui.phase === 'done';
  const worldLooks = lv.minObserveTime != null && lv.minObserveTime >= lv.tmax;
  $('btnObserve').disabled = ui.phase === 'done' || !s.canObserve();
  $('btnObserve').title = worldLooks ? `In this level the world observes at t = ${(+lv.tmax).toFixed(1)}` : lv.minObserveTime ? `Allowed from t = ${(+lv.minObserveTime).toFixed(1)}` : 'Sample |ψ|² now';
  $('phaseTag').textContent = ui.viewBranch ? `branch ${pathLabel(ui.viewBranch.path)} · weight ${(ui.viewBranch.w * 100).toFixed(1)}% · P_T ${(ui.viewBranch.pT * 100).toFixed(0)}%` : ui.phase === 'setup' ? 'setup · drag the packet, its arrow and ring' : ui.phase === 'run' ? (ui.playing ? 'running' : 'paused') : 'measured';
  const bits = [];
  if (inv.kick) bits.push(`Kick: ${s.kicksLeft}/${inv.kick.charges} charges. Click the field while running (impulse toward the cursor).`);
  if (inv.tilt) bits.push('Field tilt: hold the arrow keys or WASD.');
  if (lv.minObserveTime) bits.push(worldLooks ? `The world observes at t = ${(+lv.minObserveTime).toFixed(1)}.` : `Observation allowed after t = ${(+lv.minObserveTime).toFixed(1)}.`);
  const dets = s.detectors.map((d) => `${d.label}: ${d.shots} shots`).join(', ');
  if (dets) bits.push(dets + (s.detectors.some(d => d.hold) ? '. Hold the key to pulse repeatedly.' : '.'));
  $('rtInfo').textContent = bits.join(' ');
  $('runCard').hidden = !bits.length && !s.actions().length;
  for (const b of document.querySelectorAll('#actions button')) {
    if (b.dataset.type === 'detector') b.disabled = s.detectors[+b.dataset.i].shots <= 0 || s.finished;
  }
  $('rowM').hidden = !hasMines();
  $('probEyebrow').textContent = s.result ? 'At the observation' : 'Probabilities now';
}

// ---------------------------------------------------------------- run control
function play() {
  if (ui.phase === 'done') return;
  if (ui.phase === 'setup') {
    // freeze the setup into a fresh session (same seed) and start
    resetFromSetup();
    ui.phase = 'run';
  }
  ui.playing = !ui.playing; updatePanels();
  if (ui.playing) tutorial.signal('play');
}
function resetFromSetup() {
  ui.session = new Session(ui.level, ui.setup, { seed: ui.seed, mode: ui.mode });
  ui.renderer.setSim(ui.session.sim); ui.history = { t: [], pT: [], pM: [] };
}

function observe() {
  const s = ui.session;
  if (ui.phase === 'setup') { resetFromSetup(); ui.phase = 'run'; }
  if (!s.canObserve()) return;
  const r = ui.session.observe();
  if (!r) return;
  ui.phase = 'done'; ui.playing = false;
  audio.observed(r, ui.level.grid.L);
  updatePanels(); tutorial.signal('observe');
  // a beat of drama: the crosshair and the collapsed packet first, then the card
  if (!r.pending) { const sess = ui.session; ui.resultTimer = setTimeout(() => { if (ui.session === sess) showResult(r); }, 700); return; }
  // detectors fired: score on the branch-averaged P_T (src/ledger.js)
  const sess = ui.session, b = $('banner');
  b.className = 'pending'; b.hidden = false;
  b.innerHTML = '<h2>Scoring…</h2><p>Following every detector outcome to compute the skill score.</p>';
  ledgerAsync(ui.level, sess.solution(), {
    shouldCancel: () => ui.session !== sess,
    onDone: (L) => { sess.scoreWith(L.score, L); showResult(sess.result); },
  });
}

// ---------------------------------------------------------------- branch ledger panel
/** Run-length label for an outcome history: YYYYN -> "Y4 N"; compressed components -> "mix 3". */
function pathLabel(path) {
  if (!path) return '(no outcome)';
  if (path[0] === '~') return 'mix ' + path.slice(1);
  return path.match(/(Y+|N+)/g).map(r => r[0] + (r.length > 1 ? r.length : '')).join(' ');
}
function buildLedgerPanel(L) {
  const host = $('ledgerRows'); host.innerHTML = '';
  $('ledgerPanel').hidden = !L;
  if (!L) return;
  const rows = L.branches.slice(0, 12), wmax = Math.max(...rows.map(b => b.w));
  const mine = document.createElement('button'); mine.className = 'cur';
  mine.innerHTML = `<span class="path" title="the branch the dice picked">your run</span><span></span><span class="p">P<sub>T</sub> ${(ui.session.result.pT * 100).toFixed(0)}%</span>`;
  mine.onclick = () => viewBranch(-1, mine);
  host.append(mine);
  rows.forEach((b, i) => {
    const el = document.createElement('button');
    el.title = (b.path[0] === '~' ? 'a component of the compressed branch ensemble' : 'detector outcomes in order: ' + b.path) + ` · weight ${(b.w * 100).toFixed(1)}%`;
    el.innerHTML = `<span class="path">${pathLabel(b.path)}</span><span class="w"><i style="width:${(100 * b.w / wmax).toFixed(0)}%"></i></span><span class="p">${(b.pT * 100).toFixed(0)}%</span>`;
    el.onclick = () => viewBranch(i, el);
    host.append(el);
  });
  if (L.branches.length > rows.length) host.insertAdjacentHTML('beforeend', `<span class="note">… and ${L.branches.length - rows.length} lighter branches</span>`);
}
/** Show a ledger branch's wave function on the canvas (-1: back to your own run). */
function viewBranch(i, el) {
  const L = ui.session.result?.ledger; if (!L) return;
  for (const b of document.querySelectorAll('#ledgerRows button')) b.classList.toggle('cur', b === el);
  $('banner').hidden = i >= 0;   // the banner would cover the branch; "your run" brings it back
  if (i < 0) { ui.renderer.setSim(ui.session.sim); ui.viewBranch = null; updatePanels(); return; }
  const b = L.branches[i];
  L.sim.load(b.state);
  ui.renderer.setSim(L.sim); ui.viewBranch = b; updatePanels();
}

const OUTCOME = {
  hit: ['Hit', 'The particle was found in the target.'], miss: ['Miss', 'The particle was found somewhere else.'],
  mine: ['Mine', 'The measurement found the particle on a mine.'], lost: ['Lost', 'The particle had already been absorbed at the edge.'],
  boom: ['Boom', 'The particle had already been absorbed by the bomb.'],
};
function showResult(r) {
  const b = $('banner'), lv = ui.level;
  const idx = ui.index.levels.indexOf(lv.id), next = ui.index.levels[idx + 1];
  const mode = ui.session.mode, L = r.ledger, pct = (v) => (v * 100).toFixed(1) + '%';
  const [head, sub] = OUTCOME[r.outcome] || ['Done', ''];
  const th = lv.stars || [];
  const nextStar = th.find(v => r.score < v);
  const when = lv.minObserveTime != null && lv.minObserveTime >= lv.tmax ? 'The world looked' : 'You looked';
  let body = `<p>${sub} ${when} at <b>t = ${ui.session.t.toFixed(1)}</b>, when P<sub>T</sub> was <b>${pct(r.pT)}</b>.`;
  if (r.hit && nextStar != null) body += ` The next star needs ${(nextStar * 100).toFixed(0)}%.`;
  body += '</p>';
  if (mode === 'expect') {
    body += `<p>Expectation mode: no dice. You win when the score reaches ${((lv.expectThreshold ?? 0.5) * 100).toFixed(0)}%.</p>`;
  } else if (L) {
    body += `<p>Detectors fired, so the stars come from the <b>skill score ${pct(r.score)}</b>: P<sub>T</sub> averaged over all ${L.branches.length} outcome branches of your inputs${L.resampled ? ` (compressed to the leading density-matrix components, error ≤ ${(L.dropped * 100).toFixed(1)}%)` : ''}. Your own branch was lucky or unlucky; the average is not. The Branches panel shows each one.</p>`;
  } else {
    // the Born rule as an ensemble: 100 runs of this exact state, P_T of them hits
    const n = Math.round(r.pT * 100), me = r.hit ? Math.min(n - 1, Math.floor(n / 2)) : Math.min(99, n + Math.floor((100 - n) / 2));
    body += `<p>If you ran this exact setup 100 times, about ${n} would find the particle in the target:</p>
      <div class="dots" aria-hidden="true">${Array.from({ length: 100 }, (_, i) => `<i class="${i < n ? 'h' : ''}${i === me ? ' me' : ''}"></i>`).join('')}</div>
      <p class="note">Outcome is chance. P<sub>T</sub> is skill. Stars come from P<sub>T</sub>, and only a hit earns them.</p>`;
  }
  b.className = r.hit ? 'win' : 'lose'; b.hidden = false;
  b.innerHTML = `<h2>${head}</h2><div class="stars" aria-label="${r.stars} of 3 stars">${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</div>${body}
    <div class="row">${next && r.hit ? '<button id="bNext" class="primary">Next level →</button>' : ''}<button id="bRetry" ${r.hit ? '' : 'class="primary"'}>Retry, new dice</button><button id="bSetup">Back to setup</button></div>
    <button class="copy" id="bCopy">Copy replay JSON</button>`;
  $('bRetry').onclick = () => { resetToSetup(); play(); };
  $('bSetup').onclick = () => resetToSetup();
  if ($('bNext')) $('bNext').onclick = () => go(next);
  $('bCopy').onclick = () => { navigator.clipboard?.writeText(JSON.stringify(ui.session.solution(), null, 1)).then(() => { $('bCopy').textContent = 'Copied'; }, () => {}); };
  const key = starKey(lv.id, mode);
  if (r.hit && r.stars > (ui.stars[key] || 0)) { ui.stars[key] = r.stars; store.set('stars', ui.stars); buildNav(); }
  buildLedgerPanel(L);
  tutorial.signal('result');
}

function doAction(n, down) {
  const a = ui.session.actions()[n]; if (!a) return;
  if (ui.phase === 'setup') { resetFromSetup(); ui.phase = 'run'; ui.playing = true; updatePanels(); }
  if (ui.phase !== 'run') return;
  if (a.type === 'gate') { if (down) { ui.session.toggleGate(a.i); audio.gate(ui.session.gates[a.i].open); } }
  else if (down) {
    const d = ui.session.detectors[a.i];
    const r = ui.session.fireDetector(a.i); ui.lastFire[a.i] = ui.session.stepCount;
    if (r) audio.detector(r.yes);
    if (d.hold) ui.keys.add('act' + n);
    updatePanels();
  }
}

// ---------------------------------------------------------------- input
function tiltFromKeys() {
  const k = ui.keys; let x = 0, y = 0;
  if (k.has('ArrowLeft') || k.has('a')) x -= 1; if (k.has('ArrowRight') || k.has('d')) x += 1;
  if (k.has('ArrowUp') || k.has('w')) y -= 1; if (k.has('ArrowDown') || k.has('s')) y += 1;
  return [x, y];
}

addEventListener('keydown', (e) => {
  if (ui.screen !== 'game') return;
  if (e.target.tagName === 'INPUT' && e.target.type === 'range') e.target.blur();
  if (e.target.tagName === 'SELECT') return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'Escape') { closeOverlays(); return; }
  if (key === '?') { toggleKeys(); return; }
  if (e.target.tagName === 'BUTTON' && (key === ' ' || key === 'Enter')) e.target.blur();
  if (e.repeat && /^[1-9]$/.test(key)) return;
  if (key === ' ') { e.preventDefault(); play(); return; }
  if (key === 'Enter') { e.preventDefault(); observe(); return; }
  if (key === 'r') { resetToSetup(true); return; }
  if (key === '[' || key === ']') { stepLevel(key === '[' ? -1 : 1); return; }
  if (key === 'v') {
    const vs = [...document.querySelectorAll('#viewToggle button')].filter(b => !b.hidden).map(b => b.dataset.view);
    setView(vs[(vs.indexOf(ui.view) + 1) % vs.length]); return;
  }
  if (key === 'c') { $('optCurrent').click(); return; }
  if (key === 'g') { $('optGhost').click(); return; }
  if (key === 'm') { $('optSound').click(); return; }
  if (key === 'Tab') return;
  if (key === 'Delete' || key === 'Backspace') { if (ui.phase === 'setup') removeSelected(); return; }
  if (/^[1-9]$/.test(key)) { doAction(+key - 1, true); return; }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) {
    e.preventDefault(); ui.keys.add(key);
  }
});
addEventListener('keyup', (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  ui.keys.delete(key);
  if (/^[1-9]$/.test(key)) ui.keys.delete('act' + (+key - 1));
});
addEventListener('blur', () => ui.keys.clear());

function pointer(e) {
  const r = canvas.getBoundingClientRect(), S = canvas.width / r.width, L = ui.level.grid.L;
  return { x: ((e.clientX - r.left) * S) / (canvas.width / L), y: ((e.clientY - r.top) * S) / (canvas.width / L), px: (e.clientX - r.left) * S, py: (e.clientY - r.top) * S };
}
const pxPerUnit = () => canvas.width / ui.level.grid.L;

// ---------------------------------------------------------------- playfield handles
// Every editable geometric property of the setup has a handle on the playfield.
// Handles live in world units and are rebuilt from the current setup each time
// (the setup is re-sanitised while dragging, so they never hold stale objects).
const ARROW_PX = 22;   // launch arrow: pixels per unit of |k|
const editable = (p) => { const q = param(p); return q.max > q.min; };
function setupHandles() {
  if (ui.phase !== 'setup') return [];
  const lv = ui.level, L = lv.launch, l = ui.setup.launch, S = pxPerUnit(), out = [];
  const a = (l.angle * Math.PI) / 180;
  if (editable(L.k) || editable(L.angle)) out.push({
    id: 'k', x: l.x + (Math.cos(a) * l.k * ARROW_PX) / S, y: l.y + (Math.sin(a) * l.k * ARROW_PX) / S, shape: 'dot', cursor: 'grab', title: 'momentum (speed and direction)',
    drag: (p) => { const dx = p.x - l.x, dy = p.y - l.y; if (editable(L.k)) l.k = (Math.hypot(dx, dy) * S) / ARROW_PX; if (editable(L.angle)) l.angle = (Math.atan2(dy, dx) * 180) / Math.PI; },
  });
  if (editable(L.sigma)) out.push({
    id: 'sigma', x: l.x + 2 * l.sigma * Math.SQRT1_2, y: l.y + 2 * l.sigma * Math.SQRT1_2, shape: 'ring', cursor: 'nwse-resize', title: 'packet width σ',
    drag: (p) => { l.sigma = Math.hypot(p.x - l.x, p.y - l.y) / 2; },
  });
  const it = ui.setup.placed[ui.selected];
  if (it) {
    const spec = lv.inventory.items.find(s => s.id === it.id);
    if (spec.shape === 'circle') {
      if (editable(spec.r)) out.push({ id: 'r', x: it.x + it.r, y: it.y, shape: 'square', cursor: 'ew-resize', title: 'radius', drag: (p) => { it.r = Math.hypot(p.x - it.x, p.y - it.y); } });
    } else {
      if (editable(spec.w)) out.push({ id: 'w', x: it.x + it.w / 2, y: it.y, shape: 'square', cursor: 'ew-resize', title: 'width', drag: (p) => { it.w = 2 * Math.abs(p.x - it.x); } });
      if (editable(spec.h)) out.push({ id: 'h', x: it.x, y: it.y + it.h / 2, shape: 'square', cursor: 'ns-resize', title: 'height', drag: (p) => { it.h = 2 * Math.abs(p.y - it.y); } });
    }
    // a polarization axis is a dot on the item's dial (drawn at the top of the element, see render.js)
    if (itemKeys(spec).includes('pol') && editable(spec.pol)) {
      const [cx, cy] = dialPos({ shape: 'rect', ...it }, true), R = 12 / S, a = (it.pol * Math.PI) / 180;
      out.push({
        id: 'pol', x: cx + R * Math.cos(a), y: cy - R * Math.sin(a), shape: 'dot', cursor: 'grab', title: 'polarization axis (drag around the dial)',
        drag: (p) => { let d = (Math.atan2(cy - p.y, p.x - cx) * 180) / Math.PI; if (d > 90) d -= 180; if (d < -90) d += 180; it.pol = Math.round(d); },
      });
    }
    // scalar strengths (barrier V, detector strength) sit on a stalk above the item:
    // the higher the handle, the larger the value over its range
    const top = it.y - (spec.shape === 'circle' ? it.r : it.h / 2);
    for (const k of ['V', 'strength', 'gradient']) {
      if (!itemKeys(spec).includes(k) || !editable(spec[k])) continue;
      const q = param(spec[k]), f = (it[k] - q.min) / (q.max - q.min);
      out.push({
        id: k, x: it.x, y: top - STALK_MIN - f * STALK_LEN, base: top, shape: 'stalk', cursor: 'ns-resize',
        label: `${{ V: 'V', strength: 's', gradient: 'g' }[k]} ${(+it[k]).toFixed(2)}`, title: { V: 'strength V', strength: 'measurement strength', gradient: 'field gradient' }[k] + ' (drag up / down)',
        drag: (p) => { const g = (top - STALK_MIN - p.y) / STALK_LEN; it[k] = q.min + Math.min(1, Math.max(0, g)) * (q.max - q.min); },
      });
    }
  }
  return out;
}
const STALK_MIN = 0.8, STALK_LEN = 3.5; // world units
const HANDLE_HIT_PX = 14;
function handleAt(p) {
  const S = pxPerUnit(); let best = null, bd = HANDLE_HIT_PX;
  for (const h of setupHandles()) { const d = Math.hypot(h.x * S - p.px, h.y * S - p.py); if (d <= bd) { bd = d; best = h; } }
  return best;
}
function itemAt(p) {
  for (let i = ui.setup.placed.length - 1; i >= 0; i--) {          // topmost last
    const it = ui.setup.placed[i], spec = ui.level.inventory.items.find(s => s.id === it.id);
    const inside = spec.shape === 'circle' ? Math.hypot(p.x - it.x, p.y - it.y) <= it.r : Math.abs(p.x - it.x) <= it.w / 2 && Math.abs(p.y - it.y) <= it.h / 2;
    if (inside) return i;
  }
  return -1;
}
function onPacket(p) {
  const lv = ui.level, l = ui.setup.launch, S = pxPerUnit();
  return (editable(lv.launch.x) || editable(lv.launch.y)) && Math.hypot(p.px - l.x * S, p.py - l.y * S) < Math.max(22, l.sigma * 2 * S);
}
/** Clamp the setup to the level's ranges right away and refresh sliders and the view. */
function setupChanged() {
  ui.setup = sanitizeSetup(ui.level, ui.setup);
  syncLaunchSliders(); syncItemPanel(); rebuildSetupView();
}

canvas.addEventListener('pointerdown', (e) => {
  const p = pointer(e);
  if (ui.phase === 'run' && ui.playing) {
    const [cx, cy] = ui.session.sim.centroid();
    if (ui.session.kick(p.x - cx, p.y - cy)) audio.kick();
    updatePanels(); return;
  }
  if (ui.phase !== 'setup') return;
  const h = handleAt(p), i = h ? -1 : itemAt(p);
  if (h) ui.drag = { kind: 'handle', id: h.id };
  else if (i >= 0) { if (ui.selected !== i) { ui.selected = i; updatePanels(); } const it = ui.setup.placed[i]; ui.drag = { kind: 'item', dx: it.x - p.x, dy: it.y - p.y }; }
  else if (onPacket(p)) { const l = ui.setup.launch; ui.drag = { kind: 'pos', dx: l.x - p.x, dy: l.y - p.y }; }
  else if (ui.selected >= 0) { ui.selected = -1; updatePanels(); }
  if (ui.drag) canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointer(e);
  if (!ui.drag) {                                   // hover feedback
    if (ui.phase !== 'setup') { canvas.style.cursor = ''; ui.hover = null; return; }
    const h = handleAt(p);
    ui.hover = h?.id || null;
    canvas.style.cursor = h ? h.cursor : itemAt(p) >= 0 || onPacket(p) ? 'move' : '';
    canvas.title = h ? h.title : '';
    return;
  }
  const l = ui.setup.launch;
  if (ui.drag.kind === 'handle') { setupHandles().find(h => h.id === ui.drag.id)?.drag(p); if (ui.drag.id === 'k') ui.dragged = true; }
  else if (ui.drag.kind === 'pos') { l.x = p.x + ui.drag.dx; l.y = p.y + ui.drag.dy; }
  else if (ui.drag.kind === 'item') { const it = ui.setup.placed[ui.selected]; it.x = p.x + ui.drag.dx; it.y = p.y + ui.drag.dy; }
  setupChanged();
});
canvas.addEventListener('pointerup', () => { ui.drag = null; if (ui.dragged) { ui.dragged = false; tutorial.signal('drag'); } });
canvas.addEventListener('pointerleave', () => { if (!ui.drag) ui.hover = null; });

$('btnPlay').onclick = play;
$('btnObserve').onclick = observe;
$('btnReset').onclick = () => resetToSetup(true);
$('speed').onchange = (e) => { ui.speed = +e.target.value; };
// the mode is fixed for the whole run (the checkbox is disabled outside setup)
$('optExpect').onchange = (e) => { if (ui.phase !== 'setup') { e.target.checked = ui.mode === 'expect'; return; } ui.mode = e.target.checked ? 'expect' : 'born'; resetToSetup(true); };
$('optCurrent').onchange = (e) => { ui.renderer.showCurrent = e.target.checked; };
$('optGhost').onchange = () => { scheduleGhost(); };
audio.enabled = $('optSound').checked = store.get('sound', true);
$('optSound').onchange = (e) => { store.set('sound', e.target.checked); audio.setEnabled(e.target.checked); };

// ---------------------------------------------------------------- view switch and legend
function setView(v) {
  const btn = $('viewToggle').querySelector(`[data-view=${v}]`);
  if (!btn || btn.hidden) v = 'phase';
  ui.view = v; ui.renderer.view = v;
  for (const b of document.querySelectorAll('#viewToggle button')) b.classList.toggle('on', b.dataset.view === v);
  drawLegend(v);
}
for (const b of document.querySelectorAll('#viewToggle button')) b.onclick = () => setView(b.dataset.view);
function drawLegend(v) {
  const c = $('wheel'), g = c.getContext('2d'), N = c.width, img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - N / 2 + 0.5, y = j - N / 2 + 0.5, r = Math.hypot(x, y) / (N / 2), k = 4 * (j * N + i);
    if (r > 1) continue;
    const a = Math.atan2(-y, x);
    // phase: hue = arg psi, brightness = |psi|; polarization: hue = 2 x axis angle (axes are mod 180 deg), white at the centre = circular
    const [R, G, B] = v === 'polarization' ? hsvMain(((2 * a) / (2 * Math.PI) + 1) % 1, 0.85 * r, 1)
      : v === 'density' ? [0.35 * r, 0.8 * r, r] : v === 'momentum' ? [r, 0.75 * r, 0.25 * r] : hsvMain((a / (2 * Math.PI) + 1) % 1, 0.8, Math.min(1, r * 1.1));
    img.data[k] = R * 255; img.data[k + 1] = G * 255; img.data[k + 2] = B * 255; img.data[k + 3] = 255;
  }
  g.clearRect(0, 0, N, N); g.putImageData(img, 0, 0);
  $('legendText').innerHTML = { phase: 'hue = phase<br>brightness = |ψ|', density: 'brightness = |ψ|²<br>(phase hidden)', momentum: 'momentum space |φ(k)|²<br>centre = k 0', polarization: 'hue = polarization axis<br>white = circular' }[v];
}
function hsvMain(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}

// ---------------------------------------------------------------- settings, keys sheet, physics drawer
$('btnSettings').onclick = (e) => { e.stopPropagation(); const p = $('settings'); p.hidden = !p.hidden; $('btnSettings').setAttribute('aria-expanded', !p.hidden); };
addEventListener('pointerdown', (e) => { if (!$('settings').hidden && !e.target.closest('.popwrap')) { $('settings').hidden = true; $('btnSettings').setAttribute('aria-expanded', 'false'); } });
function toggleKeys() { $('keysSheet').hidden = !$('keysSheet').hidden; }
$('btnKeys').onclick = toggleKeys; $('keysClose').onclick = toggleKeys;
$('keysSheet').onclick = (e) => { if (e.target === $('keysSheet')) toggleKeys(); };
function closeOverlays() { $('keysSheet').hidden = true; $('settings').hidden = true; closeDrawer(); }

function openDrawer(tab = 'idea') {
  const lv = ui.level, ph = lv.physics; if (!ph?.learn) return;
  $('drawerEyebrow').textContent = `${lv.id} · ${lv.title}${lv.experiment ? ' · ' + lv.experiment : ''}`;
  $('drawerTitle').textContent = 'The physics';
  $('drawerPoint').textContent = ph.point;
  for (const b of document.querySelectorAll('#drawerTabs button')) {
    b.hidden = !ph.learn[b.dataset.tab]?.length;
    b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab);
  }
  const body = $('drawerBody'); body.innerHTML = '';
  for (const item of ph.learn[tab] || []) {
    if (typeof item === 'string') { const p = document.createElement('p'); p.innerHTML = item; body.append(p); }
    else if (item.eq) { const d = document.createElement('div'); d.className = 'eqblk'; d.textContent = item.eq; body.append(d); }
  }
  $('drawer').hidden = false; ui.drawerTab = tab;
}
function closeDrawer() { $('drawer').hidden = true; }
$('btnWhy').onclick = () => openDrawer('idea');
$('drawerClose').onclick = closeDrawer;
for (const b of document.querySelectorAll('#drawerTabs button')) b.onclick = () => openDrawer(b.dataset.tab);

// ---------------------------------------------------------------- tutorial
const tutorial = new Tutorial({
  anchorRect(name) {
    const el = { field: 'field', play: 'btnPlay', observe: 'btnObserve', ring: 'probCard', timeline: 'timeline', physics: 'physCard', goal: 'goalCard', result: 'banner', setup: 'setupPanel' }[name];
    if (el) { const e = $(el); return e && !e.hidden && e.offsetParent !== null ? e.getBoundingClientRect() : null; }
    if (name.startsWith('handle:')) {
      const h = (ui.handles || []).find(q => q.id === name.slice(7)); if (!h) return null;
      const r = canvas.getBoundingClientRect(), f = r.width / ui.level.grid.L, x = r.left + h.x * f, y = r.top + h.y * f;
      return new DOMRect(x - 16, y - 16, 32, 32);
    }
    return null;
  },
  done(id) { store.set('tut:' + id, true); updateTutorialChrome(); },
  changed() { updateTutorialChrome(); },
});
function updateTutorialChrome() {
  const lv = ui.level, on = tutorial.active;
  $('btnSkipTut').hidden = !on; $('btnTut').hidden = on || !lv?.tutorial;
  $('tutDots').hidden = !on;
  $('goalEyebrow').textContent = on ? 'Guided level' : 'Goal';
  if (on) $('tutDots').innerHTML = tutorial.steps.map((_, i) => `<i class="${i < tutorial.i ? 'done' : i === tutorial.i ? 'cur' : ''}"></i>`).join('');
}
$('btnSkipTut').onclick = () => { const id = ui.level.id; tutorial.stop(); store.set('tut:' + id, true); };
$('btnTut').onclick = () => { if (ui.phase !== 'setup') resetToSetup(); tutorial.start(ui.level); };
// browsers start audio only after a user gesture
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => audio.unlock(), { capture: true });

// ---------------------------------------------------------------- ghost preview
let ghostTimer = 0;
function scheduleGhost() {
  clearTimeout(ghostTimer); ui.ghostToken++;
  if (!$('optGhost').checked) { ui.ghost = null; return; }
  const token = ui.ghostToken;
  ghostTimer = setTimeout(() => {
    const setup = sanitizeSetup(ui.level, ui.setup);
    simulateCurveAsync(ui.level, setup, { N: 64, shouldCancel: () => token !== ui.ghostToken, onDone: (c) => { if (token === ui.ghostToken) ui.ghost = c; } });
  }, 250);
}

// ---------------------------------------------------------------- main loop
function advance(budget) {
  const s = ui.session, acts = s.actions();
  while (budget > 0 && !s.finished && s.t < ui.level.tmax - 1e-9) {
    const [tx, ty] = tiltFromKeys(); s.setTilt(tx, ty);
    let n = Math.min(budget, Math.round(ui.level.tmax / DT) - s.stepCount);
    for (const key of ui.keys) {
      if (!key.startsWith('act')) continue;
      const a = acts[+key.slice(3)]; if (!a || a.type !== 'detector') continue;
      const d = s.detectors[a.i], cd = d.cooldown || 1, last = ui.lastFire[a.i] ?? -1e9;
      if (s.stepCount - last >= cd) { const r = s.fireDetector(a.i); ui.lastFire[a.i] = s.stepCount; if (r) audio.detector(r.yes); }
      n = Math.min(n, Math.max(1, ui.lastFire[a.i] + cd - s.stepCount));
    }
    s.step(n); budget -= n;
    if (s.stepCount % 2 === 0 || n > 1) { ui.history.t.push(s.t); ui.history.pT.push(s.pT()); ui.history.pM.push(s.pM()); }
  }
  if (!s.finished && s.t >= ui.level.tmax - 1e-9) observe();   // time is up: the world measures for you
}

function loop() {
  ui.frame++;
  if (ui.screen === 'game' && ui.session) {
    if (ui.rebuildPending && ui.phase === 'setup') {
      ui.rebuildPending = false; resetToSetup(true); scheduleGhost();
    }
    if (ui.phase === 'run' && ui.playing) {
      ui.acc += ui.speed; const n = Math.floor(ui.acc); ui.acc -= n;   // fractional speeds accumulate
      if (n > 0) advance(n);
      updatePanels();
    }
    draw();
    tutorial.tick(ui.session.t);
    if (ui.frame % 4 === 0) audio.update(ui.session, ui.phase, ui.playing);
  }
  requestAnimationFrame(loop);
}

/** Size a canvas's backing store to its CSS box (device pixels). */
function fitCanvas(c) {
  const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return d;
}

function draw() {
  const s = ui.session; if (!s) return;
  ui.handles = setupHandles();
  ui.renderer.draw(s, ui);
  $('clock').textContent = `t = ${s.t.toFixed(1)} / ${ui.level.tmax}`;
  // after an observation the meters hold the values at the moment of observation,
  // not the collapsed state (which would read as P_T jumping after a miss)
  const r = s.result, pT = r ? r.pT : s.pT(), pM = r ? r.pM : s.pM(), lost = r ? r.lost : s.lost();
  $('valT').textContent = (pT * 100).toFixed(1) + '%';
  $('barM').style.width = (pM * 100) + '%'; $('valM').textContent = (pM * 100).toFixed(1) + '%';
  $('barL').style.width = (lost * 100) + '%'; $('valL').textContent = (lost * 100).toFixed(1) + '%';
  drawRing(pT);
  if (ui.frame % 15 === 0 && !r) {
    ui.leak = s.sim.kLeak(0.6);
    const st = s.sim.stats();
    $('readout').innerHTML = (st ? `Δx·Δk<sub>x</sub> = <b>${(st.sx * st.skx).toFixed(2)}</b> ≥ ½ · Δx ${st.sx.toFixed(2)} · Δk<sub>x</sub> ${st.skx.toFixed(2)} · ⟨E⟩ <b>${st.E.toFixed(2)}</b>` : '')
      + (s.sim.spinor ? polReadout(s.sim.stokes()) : '');
  }
  $('barK').style.width = Math.min(100, ui.leak * 2000) + '%';
  $('valK').textContent = ui.leak > 0.01 ? 'ALIASING' : ui.leak > 1e-3 ? 'high' : 'ok';
  if (ui.frame % 2 === 0) drawPlot();
}

/** P_T as a ring with the star thresholds as gold ticks. */
function drawRing(v) {
  const c = $('ring'), g = c.getContext('2d'), W = c.width, cx = W / 2, R = W / 2 - 14;
  if (ui.ringV === v && ui.ringLevel === ui.level.id) return;
  ui.ringV = v; ui.ringLevel = ui.level.id;
  g.clearRect(0, 0, W, W); g.lineCap = 'round';
  g.lineWidth = 16; g.strokeStyle = '#ffffff14'; g.beginPath(); g.arc(cx, cx, R, 0, 2 * Math.PI); g.stroke();
  if (v > 0.002) { g.strokeStyle = '#4ff59a'; g.beginPath(); g.arc(cx, cx, R, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, v)); g.stroke(); }
  g.lineCap = 'butt'; g.lineWidth = 4;
  for (const t of ui.level.stars || []) {
    const a = -Math.PI / 2 + 2 * Math.PI * t;
    g.strokeStyle = v >= t ? '#ffc44d' : '#ffc44d88';
    g.beginPath(); g.moveTo(cx + (R - 13) * Math.cos(a), cx + (R - 13) * Math.sin(a)); g.lineTo(cx + (R + 13) * Math.cos(a), cx + (R + 13) * Math.sin(a)); g.stroke();
  }
}

/** Mean polarization from the Stokes vector: linear angle, linear and circular fractions. */
function polReadout([s1, s2, s3]) {
  const lin = Math.hypot(s1, s2), ang = (Math.atan2(s2, s1) * 90) / Math.PI;
  return `<br>polarization ${lin > 0.05 ? `linear <b>${ang.toFixed(0)}°</b> (${(lin * 100).toFixed(0)}%)` : 'no linear part'}${Math.abs(s3) > 0.05 ? `, circular ${(s3 * 100).toFixed(0)}%` : ''}`;
}

const hasMines = () => (ui.level.mines || []).length > 0 || ui.session.sim.hasWel;

/** The transport timeline: clock, ghost preview, this run's P_T (and P_M), star lines,
 *  the observation window and, on fixed-time levels, the moment the world observes. */
function drawPlot() {
  const c = $('plot'), d = fitCanvas(c), g = c.getContext('2d'), W = c.width, H = c.height, lv = ui.level, tmax = lv.tmax;
  g.clearRect(0, 0, W, H);
  const gh = ui.ghost, h = ui.history;
  let ymax = 0.2;
  for (const a of [gh?.pT, h.pT, gh && hasMines() ? gh.pM : null]) if (a) for (const v of a) ymax = Math.max(ymax, v * 1.15);
  ymax = Math.min(1, ymax);
  const x0 = 4 * d, x1 = W - 4 * d, top = 4 * d, bot = H - 14 * d;
  const X = (t) => x0 + (x1 - x0) * t / tmax, Y = (v) => bot - (bot - top) * v / ymax;
  g.fillStyle = '#ffffff07'; g.fillRect(x0, top, x1 - x0, bot - top);
  const mo = lv.minObserveTime;
  if (mo && mo < tmax) { g.fillStyle = '#ffffff0d'; g.fillRect(x0, top, X(mo) - x0, bot - top); }
  g.font = `${9.5 * d}px "JetBrains Mono", ui-monospace, monospace`; g.fillStyle = '#5c6383';
  const tick = tmax > 30 ? 10 : tmax > 12 ? 5 : 2;
  for (let t = 0; t <= tmax + 1e-9; t += tick) { g.textAlign = t === 0 ? 'left' : t >= tmax - 1e-9 ? 'right' : 'center'; g.fillText(t, X(t), H - 2 * d); }
  g.textAlign = 'left';
  g.setLineDash([3 * d, 3 * d]); g.lineWidth = d;
  for (const v of lv.stars || []) { if (v <= ymax) { g.strokeStyle = '#ffc44d55'; g.beginPath(); g.moveTo(x0, Y(v)); g.lineTo(x1, Y(v)); g.stroke(); } }
  g.setLineDash([]);
  const line = (ts, vs, color, w) => { if (!ts || !ts.length) return; g.strokeStyle = color; g.lineWidth = w * d; g.beginPath(); ts.forEach((t, i) => (i ? g.lineTo(X(t), Y(vs[i])) : g.moveTo(X(t), Y(vs[i])))); g.stroke(); };
  if (gh) { line(gh.t, gh.pT, 'rgba(79,245,154,0.4)', 3); if (hasMines()) line(gh.t, gh.pM, 'rgba(255,93,108,0.4)', 3); }
  line(h.t, h.pT, '#4ff59a', 2); if (hasMines()) line(h.t, h.pM, '#ff5d6c', 2);
  if (mo != null && mo >= tmax) {
    g.fillStyle = '#ffc44d'; g.fillRect(X(tmax) - 1.5 * d, top, 3 * d, bot - top);
    g.textAlign = 'right'; g.fillText('world observes ▸', X(tmax) - 6 * d, top + 9 * d); g.textAlign = 'left';
  }
  const t = ui.session.t, xt = X(t);
  g.strokeStyle = ui.session.result ? '#ffc44d' : '#fff'; g.lineWidth = 1.5 * d;
  g.beginPath(); g.moveTo(xt, top); g.lineTo(xt, bot); g.stroke();
  g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(xt, top + 2 * d, 3.5 * d, 0, 2 * Math.PI); g.fill();
}

init();

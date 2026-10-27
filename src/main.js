import { Session, defaultSetup, defaultItem, itemKeys, param, sanitizeSetup, DT } from './session.js';
import { Renderer } from './render.js';
import { simulateCurveAsync } from './ghost.js';
import { ledgerAsync } from './ledger.js';

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
  rebuildPending: false, drag: null,
};

// ---------------------------------------------------------------- loading
async function init() {
  ui.index = await (await fetch('levels/index.json')).json();
  await Promise.all(ui.index.levels.map(async (id) => { ui.levels[id] = await (await fetch(`levels/${id}.json`)).json(); }));
  buildNav();
  const want = location.hash.slice(1);
  loadLevel(ui.levels[want] ? want : store.get('last', ui.index.levels[0]));
  requestAnimationFrame(loop);
}

function buildNav() {
  const nav = $('levels'); nav.innerHTML = '';
  let chap = null;
  for (const id of ui.index.levels) {
    const lv = ui.levels[id];
    if (lv.chapter !== chap) {
      chap = lv.chapter;
      const c = document.createElement('span'); c.className = 'chap';
      c.textContent = 'Ch ' + chap + ' · ' + (ui.index.chapters.find(x => x.id === chap)?.name || ''); nav.append(c);
    }
    const b = document.createElement('button'); b.dataset.id = id;
    const ex = ui.stars[starKey(id, 'expect')] || 0;
    b.innerHTML = `${id} <span class="st">${'★'.repeat(ui.stars[id] || 0)}</span>${ex ? `<span class="st ex" title="expectation mode">${'★'.repeat(ex)}</span>` : ''}`;
    b.title = lv.title; b.onclick = () => loadLevel(id);
    if (ui.level && ui.level.id === id) b.classList.add('cur');
    nav.append(b);
  }
}

function loadLevel(id) {
  ui.level = ui.levels[id]; store.set('last', id); history.replaceState(null, '', '#' + id);
  ui.setup = defaultSetup(ui.level); ui.selected = -1;
  $('lvlTitle').textContent = `${id} · ${ui.level.title}`;
  $('lvlIntro').textContent = ui.level.intro;
  buildNav(); buildStarTicks(); buildLaunchSliders(); buildInventory();
  resetToSetup();
  // momentum-measurement levels open in the (zoomed) momentum view
  ui.renderer.kView = ui.level.kView;
  const kLevel = ui.level.observe === 'momentum';
  if (kLevel || ui.autoK) { $('view_mode').value = kLevel ? 'momentum' : 'phase'; ui.renderer.view = $('view_mode').value; }
  ui.autoK = kLevel;
}

// Born-mode and expectation-mode stars are kept apart: expectation mode removes
// the final roll, so its stars are not comparable.
const starKey = (id, mode) => (mode === 'expect' ? id + '@expect' : id);

function newSeed() { return (Math.random() * 2 ** 32) >>> 0; }

function resetToSetup(keepSeed) {
  ui.setup = sanitizeSetup(ui.level, ui.setup);
  ui.seed = keepSeed ? ui.seed : newSeed();
  ui.session = new Session(ui.level, ui.setup, { seed: ui.seed, mode: ui.mode });
  if (!ui.renderer) ui.renderer = new Renderer(canvas, ui.session.sim); else ui.renderer.setSim(ui.session.sim);
  ui.phase = 'setup'; ui.playing = false; ui.history = { t: [], pT: [], pM: [] };
  ui.lastFire = {}; ui.keys.clear();
  $('banner').hidden = true;
  buildActions(); updatePanels(); scheduleGhost();
}

function rebuildSetupView() { ui.rebuildPending = true; }

// ---------------------------------------------------------------- setup UI
function buildLaunchSliders() {
  const host = $('launchSliders'); host.innerHTML = '';
  const names = { x: 'x', y: 'y', k: '|k₀| speed', angle: 'angle °', sigma: 'σ width' };
  for (const key of ['x', 'y', 'k', 'angle', 'sigma']) {
    const p = param(ui.level.launch[key]);
    const row = document.createElement('div'); row.className = 'slider' + (p.max > p.min ? '' : ' fixed');
    const step = key === 'angle' ? 1 : 0.05;
    row.innerHTML = `<span>${names[key]}</span><input type="range" min="${p.min}" max="${p.max}" step="${step}" value="${p.v}" ${p.max > p.min ? '' : 'disabled'}><output></output>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    out.textContent = (+p.v).toFixed(key === 'angle' ? 0 : 2);
    inp.oninput = () => { ui.setup.launch[key] = +inp.value; out.textContent = (+inp.value).toFixed(key === 'angle' ? 0 : 2); rebuildSetupView(); };
    inp.dataset.key = key; host.append(row);
  }
}

function syncLaunchSliders() {
  for (const inp of document.querySelectorAll('#launchSliders input')) {
    const k = inp.dataset.key; inp.value = ui.setup.launch[k];
    inp.parentElement.querySelector('output').textContent = ui.setup.launch[k].toFixed(k === 'angle' ? 0 : 2);
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
  const names = { w: 'width', h: 'height', V: 'strength V', r: 'radius' };
  host.innerHTML = `<h3>${spec.label}</h3>`;
  for (const k of itemKeys(spec)) {
    const p = param(spec[k]);
    const row = document.createElement('div'); row.className = 'slider';
    row.innerHTML = `<span>${names[k]}</span><input type="range" min="${p.min}" max="${p.max}" step="0.05" value="${it[k]}"><output>${(+it[k]).toFixed(2)}</output>`;
    const inp = row.querySelector('input');
    inp.oninput = () => { it[k] = +inp.value; row.querySelector('output').textContent = (+inp.value).toFixed(2); rebuildSetupView(); };
    host.append(row);
  }
  const del = document.createElement('button'); del.textContent = 'Remove  (Del)';
  del.onclick = removeSelected; host.append(del);
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
  buildStarTicks();
}

function buildStarTicks() {
  $('starTicks').innerHTML = (ui.level.stars || []).map(v => `<span style="left:${Math.min(100, v * 100)}%"></span>`).join('');
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
  $('btnPlay').textContent = ui.playing ? '⏸ Pause' : (ui.phase === 'setup' ? '▶ Play' : '▶ Resume');
  $('btnPlay').disabled = ui.phase === 'done';
  $('btnObserve').disabled = ui.phase === 'done' || !s.canObserve();
  $('phaseTag').textContent = ui.phase === 'setup' ? 'setup: drag the packet, its arrow, and any items' : ui.phase === 'run' ? (ui.playing ? 'running' : 'paused') : 'measured';
  const bits = [];
  if (inv.kick) bits.push(`Kick: ${s.kicksLeft}/${inv.kick.charges} charges - click the field (impulse toward the cursor).`);
  if (inv.tilt) bits.push('Field tilt: hold arrow keys / WASD.');
  if (lv.minObserveTime) bits.push(lv.minObserveTime >= lv.tmax ? `The detector clicks at t = ${(+lv.minObserveTime).toFixed(1)}.` : `Observation allowed after t = ${(+lv.minObserveTime).toFixed(1)}.`);
  const dets = s.detectors.map((d, i) => `${d.label} ${d.shots} shots`).join(', ');
  if (dets) bits.push(dets + (s.detectors.some(d => d.hold) ? ' - hold the key to pulse repeatedly.' : '.'));
  $('rtInfo').textContent = bits.join(' ');
  for (const b of document.querySelectorAll('#actions button')) {
    if (b.dataset.type === 'detector') b.disabled = s.detectors[+b.dataset.i].shots <= 0 || s.finished;
  }
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
  updatePanels();
  if (!r.pending) { showResult(r); return; }
  // detectors fired: score on the branch-averaged P_T (src/ledger.js)
  const sess = ui.session, b = $('banner');
  b.className = 'pending'; b.hidden = false;
  b.innerHTML = '<h2>Scoring…</h2><p>Following every detector outcome to compute the skill score.</p>';
  ledgerAsync(ui.level, sess.solution(), {
    shouldCancel: () => ui.session !== sess,
    onDone: (L) => { sess.scoreWith(L.score, L); showResult(sess.result); },
  });
}

function showResult(r) {
  const b = $('banner'), lv = ui.level;
  const txt = {
    hit: r.stars >= 3 ? 'Direct hit!' : 'Hit!', miss: 'Missed - the particle was found elsewhere.',
    mine: 'Boom - the measurement found the particle on a mine.', lost: 'Lost - the particle had already been absorbed at the boundary.',
    boom: 'Boom - the particle had already been absorbed by the bomb.',
  }[r.outcome];
  b.className = r.hit ? 'win' : 'lose'; b.hidden = false;
  const idx = ui.index.levels.indexOf(lv.id), next = ui.index.levels[idx + 1];
  const mode = ui.session.mode, L = r.ledger;
  const expectNote = mode === 'expect' ? ` (expectation mode: score ${r.score >= (lv.expectThreshold ?? 0.5) ? '≥' : '<'} ${((lv.expectThreshold ?? 0.5) * 100).toFixed(0)}%)` : '';
  const ledgerNote = L ? `<p>Detectors fired, so the stars come from the <b>skill score ${(r.score * 100).toFixed(1)}%</b>: P<sub>T</sub> averaged over all
    ${L.branches.length} outcome branches of your inputs (${L.branches.slice(0, 4).map(q => `${q.path}: ${(q.w * 100).toFixed(0)}% × ${(q.pT * 100).toFixed(0)}%`).join(', ')}${L.branches.length > 4 ? ', …' : ''}${L.dropped > 1e-3 ? `; ${(L.dropped * 100).toFixed(1)}% weight pruned and scored 0` : ''}).
    Your own branch's P<sub>T</sub> was lucky or unlucky; the average is not.</p>` : '';
  b.innerHTML = `<h2>${txt} ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</h2>
    <p>P<sub>T</sub> at observation = <b>${(r.pT * 100).toFixed(1)}%</b>, P<sub>M</sub> = ${(r.pM * 100).toFixed(1)}%, absorbed = ${(r.lost * 100).toFixed(1)}%${expectNote}.
    ${L ? '' : 'The stars come from P<sub>T</sub> at the moment you observed, so skill is rewarded even when the dice are unkind.'}</p>${ledgerNote}
    <div class="row"><button id="bRetry" class="primary">Retry (new dice)</button><button id="bSetup">Back to setup</button>
    ${next && r.hit ? '<button id="bNext">Next level →</button>' : ''}<button id="bCopy">Copy replay JSON</button></div>`;
  $('bRetry').onclick = () => { resetToSetup(); play(); };
  $('bSetup').onclick = () => resetToSetup();
  if ($('bNext')) $('bNext').onclick = () => loadLevel(next);
  $('bCopy').onclick = () => { navigator.clipboard?.writeText(JSON.stringify(ui.session.solution(), null, 1)); $('bCopy').textContent = 'Copied'; };
  const key = starKey(lv.id, mode);
  if (r.hit && r.stars > (ui.stars[key] || 0)) { ui.stars[key] = r.stars; store.set('stars', ui.stars); buildNav(); }
}

function doAction(n, down) {
  const a = ui.session.actions()[n]; if (!a) return;
  if (ui.phase === 'setup') { resetFromSetup(); ui.phase = 'run'; ui.playing = true; updatePanels(); }
  if (ui.phase !== 'run') return;
  if (a.type === 'gate') { if (down) ui.session.toggleGate(a.i); }
  else if (down) {
    const d = ui.session.detectors[a.i];
    ui.session.fireDetector(a.i); ui.lastFire[a.i] = ui.session.stepCount;
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
  if (e.target.tagName === 'INPUT' && e.target.type === 'range') e.target.blur();
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.repeat && /^[1-9]$/.test(key)) return;
  if (key === ' ') { e.preventDefault(); play(); return; }
  if (key === 'Enter') { e.preventDefault(); observe(); return; }
  if (key === 'r') { resetToSetup(true); return; }
  if (key === 'v') { const sel = $('view_mode'); sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; sel.onchange(); return; }
  if (key === 'c') { $('optCurrent').click(); return; }
  if (key === 'g') { $('optGhost').click(); return; }
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

canvas.addEventListener('pointerdown', (e) => {
  const p = pointer(e), lv = ui.level;
  if (ui.phase === 'run' && ui.playing) {
    const [cx, cy] = ui.session.sim.centroid();
    ui.session.kick(p.x - cx, p.y - cy); updatePanels(); return;
  }
  if (ui.phase !== 'setup') return;
  const l = ui.setup.launch, S = pxPerUnit(), a = l.angle * Math.PI / 180;
  const hx = l.x * S + Math.cos(a) * l.k * 22, hy = l.y * S + Math.sin(a) * l.k * 22;
  const kEditable = param(lv.launch.k).max > param(lv.launch.k).min || param(lv.launch.angle).max > param(lv.launch.angle).min;
  const posEditable = param(lv.launch.x).max > param(lv.launch.x).min || param(lv.launch.y).max > param(lv.launch.y).min;
  if (kEditable && Math.hypot(p.px - hx, p.py - hy) < 16) ui.drag = { kind: 'k' };
  else {
    // items first (topmost last)
    for (let i = ui.setup.placed.length - 1; i >= 0; i--) {
      const it = ui.setup.placed[i], spec = lv.inventory.items.find(s => s.id === it.id);
      const inside = spec.shape === 'circle' ? Math.hypot(p.x - it.x, p.y - it.y) <= it.r : Math.abs(p.x - it.x) <= it.w / 2 && Math.abs(p.y - it.y) <= it.h / 2;
      if (inside) { ui.selected = i; ui.drag = { kind: 'item', dx: it.x - p.x, dy: it.y - p.y }; updatePanels(); canvas.setPointerCapture(e.pointerId); return; }
    }
    if (posEditable && Math.hypot(p.px - l.x * S, p.py - l.y * S) < Math.max(22, l.sigma * 2 * S)) ui.drag = { kind: 'pos', dx: l.x - p.x, dy: l.y - p.y };
    else { ui.selected = -1; updatePanels(); }
  }
  if (ui.drag) canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!ui.drag) return;
  const p = pointer(e), l = ui.setup.launch;
  if (ui.drag.kind === 'k') {
    const S = pxPerUnit(), dx = p.px - l.x * S, dy = p.py - l.y * S;
    l.k = Math.hypot(dx, dy) / 22; l.angle = Math.atan2(dy, dx) * 180 / Math.PI;
    syncLaunchSliders();
  } else if (ui.drag.kind === 'pos') { l.x = p.x + ui.drag.dx; l.y = p.y + ui.drag.dy; syncLaunchSliders(); }
  else if (ui.drag.kind === 'item') { const it = ui.setup.placed[ui.selected]; it.x = p.x + ui.drag.dx; it.y = p.y + ui.drag.dy; }
  rebuildSetupView();
});
canvas.addEventListener('pointerup', () => { ui.drag = null; });

$('btnPlay').onclick = play;
$('btnObserve').onclick = observe;
$('btnReset').onclick = () => resetToSetup(true);
$('speed').onchange = (e) => { ui.speed = +e.target.value; };
// the mode is fixed for the whole run (the checkbox is disabled outside setup)
$('optExpect').onchange = (e) => { if (ui.phase !== 'setup') { e.target.checked = ui.mode === 'expect'; return; } ui.mode = e.target.checked ? 'expect' : 'born'; resetToSetup(true); };
$('view_mode').onchange = () => { ui.renderer.view = $('view_mode').value; };
$('optCurrent').onchange = (e) => { ui.renderer.showCurrent = e.target.checked; };
$('optGhost').onchange = () => { scheduleGhost(); };

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
      if (s.stepCount - last >= cd) { s.fireDetector(a.i); ui.lastFire[a.i] = s.stepCount; }
      n = Math.min(n, Math.max(1, ui.lastFire[a.i] + cd - s.stepCount));
    }
    s.step(n); budget -= n;
    if (s.stepCount % 2 === 0 || n > 1) { ui.history.t.push(s.t); ui.history.pT.push(s.pT()); ui.history.pM.push(s.pM()); }
  }
  if (!s.finished && s.t >= ui.level.tmax - 1e-9) observe();   // time is up: the world measures for you
}

function loop() {
  ui.frame++;
  if (ui.rebuildPending && ui.phase === 'setup') {
    ui.rebuildPending = false; resetToSetup(true); scheduleGhost();
  }
  if (ui.phase === 'run' && ui.playing) {
    ui.acc += ui.speed; const n = Math.floor(ui.acc); ui.acc -= n;   // fractional speeds accumulate
    if (n > 0) advance(n);
    updatePanels();
  }
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  const s = ui.session; if (!s) return;
  ui.renderer.draw(s, ui);
  $('clock').textContent = `t = ${s.t.toFixed(1)} / ${ui.level.tmax}`;
  const pT = s.pT(), pM = s.pM(), lost = s.lost();
  $('barT').style.width = (pT * 100) + '%'; $('valT').textContent = (pT * 100).toFixed(1) + '%';
  $('barM').style.width = (pM * 100) + '%'; $('valM').textContent = (pM * 100).toFixed(1) + '%';
  $('barL').style.width = (lost * 100) + '%'; $('valL').textContent = (lost * 100).toFixed(1) + '%';
  if (ui.frame % 15 === 0) ui.leak = s.sim.kLeak(0.6);
  $('barK').style.width = Math.min(100, ui.leak * 2000) + '%';
  $('valK').textContent = ui.leak > 0.01 ? 'ALIASING' : ui.leak > 1e-3 ? 'high' : 'ok';
  if (ui.frame % 3 === 0) drawPlot();
}

const hasMines = () => (ui.level.mines || []).length > 0 || ui.session.sim.hasWel;

function drawPlot() {
  const c = $('plot'), g = c.getContext('2d'), W = c.width, H = c.height, tmax = ui.level.tmax;
  g.clearRect(0, 0, W, H);
  const gh = ui.ghost, h = ui.history;
  let ymax = 0.2;
  for (const a of [gh?.pT, h.pT]) if (a) for (const v of a) ymax = Math.max(ymax, v * 1.15);
  ymax = Math.min(1, ymax);
  const X = (t) => 28 + (W - 36) * t / tmax, Y = (v) => H - 18 - (H - 28) * v / ymax;
  g.font = '10px system-ui'; g.fillStyle = '#8b93a7'; g.strokeStyle = '#2a3245'; g.lineWidth = 1;
  for (let v = 0; v <= ymax + 1e-9; v += ymax > 0.5 ? 0.25 : 0.1) { g.beginPath(); g.moveTo(28, Y(v)); g.lineTo(W - 8, Y(v)); g.stroke(); g.fillText((v * 100).toFixed(0) + '%', 2, Y(v) + 3); }
  for (let t = 0; t <= tmax; t += 5) g.fillText(t, X(t) - 4, H - 4);
  g.setLineDash([4, 3]); g.strokeStyle = '#ffd23f66';
  for (const v of ui.level.stars || []) { if (v <= ymax) { g.beginPath(); g.moveTo(28, Y(v)); g.lineTo(W - 8, Y(v)); g.stroke(); } }
  g.setLineDash([]);
  const line = (ts, vs, color, w = 2) => { if (!ts || !ts.length) return; g.strokeStyle = color; g.lineWidth = w; g.beginPath(); ts.forEach((t, i) => (i ? g.lineTo(X(t), Y(vs[i])) : g.moveTo(X(t), Y(vs[i])))); g.stroke(); };
  if (gh) { line(gh.t, gh.pT, 'rgba(76,255,124,0.3)', 3); if (hasMines()) line(gh.t, gh.pM, 'rgba(255,74,74,0.3)', 3); }
  line(h.t, h.pT, '#4cff7c'); if (hasMines()) line(h.t, h.pM, '#ff4a4a');
  g.strokeStyle = '#fff6'; g.beginPath(); g.moveTo(X(ui.session.t), 4); g.lineTo(X(ui.session.t), H - 16); g.stroke();
  if (ui.level.minObserveTime) { g.fillStyle = '#ffffff10'; g.fillRect(28, 4, X(ui.level.minObserveTime) - 28, H - 20); }
}

init();

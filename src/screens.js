// Title and chapter-map screens. The title shows an exact free Gaussian drifting
// and spreading (analytic, so it costs nothing); the map renders every level's
// real initial state and geometry through the game's own Session and Renderer.
import { Session, defaultSetup } from './session.js';
import { Renderer } from './render.js';

// ---------------------------------------------------------------- title
// psi(x,t) per axis = a^{-1/2} exp(-(x - x0 - k t)^2 / (4 s^2 a) + i k (x - x0) - i k^2 t / 2),
// a = 1 + i t / (2 s^2)   (hbar = m = 1)
function freeGaussian(N, L, p, t, out) {
  const dx = L / N, s2 = p.s * p.s, ai = t / (2 * s2), aa = 1 + ai * ai;
  const cr = 1 / (4 * s2) / aa, ci = -ai / (4 * s2) / aa;
  const axis = (x0, k) => {
    const m = new Float32Array(N), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * dx, d = x - x0 - k * t, d2 = d * d;
      m[i] = -d2 * cr; ph[i] = -d2 * ci + k * (x - x0) - 0.5 * k * k * t;
    }
    return [m, ph];
  };
  const [mx, px] = axis(p.x, p.kx), [my, py] = axis(p.y, p.ky), pre = -Math.atan2(ai, 1), amp = 1 / Math.sqrt(aa);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const m = Math.exp(mx[i] + my[j]) * amp, ph = px[i] + py[j] + pre, k = j * N + i;
    out.re[k] = m * Math.cos(ph); out.im[k] = m * Math.sin(ph);
  }
}

export function startTitle(canvas, isActive) {
  const N = 120, L = 40, f = { re: new Float32Array(N * N), im: new Float32Array(N * N) };
  const off = document.createElement('canvas'); off.width = off.height = N;
  const octx = off.getContext('2d'), img = octx.createImageData(N, N);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  const frame = (now) => {
    if (!isActive()) return;
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    const t = reduce ? 6 : ((now - t0) / 1000 * 0.9) % 22;
    freeGaussian(N, L, { x: 17, y: 21, kx: 1.0, ky: -0.15, s: 1.4 }, t, f);
    let peak = 1e-12; for (let i = 0; i < N * N; i++) peak = Math.max(peak, f.re[i] ** 2 + f.im[i] ** 2);
    const d = img.data;
    for (let i = 0; i < N * N; i++) {
      const b = Math.min(1, Math.pow((f.re[i] ** 2 + f.im[i] ** 2) / peak, 0.45));
      const [R, G, B] = hsv((Math.atan2(f.im[i], f.re[i]) / (2 * Math.PI) + 1) % 1, 0.8, b);
      d[4 * i] = R * 255; d[4 * i + 1] = G * 255; d[4 * i + 2] = B * 255; d[4 * i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, S = Math.max(W * 0.75, H);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high'; g.globalAlpha = 0.9;
    g.drawImage(off, W - S * 0.92, (H - S) / 2, S, S); g.globalAlpha = 1;
    const fade = g.createLinearGradient(0, 0, W * 0.65, 0); fade.addColorStop(0, '#000000e6'); fade.addColorStop(1, '#00000000');
    g.fillStyle = fade; g.fillRect(0, 0, W, H);
    if (!reduce) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}

// ---------------------------------------------------------------- chapter map
const thumbCache = new Map();
/** A level's initial state with its overlays, as a data URL (rendered once, lazily). */
function thumbnail(level) {
  if (thumbCache.has(level.id)) return thumbCache.get(level.id);
  const c = document.createElement('canvas'); c.width = c.height = 400;
  const s = new Session(level, defaultSetup(level), { N: 64 });
  const r = new Renderer(c, s.sim);
  if (level.observe === 'momentum') { r.view = 'momentum'; r.kView = level.kView; }
  else if (level.spinor) r.view = 'polarization';
  r.draw(s, { phase: 'setup', handles: [], selected: -1 });
  const url = c.toDataURL('image/png');
  thumbCache.set(level.id, url);
  return url;
}

/** Build the chapter map into `host`. `onPick(id)` opens a level. */
export function buildMap(host, index, levels, stars, current, onPick) {
  host.innerHTML = '';
  const pending = [];
  const suggested = index.levels.find(id => !stars[id]);
  for (const ch of index.chapters) {
    const ids = index.levels.filter(id => levels[id].chapter === ch.id);
    if (!ids.length) continue;
    const row = document.createElement('section'); row.className = 'chap';
    row.innerHTML = `<div><span class="n">CHAPTER ${ch.id}</span><h3></h3><p class="idea"></p></div><div class="lvls"></div>`;
    row.querySelector('h3').textContent = ch.name;
    row.querySelector('.idea').textContent = ch.idea || '';
    for (const id of ids) {
      const lv = levels[id], n = stars[id] || 0;
      const b = document.createElement('button'); b.className = 'lv' + (id === current ? ' cur' : '');
      b.innerHTML = `<img class="th" alt=""><div><b></b><span></span></div>`;
      b.querySelector('b').textContent = `${id} · ${lv.title}`;
      if (lv.tutorial) b.querySelector('b').insertAdjacentHTML('beforeend', '<span class="tag">GUIDED</span>');
      if (lv.experiment) { const e = document.createElement('em'); e.textContent = lv.experiment; b.querySelector('b').after(e); }
      b.querySelector('div > span').textContent = n ? '★'.repeat(n) + '☆'.repeat(3 - n) : id === suggested ? 'next up' : '☆☆☆';
      b.onclick = () => onPick(id);
      row.querySelector('.lvls').append(b);
      pending.push([b.querySelector('img'), lv]);
    }
    host.append(row);
  }
  // fill the thumbnails a few at a time so the map appears immediately
  const step = () => {
    const t0 = performance.now();
    while (pending.length && performance.now() - t0 < 24) { const [img, lv] = pending.shift(); img.src = thumbnail(lv); }
    if (pending.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

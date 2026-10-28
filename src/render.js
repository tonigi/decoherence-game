// Canvas renderer: domain colouring (hue = phase, brightness = |psi|), |psi|^2
// only, the momentum-space density |phi(k)|^2, or (spinor levels) the local
// polarization, plus current arrows and vector overlays for targets, mines,
// detectors, optics and launch handles.
export class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.setSim(sim);
    this.view = 'phase';        // 'phase' | 'density' | 'momentum' | 'polarization'
    this.showCurrent = false;
    this.ref = 1e-3;            // brightness reference (peak |psi|^2), decays slowly
  }
  setSim(sim) {
    this.sim = sim; const N = sim.N;
    this.off = document.createElement('canvas'); this.off.width = this.off.height = N;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(N, N);
    this.kbuf = new Float64Array(N * N);
    this.ref = 1e-3;
  }
  get scale() { return this.canvas.width / this.sim.L; }

  drawField() {
    const { sim, img } = this, N = sim.N, d = img.data, re = sim.re, im = sim.im, re2 = sim.re2, im2 = sim.im2, V = sim.Vdraw, Wel = sim.Wshow || (sim.hasWel ? sim.Wel : null), Vc = sim.Vcont;
    const view = this.view === 'polarization' && !re2 ? 'phase' : this.view;
    const dens = view === 'momentum' ? (sim.momentumDensity(this.kbuf), this.kbuf) : sim.density(this.kbuf);
    let peak = 0;
    const n2 = N * N;
    for (let i = 0; i < n2; i++) if (dens[i] > peak) peak = dens[i];
    this.ref = Math.max(peak, this.ref * 0.985, 1e-6);
    const inv = 1 / this.ref;
    for (let i = 0; i < n2; i++) {
      const p = dens[i];
      const b = Math.min(1, Math.pow(p * inv, 0.45));
      let r, g, bl;
      if (view === 'phase') {
        // spinor: the phase of the larger component
        const big = re2 && re2[i] * re2[i] + im2[i] * im2[i] > re[i] * re[i] + im[i] * im[i];
        const h = ((big ? Math.atan2(im2[i], re2[i]) : Math.atan2(im[i], re[i])) / (2 * Math.PI) + 1) % 1;
        [r, g, bl] = hsv(h, 0.8, b);
      } else if (view === 'polarization') {
        // Poincare sphere: hue = linear polarization angle (0..180 deg -> full circle,
        // horizontal red, vertical cyan), saturation = linear fraction (circular is white)
        const a = re[i] * re[i] + im[i] * im[i], c = re2[i] * re2[i] + im2[i] * im2[i], n = a + c || 1;
        const s1 = (a - c) / n, s2 = (2 * (re[i] * re2[i] + im[i] * im2[i])) / n;
        [r, g, bl] = hsv((Math.atan2(s2, s1) / (2 * Math.PI) + 1) % 1, Math.min(1, Math.hypot(s1, s2)) * 0.85, b);
      } else {
        r = b * 0.35; g = b * 0.8; bl = b;       // cyan ramp
        if (view === 'momentum') { r = b; g = b * 0.75; bl = b * 0.25; }
      }
      if (view !== 'momentum') {                  // potential tint
        const v = Vc ? V[i] - Vc[i] : V[i];
        if (Vc) {                                  // harmonic well: a contour every 2 units of V
          const f = (Vc[i] / 2) % 1, dist = Math.min(f, 1 - f), a = Vc[i] > 0.5 ? 0.45 * Math.max(0, 1 - dist / 0.12) : 0;
          if (a > 0) { r = r * (1 - a) + 0.45 * a; g = g * (1 - a) + 0.75 * a; bl = bl * (1 - a) + a; }
        }
        if (Math.abs(v) > 0.02) {
          const a = Math.min(0.6, Math.abs(v) / 5 * 0.6 + 0.08);
          const tr = v > 0 ? 255 : 60, tg = v > 0 ? 110 : 190, tb = v > 0 ? 40 : 255;
          r = r * (1 - a) + tr * a / 255; g = g * (1 - a) + tg * a / 255; bl = bl * (1 - a) + tb * a / 255;
        }
        if (Wel && Wel[i] > 0.02) {               // absorbing element (bomb): purple
          const a = Math.min(0.55, Wel[i] / 4 * 0.5 + 0.1);
          r = r * (1 - a) + 0.75 * a; g = g * (1 - a) + 0.2 * a; bl = bl * (1 - a) + 0.95 * a;
        }
      }
      const k = 4 * i;
      d[k] = r * 255; d[k + 1] = g * 255; d[k + 2] = bl * 255; d[k + 3] = 255;
    }
    this.octx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
    if (view === 'momentum') { const c = this.kCrop(); this.ctx.drawImage(this.off, c.i0, c.i0, c.w, c.w, 0, 0, this.canvas.width, this.canvas.height); }
    else this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Momentum view shows |k| <= kView (level.kView, default the whole grid). */
  kCrop() {
    const N = this.sim.N, dk = (2 * Math.PI) / this.sim.L, kv = Math.min(this.kView || Infinity, (N / 2) * dk);
    const w = Math.max(4, Math.round((2 * kv) / dk)), i0 = N / 2 - w / 2;
    return { i0, w, dk, kv: (w / 2) * dk };
  }
  /** Coordinate maps for overlays: position space, or k-space in the momentum view. */
  mapping(k) {
    if (!k) { const S = this.scale; return { x: (v) => v * S, y: (v) => v * S, s: S }; }
    const c = this.kCrop(), N = this.sim.N, f = this.canvas.width / c.w;
    const X = (v) => (v / c.dk + N / 2 + 0.5 - c.i0) * f;
    return { x: X, y: X, s: f / c.dk };
  }

  drawCurrent() {
    const { sim, ctx } = this, N = sim.N, S = this.scale, step = 6, C = sim.comps();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5;
    for (let j = step; j < N - step; j += step) for (let i = step; i < N - step; i += step) {
      const k = j * N + i;
      let rho = 0, jx = 0, jy = 0;
      // v = sum_c Im(psi_c* grad psi_c) / |psi|^2, central differences
      for (const [re, im] of C) {
        const dxr = (re[k + 1] - re[k - 1]) / (2 * sim.dx), dxi = (im[k + 1] - im[k - 1]) / (2 * sim.dx);
        const dyr = (re[k + N] - re[k - N]) / (2 * sim.dx), dyi = (im[k + N] - im[k - N]) / (2 * sim.dx);
        rho += re[k] ** 2 + im[k] ** 2; jx += re[k] * dxi - im[k] * dxr; jy += re[k] * dyi - im[k] * dyr;
      }
      if (rho < 0.08 * this.ref) continue;
      const vx = jx / rho, vy = jy / rho;
      const m = Math.hypot(vx, vy); if (m < 0.05) continue;
      const len = Math.min(1.8, m * 0.9) * S / 3 * 1.0, ux = vx / m, uy = vy / m;
      const x0 = (i + 0.5) * sim.dx * S, y0 = (j + 0.5) * sim.dx * S, x1 = x0 + ux * len, y1 = y0 + uy * len;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - ux * 4 - uy * 2.5, y1 - uy * 4 + ux * 2.5); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * 4 + uy * 2.5, y1 - uy * 4 - ux * 2.5);
      ctx.stroke();
    }
  }

  shapePath(sh, M = this.mapping(false)) {
    const ctx = this.ctx; ctx.beginPath();
    if (sh.shape === 'circle') ctx.arc(M.x(sh.x), M.y(sh.y), sh.r * M.s, 0, 2 * Math.PI);
    else {
      const a = ((sh.angle || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = sh.w / 2, hh = sh.h / 2;
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([u, v], n) => {
        const px = M.x(sh.x + c * u - s * v), py = M.y(sh.y + s * u + c * v);
        n ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
    }
  }

  /** Targets and mines, in whichever space the level measures. */
  drawRegions(lv, M) {
    const ctx = this.ctx;
    for (const t of lv.targets || []) { this.shapePath(t, M); ctx.fillStyle = 'rgba(80,255,120,0.12)'; ctx.fill(); ctx.strokeStyle = '#4cff7c'; ctx.lineWidth = 2; ctx.stroke(); }
    for (const m of lv.mines || []) {
      this.shapePath(m, M); ctx.fillStyle = 'rgba(255,60,60,0.15)'; ctx.fill(); ctx.strokeStyle = '#ff4a4a'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
      const rx = 0.5 * (m.r ?? m.w / 2), ry = 0.5 * (m.r ?? m.h / 2);
      ctx.beginPath(); ctx.moveTo(M.x(m.x - rx), M.y(m.y - ry)); ctx.lineTo(M.x(m.x + rx), M.y(m.y + ry));
      ctx.moveTo(M.x(m.x + rx), M.y(m.y - ry)); ctx.lineTo(M.x(m.x - rx), M.y(m.y + ry)); ctx.stroke();
    }
  }

  /** Polarization optics: a tinted outline and an axis dial near the top of the element. */
  drawOptics(session) {
    const ctx = this.ctx, S = this.scale;
    for (const o of session.optics) {
      const g = o.gate !== undefined ? session.gates[o.gate] : null, off = g && g.open;
      const col = o.optic.bomb ? BOMB_COLOUR : OPTIC_COLOURS[o.optic.kind];
      this.shapePath(o.shape);
      ctx.fillStyle = off ? 'transparent' : col + '22'; ctx.fill();
      ctx.setLineDash(off ? [3, 5] : []); ctx.strokeStyle = col + (off ? '66' : 'cc'); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      const [x, y] = dialPos(o.shape, o.placed);
      opticDial(ctx, x * S, y * S, o.optic, col);
    }
  }

  /** The complex absorbing potential along the edges: a hatched frame, so the "lost"
   *  probability has a visible place to go. */
  drawAbsorber() {
    const ctx = this.ctx, W = this.canvas.width, A = (this.sim.absorbWidth || 0) * this.scale;
    if (!A) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.rect(A, A, W - 2 * A, W - 2 * A); ctx.clip('evenodd');
    ctx.fillStyle = 'rgba(7,9,15,0.35)'; ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(140,150,190,0.13)'; ctx.lineWidth = 1;
    for (let x = -W; x < W; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W, W); ctx.stroke(); }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(140,150,190,0.28)'; ctx.setLineDash([3, 4]); ctx.strokeRect(A, A, W - 2 * A, W - 2 * A);
    ctx.fillStyle = 'rgba(140,150,190,0.6)'; ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('absorbing edge', A + 4, W - A + 14);
    ctx.restore();
  }

  drawOverlays(session, ui) {
    const ctx = this.ctx, S = this.scale, lv = session.level;
    this.drawAbsorber();
    ctx.save();
    if (session.optics?.length) this.drawOptics(session);
    if (!session.kSpace) this.drawRegions(lv, this.mapping(false));
    for (const t of lv.targets || []) if (t.pol !== undefined) opticDial(ctx, t.x * S, (t.y - (t.r ?? t.h / 2)) * S - 16, { kind: 'polarizer', angle: t.pol }, '#4cff7c');
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    const acts = session.actions();
    session.detectors.forEach((d, i) => {
      this.shapePath(d.shape); ctx.strokeStyle = d.shots > 0 ? '#ffd23f' : 'rgba(255,210,63,0.3)'; ctx.stroke();
      const hk = acts.findIndex(a => a.type === 'detector' && a.i === i) + 1;
      label(ctx, `${hk}`, (d.shape.x) * S, (d.shape.y - (d.shape.r ?? d.shape.h / 2)) * S - 6, '#ffd23f');
    });
    ctx.setLineDash([]);
    session.gates.forEach((g, i) => {
      const hk = acts.findIndex(a => a.type === 'gate' && a.i === i) + 1;
      label(ctx, `${hk}${g.open ? '' : ' ■'}`, 18, 18 + 18 * i, g.open ? '#9be' : '#f96');
    });
    // placed items / selection handles in setup
    if (ui && ui.phase === 'setup') {
      session.setup.placed.forEach((it, idx) => {
        const spec = lv.inventory.items.find(s => s.id === it.id);
        const sh = spec.shape === 'circle' ? { shape: 'circle', x: it.x, y: it.y, r: it.r } : { shape: 'rect', x: it.x, y: it.y, w: it.w, h: it.h };
        this.shapePath(sh);
        ctx.strokeStyle = idx === ui.selected ? '#fff' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = idx === ui.selected ? 2.5 : 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      });
      const l = session.setup.launch, a = l.angle * Math.PI / 180;
      const x = l.x * S, y = l.y * S, len = l.k * 22, hx = x + Math.cos(a) * len, hy = y + Math.sin(a) * len;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy);
      ctx.lineTo(hx - Math.cos(a - 0.4) * 9, hy - Math.sin(a - 0.4) * 9); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(a + 0.4) * 9, hy - Math.sin(a + 0.4) * 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, l.sigma * 2 * S, 0, 2 * Math.PI); ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke(); ctx.setLineDash([]);
      if (lv.spinor) opticDial(ctx, x, y - l.sigma * 2 * S - 16, { kind: 'source', angle: l.pol || 0, ellip: l.ellip || 0 }, '#fff');
      this.drawHandles(ui.handles || [], ui.hover);
    }
    if (session.result?.sample && !session.kSpace) {
      const s = session.result.sample;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x * S, s.y * S, 10, 0, 2 * Math.PI);
      ctx.moveTo(s.x * S - 16, s.y * S); ctx.lineTo(s.x * S + 16, s.y * S); ctx.moveTo(s.x * S, s.y * S - 16); ctx.lineTo(s.x * S, s.y * S + 16); ctx.stroke();
    }
    ctx.restore();
  }

  /** Setup handles: dot = momentum arrow head, ring = packet width, square = item size. */
  drawHandles(handles, hover) {
    const ctx = this.ctx, S = this.scale;
    for (const h of handles) {
      const x = h.x * S, y = h.y * S, on = h.id === hover, r = on ? 8 : 6;
      if (h.shape === 'stalk') {
        ctx.beginPath(); ctx.moveTo(x, h.base * S); ctx.lineTo(x, y); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
        label(ctx, h.label, x, y - 12, on ? '#6ea8ff' : '#fff');
      }
      ctx.beginPath();
      if (h.shape === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else if (h.shape === 'stalk') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
      else ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.fillStyle = on ? '#6ea8ff' : h.shape === 'ring' ? 'rgba(13,16,23,0.85)' : '#fff';
      ctx.fill(); ctx.stroke();
      if (h.shape === 'ring') { ctx.beginPath(); ctx.arc(x, y, r - 2.5, 0, 2 * Math.PI); ctx.strokeStyle = on ? '#fff' : '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  draw(session, ui) {
    this.drawField();
    if (this.showCurrent && this.view !== 'momentum') this.drawCurrent();
    if (this.view !== 'momentum') { this.drawOverlays(session, ui); return; }
    const ctx = this.ctx, c = this.kCrop();
    if (session.kSpace) {
      const M = this.mapping(true);
      ctx.save(); this.drawRegions(session.level, M);
      const s = session.result?.sample;
      if (s && s.space === 'k') {
        const x = M.x(s.kx), y = M.y(s.ky);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = '#fff'; ctx.font = '14px system-ui';
    ctx.fillText(`momentum space |φ(k)|²  (kx → , ky ↓, centre = 0, |k| ≤ ${c.kv.toFixed(1)})`, 12, 22);
  }
}

const OPTIC_COLOURS = { polarizer: '#b9a7ff', rotator: '#ffb347', retarder: '#5fe0d0', zeeman: '#ff7ad9' };
const BOMB_COLOUR = '#ff5a5a';   // a polarization-selective bomb (what it absorbs is a boom)
/** Where an optic's dial sits (world units): near the top of a rect, clear of the
 *  absorbing border; placed items one row lower, so they never hide a level element's dial. */
export function dialPos(sh, placed = false) {
  if (sh.shape === 'circle') return [sh.x, sh.y];
  return [sh.x, Math.max(sh.y - sh.h / 2 + 1.6, 7.5) + (placed ? 3.2 : 0)];
}
/** A small dial: the polarization axis (polarizer, retarder fast axis, source, analyzer)
 *  drawn at angle theta counter-clockwise from horizontal, or a turning arrow for a rotator. */
function opticDial(ctx, x, y, o, col) {
  const R = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(x, y, R + 3, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  if (o.kind === 'rotator') {
    const dir = Math.sign(o.omega || 1);
    ctx.beginPath(); ctx.arc(x, y, R - 3, -0.3 * Math.PI, 1.2 * Math.PI, dir < 0); ctx.stroke();
    const a = dir > 0 ? -0.3 * Math.PI : 1.2 * Math.PI, hx = x + (R - 3) * Math.cos(a), hy = y + (R - 3) * Math.sin(a);
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - 5 * dir, hy - 2); ctx.moveTo(hx, hy); ctx.lineTo(hx + 1 * dir, hy + 5); ctx.stroke();
  } else {
    const a = ((o.angle || 0) * Math.PI) / 180, c = Math.cos(a) * R, s = -Math.sin(a) * R;
    if (o.kind === 'source' && Math.abs(o.ellip) > 0.02) {   // polarization ellipse
      ctx.beginPath(); ctx.ellipse(x, y, R, R * Math.abs(Math.tan((Math.PI / 4) * o.ellip)), -a, 0, 2 * Math.PI); ctx.stroke();
    } else { ctx.beginPath(); ctx.moveTo(x - c, y - s); ctx.lineTo(x + c, y + s); ctx.stroke(); }
    if (o.kind === 'retarder') {                              // a second, parallel line: a plate
      const px = -s * 0.25, py = c * 0.25;
      ctx.beginPath(); ctx.moveTo(x - c * 0.7 + px, y - s * 0.7 + py); ctx.lineTo(x + c * 0.7 + px, y + s * 0.7 + py); ctx.stroke();
    }
    if (o.kind === 'zeeman') {                                // magnet: the axis goes up, the crossed axis down
      ctx.beginPath(); ctx.moveTo(x - 4, y - R + 6); ctx.lineTo(x, y - R + 1); ctx.lineTo(x + 4, y - R + 6);
      ctx.moveTo(x - 4, y + R - 6); ctx.lineTo(x, y + R - 1); ctx.lineTo(x + 4, y + R - 6); ctx.stroke();
    }
  }
  ctx.restore();
}

function label(ctx, text, x, y, color) {
  ctx.save(); ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const w = ctx.measureText(text).width + 8; ctx.fillRect(x - w / 2, y - 14, w, 19);
  ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}

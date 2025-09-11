import { makeDoubleSlit } from './sim/potential.js';
import { makeAbsorbMask } from './sim/absorb.js';
import { createFDTDSim } from './sim/fdtd_cpu.js';
import { CPURenderer } from './render/renderer_cpu.js';
import { Player } from './game/player.js';
import { Coherence } from './game/coherence.js';
import { Detector } from './game/detector.js';
import { HUD } from './ui/hud.js';

const CONFIG = {
  width: 320,
  height: 180,
  dx: 1.0,
  dt: 0.01,
  substeps: 3,
};

function setupCanvases(w, h) {
  const simCanvas = document.getElementById('simCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');
  simCanvas.width = w; simCanvas.height = h;
  overlayCanvas.width = w; overlayCanvas.height = h;
  // Scale canvases to fit window preserving aspect ratio
  const stage = simCanvas.parentElement;
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / w, vh / h) * 0.98;
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', resize);
  resize();
  return { simCanvas, overlayCanvas };
}

function drawOverlay(ctx, player, detector) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Detector area
  ctx.save();
  ctx.strokeStyle = '#5df';
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(detector.x + 0.5, detector.y + 0.5, detector.w, detector.h);
  ctx.restore();
  // Player
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#8ff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function main() {
  const { width: W, height: H, dx, dt, substeps } = CONFIG;
  const { simCanvas, overlayCanvas } = setupCanvases(W, H);
  const overlayCtx = overlayCanvas.getContext('2d');
  const renderer = new CPURenderer(simCanvas, W, H);
  const hud = new HUD();

  // Build potential and absorbing mask
  const V = makeDoubleSlit(W, H, { barrierThickness: 6, barrierV: 40, slitHeight: Math.floor(H * 0.14), slitSeparation: Math.floor(H * 0.20) });
  const absorbMask = makeAbsorbMask(W, H, { margin: 16, strength: 0.06 });

  // Create simulation
  const sim = createFDTDSim({ width: W, height: H, dx, dt, V, absorbMask });
  sim.seedGaussian({ x0: Math.floor(W * 0.18), y0: Math.floor(H * 0.5), sigma: 7, kx: 0.7, ky: 0 });

  // Game objects
  const player = new Player({
    x: Math.floor(W * 0.18),
    y: Math.floor(H * 0.5),
    baseSpeed: 30,
    radius: 3,
    speedProfile: { minFactor: 0.8, maxFactor: 4.0 },
  });
  const coherence = new Coherence({ max: 1, value: 1, minDrain: 0.005, maxDrain: 0.10, regenThreshold: 0.7, regenRate: 0.18 });
  const detector = new Detector({ x: Math.floor(W * 0.80), y: Math.floor(H * 0.5) - 30, w: 16, h: 60 });

  // Input
  const input = { up: false, down: false, left: false, right: false };
  const keys = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };
  window.addEventListener('keydown', (e) => { const k = keys[e.key]; if (k) { input[k] = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { const k = keys[e.key]; if (k) { input[k] = false; e.preventDefault(); } });

  // UI overlays
  const winOverlay = document.getElementById('winOverlay');
  const loseOverlay = document.getElementById('loseOverlay');
  const retryBtn = document.getElementById('retryBtn');
  const nextBtn = document.getElementById('nextBtn');
  retryBtn.addEventListener('click', () => restart());
  nextBtn.addEventListener('click', () => restart());

  let lastTime = performance.now();
  let running = true;

  function restart() {
    winOverlay.classList.remove('active');
    loseOverlay.classList.remove('active');
    coherence.reset();
    player.x = Math.floor(W * 0.18);
    player.y = Math.floor(H * 0.5);
    sim.seedGaussian({ x0: player.x, y0: player.y, sigma: 7, kx: 0.7, ky: 0 });
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!running) return;
    const dtFrame = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Sim substeps
    for (let i = 0; i < substeps; i++) sim.step(1);
    const density = sim.computeDensity();
    const dMax = sim.getLastMaxDensity();

    // Player + coherence
    const localNd = player.update(input, dtFrame, (x, y) => sim.sampleDensity(x, y) / (dMax + 1e-6));
    player.clampToBounds(W, H);
    const alive = coherence.update(dtFrame, localNd);
    hud.setCoherence01(coherence.value / coherence.max);

    // Win/Lose checks
    if (!alive) {
      running = false;
      loseOverlay.classList.add('active');
    } else if (detector.contains(player.x, player.y)) {
      running = false;
      winOverlay.classList.add('active');
    }

    // Render
    renderer.render(density);
    drawOverlay(overlayCtx, player, detector);

    if (running) requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main();

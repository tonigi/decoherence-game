export class CPURenderer {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.imageData = this.ctx.createImageData(width, height);
    // Tone mapping params
    // We compute a per-frame 95th percentile white point and apply gamma.
    this.gamma = 0.7; // < 1 brightens mid‑tones without blowing highlights
    this.histBins = 256;
    this.hist = new Uint32Array(this.histBins);
    this.regenColor = [90, 255, 200]; // mint highlight for regen region
    this.percentile = 0.95; // white point percentile
    this.regenOverlayAlphaMax = 0.55;
    this.regenOverlayBrightMax = 0.35;
    this.outlineIntensity = 1.2; // scales edge boost
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.imageData = this.ctx.createImageData(width, height);
  }

  // Convert HSV to RGB (0..1 inputs, 0..255 outputs)
  _hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
  }

  render(density, { psiR, psiI, dMax, regenThreshold = 0.7 } = {}) {
    const { data } = this.imageData;

    // 1) Find max and build histogram (normalized to max) for percentile white point
    let maxD = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > maxD) maxD = density[i];
    const eps = 1e-8;
    const invMax = 1.0 / (maxD + eps);
    this.hist.fill(0);
    const bins = this.histBins;
    for (let i = 0; i < density.length; i++) {
      const v = density[i] * invMax; // 0..~1
      const bin = Math.min(bins - 1, v > 0 ? (v >= 1 ? bins - 1 : (v * bins) | 0) : 0);
      this.hist[bin]++;
    }
    // 2) Choose 95th percentile as white point to avoid full-frame saturation
    const targetCount = Math.floor(density.length * Math.max(0.5, Math.min(0.999, this.percentile)));
    let acc = 0, wpBin = bins - 1;
    for (let b = 0; b < bins; b++) { acc += this.hist[b]; if (acc >= targetCount) { wpBin = b; break; } }
    const whitePoint = (wpBin + 0.5) / bins * maxD + eps; // back to absolute density
    const invWhite = 1.0 / whitePoint;

    // 3) Map each pixel with exposure to whitePoint and gamma
    const gamma = this.gamma;
    const hasPhase = !!(psiR && psiI);
    const invDMax = 1.0 / ((dMax || maxD) + eps);
    const highlight = this.regenColor;

    const w = this.width, h = this.height;
    let i = 0; // density index
    for (let y = 0; y < h; y++) {
      for (let xPix = 0; xPix < w; xPix++, i++) {
        const p = i * 4;
        const absD = density[i];
        let x = absD * invWhite; // normalized to 95th percentile
        if (x < 0) x = 0; if (x > 1) x = 1;
        const val = Math.pow(x, gamma);

        // Base color by phase (hue) and intensity (value)
        let r, g, b;
        if (hasPhase) {
          const a = psiR[i];
          const bb = psiI[i];
          const phi = Math.atan2(bb, a); // -π..π
          const hfrac = (phi + Math.PI) / (2 * Math.PI); // 0..1
          const s = 1.0;
          [r, g, b] = this._hsvToRgb(hfrac, s, val);
        } else {
          r = Math.min(255, Math.floor(20 + 235 * val));
          g = Math.min(255, Math.floor(10 + 210 * val));
          b = Math.min(255, Math.floor(40 + 240 * val));
        }

        // Regen overlay: strong and clear
        const ndGame = absD * invDMax; // normalized to simulation max (used by gameplay)
        const t = Math.max(0, Math.min(1, (ndGame - regenThreshold) / (1 - regenThreshold)));
        if (t > 0) {
          // Screen blend with a brighter mint and slight desaturation via mixing towards white
          const hr = highlight[0], hg = highlight[1], hb = highlight[2];
          const alpha = this.regenOverlayAlphaMax * t; // stronger visibility
          // desaturate by mixing with white to lift luminance
          const wr = 255, wg = 255, wb = 255;
          const rMix = Math.floor(r * (1 - alpha) + hr * alpha);
          const gMix = Math.floor(g * (1 - alpha) + hg * alpha);
          const bMix = Math.floor(b * (1 - alpha) + hb * alpha);
          const bright = this.regenOverlayBrightMax * t; // add extra lift
          r = Math.min(255, Math.floor(rMix * (1 - bright) + wr * bright));
          g = Math.min(255, Math.floor(gMix * (1 - bright) + wg * bright));
          b = Math.min(255, Math.floor(bMix * (1 - bright) + wb * bright));

          // Outline at the regen boundary for extra distinction
          // If any 4-neighbors fall below threshold, draw a neon edge
          const xm = xPix > 0 ? i - 1 : i;
          const xp = xPix < w - 1 ? i + 1 : i;
          const ym = y > 0 ? i - w : i;
          const yp = y < h - 1 ? i + w : i;
          const below = (density[xm] * invDMax) < regenThreshold || (density[xp] * invDMax) < regenThreshold || (density[ym] * invDMax) < regenThreshold || (density[yp] * invDMax) < regenThreshold;
          if (below) {
            // edge color: bright lime
            const edgeScale = Math.max(0, this.outlineIntensity);
            r = Math.min(255, r + Math.floor(60 * edgeScale));
            g = Math.min(255, g + Math.floor(120 * edgeScale));
            // keep b to preserve mint tint subtly
          }
        }

        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}

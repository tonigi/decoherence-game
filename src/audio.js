// Sonification: the wavefunction played as an additive pad.
//
// The screen is cut into horizontal bands, each tuned to a degree of a
// just-intoned major pentatonic (top = high). Each band's voice has amplitude
// sqrt(P_band), so the total acoustic power is sum P_band = norm: unitary
// evolution keeps the loudness constant and absorption fades it. Direction
// is binaural (HRTF panners where the browser has them): a band whose
// probability is concentrated in x is heard from the azimuth of its mean x
// (left edge = hard left, right edge = hard right); as it spreads out it
// crossfades into a surround bed of decorrelated sources all around the
// listener. RMS momentum opens the filter.
// On top of the pad, the Born rule itself plays the melody: every beat a
// position is sampled from |psi|^2 and rung as a bell at that band's pitch.
// P_T adds a high halo, P_M a slowly beating low drone.

const RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];   // just major pentatonic
export const BANDS = 16;
export const ROOT = 110;                            // A2

/** Frequency of band b (b = 0 is the top row of the grid). */
export function bandFreq(b, bands = BANDS) {
  const d = bands - 1 - b;
  return ROOT * 2 ** Math.floor(d / 5) * RATIOS[d % 5];
}

/** Azimuth (rad, 0 = ahead, + = right) for x as a fraction of the width. */
export const azimuth = (x) => (Math.min(1, Math.max(0, x)) - 0.5) * Math.PI;
/** How directional a band is, from its x spread (fraction of the width): 1 for a
 *  packet, 0 for a uniform smear (sd 0.29) or a cat state split across the field. */
export const concentration = (sx) => Math.min(1, Math.max(0, 1 - (sx - 0.06) / 0.14));

/** Per band: weight, mean x and sd of x (fractions of the width); norm, RMS momentum. */
export function analyse(sim, bands = BANDS) {
  const { N, dx } = sim;
  const weights = new Float64Array(bands), mx = new Float64Array(bands), sx = new Float64Array(bands);
  let norm = 0, grad = 0;
  for (const [re, im] of sim.comps()) for (let j = 0; j < N; j++) {
    const b = Math.min(bands - 1, Math.floor((j * bands) / N)), jd = ((j + 1) % N) * N;
    for (let i = 0; i < N; i++) {
      const k = j * N + i, p = re[k] * re[k] + im[k] * im[k];
      const x = (i + 0.5) / N;
      weights[b] += p; mx[b] += p * x; sx[b] += p * x * x; norm += p;
      const kr = j * N + ((i + 1) % N), kd = jd + i;
      grad += (re[kr] - re[k]) ** 2 + (im[kr] - im[k]) ** 2 + (re[kd] - re[k]) ** 2 + (im[kd] - im[k]) ** 2;
    }
  }
  for (let b = 0; b < bands; b++) {
    const w = weights[b];
    mx[b] = w > 0 ? mx[b] / w : 0.5;
    sx[b] = w > 0 ? Math.sqrt(Math.max(0, sx[b] / w - mx[b] * mx[b])) : 0.29;
  }
  // forward differences see 2 sin(k dx / 2) / dx; undo that for a plane-wave-exact estimate
  const kd = norm > 1e-12 ? Math.sqrt(grad / norm) / dx : 0;
  const kRms = (2 / dx) * Math.asin(Math.min(1, (kd * dx) / 2));
  return { weights, mx, sx, norm, kRms };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function impulse(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += 0.35 * (Math.random() * 2 - 1 - lp);          // darken the tail a little
      d[i] = lp * (1 - t) ** 2.5 * Math.min(1, i / (0.03 * ctx.sampleRate));
    }
  }
  return buf;
}

export class Sonifier {
  constructor() {
    this.ctx = null; this.enabled = true;
    this.nextSparkle = 0; this.lastNo = 0;
  }

  /** Call from a user gesture: browsers only start audio after one. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx && !this._init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.1);
  }

  get live() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  _init() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();
    const gain = (v, ...to) => { const g = ctx.createGain(); g.gain.value = v; for (const n of to) g.connect(n); return g; };

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.connect(ctx.destination);
    this.master = gain(0, comp);
    this.master.gain.setTargetAtTime(0.8, ctx.currentTime, 0.5);

    const reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 5);
    reverb.connect(gain(0.55, this.master));
    const delay = ctx.createDelay(2); delay.delayTime.value = 0.42;
    const fbTone = ctx.createBiquadFilter(); fbTone.type = 'lowpass'; fbTone.frequency.value = 2200;
    delay.connect(fbTone); fbTone.connect(gain(0.4, delay)); delay.connect(gain(0.25, this.master, reverb));

    // pad: voices -> tone filter -> dry + reverb + delay
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.Q.value = 0.4; this.tone.frequency.value = 1200;
    this.tone.connect(gain(0.5, this.master)); this.tone.connect(gain(0.8, reverb)); this.tone.connect(gain(0.3, delay));
    const bus = gain(1, this.tone);
    // one-shots (bells, chimes): mostly wet
    this.fx = gain(1); this.fx.connect(gain(0.45, this.master)); this.fx.connect(gain(1, reverb)); this.fx.connect(gain(0.5, delay));

    // binaural source at an azimuth; equal-power stereo where HRTF is unavailable
    const panner = (az) => {
      const p = ctx.createPanner();
      try { p.panningModel = 'HRTF'; } catch { /* keep the default */ }
      p.distanceModel = 'linear'; p.rolloffFactor = 0;   // direction only, no distance cue
      this.place(p, az); return p;
    };
    this.panner = panner;
    // the surround bed: four decorrelated copies placed around the listener
    this.around = gain(0.5);
    [[-45, 0], [45, 0.011], [-135, 0.023], [135, 0.037]].forEach(([deg, d]) => {
      const dl = ctx.createDelay(0.1); dl.delayTime.value = d;
      this.around.connect(dl); dl.connect(panner((deg * Math.PI) / 180)).connect(bus);
    });

    const drift = (param, cents) => {   // slow random detune, so the pad breathes
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.15;
      lfo.connect(gain(cents, param)); lfo.start();
    };
    const t0 = ctx.currentTime;
    this.voices = [];
    for (let b = 0; b < BANDS; b++) {
      // one voice, two paths: directional (at the band's mean x) and the surround bed
      const f = bandFreq(b), pan = panner(0), gDir = gain(0, pan), gAmb = gain(0, this.around), g = gain(1, gDir, gAmb);
      pan.connect(bus);
      const s = ctx.createOscillator(); s.frequency.value = f; drift(s.detune, 4); s.connect(g); s.start(t0);
      const tri = ctx.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f; tri.detune.value = 7; drift(tri.detune, 5);
      tri.connect(gain(0.3, g)); tri.start(t0);
      this.voices.push({ gDir, gAmb, pan });
    }
    // halo over the target: high fifth with a slow shimmer
    this.halo = gain(0, bus);
    for (const [f, a] of [[ROOT * 8, 0.6], [ROOT * 12, 0.4], [ROOT * 16, 0.25]]) {
      const o = ctx.createOscillator(); o.frequency.value = f; drift(o.detune, 8);
      const trem = gain(a, this.halo); o.connect(trem); o.start(t0);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 3 + Math.random() * 2; lfo.connect(gain(a * 0.4, trem.gain)); lfo.start(t0);
    }
    // shadow under the mines: low root and fifth, detuned to beat slowly
    this.shadow = gain(0, bus);
    for (const [f, a] of [[ROOT / 2, 0.7], [ROOT / 2 * 1.013, 0.7], [ROOT * 3 / 4, 0.4]]) {
      const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain(a, this.shadow)); o.start(t0);
    }
    return true;
  }

  /** Point a panner at azimuth az (rad), on the unit circle around the listener. */
  place(p, az, tau = 0) {
    const x = Math.sin(az), z = -Math.cos(az);
    if (!p.positionX) { p.setPosition(x, 0, z); return; }
    if (!tau) { p.positionX.value = x; p.positionY.value = 0; p.positionZ.value = z; return; }
    const now = this.ctx.currentTime;
    p.positionX.setTargetAtTime(x, now, tau); p.positionZ.setTargetAtTime(z, now, tau);
  }

  /** Track the current state; call a few times per second. */
  update(session, phase, playing) {
    if (!this.live) return;
    const ctx = this.ctx, now = ctx.currentTime, sim = session.sim;
    const a = analyse(sim);
    // after the observation the pad fades to silence (~4 s); only the result chime rings out
    const level = phase === 'setup' ? 0.35 : phase === 'run' ? (playing ? 1 : 0.5) : 0;
    const tau = phase === 'done' ? 0.8 : 0.15;
    a.weights.forEach((w, b) => {
      const v = this.voices[b];
      const amp = 0.09 * level * Math.sqrt(w), c = concentration(a.sx[b]);
      v.gDir.gain.setTargetAtTime(amp * Math.sqrt(c), now, tau);
      v.gAmb.gain.setTargetAtTime(amp * Math.sqrt(1 - c), now, tau);
      if (w > 1e-6) this.place(v.pan, azimuth(a.mx[b]), 0.15);
    });
    this.tone.frequency.setTargetAtTime(clamp(600 + 320 * a.kRms, 400, 5000), now, 0.3);
    this.halo.gain.setTargetAtTime(0.1 * level * session.pT(), now, tau);
    this.shadow.gain.setTargetAtTime(0.22 * level * session.pM(), now, tau);

    // the Born-rule melody: sample |psi|^2, ring the sampled band an octave up
    if (phase !== 'run' || !playing) { this.nextSparkle = 0; return; }
    if (now < this.nextSparkle) return;
    const beat = clamp(0.95 - 0.1 * a.kRms, 0.25, 0.95);
    this.nextSparkle = (this.nextSparkle || now) + Math.round(beat * 8 * (Math.random() < 0.25 ? 2 : 1)) / 8;
    if (this.nextSparkle < now) this.nextSparkle = now + beat;
    const u = Math.random();
    if (u >= a.norm) return;                         // absorbed branch: a rest
    const idx = sim.sampleCell(u); if (idx < 0) return;
    const j = Math.floor(idx / sim.N), i = idx % sim.N;
    const b = Math.min(BANDS - 1, Math.floor((j * BANDS) / sim.N));
    this.bell(bandFreq(b) * 2, azimuth((i + 0.5) / sim.N), 0.13 * Math.sqrt(a.norm), now + 0.01, 3);
  }

  /** A soft bell; `az` (rad) places it binaurally, null leaves it centred. */
  bell(f, az = null, amp = 0.1, when = this.ctx.currentTime, dur = 2.5) {
    const ctx = this.ctx, env = ctx.createGain();
    if (az === null) env.connect(this.fx); else env.connect(this.panner(az)).connect(this.fx);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + 0.02);
    env.gain.exponentialRampToValueAtTime(1e-4, when + dur);
    for (const [m, a] of [[1, 1], [2, 0.25], [3, 0.08]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f * m; g.gain.value = a; o.connect(g); g.connect(env);
      o.start(when); o.stop(when + dur + 0.05);
    }
    return env;
  }

  // ---- game events ---------------------------------------------------------
  kick() {
    if (!this.live) return;
    const ctx = this.ctx, now = ctx.currentTime;
    [4, 5, 6].forEach((m, n) => this.bell(ROOT * m * 1.5, null, 0.05, now + n * 0.06, 1.5));
  }
  gate(open) {
    if (!this.live) return;
    this.bell(ROOT * (open ? 4 : 3), null, 0.07, this.ctx.currentTime, 2);
  }
  detector(yes) {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    if (yes) { this.bell(ROOT * 6, null, 0.09, now, 3.5); this.bell(ROOT * 15 / 2, null, 0.06, now + 0.08, 3.5); }
    else if (now - this.lastNo > 0.25) { this.lastNo = now; this.bell(ROOT * 2, null, 0.05, now, 1.2); }
  }
  /** The observation: the pad fades out (update) and one faint, pure tone at the
   *  found position (pitch of its band, two octaves up) rings into the reverb. */
  observed(r, L) {
    if (!this.live || r.sample?.x === undefined) return;   // absorbed or momentum-space: just silence
    const ctx = this.ctx, now = ctx.currentTime, b = Math.min(BANDS - 1, Math.floor((r.sample.y / L) * BANDS));
    const o = ctx.createOscillator(), env = ctx.createGain(), p = this.panner(azimuth(r.sample.x / L));
    o.frequency.value = bandFreq(b) * 4;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();   // a slow, unsteady waver
    lfo.frequency.value = 0.3; depth.gain.value = 9; lfo.connect(depth); depth.connect(o.detune);
    o.connect(env); env.connect(p).connect(this.fx);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.035, now + 0.4);
    env.gain.exponentialRampToValueAtTime(1e-4, now + 7);
    o.start(now); o.stop(now + 7.1); lfo.start(now); lfo.stop(now + 7.1);
  }
}

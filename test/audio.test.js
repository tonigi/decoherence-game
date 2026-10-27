import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim.js';
import { analyse, bandFreq, concentration, BANDS } from '../src/audio.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('band pitches rise upward and stay on the pentatonic', () => {
  for (let b = 1; b < BANDS; b++) assert.ok(bandFreq(b - 1) > bandFreq(b), 'top band is highest');
  near(bandFreq(BANDS - 1), 110, 1e-9, 'bottom band is the root');
  near(bandFreq(BANDS - 6) / bandFreq(BANDS - 1), 2, 1e-9, 'five degrees = one octave');
});

test('analyse: band weights sum to the norm, RMS momentum matches the packet', () => {
  const sim = new Sim(128, 40, 0.05);
  const k0 = 4, sigma = 2.5;
  sim.setGaussian({ x: 20, y: 10, kx: k0, ky: 0, sigma });
  const a = analyse(sim);
  near(a.weights.reduce((s, w) => s + w, 0), a.norm, 1e-12, 'sum of bands');
  near(a.norm, 1, 1e-9, 'norm');
  // y = 10 of 40 sits in the upper quarter of the bands, x = 20 is centred
  const top = a.weights.indexOf(Math.max(...a.weights));
  assert.ok(top === 3 || top === 4, `peak band ${top}`);
  near(a.mx[top], 0.5, 0.02, 'mean x');
  near(a.sx[top], sigma / 40, 0.01, 'x spread');
  assert.ok(concentration(a.sx[top]) > 0.9, 'a packet is directional');
  near(a.kRms, Math.sqrt(k0 * k0 + 1 / (2 * sigma * sigma)), 0.05, 'rms momentum');
});

test('analyse sums both spinor components', () => {
  const sim = new Sim(64, 40, 0.05, { spinor: true });
  sim.setGaussian({ x: 20, y: 20, kx: 0, ky: 0, sigma: 3, pol: [Math.SQRT1_2, Math.SQRT1_2] });
  near(analyse(sim).norm, 1, 1e-9, 'norm over both components');
});

test('a packet split left and right is diffuse, not a centred source', () => {
  const sim = new Sim(128, 40, 0.05);
  sim.setGaussian({ x: 10, y: 20, kx: 0, ky: 0, sigma: 1.5 });
  sim.setGaussian({ x: 30, y: 20, kx: 0, ky: 0, sigma: 1.5 }, true);
  const a = analyse(sim), b = a.weights.indexOf(Math.max(...a.weights));
  near(a.mx[b], 0.5, 0.02, 'mean x is central');
  assert.ok(concentration(a.sx[b]) < 0.3, `concentration ${concentration(a.sx[b])}`);
});

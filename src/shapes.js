// Rasterisation of level geometry onto a simulation grid. Every edge is
// smoothed over ~a couple of cells (tanh profile) so that neither potentials
// nor measurement masks excite Gibbs ringing.
const edge = (d, s) => 0.5 * (1 + Math.tanh(d / s));
// Edge softness in world units, the same at every resolution so the 64^2 ghost
// preview and solver see the same barriers as the 128^2 game grid (0.7 cells
// at 64^2, 1.4 cells at 128^2).
export const SOFTNESS = 0.45;
const softness = () => SOFTNESS;
// Rect-local coordinates: rects may carry `angle` (degrees, clockwise on screen
// since y points down); w is measured along the rotated x axis.
function local(el, x, y) {
  const dx = x - el.x, dy = y - el.y;
  if (!el.angle) return [dx, dy];
  const a = (el.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** Smooth [0,1] indicator of a circle {x,y,r} or rect {x,y,w,h,angle?} (centre-based). */
export function rasterMask(sim, shape) {
  const { N, dx } = sim, s = softness(sim);
  const m = new Float64Array(N * N);
  const circle = shape.shape === 'circle';
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) * dx;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * dx;
      m[j * N + i] = circle
        ? edge(shape.r - Math.hypot(x - shape.x, y - shape.y), s)
        : rectP(shape, x, y, s);
    }
  }
  return m;
}

/** Potential V(x,y) contributed by one element:
 *  rect {x,y,w,h,V,angle?}, disc {x,y,r,V}, wall {x,w,V,slits:[{y,w}]} (full height),
 *  harmonic {x,y,omega,R}: V = omega^2 r^2 / 2 for r < R, flat (continuous) beyond,
 *  lattice {x,y,V,period,angle?,w?,h?}: V sin^2(pi u / period), optionally windowed by the rect w x h. */
export function rasterV(sim, el) {
  const { N, dx } = sim, s = softness(sim);
  const V = new Float64Array(N * N);
  if (el.type === 'harmonic') {
    const k = 0.5 * el.omega * el.omega, R = el.R ?? Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = Math.hypot((i + 0.5) * dx - el.x, (j + 0.5) * dx - el.y);
      V[j * N + i] = k * Math.min(r, R) ** 2;
    }
    return V;
  }
  if (el.type === 'lattice') {
    // a standing wave V sin^2(pi u / period) along the rect-local u axis (minima at the
    // window centre and every period from it), inside an optional soft rect window
    const win = el.w !== undefined;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * dx, y = (j + 0.5) * dx, [u] = local(el, x, y);
      V[j * N + i] = el.V * Math.sin((Math.PI * u) / el.period) ** 2 * (win ? rectP(el, x, y, s) : 1);
    }
    return V;
  }
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) * dx;
    let open = 0;
    if (el.type === 'wall') {
      for (const sl of el.slits || []) open += edge(sl.w / 2 - Math.abs(y - sl.y), s);
      open = Math.min(1, open);
    }
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * dx;
      let p;
      if (el.type === 'rect') p = rectP(el, x, y, s);
      else if (el.type === 'disc') p = edge(el.r - Math.hypot(x - el.x, y - el.y), s);
      else if (el.type === 'wall') p = edge(el.w / 2 - Math.abs(x - el.x), s) * (1 - open);
      else throw new Error('unknown element type ' + el.type);
      V[j * N + i] = el.V * p;
    }
  }
  return V;
}

function rectP(r, x, y, s) {
  const [u, v] = local(r, x, y);
  return edge(r.w / 2 - Math.abs(u), s) * edge(r.h / 2 - Math.abs(v), s);
}

// Momentum-space masks live on the fft-shifted k grid of Sim.momentumDensity:
// cell I has k = (I - N/2) * dk with dk = 2 pi / L, the same at every N.
export const K_SOFTNESS = 0.08;
// A shape's `edge` overrides the softness (a sharp edge resolves single k cells). Regions
// are in kinetic momentum k + sim.gauge, which differs from the grid's canonical k on a
// ring with a flux or a force (see Sim).
export function rasterKMask(sim, shape) {
  const { N } = sim, dk = (2 * Math.PI) / sim.L, s = shape.edge ?? K_SOFTNESS, g = sim.gauge || [0, 0];
  const m = new Float64Array(N * N);
  const circle = shape.shape === 'circle';
  for (let J = 0; J < N; J++) {
    const ky = (J - N / 2) * dk + g[1];
    for (let I = 0; I < N; I++) {
      const kx = (I - N / 2) * dk + g[0];
      m[J * N + I] = circle ? edge(shape.r - Math.hypot(kx - shape.x, ky - shape.y), s) : rectP(shape, kx, ky, s);
    }
  }
  return m;
}

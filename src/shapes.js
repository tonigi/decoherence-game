// Rasterisation of level geometry onto a simulation grid. Every edge is
// smoothed over ~a couple of cells (tanh profile) so that neither potentials
// nor measurement masks excite Gibbs ringing.
const edge = (d, s) => 0.5 * (1 + Math.tanh(d / s));
// Edge softness in world units: independent of resolution (so the low-res ghost
// preview sees the same physics) but never sharper than ~1.3 cells.
const softness = (sim) => Math.max(0.35, 0.7 * sim.dx);

/** Smooth [0,1] indicator of a circle {x,y,r} or rect {x,y,w,h} (centre-based). */
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
        : edge(shape.w / 2 - Math.abs(x - shape.x), s) * edge(shape.h / 2 - Math.abs(y - shape.y), s);
    }
  }
  return m;
}

/** Potential V(x,y) contributed by one element:
 *  rect {x,y,w,h,V}, disc {x,y,r,V}, wall {x,w,V,slits:[{y,w}]} (full height). */
export function rasterV(sim, el) {
  const { N, dx } = sim, s = softness(sim);
  const V = new Float64Array(N * N);
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
      if (el.type === 'rect') p = edge(el.w / 2 - Math.abs(x - el.x), s) * edge(el.h / 2 - Math.abs(y - el.y), s);
      else if (el.type === 'disc') p = edge(el.r - Math.hypot(x - el.x, y - el.y), s);
      else if (el.type === 'wall') p = edge(el.w / 2 - Math.abs(x - el.x), s) * (1 - open);
      else throw new Error('unknown element type ' + el.type);
      V[j * N + i] = el.V * p;
    }
  }
  return V;
}

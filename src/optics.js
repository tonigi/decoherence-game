// Polarization optics as spin Hamiltonians for a spinor Sim. A linear
// polarization at angle theta has Jones vector (cos theta, sin theta) and sits on
// the Poincare sphere at n(theta) = (sin 2theta, 0, cos 2theta) (components x, y, z
// of sigma; z = H/V, x = diagonal/antidiagonal, y = circular). The projector onto
// it is P(theta) = (1 + n.sigma) / 2. Each element is applied as chi(x) * term,
// with chi the element's smooth mask, so overlapping elements simply add.
//
//   polarizer {angle, absorb = 6}: -i absorb P(theta + 90): the crossed
//     component decays at rate 2*absorb (an absorbing polarizer, loss counts as lost)
//   polarizer {angle, V}: V P(theta + 90): the crossed component sees a barrier
//     and is reflected (a polarizing beam splitter); combine with absorb if wanted
//   rotator {omega}: omega sigma_y, rotates linear polarization by omega per unit
//     time spent inside (optical activity / a Larmor spin rotator)
//   retarder {angle, delta}: (delta / 2) n(theta).sigma, a birefringent plate
//     that builds up a phase delta per unit time between the axis theta and the
//     crossed axis (a quarter-wave plate is delta * dwell = pi / 2)
//   zeeman {angle, gradient}: gradient * v * n(theta).sigma, with v the transverse
//     coordinate across the element (Session scales chi by it): a Stern-Gerlach
//     magnet. The force -gradient * n.sigma pushes polarization along theta toward
//     -v (up on screen for an unrotated element) and the crossed one toward +v
//   any optic with `bomb: true`: what it absorbs is caught, like an absorbing bomb
const rad = (deg) => (deg * Math.PI) / 180;

/** Poincare-sphere axis of linear polarization at angle deg. */
export const polAxis = (deg) => [Math.sin(2 * rad(deg)), 0, Math.cos(2 * rad(deg))];

/** The term {h0, hx, hy, hz} (complex [re, im]) of one optic. */
export function opticTerm(o) {
  const t = { h0: [0, 0], hx: [0, 0], hy: [0, 0], hz: [0, 0] };
  const addP = (deg, c) => { // c * P(deg) with complex c = [re, im]
    const n = polAxis(deg);
    t.h0[0] += c[0] / 2; t.h0[1] += c[1] / 2;
    t.hx[0] += (c[0] / 2) * n[0]; t.hx[1] += (c[1] / 2) * n[0];
    t.hz[0] += (c[0] / 2) * n[2]; t.hz[1] += (c[1] / 2) * n[2];
  };
  switch (o.kind) {
    case 'polarizer': {
      const absorb = o.absorb ?? (o.V ? 0 : DEFAULT_ABSORB);
      addP((o.angle || 0) + 90, [o.V || 0, -absorb]);
      break;
    }
    case 'rotator': t.hy[0] = o.omega || 0; break;
    case 'zeeman': {
      const n = polAxis(o.angle || 0), g = o.gradient || 0;
      t.hx[0] = g * n[0]; t.hz[0] = g * n[2];
      break;
    }
    case 'retarder': {
      const n = polAxis(o.angle || 0), d = (o.delta || 0) / 2;
      t.hx[0] = d * n[0]; t.hz[0] = d * n[2];
      break;
    }
    default: throw new Error('unknown optic ' + o.kind);
  }
  return t;
}
export const DEFAULT_ABSORB = 6;

/** Jones vector of the launch polarization: linear at angle `pol` (deg),
 *  optionally with ellipticity `ellip` in [-1, 1] (+1 = circular). */
export function jones(pol = 0, ellip = 0) {
  const a = rad(pol), chi = (Math.PI / 4) * Math.max(-1, Math.min(1, ellip));
  // (cos a cos chi - i sin a sin chi, sin a cos chi + i cos a sin chi)
  return [[Math.cos(a) * Math.cos(chi), -Math.sin(a) * Math.sin(chi)], [Math.sin(a) * Math.cos(chi), Math.cos(a) * Math.sin(chi)]];
}

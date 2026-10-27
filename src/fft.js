// In-place radix-2 complex FFT on split re/im Float64Arrays, 2D (N x N, row-major).
//
// `pass` is the fast path used by the propagator: rows, transpose, rows. The
// spectrum comes out transposed ([kx][ky]) and the *same* routine inverts it
// back to [y][x] layout, so no extra transposes are needed as long as the
// k-space multiplier is symmetric in (kx, ky) -- which kinetic energy is.
// `forward` / `inverse` give the ordinary layout for analysis code.
export class FFT2 {
  constructor(N) {
    if (N & (N - 1)) throw new Error('N must be a power of two');
    this.N = N;
    const bits = Math.log2(N) | 0;
    this.rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if ((i >> b) & 1) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(N / 2);
    this.sin = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / N);
      this.sin[k] = Math.sin((2 * Math.PI * k) / N);
    }
  }

  rows(re, im, inv) {
    const N = this.N, rev = this.rev, c = this.cos, s = this.sin;
    const sg = inv ? 1 : -1;
    for (let r = 0; r < N; r++) {
      const o = r * N;
      for (let i = 0; i < N; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[o + i]; re[o + i] = re[o + j]; re[o + j] = t;
          t = im[o + i]; im[o + i] = im[o + j]; im[o + j] = t;
        }
      }
      for (let len = 2; len <= N; len <<= 1) {
        const half = len >> 1, step = N / len;
        for (let i = 0; i < N; i += len) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const wr = c[k], wi = sg * s[k];
            const a = o + i + j, b = a + half;
            const xr = re[b] * wr - im[b] * wi;
            const xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
          }
        }
      }
    }
  }

  transpose(re, im) {
    const N = this.N;
    for (let i = 1; i < N; i++) {
      for (let j = 0; j < i; j++) {
        const a = i * N + j, b = j * N + i;
        let t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
    }
  }

  pass(re, im, inv) {
    this.rows(re, im, inv);
    this.transpose(re, im);
    this.rows(re, im, inv);
  }

  /** Unnormalised forward transform; output layout [ky][kx]. */
  forward(re, im) { this.pass(re, im, false); this.transpose(re, im); }

  /** Inverse of `forward`, including the 1/N^2 factor. */
  inverse(re, im) {
    this.transpose(re, im);
    this.pass(re, im, true);
    const f = 1 / (this.N * this.N);
    for (let i = 0; i < re.length; i++) { re[i] *= f; im[i] *= f; }
  }
}

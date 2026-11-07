// One Euro filter (Casiez et al. 2012): heavy smoothing when still, light smoothing when moving fast.
const alpha = (rate, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff) * rate);

export class OneEuro {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = null; }
  filter(v, tMs) {
    if (this.t === null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max((tMs - this.t) / 1000, 0.001);
    this.t = tMs;
    const rate = 1 / dt;
    this.dx += alpha(rate, this.dCutoff) * ((v - this.x) * rate - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(rate, cutoff) * (v - this.x);
    return this.x;
  }
}

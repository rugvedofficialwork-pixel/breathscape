/**
 * One Euro filter: heavy smoothing when the signal is still (kills jitter),
 * light smoothing when it moves fast (stays responsive, no lag).
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dtSec: number): number {
    const dt = Math.max(1e-3, dtSec);
    if (this.x === null) { this.x = value; return value; }
    const rawD = (value - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (rawD - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void { this.x = null; this.dx = 0; }
}

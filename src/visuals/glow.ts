const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Stage 4's single steady soft glow (no particles). In 'follow' mode its brightness follows the hand,
 * so lowering the hand dims it, mirroring Stage 1.
 */
export class Glow {
  mode: 'steady' | 'follow' = 'steady';
  /** Returns 0-1 in follow mode (hand height, or the breath timer when there is no camera). */
  follow: () => number = () => 0;
  /** 0 = visible, 1 = faded to dark. */
  fadeAmt = 0;
  brightness = 0;

  private visible = false;
  private appear = 0;
  private last = 0;
  private fadeStart: number | null = null;
  private fadeMs = 5000;

  reset(): void {
    this.mode = 'steady'; this.visible = false; this.appear = 0; this.fadeAmt = 0;
    this.brightness = 0; this.fadeStart = null;
  }

  show(): void { this.visible = true; }

  fadeOut(ms: number, now: number): void { this.fadeStart = now; this.fadeMs = ms; }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    if (!this.visible) return;
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    this.appear = Math.min(1, this.appear + dt / 2600);
    if (this.fadeStart !== null) this.fadeAmt = ease(clamp01((now - this.fadeStart) / this.fadeMs));

    const target = this.mode === 'steady' ? 0.42 : 0.1 + 0.9 * clamp01(this.follow());
    const tau = this.mode === 'follow' ? 140 : 900;
    this.brightness += (target - this.brightness) * (1 - Math.exp(-dt / tau));

    const a = ease(this.appear) * (1 - this.fadeAmt);
    if (a <= 0.002) return;
    const md = Math.min(w, h), b = this.brightness;
    const cx = w / 2, cy = h / 2;
    const r = md * (0.09 + 0.07 * b);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowR = r * (2.4 + 1.8 * b);
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, glowR);
    g.addColorStop(0, `rgba(206,226,255,${(0.12 + 0.5 * b) * a})`);
    g.addColorStop(1, 'rgba(206,226,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();

    const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    body.addColorStop(0, `rgba(255,255,255,${(0.55 + 0.4 * b) * a})`);
    body.addColorStop(0.4, `rgba(214,231,255,${(0.4 + 0.5 * b) * a})`);
    body.addColorStop(1, `rgba(206,226,255,${0.15 * a})`);
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

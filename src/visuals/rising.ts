/**
 * Breathing visual: luminous particles all around you. They rise and brighten as the breath level goes up
 * (chin lift, or the hand) and sink and dim as it goes down. Fully out, most rest below the bottom of the screen and
 * the rest glow faintly in the bottom fifth; fully in, they fill the screen.
 *
 * They circle you: each particle sits on a slowly turning ring around your body. The near side passes in front of
 * you, larger and brighter; the far side passes behind you, smaller and fainter, hidden by your outline on the camera
 * image, and fades out directly behind. So particles keep emerging from behind your back and coming round.
 * Each follows the breath with its own slight lag, so the field moves as one slow, fluid mass.
 */
import { CONFIG } from '../config';
import type { BodyShape } from './body';

interface Mote {
  h: number; // 0..1: where this one sits in the field (its height rank)
  th: number; // angle around you: 0 = straight in front of you (towards the camera), PI = straight behind
  om: number; // rad/s: how fast it circles
  R: number; // 0..1: distance from you (1 reaches the edge of the screen)
  z: number; // 0.3..1: its own size and brightness
  tau: number; // ms: how slowly it follows the breath
  li: number; // its own breath level
  on: number; // 0..1: present yet (more of them appear over the breaths)
  fy: number; py: number; // slow vertical sway
  fx: number; px: number; // slow left-right sway (breathed in)
  tw: number; tp: number; // twinkle
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class RisingField {
  private motes: Mote[] = [];
  private t = 0;
  private sprite: HTMLCanvasElement | null = null;
  private spriteKey = '';
  private back: HTMLCanvasElement | null = null;
  private cx = -1;
  /** The breath level the field moves with: follows the real one smoothly, never faster than a calm rise. */
  private flow = 0;
  private flowV = 0;

  constructor(private reduced: boolean) {
    const c = CONFIG.scene1.field;
    const n = reduced ? Math.round(c.count * 0.45) : c.count;
    for (let i = 0; i < n; i++) {
      this.motes.push({
        h: Math.random(),
        th: Math.random() * Math.PI * 2, // half in front of you, half behind
        om: (c.orbitRadPerSec[0] + Math.random() * (c.orbitRadPerSec[1] - c.orbitRadPerSec[0])) * (Math.random() < 0.8 ? 1 : -1),
        R: c.innerRadius + (1 - c.innerRadius) * Math.sqrt(Math.random()), // fills the space out to the screen edges
        z: 0.3 + 0.7 * Math.random() ** 1.6,
        tau: lerp(c.lagMs[0], c.lagMs[1], Math.random()),
        li: 0, on: 0,
        fy: 0.02 + Math.random() * 0.04, py: Math.random() * Math.PI * 2,
        fx: 0.03 + Math.random() * 0.05, px: Math.random() * Math.PI * 2,
        tw: 0.15 + Math.random() * 0.35, tp: Math.random() * Math.PI * 2,
      });
    }
  }

  /** A soft round glow in the current colour, drawn once and reused. */
  private glow(color: string): HTMLCanvasElement {
    if (this.sprite && this.spriteKey === color) return this.sprite;
    const s = this.sprite ?? document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d')!;
    g.clearRect(0, 0, 64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, color.replace(/[\d.]+\)$/, '0.9)'));
    grad.addColorStop(0.45, color.replace(/[\d.]+\)$/, '0.25)'));
    grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.sprite = s; this.spriteKey = color;
    return s;
  }

  /** The canvas the far-side particles are drawn on, so your outline can be cut out of it. */
  private backLayer(ctx: CanvasRenderingContext2D, w: number, h: number): CanvasRenderingContext2D {
    const dpr = ctx.getTransform().a || 1;
    const b = this.back ?? (this.back = document.createElement('canvas'));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (b.width !== W || b.height !== H) { b.width = W; b.height = H; }
    const g = b.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.filter = 'none';
    g.clearRect(0, 0, w, h);
    return g;
  }

  /**
   * level: the breath level 0..1. appear: fade-in 0..1. end: 0..1 fade at the close. color: rgba() string.
   * body: your outline on screen (null without tracking: the far side then just fades with distance).
   * progress: 0..1 through the breaths (more particles join as it grows).
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, level: number, appear: number, end: number, color: string, body: BodyShape | null, progress = 0): void {
    const c = CONFIG.scene1.field;
    this.t += dt / 1000;
    const fade = appear * (1 - end);
    if (fade <= 0.001) return;
    const sprite = this.glow(color);
    const unit = Math.min(w, h);
    // circle around where you are on screen (eased, so it never jumps)
    const targetCx = body ? body.cx : w / 2;
    this.cx = this.cx < 0 ? targetCx : this.cx + (targetCx - this.cx) * (1 - Math.exp(-dt / 600));
    const back = this.backLayer(ctx, w, h);
    back.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Rising follows the breath directly. Falling is never faster than a calm rise: a quick drop of the head on the
    // out-breath still lets the particles sink gently (eased into and out of the fall, capped at maxFallPerSec).
    const sec = Math.min(0.1, dt / 1000);
    if (level >= this.flow) {
      this.flow = level;
      this.flowV = 0;
    } else {
      const want = -Math.min(c.maxFallPerSec, (this.flow - level) * 2.5); // slows down as it arrives
      this.flowV += (want - this.flowV) * (1 - Math.exp(-sec / 0.35)); // and starts gently
      this.flow = Math.max(level, this.flow + this.flowV * sec);
    }
    const flow = this.flow;
    // the field turns a little faster when it is alive
    const spin = 0.8 + 0.4 * flow;

    // half of them at the first breath, all of them by the last; newcomers fade in slowly
    const present = Math.round(this.motes.length * (c.startFraction + (1 - c.startFraction) * clamp01(progress)));
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.on += ((i < present ? 1 : 0) - m.on) * (1 - Math.exp(-dt / 2500));
      m.li += (flow - m.li) * (1 - Math.exp(-dt / m.tau));
      if (m.on < 0.01) continue;
      m.th += m.om * spin * (dt / 1000);
      const L = smooth(clamp01(m.li));
      const depth = Math.cos(m.th); // 1 = in front of you, -1 = straight behind
      const side = Math.sin(m.th);
      // height above the bottom edge, in screen heights: breathed out -0.45..0.2, breathed in up the whole screen
      const lowY = c.outBottom + (c.outTop - c.outBottom) * m.h;
      const highY = c.inBottom + (c.inTop - c.inBottom) * m.h;
      const above = lerp(lowY, highY, L);
      // perspective: how near the camera it is (the front of the ring, far out, is nearest; straight behind you is
      // furthest). Size and brightness follow it: the nearest are about 4x the size of the furthest.
      const near = depth * (0.4 + 0.6 * m.R); // -1 (far behind you) .. 1 (nearest the camera)
      const persp = Math.exp(c.depthScale * near);
      // a slight left-right drift that grows as you breathe in and settles almost still as you breathe out
      const swayX = Math.sin(this.t * m.fx * Math.PI * 2 + m.px) * unit * c.sway * (0.08 + 0.92 * L) * (0.6 + 0.4 * persp);
      const x = this.cx + side * m.R * (w * c.reach) * (0.85 + 0.15 * persp) + swayX;
      const y = h * (1 - above) + Math.sin(this.t * m.fy * Math.PI * 2 + m.py) * unit * 0.018 * m.z * (0.3 + 0.7 * L) + depth * unit * 0.02 * m.R;
      if (y < -40 || y > h + 40 || x < -40 || x > w + 40) continue;
      // brightness: rises with the breath; fainter towards the far side, gone straight behind you
      const twinkle = this.reduced ? 1 : 0.82 + 0.18 * Math.sin(this.t * m.tw * Math.PI * 2 + m.tp);
      const far = depth < 0 ? clamp01(1 + depth * c.behindFade) : 1;
      const a = c.brightness * (c.dimAlpha + (1 - c.dimAlpha) * L ** 1.2) * (0.6 + 0.4 * m.z) * twinkle * fade * far * Math.min(1.3, 0.55 + 0.45 * persp) * m.on;
      if (a < 0.01) continue;
      const r = unit * c.size * (0.9 + 0.2 * m.z) * (0.75 + 0.55 * L) * persp;
      const g = depth < 0 ? back : ctx;
      g.globalAlpha = Math.min(1, a);
      g.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();

    // the far side passes behind you: cut your outline (soft-edged) out of it, then lay it under the near side
    if (body) {
      back.globalAlpha = 1;
      back.globalCompositeOperation = 'destination-out';
      back.filter = `blur(${Math.max(1, Math.round(unit * body.edge))}px)`;
      back.fillStyle = '#000'; back.strokeStyle = '#000';
      body.fill(back);
      back.filter = 'none';
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over'; // under the near side already drawn
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.back!, 0, 0);
    ctx.restore();
  }
}

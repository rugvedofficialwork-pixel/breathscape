import { CONFIG } from '../config';
import type { Word } from '../state';
import type { Point } from '../tracking/pose';
import { PALETTES, rgba } from './palette';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Mote { ox: number; oy: number; side: 0 | 1; life: number; max: number; curl: number; size: number }

export interface GatherInput {
  bothPinched: boolean;
  points: { left: Point; right: Point }; // live pinch positions (normalized, mirrored)
  chest: Point;
  hands: { left: Point; right: Point };
  word: Word;
}

/**
 * Part F2, beat 1: particles from the effect steer toward the two pinch points and gather into two small
 * glowing orbs. `thin` (0-1) tells the effect layer how much to thin the surrounding effect as the orbs brighten.
 */
export class Gather {
  mode: 'off' | 'live' | 'auto' = 'off';
  amount = 0;
  thin = 0;
  /** 0-1: orbs travelling into the chest contact point (beat 3). */
  converge = 0;

  private motes: Mote[] = [];
  private acc = 0;
  private energy = [0, 0];
  private pos: Point[] = [{ x: 0.4, y: 0.55 }, { x: 0.6, y: 0.55 }];
  private contact: Point | null = null;
  private word: Word = 'kindness';
  /** Once both hands have pinched, the orbs stay and follow the fingertips (until contact), even if the pinch relaxes. */
  private latched = false;
  /** Seconds since contact, drives the ring that follows as the orbs sink in. */
  private pulse = -1;

  get active(): boolean { return this.amount > 0.01 || (this.converge > 0 && this.converge < 1); }

  contactAt(p: Point): void { this.contact = p; this.pulse = 0; }

  reset(): void {
    this.mode = 'off'; this.amount = 0; this.thin = 0; this.converge = 0;
    this.motes = []; this.energy = [0, 0]; this.contact = null; this.acc = 0; this.latched = false; this.pulse = -1;
  }

  update(dt: number, inp: GatherInput, w: number, h: number, motion: number): void {
    this.word = inp.word;
    const md = Math.min(w, h);
    if (this.mode === 'live' && inp.bothPinched) this.latched = true;
    const arrived = !!this.contact && this.converge >= 1;
    const want = arrived ? 0 : this.contact ? 1 : this.mode === 'auto' ? 1 : this.mode === 'live' && (inp.bothPinched || this.latched) ? 1 : 0;
    this.amount += (want - this.amount) * (1 - Math.exp(-dt / (want > this.amount ? 700 : arrived ? 450 : 1600)));
    this.thin = 0.72 * this.amount * (1 - this.converge);

    // orb positions: the live pinch points, or a gentle spot in front of the chest on the auto path
    const c = inp.chest;
    const auto: Point[] = [{ x: c.x - 0.12, y: c.y - 0.1 }, { x: c.x + 0.12, y: c.y - 0.1 }];
    const live: Point[] = [inp.points.left, inp.points.right];
    const src = this.mode === 'auto' && !this.latched ? auto : live; // follow the fingertips, even after the pinch relaxes
    for (let i = 0; i < 2; i++) {
      const k = 1 - Math.exp(-dt / 220); // orbs follow the fingertips smoothly
      this.pos[i] = { x: lerp(this.pos[i].x, src[i].x, k), y: lerp(this.pos[i].y, src[i].y, k) };
    }
    if (this.contact) {
      this.converge = Math.min(1, this.converge + dt / 1900); // sink into the chest gently
      if (this.pulse >= 0) this.pulse += dt / 1000;
    }

    // seed motes from around the user (where the effect is) toward the pinch points
    if (this.amount > 0.05 && (!this.contact || this.converge < 0.7)) {
      this.acc += 11 * this.amount * motion * (dt / 1000); // fewer particles...
      while (this.acc >= 1) {
        this.acc -= 1;
        if (this.motes.length >= 120) break;
        const base = Math.random() < 0.5 ? inp.hands.left : inp.hands.right;
        const useChest = Math.random() < 0.4;
        const o = useChest ? c : base;
        const a = Math.random() * Math.PI * 2, r = md * (0.05 + Math.random() * 0.22);
        this.motes.push({
          ox: o.x * w + Math.cos(a) * r, oy: o.y * h + Math.sin(a) * r * 0.8,
          side: Math.random() < 0.5 ? 0 : 1, life: 0, max: 3400 + Math.random() * 2200, // ...each drifting in slowly
          curl: (Math.random() - 0.5) * md * 0.08, size: 0.8 + Math.random() * 1.2,
        });
      }
    }
    for (const m of this.motes) {
      m.life += dt;
      if (m.life >= m.max) this.energy[m.side] = Math.min(1, this.energy[m.side] + 0.06);
    }
    this.motes = this.motes.filter((m) => m.life < m.max);
    for (let i = 0; i < 2; i++) this.energy[i] = Math.max(0, this.energy[i] - (dt / 1000) * 0.12);
  }

  /** A soft ring expanding from the contact point as the orbs sink in: as the orbs sink in. */
  private drawPulse(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.contact || this.pulse < 1.2 || this.pulse > 4.2) return; // starts as the orbs arrive
    const u = (this.pulse - 1.2) / 3, md = Math.min(w, h);
    const pal = PALETTES[this.word];
    const x = this.contact.x * w, y = this.contact.y * h, r = md * (0.03 + 0.34 * (1 - (1 - u) * (1 - u)));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(pal.hi, 0.7 * (1 - u)); ctx.lineWidth = 3 + 5 * (1 - u);
    ctx.shadowColor = rgba(pal.glow, 0.9); ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(pal.glow, 0.35 * (1 - u))); g.addColorStop(1, rgba(pal.glow, 0));
    ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** Where each orb is drawn (mirrored, normalized), including the convergence into the contact point. */
  private orbAt(i: number): Point {
    const p = this.pos[i];
    if (!this.contact || this.converge <= 0) return p;
    const e = ease(this.converge);
    return { x: lerp(p.x, this.contact.x, e), y: lerp(p.y, this.contact.y, e) };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawPulse(ctx, w, h);
    if (!this.active) return;
    const pal = PALETTES[this.word];
    const md = Math.min(w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // motes drift toward their orb along a soft curve, and are absorbed on arrival
    for (const m of this.motes) {
      const u = clamp01(m.life / m.max), e = ease(u);
      const t = this.orbAt(m.side);
      const tx = t.x * w, ty = t.y * h;
      const x = lerp(m.ox, tx, e) + Math.sin(u * Math.PI) * m.curl;
      const y = lerp(m.oy, ty, e) - Math.sin(u * Math.PI) * Math.abs(m.curl) * 0.3;
      ctx.fillStyle = rgba(pal.glow, Math.sin(u * Math.PI) * 0.6 * this.amount);
      ctx.beginPath(); ctx.arc(x, y, m.size * (1 - 0.5 * u), 0, Math.PI * 2); ctx.fill();
    }
    // the two glowing orbs
    const maxR = CONFIG.f2.gatherOrbMax * (md / 540);
    for (let i = 0; i < 2; i++) {
      const p = this.orbAt(i);
      const pulse = 1 + 0.07 * Math.sin(performance.now() / 700 + i * 1.7);
      const b = clamp01((0.62 * this.amount + 0.5 * this.energy[i]) * pulse) * this.amount * (1 - 0.6 * ease(this.converge));
      if (b <= 0.01) continue;
      const r = md * 0.006 + maxR * b, x = p.x * w, y = p.y * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4.6);
      g.addColorStop(0, rgba(pal.glow, 1.0 * b));
      g.addColorStop(0.3, rgba(pal.glow, 0.55 * b));
      g.addColorStop(0.65, rgba(pal.glow, 0.16 * b));
      g.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4.6, 0, Math.PI * 2); ctx.fill();
      const core = ctx.createRadialGradient(x, y, 0, x, y, r);
      core.addColorStop(0, `rgba(255,255,255,${0.95 * b})`);
      core.addColorStop(1, rgba(pal.hi, 0.35 * b));
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

import { CONFIG } from '../config';
import type { PoseTracker } from '../tracking/pose';
import type { Phase } from '../audio/drone';
import { RisingField } from './rising';
import type { BodyShape } from './body';

interface Particle {
  mode: 'in' | 'out';
  a: number; // angle from the orb centre
  d0: number; // starting distance from the centre
  d: number; // current distance
  swirl: number; // small angular drift over the particle's life
  travel?: number; // outward distance (exhale only)
  x: number; y: number; alpha: number;
  life: number; max: number; size: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);

export class Orb {
  visible = false;
  /** 0 = untouched, 1 = dimmed to a single point. */
  endAmt = 0;
  /** 0 = clear, 1 = fully dark. */
  darkAmt = 0;
  /** Fractional cycle position (cycle index + progress) used for colour/pace. */
  cycleF = 0;
  level = 0;

  private phase: Phase | 'idle' = 'idle';
  private phaseStart = 0;
  private phaseDur: number = CONFIG.scene1.phaseMs;
  private appear = 0;
  private holdAmt = 0;
  private t = 0;
  private last = 0;
  private parts: Particle[] = [];
  private spawnAcc = 0;
  private endFrom: number | null = null;
  private endMs = 0;
  private endStart = 0;

  /** The breathing visual: the rising particle field (default) or the original orb (?orb=1). */
  style: 'particles' | 'orb' = new URLSearchParams(location.search).get('orb') === '1' ? 'orb' : CONFIG.scene1.visual;
  private field: RisingField;
  /** Your outline on screen, for particles to pass behind (set by main). */
  bodyProvider: ((w: number, h: number) => BodyShape | null) | null = null;

  constructor(private tracker: PoseTracker, private reduced: boolean) {
    this.field = new RisingField(reduced);
  }

  show(): void { this.visible = true; }

  reset(): void {
    this.visible = false; this.endAmt = 0; this.darkAmt = 0; this.cycleF = 0; this.level = 0;
    this.appear = 0; this.holdAmt = 0; this.parts = []; this.endFrom = null; this.phase = 'idle';
  }

  setPhase(phase: Phase, cycle: number, durMs: number, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
    this.phaseDur = durMs;
    this.cycleF = cycle + ['inhale', 'hold', 'exhale', 'rest'].indexOf(phase) / 4;
  }

  /** Dim to a single point and fade the screen toward dark. */
  dim(ms: number, now: number): void {
    this.endFrom = 0; this.endMs = ms; this.endStart = now;
  }

  /** Where the orb would be if it followed the breath clock (used when there is no camera). */
  private timerLevel(now: number): number {
    const p = clamp01((now - this.phaseStart) / this.phaseDur);
    switch (this.phase) {
      case 'inhale': return ease(p);
      case 'hold': return 1;
      case 'exhale': return 1 - ease(p);
      default: return 0;
    }
  }

  private target(now: number): number {
    const noCamera = !this.tracker.ready && !this.tracker.manual;
    return noCamera ? this.timerLevel(now) : this.tracker.signals.handHeight;
  }

  private color(a: number): string {
    const s = CONFIG.scene1;
    const t = ease(clamp01(this.cycleF / s.cycles));
    const c = s.colorFrom.map((v, i) => Math.round(lerp(v, s.colorTo[i], t)));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number): void {
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    const s = CONFIG.scene1;
    const speed = Math.pow(s.slowPerCycle, this.cycleF);
    this.t += (dt / 1000) * speed;

    if (this.endFrom !== null) {
      const p = clamp01((now - this.endStart) / this.endMs);
      this.endAmt = ease(clamp01(p / 0.7));
      this.darkAmt = ease(clamp01((p - 0.25) / 0.75));
    }

    if (this.visible) this.appear = Math.min(1, this.appear + dt / 1800);
    const appear = ease(this.appear);

    // Orb level follows the hand 1:1 (light smoothing only)
    const tau = (this.reduced ? 260 : 110) / speed;
    this.level += (this.target(now) - this.level) * (1 - Math.exp(-dt / tau));

    if (this.style === 'particles') {
      this.field.draw(ctx, w, h, dt, this.level, appear, this.endAmt, this.color(1), this.bodyProvider?.(w, h) ?? null, this.cycleF / Math.max(1, s.cycles - 1));
      this.veil(ctx, w, h);
      return;
    }

    // inner pulse on holds
    const holding = this.phase === 'hold' ? 1 : 0;
    this.holdAmt += (holding - this.holdAmt) * (1 - Math.exp(-dt / 500));

    const minDim = Math.min(w, h);
    const rMin = s.orbMinRadius * minDim, rMax = s.orbMaxRadius * minDim;
    let r = lerp(rMin, rMax, this.level);
    if (!this.reduced) r *= 1 + 0.03 * this.holdAmt * Math.sin(this.t * Math.PI * 2 * 0.6);
    r = lerp(r, 2.5, this.endAmt);
    const cx = w / 2, cy = h / 2;

    // Particles: inhale = drawn inward into the orb, hold = none, exhale = released outward and spread away
    // Particles wait ~1s after the cue; inhale stops seeding near the end so they arrive before the hold
    const phaseP = clamp01((now - this.phaseStart) / this.phaseDur);
    const inWindow = this.phase === 'inhale' ? phaseP >= 0.25 && phaseP < 0.6 : phaseP >= 0.25;
    const spawning = (this.phase === 'inhale' || this.phase === 'exhale') && inWindow;
    if (!this.reduced && spawning && this.endAmt < 0.5) {
      const thin = Math.max(0.2, 1 - 0.14 * this.cycleF); // trail thins each cycle
      const rate = (this.phase === 'inhale' ? 26 : 22) * thin * speed;
      this.spawnAcc += rate * (dt / 1000);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.parts.length >= s.maxParticles) break;
        const a = Math.random() * Math.PI * 2;
        if (this.phase === 'inhale') {
          this.parts.push({
            mode: 'in', a, d0: r + minDim * (0.14 + Math.random() * 0.16), d: 0, swirl: (Math.random() - 0.5) * 0.35,
            life: 0, max: (2300 + Math.random() * 900) / speed, size: 0.9 + Math.random() * 1.6, x: 0, y: 0, alpha: 0,
          });
        } else {
          this.parts.push({
            mode: 'out', a, d0: r, d: 0, swirl: (Math.random() - 0.5) * 0.8,
            travel: minDim * (0.12 + Math.random() * 0.24),
            life: 0, max: (3600 + Math.random() * 1600) / speed, size: 0.9 + Math.random() * 1.8, x: 0, y: 0, alpha: 0,
          });
        }
      }
    }

    // On hold there are no new particles and stragglers are absorbed/fade quickly
    const lifeRate = this.phase === 'hold' ? 3 : 1;
    for (const p of this.parts) {
      p.life += dt * lifeRate;
      const u = clamp01(p.life / p.max);
      if (p.mode === 'in') {
        // spiral gently inward, accelerating, and get absorbed at the orb's surface
        p.d = lerp(p.d0, r * 0.9, u * (2 - u) * 0.6 + u * u * 0.4); // eases in gently, no sudden rush
        const ang = p.a + p.swirl * u;
        p.x = cx + Math.cos(ang) * p.d; p.y = cy + Math.sin(ang) * p.d;
        p.alpha = Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.75; // fades in, glows, dissolves into the orb
      } else {
        // leave the surface, decelerate, spread and drift away
        const e = 1 - (1 - u) * (1 - u);
        p.d = p.d0 + (p.travel ?? 0) * e;
        const ang = p.a + p.swirl * e * 0.6;
        p.x = cx + Math.cos(ang) * p.d; p.y = cy + Math.sin(ang) * p.d + e * minDim * 0.03;
        p.alpha = (1 - u) * (1 - u) * 0.5;
      }
    }
    this.parts = this.parts.filter((p) => p.life < p.max);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      const a = p.alpha * appear * (1 - this.endAmt);
      const sz = p.mode === 'in' ? p.size * (1 - 0.5 * clamp01(p.life / p.max)) : p.size;
      ctx.fillStyle = this.color(a);
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
    }

    if (appear > 0) {
      // outer glow: radius and strength both follow the hand
      const glowR = r * (1.7 + this.level * 1.3);
      const glowA = (0.18 + 0.5 * this.level) * appear * (1 - this.endAmt);
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, glowR);
      g.addColorStop(0, this.color(glowA));
      g.addColorStop(1, this.color(0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();

      // body
      const b = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      b.addColorStop(0, `rgba(255,255,255,${0.95 * appear})`);
      b.addColorStop(0.35, this.color(0.9 * appear));
      b.addColorStop(1, this.color(0.35 * appear));
      ctx.fillStyle = b;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    this.veil(ctx, w, h);
  }

  /** At the close: the screen fades toward dark (the orb leaves a single point of light). */
  private veil(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w / 2, cy = h / 2;
    if (this.darkAmt > 0) {
      ctx.fillStyle = `rgba(5,6,10,${0.94 * this.darkAmt})`;
      // leave the single point visible: draw the dark veil, then the point again
      ctx.fillRect(0, 0, w, h);
      if (this.endAmt > 0.5 && this.style === 'orb') {
        ctx.fillStyle = this.color(0.9 * (1 - this.darkAmt * 0.6));
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

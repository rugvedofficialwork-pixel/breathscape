import type { Point } from '../tracking/pose';
import type { Word } from '../state';

export interface EffectInput {
  intensity: number; // 0-1, from arm spread (eased); never auto-escalates
  hands: { left: Point; right: Point }; // normalized, mirrored
  chest: Point; // normalized, mirrored
}

export interface Effect {
  /** Normalized X of flowers that just bloomed (drained by the layer to trigger chimes). */
  bloomed: number[];
  /** vis = overall visibility 0-1 (appear x release fade). Also scales how much is spawned. */
  update(dt: number, inp: EffectInput, vis: number, w: number, h: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vis: number): void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------- Kindness
interface Mote { x0: number; y0: number; dx: number; dy: number; life: number; max: number; size: number }
interface Flower { x: number; y: number; size: number; petals: number; rot: number; col: number[]; age: number; dying: number }

const PETALS = [[255, 186, 150], [255, 168, 172], [255, 212, 150], [248, 198, 224]];

class Kindness implements Effect {
  bloomed: number[] = [];
  private motes: Mote[] = [];
  private flowers: Flower[] = [];
  private acc = 0;
  private t = 0;

  constructor(private motion: number) {}

  update(dt: number, inp: EffectInput, vis: number, w: number, h: number): void {
    const md = Math.min(w, h), I = inp.intensity;
    this.t += dt;
    this.acc += (2.5 + 13 * I) * vis * this.motion * (dt / 1000);
    while (this.acc >= 1) {
      this.acc -= 1;
      if (this.motes.length >= 110) break;
      const hand = Math.random() < 0.5 ? inp.hands.left : inp.hands.right;
      const outward = hand.x < inp.chest.x ? Math.PI : 0; // away from the body
      const ang = outward + (Math.random() - 0.5) * 2.4;
      const dist = md * (0.05 + 0.3 * I) * (0.5 + Math.random());
      this.motes.push({
        x0: hand.x * w, y0: hand.y * h,
        dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist - md * 0.02,
        life: 0, max: 1500 + Math.random() * 1400, size: 1.6 + Math.random() * 1.8,
      });
    }
    for (const m of this.motes) {
      m.life += dt;
      if (m.life >= m.max) this.land(m.x0 + m.dx, m.y0 + m.dy, md, I, w);
    }
    this.motes = this.motes.filter((m) => m.life < m.max);
    for (const f of this.flowers) { f.age += dt; if (f.dying) f.dying += dt; }
    this.flowers = this.flowers.filter((f) => f.dying < 1000);
  }

  private land(x: number, y: number, md: number, I: number, w: number): void {
    const live = this.flowers.filter((f) => !f.dying);
    if (live.length >= 64) live[0].dying = 1; // oldest gently fades out
    this.flowers.push({
      x, y, size: md * (0.012 + 0.016 * Math.random()) * (0.85 + I * 0.5),
      petals: 5 + Math.floor(Math.random() * 3), rot: Math.random() * Math.PI * 2,
      col: PETALS[Math.floor(Math.random() * PETALS.length)], age: 0, dying: 0,
    });
    this.bloomed.push(x / w);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vis: number): void {
    ctx.save();
    // flowers
    for (const f of this.flowers) {
      const bloom = easeOut(clamp01(f.age / 2200));
      const alpha = vis * (f.dying ? 1 - f.dying / 1000 : 1) * clamp01(f.age / 500);
      if (alpha <= 0.01) continue;
      const sway = Math.sin(this.t / 1400 + f.x) * 0.05;
      const s = f.size * (0.3 + 0.7 * bloom);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 3.2);
      g.addColorStop(0, `rgba(${f.col[0]},${f.col[1]},${f.col[2]},${0.28 * alpha})`);
      g.addColorStop(1, `rgba(${f.col[0]},${f.col[1]},${f.col[2]},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.rotate(f.rot + sway);
      ctx.fillStyle = `rgba(${f.col[0]},${f.col[1]},${f.col[2]},${0.85 * alpha})`;
      for (let i = 0; i < f.petals; i++) {
        ctx.rotate((Math.PI * 2) / f.petals);
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.95 * bloom, s * 0.46 * bloom + 0.1, s * 0.95 * bloom + 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255,224,130,${alpha})`;
      ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // points of warm light
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const u = m.life / m.max, e = easeOut(u);
      const x = m.x0 + m.dx * e, y = m.y0 + m.dy * e - Math.sin(u * Math.PI) * 6;
      const a = Math.sin(clamp01(u) * Math.PI) * 0.85 * vis;
      const g = ctx.createRadialGradient(x, y, 0, x, y, m.size * 4);
      g.addColorStop(0, `rgba(255,214,140,${a})`);
      g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, m.size * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    void w; void h;
  }
}

// ---------------------------------------------------------------- Acceptance
interface Drift { x: number; y: number; len: number; spd: number; a: number; w: number; ph: number; k: number }
interface Wave { r: number; a: number }

/**
 * Acceptance as making room (the "expansion" practice in acceptance and commitment therapy): the wind keeps blowing
 * and is never stopped or pushed away. It passes THROUGH an open space instead of against you. The space is held
 * open between your two hands: its sides are where your hands are, with a small light at each, so opening your arms
 * visibly opens it. Inside, the wind slows, smooths and turns to soft green-gold light; each time you open a little
 * further a ring of light goes out from you. The space has no wall: its edge is a broken, breathing line.
 */
class Acceptance implements Effect {
  bloomed: number[] = [];
  private drifts: Drift[] = [];
  private waves: Wave[] = [];
  private t = 0;
  private I = 0;
  private lastStep = 0;
  // the room, in pixels: centre and half-width / half-height
  private cx = 0; private cy = 0; private rx = 0; private ry = 0;
  private hl = { x: 0, y: 0 }; private hr = { x: 0, y: 0 };
  private ready = false;

  constructor(private motion: number) {}

  update(dt: number, inp: EffectInput, _vis: number, w: number, h: number): void {
    const md = Math.min(w, h);
    this.t += dt;
    // how open the arms are, straight from where the hands are (and never less than the arm-spread reading)
    const L = { x: inp.hands.left.x * w, y: inp.hands.left.y * h }, R = { x: inp.hands.right.x * w, y: inp.hands.right.y * h };
    const span = Math.abs(R.x - L.x) / w;
    const open = Math.max(inp.intensity, clamp01((span - 0.16) / 0.5));
    this.I += (open - this.I) * (1 - Math.exp(-dt / 160)); // quick: it answers the arms at once
    // each further opening sends a ring of light outward
    if (this.I - this.lastStep > 0.08) { this.waves.push({ r: 0, a: 1 }); this.lastStep = this.I; }
    if (this.I < this.lastStep - 0.12) this.lastStep = this.I;
    // the room is stretched between the hands, centred a little above them, at chest height
    const k = 1 - Math.exp(-dt / 120);
    const tx = (L.x + R.x) / 2, ty = (inp.chest.y * h + (L.y + R.y) / 2) / 2;
    const trx = Math.max(md * 0.12, Math.abs(R.x - L.x) / 2 + md * 0.04);
    const try_ = md * (0.14 + 0.32 * this.I);
    if (!this.ready) { this.cx = tx; this.cy = ty; this.rx = trx; this.ry = try_; this.hl = { ...L }; this.hr = { ...R }; this.ready = true; }
    this.cx += (tx - this.cx) * k; this.cy += (ty - this.cy) * k; this.rx += (trx - this.rx) * k; this.ry += (try_ - this.ry) * k;
    this.hl.x += (L.x - this.hl.x) * k; this.hl.y += (L.y - this.hl.y) * k; this.hr.x += (R.x - this.hr.x) * k; this.hr.y += (R.y - this.hr.y) * k;
    for (const wv of this.waves) { wv.r += dt / 1600; wv.a = 1 - wv.r; }
    this.waves = this.waves.filter((wv) => wv.a > 0);

    if (!this.drifts.length) {
      const n = Math.round(130 * (this.motion < 1 ? 0.5 : 1));
      for (let i = 0; i < n; i++) this.drifts.push(this.make(w, h, md, true));
    }
    const sec = dt / 1000;
    for (const s of this.drifts) {
      const d = Math.hypot((s.x - this.cx) / this.rx, (s.y - this.cy) / this.ry); // 1 = the edge of the room
      s.k = 1 - smooth(0.75, 1.05, d);
      // through, not around: no deflection; inside it slows to half and its flutter settles
      s.x += s.spd * (1 - 0.55 * s.k) * this.motion * sec;
      s.y += Math.sin(this.t / 700 + s.ph) * 9 * sec * (1 - 0.85 * s.k);
      if (s.x - s.len > w) Object.assign(s, this.make(w, h, md, false));
    }
  }

  private make(w: number, h: number, md: number, anywhere: boolean): Drift {
    return {
      x: anywhere ? Math.random() * w : -Math.random() * 80, y: Math.random() * h,
      len: md * (0.06 + Math.random() * 0.14), spd: w * (0.3 + Math.random() * 0.45),
      a: 0.28 + Math.random() * 0.3, w: 1.1 + Math.random() * 1.5, ph: Math.random() * 6.28, k: 0,
    };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vis: number): void {
    if (!this.ready) return;
    const md = Math.min(w, h), I = this.I;
    const breathe = 1 + 0.03 * Math.sin(this.t / 2400);
    const rx = this.rx * breathe, ry = this.ry * breathe;
    ctx.save();
    // the open space: a clear, soft green-gold wash, brighter and wider the more you open
    ctx.save();
    ctx.translate(this.cx, this.cy); ctx.scale(rx / ry, 1);
    const g = ctx.createRadialGradient(0, 0, ry * 0.05, 0, 0, ry);
    g.addColorStop(0, `rgba(236,246,214,${(0.12 + 0.3 * I) * vis})`);
    g.addColorStop(0.65, `rgba(186,228,196,${(0.07 + 0.2 * I) * vis})`);
    g.addColorStop(1, 'rgba(170,214,182,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    // its edge: a broken line through both hands (a room, not a wall: the wind crosses it)
    ctx.save();
    ctx.setLineDash([md * 0.014, md * 0.018]); ctx.lineDashOffset = -this.t / 60;
    ctx.lineWidth = 1.6 + 1.4 * I;
    ctx.strokeStyle = `rgba(222,244,214,${(0.3 + 0.45 * I) * vis})`;
    ctx.beginPath(); ctx.ellipse(this.cx, this.cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // rings of light going out each time you open further
    for (const wv of this.waves) {
      ctx.strokeStyle = `rgba(240,232,190,${0.45 * wv.a * wv.a * vis})`; ctx.lineWidth = 2.5 * wv.a + 0.5;
      ctx.beginPath(); ctx.ellipse(this.cx, this.cy, rx * (1 + 0.6 * wv.r), ry * (1 + 0.6 * wv.r), 0, 0, Math.PI * 2); ctx.stroke();
    }
    // a light at each hand: you are the one holding it open
    for (const p of [this.hl, this.hr]) {
      const r = md * (0.03 + 0.03 * I);
      const hg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      hg.addColorStop(0, `rgba(255,246,214,${(0.55 + 0.35 * I) * vis})`); hg.addColorStop(1, 'rgba(220,240,200,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    // the wind, passing through: outside it is quick and pale; inside, slow, wide and glowing
    ctx.lineCap = 'round';
    for (const s of this.drifts) {
      const k = s.k;
      const len = s.len * (1 - 0.3 * k);
      const glow = k * (0.4 + 0.6 * I);
      ctx.strokeStyle = `rgba(${Math.round(lerp(200, 246, glow))},${Math.round(lerp(214, 238, glow))},${Math.round(lerp(226, 186, glow))},${s.a * (1 + 0.6 * glow) * vis})`;
      ctx.lineWidth = s.w * (1 + 1.2 * glow);
      ctx.beginPath(); ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- Courage
interface Streak { x: number; y: number; len: number; spd: number; a: number; w: number; ph: number; k: number }
interface Still { x: number; y: number; ph: number; s: number }

/**
 * Wind blows across the frame and flows AROUND a calm pocket that follows you. Opening your arms
 * grows the pocket: inside it the wind stops and the air goes still and clear. Everything is driven
 * live by arm spread, so widening and closing your arms visibly resizes the bubble.
 */
class Courage implements Effect {
  bloomed: number[] = [];
  private streaks: Streak[] = [];
  private still: Still[] = [];
  private t = 0;
  private I = 0;
  private cx = 0.5;
  private cy = 0.5;

  constructor(private motion: number) {}

  private radii(md: number): { rx: number; ry: number } {
    const ry = md * (0.15 + 0.42 * this.I);
    return { rx: ry * 1.35, ry };
  }

  update(dt: number, inp: EffectInput, _vis: number, w: number, h: number): void {
    const md = Math.min(w, h);
    this.t += dt;
    this.cx = inp.chest.x; this.cy = inp.chest.y;
    this.I += (inp.intensity - this.I) * (1 - Math.exp(-dt / 350));
    if (!this.streaks.length) {
      const n = Math.round(150 * (this.motion < 1 ? 0.5 : 1));
      for (let i = 0; i < n; i++) this.streaks.push(this.make(w, h, md, true));
      for (let i = 0; i < 34; i++) this.still.push({ x: 0, y: 0, ph: Math.random() * 6.28, s: 0.6 + Math.random() });
    }
    const px = this.cx * w, py = (this.cy - 0.05) * h;
    const { rx, ry } = this.radii(md);
    const sec = dt / 1000;
    for (const s of this.streaks) {
      const d = Math.hypot((s.x - px) / rx, (s.y - py) / ry); // 1 = the pocket's edge
      s.k = 1 - smooth(0.78, 1.0, d);
      // wind flows around the bubble instead of through it
      if (d < 1.4 && d > 0.8) s.y += Math.sign(s.y - py || 1) * (1.4 - d) * 90 * sec * this.motion;
      s.x += s.spd * (1 - 0.97 * s.k) * this.motion * sec;
      s.y += Math.sin(this.t / 800 + s.ph) * 6 * sec * (1 - s.k);
      if (s.x - s.len > w) Object.assign(s, this.make(w, h, md, false));
    }
    // still, floating specks inside the pocket
    for (const m of this.still) {
      m.x = px + Math.cos(this.t / 4200 * m.s + m.ph) * rx * 0.62 * Math.sin(m.ph * 3 + 1);
      m.y = py + Math.sin(this.t / 5100 * m.s + m.ph * 2) * ry * 0.6;
    }
  }

  private make(w: number, h: number, md: number, anywhere: boolean): Streak {
    return {
      x: anywhere ? Math.random() * w : -Math.random() * 80, y: Math.random() * h,
      len: md * (0.07 + Math.random() * 0.16), spd: w * (0.34 + Math.random() * 0.5),
      a: 0.3 + Math.random() * 0.35, w: 1.2 + Math.random() * 1.6, ph: Math.random() * 6.28, k: 0,
    };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vis: number): void {
    const md = Math.min(w, h);
    const px = this.cx * w, py = (this.cy - 0.05) * h;
    const { rx, ry } = this.radii(md);
    ctx.save();
    // the calm pocket: a clear, defined bubble that visibly grows and shrinks with your arms
    ctx.save();
    ctx.translate(px, py); ctx.scale(rx / ry, 1);
    const g = ctx.createRadialGradient(0, 0, ry * 0.1, 0, 0, ry);
    g.addColorStop(0, `rgba(150,205,240,${(0.2 + 0.12 * this.I) * vis})`);
    g.addColorStop(0.85, `rgba(140,200,240,${(0.14 + 0.1 * this.I) * vis})`);
    g.addColorStop(1, `rgba(150,210,245,${0.05 * vis})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(190,228,250,${(0.35 + 0.35 * this.I) * vis})`;
    ctx.shadowColor = 'rgba(150,210,255,0.8)'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // wind
    ctx.lineCap = 'round';
    for (const s of this.streaks) {
      const a = s.a * (1 - 0.92 * s.k) * vis;
      if (a < 0.015) continue;
      const len = s.len * (1 - 0.7 * s.k);
      ctx.strokeStyle = `rgba(226,238,250,${a})`;
      ctx.lineWidth = s.w * (1 - 0.5 * s.k);
      ctx.beginPath(); ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    // stillness inside
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.still) {
      ctx.fillStyle = `rgba(210,236,255,${(0.15 + 0.45 * this.I) * vis})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- Calm
interface Ripple { age: number; max: number }
interface Dust { x: number; y: number; vx: number; vy: number; a: number }

class Calm implements Effect {
  bloomed: number[] = [];
  private ripples: Ripple[] = [];
  private dust: Dust[] = [];
  private since = 99999;
  private I = 0;
  private cx = 0.5;
  private cy = 0.55;

  constructor(private motion: number) {}

  update(dt: number, inp: EffectInput, vis: number, w: number, h: number): void {
    this.cx = inp.chest.x; this.cy = inp.chest.y;
    this.I += (inp.intensity - this.I) * (1 - Math.exp(-dt / 600));
    if (!this.dust.length) {
      for (let i = 0; i < 70; i++) {
        this.dust.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 18, a: 0.1 + Math.random() * 0.25 });
      }
    }
    this.since += dt;
    if (vis > 0.05 && this.since > 2600 / this.motion) { this.since = 0; this.ripples.push({ age: 0, max: 7500 }); }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < r.max);
    // background motion softens as spread (stillness) increases
    const calmK = 1 - 0.9 * this.I;
    for (const d of this.dust) {
      d.x += d.vx * calmK * this.motion * (dt / 1000); d.y += d.vy * calmK * this.motion * (dt / 1000);
      if (d.x < 0) d.x += w; if (d.x > w) d.x -= w; if (d.y < 0) d.y += h; if (d.y > h) d.y -= h;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, vis: number): void {
    const md = Math.min(w, h), cx = this.cx * w, cy = this.cy * h;
    const maxR = md * (0.4 + 0.8 * this.I);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.dust) {
      ctx.fillStyle = `rgba(200,224,242,${d.a * vis * (1 - 0.6 * this.I)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    for (const r of this.ripples) {
      const u = r.age / r.max, e = easeOut(u), rad = e * maxR;
      const a = Math.pow(1 - u, 1.6) * (0.22 + 0.3 * this.I) * vis;
      const fill = ctx.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad);
      fill.addColorStop(0, 'rgba(190,220,240,0)');
      fill.addColorStop(1, `rgba(190,220,240,${a * 0.5})`);
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(206,230,246,${a})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(206,230,246,${a * 0.5})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, rad * 0.86, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- factory
export function createEffect(word: Word, reducedMotion: boolean): Effect {
  const motion = reducedMotion ? 0.5 : 1;
  switch (word) {
    case 'kindness': return new Kindness(motion);
    case 'acceptance': return new Acceptance(motion);
    case 'courage': return new Courage(motion);
    case 'calm': return new Calm(motion);
  }
}

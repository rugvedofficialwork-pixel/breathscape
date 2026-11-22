import type { Pos } from './coords';
import { angleDelta } from './math';
import type { PathDef } from '../types';

interface Key {
  t: number;
  az: number; // unwrapped, so an arc keeps turning the way it was written
  el: number;
  dist: number;
}

/**
 * A movement through space, defined by timed keyframes in az/el/dist.
 *
 * Interpolation happens in spherical coordinates (not x/y/z), so an arc from
 * the left round the back to the right travels around the head instead of
 * cutting through it. The curve is a smooth cubic through every keyframe
 * (exact timing at each key), starting and ending at rest.
 *
 * Each keyframe may leave out az/el/dist to keep the previous value. A key's
 * azimuth goes the shortest way from the previous key, unless it says
 * "turn": "cw" (clockwise seen from above: front -> right -> behind) or "ccw".
 */
export class Path {
  private keys: Key[] = [];
  readonly duration: number;

  constructor(def: PathDef, from?: Pos) {
    const pts = [...def.points].sort((a, b) => a.t - b.t);
    let prev: Key | null = null;
    if (from && (pts.length === 0 || pts[0].t > 0)) {
      prev = { t: 0, az: from.az, el: from.el, dist: from.dist };
      this.keys.push(prev);
    }
    for (const p of pts) {
      const base = prev ?? { t: 0, az: from?.az ?? 0, el: from?.el ?? 0, dist: from?.dist ?? 1.5 };
      let az = base.az;
      if (p.az !== undefined) {
        let d = angleDelta(base.az, p.az);
        if (p.turn === 'cw' && d < 0) d += 360;
        if (p.turn === 'ccw' && d > 0) d -= 360;
        az = prev ? base.az + d : p.az;
      }
      const k: Key = { t: p.t, az, el: p.el ?? base.el, dist: p.dist ?? base.dist };
      if (prev && k.t <= prev.t) continue;
      this.keys.push(k);
      prev = k;
    }
    if (this.keys.length === 0) this.keys.push({ t: 0, az: 0, el: 0, dist: 1.5 });
    this.duration = this.keys[this.keys.length - 1].t;
  }

  get start(): Pos {
    return this.at(0);
  }

  get end(): Pos {
    return this.at(this.duration);
  }

  /** Position at time t (seconds from the start of the path). */
  at(t: number): Pos {
    const k = this.keys;
    if (k.length === 1 || t <= k[0].t) return this.pos(k[0]);
    if (t >= k[k.length - 1].t) return this.pos(k[k.length - 1]);
    let i = 0;
    while (i < k.length - 2 && t > k[i + 1].t) i++;
    const a = k[i], b = k[i + 1];
    const h = b.t - a.t;
    const s = (t - a.t) / h;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const f = (field: 'az' | 'el' | 'dist') =>
      h00 * a[field] + h10 * h * this.tangent(i, field) + h01 * b[field] + h11 * h * this.tangent(i + 1, field);
    return { az: f('az'), el: f('el'), dist: Math.max(0.2, f('dist')) };
  }

  /** Catmull-Rom tangent for uneven key spacing; zero at both ends (starts and stops gently). */
  private tangent(i: number, field: 'az' | 'el' | 'dist'): number {
    const k = this.keys;
    if (i === 0 || i === k.length - 1) return 0;
    return (k[i + 1][field] - k[i - 1][field]) / (k[i + 1].t - k[i - 1].t);
  }

  private pos(k: Key): Pos {
    return { az: k.az, el: k.el, dist: k.dist };
  }
}

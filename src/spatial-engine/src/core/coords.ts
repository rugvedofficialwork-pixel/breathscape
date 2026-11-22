import { DEG } from './math';

/**
 * Position convention used everywhere (cues.json, API, docs):
 *   az   degrees, 0 = front, +90 = right, 180 = behind, -90 = left
 *   el   degrees, 0 = ear level, +90 = straight overhead, negative = below
 *   dist metres from the centre of the head
 */
export interface Pos {
  az: number;
  el: number;
  dist: number;
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * The one conversion to Web Audio's frame: listener at the origin facing -Z,
 * +X to the right, +Y up.
 */
export function toXYZ(p: Pos): XYZ {
  const a = p.az * DEG;
  const e = p.el * DEG;
  const h = p.dist * Math.cos(e);
  return { x: h * Math.sin(a), y: p.dist * Math.sin(e), z: -h * Math.cos(a) };
}

/** Inverse of toXYZ (used by the visualiser to read back where a source is right now). */
export function fromXYZ(v: XYZ): Pos {
  const dist = Math.hypot(v.x, v.y, v.z);
  if (dist < 1e-6) return { az: 0, el: 0, dist: 0 };
  return {
    az: Math.atan2(v.x, -v.z) / DEG,
    el: Math.asin(Math.max(-1, Math.min(1, v.y / dist))) / DEG,
    dist,
  };
}

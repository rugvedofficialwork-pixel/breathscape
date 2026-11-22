import { clamp } from './math';
import type { GlobalDef, ParamName, ParamSpec } from '../types';

/**
 * Gesture inputs are noisy. Every value is clamped, then one-pole smoothed.
 * When tracking is lost the last value is held for a moment, then relaxes
 * slowly towards the param's rest value. Nothing ever snaps.
 */
export class Params {
  private target = new Map<ParamName, number>();
  private value = new Map<ParamName, number>();
  private tracking = true;
  private lostFor = 0;

  constructor(private specs: Record<ParamName, ParamSpec>, private global: GlobalDef) {
    for (const [k, s] of Object.entries(specs) as [ParamName, ParamSpec][]) {
      this.target.set(k, s.rest);
      this.value.set(k, s.rest);
    }
  }

  update(specs: Record<ParamName, ParamSpec>, global: GlobalDef): void {
    this.specs = specs;
    this.global = global;
  }

  set(name: ParamName, v: number): void {
    const s = this.specs[name];
    if (!s) throw new Error(`Unknown param: ${name}`);
    if (!Number.isFinite(v)) return;
    this.ramps.delete(name); // a direct value wins over a running ramp
    this.target.set(name, clamp(v, s.min, s.max));
  }

  setTracking(ok: boolean): void {
    if (ok && !this.tracking) this.lostFor = 0;
    this.tracking = ok;
  }

  get isTracking(): boolean {
    return this.tracking;
  }

  /** Smoothed value. */
  get(name: ParamName): number {
    return this.value.get(name) ?? 0;
  }

  /** Raw (clamped) target, before smoothing. */
  raw(name: ParamName): number {
    return this.target.get(name) ?? 0;
  }

  private ramps = new Map<ParamName, { from: number; to: number; elapsed: number; sec: number }>();

  /** Move a param's target gradually (e.g. the timeline raising windIntensity over a few seconds). */
  ramp(name: ParamName, value: number, sec: number): void {
    const s = this.specs[name];
    if (!s) throw new Error(`Unknown param: ${name}`);
    this.ramps.set(name, { from: this.target.get(name) ?? s.rest, to: clamp(value, s.min, s.max), elapsed: 0, sec: Math.max(0.01, sec) });
  }

  tick(dt: number): void {
    for (const [name, r] of this.ramps) {
      r.elapsed += dt;
      const u = Math.min(1, r.elapsed / r.sec);
      this.target.set(name, r.from + (r.to - r.from) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
      if (u >= 1) this.ramps.delete(name);
    }
    if (!this.tracking) this.lostFor += dt;
    const relaxing = !this.tracking && this.lostFor > this.global.tracking.holdSec;
    for (const [name, s] of Object.entries(this.specs) as [ParamName, ParamSpec][]) {
      const gesture = s.gesture !== false;
      if (gesture && !this.tracking && !relaxing) continue; // hold the last value
      let target = this.target.get(name) ?? s.rest;
      if (gesture && relaxing) {
        // drift the target slowly towards rest; the value follows with its normal smoothing
        target += (s.rest - target) * (1 - Math.exp(-dt / Math.max(0.01, this.global.tracking.relaxSec)));
        this.target.set(name, target);
      }
      const cur = this.value.get(name) ?? s.rest;
      this.value.set(name, cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.01, s.smoothSec))));
    }
  }
}

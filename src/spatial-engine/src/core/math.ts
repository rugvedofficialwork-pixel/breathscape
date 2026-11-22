export const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Shortest signed turn from a to b in degrees, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Wrap an azimuth into [-180, 180). */
export const wrapAz = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * Stop an AudioParam's future automation and hold its current value, so a new
 * ramp starts from where the sound actually is (no jumps).
 */
export function holdAt(p: AudioParam, t: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof anyP.cancelAndHoldAtTime === 'function') {
    anyP.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/** Smooth move to a value with an exponential approach (time constant >= 20 ms: never a click). */
export function glide(p: AudioParam, value: number, t: number, timeConstant: number): void {
  holdAt(p, t);
  p.setTargetAtTime(value, t, Math.max(0.02, timeConstant));
}

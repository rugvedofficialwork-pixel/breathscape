import { CONFIG } from '../config';

/**
 * Head experiment: chin lift (degrees from the resting head) to orb level 0..1.
 *
 * - Quiet zone, within quietDeg either way: the orb barely moves, so small natural head movements do not count.
 *   It eases out of the resting level slowly (a curve that starts flat), reaching only quietLevel at quietDeg.
 * - Above it: a straight rise to 1 at fullAtDeg. The two parts meet without a kink (same slope where they join),
 *   so the change from "quiet" to "following" is gradual.
 * - Below the resting head: the same flat start, reaching 0 at quietDeg down.
 */
export function headLevel(liftDeg: number): number {
  const { restLevel: r, quietDeg: q, fullAtDeg: F, quietPower: n } = CONFIG.head;
  if (liftDeg <= 0) {
    const t = Math.min(1, -liftDeg / q);
    return r * (1 - t ** n);
  }
  // value gained in the quiet zone, chosen so the slope is continuous at q: v = (1 - r) / (1 + n (F - q) / q)
  const v = (1 - r) / (1 + (n * (F - q)) / q);
  if (liftDeg <= q) return r + v * (liftDeg / q) ** n;
  return Math.min(1, r + v + ((1 - r - v) * (liftDeg - q)) / (F - q));
}

/** Orb level at the edge of the quiet zone (for the overlay). */
export const quietLevel = () => headLevel(CONFIG.head.quietDeg);

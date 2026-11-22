import type { Pos } from '../core/coords';
import type { SpaceDef } from '../core/mixer';

/**
 * Every position and level in "Ten Past Three", in one place, so a scene can be moved or rebalanced without
 * touching any code. az: 0 ahead, +90 right, -90 left, 180 behind. el: +90 overhead, -90 under the feet. dist: metres.
 * docs/3D-AUDIO-PLAN.md explains why each thing is where it is.
 */
const p = (az: number, el: number, dist: number): Pos => ({ az, el, dist });

export const POS = {
  // the breath
  breathFar: p(0, 0, 2.6),
  breathNear: p(0, 8, 0.9),
  chime: p(0, 20, 1.6),

  // the bedroom: the listener is lying on their back, so the fan is straight "up" and the city is a wall away
  fan: p(0, 72, 1.9),
  cityBehindWall: p(70, -5, 9),
  coinTop: p(0, -12, 0.5),
  coinPath: {
    points: [
      { t: 0, az: 0, el: -12, dist: 0.5 },
      { t: 2.5, az: 8, el: -55, dist: 2 },
      { t: 8, az: -5, el: -85, dist: 12 },
    ],
  },
  feet: p(0, -65, 1.1),
  stepUp: p(20, 25, 2.6),

  // the kitchen: the window is ahead and to the left; the crow is outside it
  fridge: p(140, -10, 2.4),
  tap: p(35, -15, 0.9),
  cityWindow: p(-40, -8, 8),
  crowLedge: p(-35, 2, 1.4),
  crowShoulder: p(52, -6, 0.24),
  crowToShoulder: {
    points: [
      { t: 0, az: -35, el: 2, dist: 1.4 },
      { t: 0.8, az: -10, el: 18, dist: 0.8 },
      { t: 1.6, az: 25, el: 10, dist: 0.45 },
      { t: 2.3, az: 52, el: -6, dist: 0.24 },
    ],
  },
  crowSill: p(-48, 0, 2.2),

  // the roof
  door: p(0, 12, 1.6),
  windFront: p(0, 8, 3),
  cityBelowRoof: p(0, -25, 14),
  cityFarBelow: p(0, -75, 18),
  peg: p(-100, 15, 3.5),
  horseFar: p(20, 0, 2.3),
  horseNear: p(20, -5, 0.75),
  horseHand: p(15, -10, 0.55),
  warmth: p(0, -30, 0.6),
  seaBehind: p(180, -12, 6),
  gull: p(-135, 30, 16),
  gull2: p(150, 25, 18),
  wingLeftStart: p(-80, 0, 0.7),
  wingLeftPath: { points: [{ t: 0, az: -80, el: 0, dist: 0.7 }, { t: 4, az: -85, el: 10, dist: 2 }, { t: 11, az: -95, el: 18, dist: 5 }] },
  wingRightStart: p(80, 0, 0.7),
  wingRightPath: { points: [{ t: 0, az: 80, el: 0, dist: 0.7 }, { t: 4, az: 85, el: 10, dist: 2 }, { t: 11, az: 95, el: 18, dist: 5 }] },

  // the flight
  sun: p(15, 14, 22),
  flock: p(0, -40, 12),
  ownWingLeftA: p(-70, -8, 0.6),
  ownWingLeftB: p(-90, 12, 2.4),
  ownWingRightA: p(70, -8, 0.6),
  ownWingRightB: p(90, 12, 2.4),
  sparkleL: p(-32, 5, 0.7),
  sparkleR: p(32, 5, 0.7),
  birdSpots: [p(-70, 28, 10), p(55, 40, 13), p(160, 22, 16)],
};

export const LEVELS = {
  narratorWet: 0.06,
  breathTone: 0.075,
  fan: 0.06,
  cityClosed: 0.06,
  cityOpen: 0.32,
  cityRoof: 0.46,
  heartbeat: 0.12,
  step: 0.3,
  fridge: 0.16,
  tap: 0.1,
  beak: 0.6,
  sash: 0.55,
  flutter: 0.55,
  door: 0.9,
  roofWind: 0.26,
  peg: 0.8,
  horseBreath: 0.26,
  hide: 0.5,
  warmth: 0.05,
  sea: 0.12,
  gull: 0.3,
  wingUnfurl: 0.5,
  flightWind: 0.45,
  wingbeat: 0.32,
  whispers: 0.28,
  dawn: 0.85,
  flock: 0.45,
  ownWing: 0.5,
  sparkle: 0.55,
  chestBloom: 0.34,
  birds: 0.7,
};

/** Acoustic spaces. A roof has almost no reverb; a concrete stairwell has a lot. */
export const SPACES: Record<'room' | 'bedroom' | 'kitchen' | 'stair' | 'roof' | 'sky' | 'roofMorning', SpaceDef> = {
  room: { seconds: 2.2, preDelayMs: 18, damping: 0.65, level: 0.5 },
  bedroom: { seconds: 0.5, preDelayMs: 6, damping: 0.85, level: 0.4 },
  kitchen: { seconds: 0.8, preDelayMs: 8, damping: 0.45, level: 0.6 },
  stair: { seconds: 2.4, preDelayMs: 14, damping: 0.35, level: 0.8 },
  roof: { seconds: 1.3, preDelayMs: 50, damping: 0.8, level: 0.2 },
  sky: { seconds: 3.6, preDelayMs: 90, damping: 0.9, level: 0.28 },
  roofMorning: { seconds: 1.6, preDelayMs: 50, damping: 0.75, level: 0.22 },
};

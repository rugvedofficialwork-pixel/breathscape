import type { Word } from '../state';

export type RGB = [number, number, number];

export interface Palette {
  /** Glowing particles / orbs */
  glow: RGB;
  /** Highlights */
  hi: RGB;
}

/** Kindness warm gold, Acceptance soft sage, Courage ember-orange, Calm cool silver-blue. */
export const PALETTES: Record<Word, Palette> = {
  kindness: { glow: [255, 206, 120], hi: [255, 236, 190] },
  acceptance: { glow: [176, 222, 190], hi: [226, 246, 232] },
  courage: { glow: [255, 146, 70], hi: [255, 190, 120] },
  calm: { glow: [176, 210, 238], hi: [232, 244, 255] },
};

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

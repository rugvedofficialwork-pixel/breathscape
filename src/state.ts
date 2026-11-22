// Strength was removed: of the four, it had no direct research backing (see docs/WORDS-EVIDENCE.md).
export const WORDS = ['kindness', 'acceptance', 'courage', 'calm'] as const;
export type Word = (typeof WORDS)[number];

/** Shared session state, also read by the debug overlay. */
export const state = {
  word: 'kindness' as Word,
  /** Experiment: what the breathing orb follows. */
  breath: 'head' as 'hand' | 'head',
  timeScale: 1,
  scene: 0,
  beat: '',
  cycle: 0,
  phase: 'idle' as string,
  fx: '',
  /** '1' | '2D' | '2E' | '2F' | '2G' | 'end' — drives the Skip button. */
  part: '' as string,
};

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

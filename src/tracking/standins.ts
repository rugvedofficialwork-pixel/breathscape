import type { PoseTracker } from './pose';

/**
 * Mouse/keyboard stand-ins: mouse Y = handHeight, hold Space = bothHandsRaised,
 * mouse X distance from centre = spread. Toggle with the M key (also used when the camera is unavailable).
 */
export function attachStandIns(tracker: PoseTracker, target: HTMLElement) {
  const state = { handHeight: 0, bothHandsRaised: false, spread: 0, x: 0.5 };

  target.addEventListener('mousemove', (e) => {
    const r = target.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    state.handHeight = Math.min(1, Math.max(0, 1 - ny));
    state.spread = Math.min(1, Math.abs(nx - 0.5) * 2);
    state.x = Math.min(1, Math.max(0, nx));
  });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') { state.bothHandsRaised = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') state.bothHandsRaised = false; });

  return {
    enable() { tracker.manual = state; },
    disable() { tracker.manual = null; },
    toggle() { tracker.manual = tracker.manual ? null : state; },
    get active() { return !!tracker.manual; },
  };
}

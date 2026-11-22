import type { PoseTracker } from './tracking/pose';
import { state } from './state';
import { CONFIG } from './config';
import { currentVoiceName, speechStats } from './speech';

const BARS: { key: 'handHeight' | 'spread'; label: string }[] = [
  { key: 'handHeight', label: 'handHeight' },
  { key: 'spread', label: 'spread' },
];

// Skeleton links between shoulders, arms and wrists (indices from PoseLandmarker)
const LINKS: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];

export function createDebug(panel: HTMLElement, tracker: PoseTracker) {
  panel.hidden = false;
  panel.innerHTML =
    BARS.map((b) => `<div class="row"><span>${b.label}</span><span class="bar"><i data-bar="${b.key}"></i></span><span data-val="${b.key}">0</span></div>`).join('') +
    `<div class="row"><span>bothHands</span><span><span class="flag" data-flag="both">off</span></span><span></span></div>` +
    `<div class="row"><span>tracking</span><span><span class="flag" data-flag="tracking">no</span></span><span></span></div>` +
    `<div class="row"><span>calibrated</span><span><span class="flag" data-flag="calibrated">no</span></span><span></span></div>` +
    `<div class="row"><span>chest</span><span data-txt="chest">-</span><span></span></div>` +
    `<div class="row"><span>hands L/R</span><span data-txt="hands" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>pinch L / R</span><span data-txt="pinch" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>pinched</span><span><span class="flag" data-flag="pinched">no</span></span><span></span></div>` +
    `<div class="row"><span>tips at chest</span><span><span class="flag" data-flag="chesttips">no</span></span><span></span></div>` +
    `<div class="row"><span>source</span><span data-txt="source">-</span><span></span></div>` +
    `<div class="row"><span>baseline</span><span data-txt="baseline">-</span><span></span></div>` +
    `<div class="row"><span>scene</span><span data-txt="scene" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>beat</span><span data-txt="beat" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>effect</span><span data-txt="fx" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>word / speed</span><span data-txt="word" style="grid-column: 2 / 4">-</span></div>` +
    `<div class="row"><span>voice</span><span data-txt="voice" style="grid-column: 2 / 4; overflow:hidden; white-space:nowrap; text-overflow:ellipsis">-</span></div>` +
    `<div class="row"><span>fps</span><span data-txt="fps">-</span><span></span></div>` +
    `<div class="hint">C calibrate (hold hand at rest) · M mouse mode<br>T time scale 1×/4× · W cycle word · 1/2 run scene<br>mouse Y = height · X from centre = spread · Space = both hands<br>P (hold) = both pinched · F (hold) = fingertips at chest</div>`;

  const q = (sel: string) => panel.querySelector(sel) as HTMLElement;
  let frames = 0, last = performance.now(), fps = 0;

  return function draw(now: number, ctx: CanvasRenderingContext2D, w: number, h: number) {
    frames++;
    if (now - last >= 500) { fps = (frames * 1000) / (now - last); frames = 0; last = now; }
    const s = tracker.signals;

    for (const b of BARS) {
      (q(`[data-bar="${b.key}"]`).style as CSSStyleDeclaration).width = `${s[b.key] * 100}%`;
      q(`[data-val="${b.key}"]`).textContent = s[b.key].toFixed(2);
    }
    const flag = (name: string, on: boolean, yes: string, no: string) => {
      const el = q(`[data-flag="${name}"]`);
      el.textContent = on ? yes : no;
      el.classList.toggle('on', on);
    };
    flag('both', s.bothHandsRaised, 'RAISED', 'off');
    flag('tracking', s.tracking, 'yes', 'no');
    flag('calibrated', s.calibrated, 'yes', tracker.calibrating ? 'sampling…' : 'no');
    q('[data-txt="chest"]').textContent = `${s.chestPoint.x.toFixed(2)}, ${s.chestPoint.y.toFixed(2)}`;
    q('[data-txt="hands"]').textContent = `${s.handPositions.left.x.toFixed(2)},${s.handPositions.left.y.toFixed(2)} / ${s.handPositions.right.x.toFixed(2)},${s.handPositions.right.y.toFixed(2)}`;
    q('[data-txt="source"]').textContent = s.source === 'pose' ? `height from: ${tracker.handSource}` : 'manual';
    q('[data-txt="baseline"]').textContent = tracker.baseline.toFixed(3);
    q('[data-txt="fps"]').textContent = fps.toFixed(0);
    q('[data-txt="scene"]').textContent = `${state.scene} · ${state.phase}`;
    q('[data-txt="beat"]').textContent = state.beat || '-';
    q('[data-txt="fx"]').textContent = state.fx || '-';
    q('[data-txt="word"]').textContent = `${state.word} / ${state.timeScale}×`;
    q('[data-txt="voice"]').textContent = currentVoiceName() + (speechStats().missingClips ? ` · ${speechStats().missingClips} missing clips` : '');
    q('[data-txt="pinch"]').textContent = `${s.pinchDist.left.toFixed(2)} / ${s.pinchDist.right.toFixed(2)}  (< ${CONFIG.hands.pinchThreshold})`;
    flag('pinched', s.bothPinched, 'BOTH', s.pinched.left ? 'left' : s.pinched.right ? 'right' : 'no');
    flag('chesttips', s.fingertipsAtChest, 'YES', 'no');

    // Landmarks on canvas (mirrored x to match the mirrored video)
    ctx.save();
    const lm = tracker.landmarks;
    if (lm && s.source === 'pose' && s.tracking) {
      ctx.strokeStyle = 'rgba(127,214,164,0.9)';
      ctx.lineWidth = 2;
      for (const [a, b] of LINKS) {
        ctx.beginPath();
        ctx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
        ctx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
        ctx.stroke();
      }
      for (const i of [11, 12, 15, 16]) {
        ctx.fillStyle = i >= 15 ? '#ffd166' : '#7fd6a4';
        ctx.beginPath();
        ctx.arc((1 - lm[i].x) * w, lm[i].y * h, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Hand landmarks: what actually drives handHeight (fingertips highlighted)
    if (s.source === 'pose') {
      for (const hand of tracker.handLms) {
        for (let i = 0; i < hand.length; i++) {
          const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          ctx.fillStyle = tip ? '#ff9ad5' : 'rgba(255,154,213,0.55)';
          ctx.beginPath(); ctx.arc((1 - hand[i].x) * w, hand[i].y * h, tip ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // Pinch points (green when pinched)
    for (const side of ['left', 'right'] as const) {
      const p = s.pinchPoints[side];
      ctx.strokeStyle = s.pinched[side] ? '#7fffd4' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, s.pinched[side] ? 12 : 8, 0, Math.PI * 2); ctx.stroke();
    }
    // baseline and raised guide lines
    const base = tracker.baseline * h, raised = (tracker.baseline - CONFIG.handHeight.raiseFraction) * h;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    for (const y of [base, raised]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    // chest point
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.arc(s.chestPoint.x * w, s.chestPoint.y * h, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
}

import { CONFIG } from '../config';
import type { PoseTracker } from '../tracking/pose';

/** Your outline on screen (from the pose points), for particles to pass behind. */
export interface BodyShape {
  /** Your centre on screen (x), so the particles circle around you. */
  cx: number;
  /** Fill the outline (head, neck, torso, arms) on a context, in screen pixels. */
  fill(ctx: CanvasRenderingContext2D): void;
  /** Soft edge to draw it with, as a fraction of the smaller screen side. */
  edge: number;
}

const NOSE = 0, L_EAR = 7, R_EAR = 8, L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24;

/**
 * The body as a soft silhouette in screen space, matching the mirrored, object-fit: cover camera image.
 * Built from the pose landmarks: a head ellipse, the torso down to the bottom of the screen, and both arms.
 * Null when no body is tracked (then nothing hides the particles behind you; they just fade with distance).
 */
export function bodyShape(tracker: PoseTracker, video: HTMLVideoElement, w: number, h: number): BodyShape | null {
  const vw0 = video.videoWidth || CONFIG.camera.width, vh0 = video.videoHeight || CONFIG.camera.height;
  const sc0 = Math.max(w / vw0, h / vh0);
  const dw0 = vw0 * sc0, dh0 = vh0 * sc0, ox0 = (w - dw0) / 2, oy0 = (h - dh0) / 2;
  // Best: the pose model's person mask, your actual outline (mirrored like the camera image)
  const mask = tracker.personMask;
  if (mask && performance.now() - tracker.personMaskAt < 400) {
    // your centre: the middle of the shoulders if seen, else the middle of the image
    const lmc = tracker.landmarks;
    const cx = lmc ? ox0 + (1 - (lmc[11].x + lmc[12].x) / 2) * dw0 : w / 2;
    return {
      cx,
      edge: 0.003,
      fill(ctx) {
        ctx.save();
        ctx.translate(ox0 + dw0, oy0);
        ctx.scale(-1, 1); // mirrored, like the camera image on screen
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(mask, 0, 0, dw0, dh0);
        ctx.restore();
      },
    };
  }
  const lm = tracker.landmarks;
  if (!lm || !tracker.signals.tracking || tracker.signals.source !== 'pose') return null;
  const vw = video.videoWidth || CONFIG.camera.width, vh = video.videoHeight || CONFIG.camera.height;
  const sc = Math.max(w / vw, h / vh);
  const dw = vw * sc, dh = vh * sc, ox = (w - dw) / 2, oy = (h - dh) / 2;
  const P = (i: number) => ({ x: ox + (1 - lm[i].x) * dw, y: oy + lm[i].y * dh, v: lm[i].visibility ?? 1 });
  const ls = P(L_SH), rs = P(R_SH);
  if (ls.v < 0.4 || rs.v < 0.4) return null;
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const le = P(L_EAR), re = P(R_EAR), nose = P(NOSE);
  const lh = P(L_HIP), rh = P(R_HIP);
  const arm = [[L_SH, L_EL, L_WR], [R_SH, R_EL, R_WR]].map((ids) => ids.map(P));
  const cx = (ls.x + rs.x) / 2;

  return {
    cx,
    edge: 0.012,
    fill(ctx) {
      // head: an ellipse around the ears and nose
      const hx = (le.x + re.x + nose.x) / 3, hy = (le.y + re.y) / 2 - shoulderW * 0.05;
      const earW = Math.max(Math.hypot(le.x - re.x, le.y - re.y), shoulderW * 0.35);
      ctx.beginPath(); ctx.ellipse(hx, hy, earW * 0.78, earW * 1.0, 0, 0, Math.PI * 2); ctx.fill();
      // neck
      ctx.beginPath();
      ctx.moveTo(hx - earW * 0.3, hy); ctx.lineTo(hx + earW * 0.3, hy);
      ctx.lineTo(cx + shoulderW * 0.22, (ls.y + rs.y) / 2); ctx.lineTo(cx - shoulderW * 0.22, (ls.y + rs.y) / 2);
      ctx.closePath(); ctx.fill();
      // torso: shoulders, then the hips (or straight down) to the bottom of the screen
      const hipsOk = lh.v > 0.3 && rh.v > 0.3;
      const bl = hipsOk ? lh : { x: ls.x, y: h }, br = hipsOk ? rh : { x: rs.x, y: h };
      ctx.beginPath();
      ctx.moveTo(ls.x, ls.y - shoulderW * 0.05); ctx.lineTo(rs.x, rs.y - shoulderW * 0.05);
      ctx.lineTo(br.x, br.y); ctx.lineTo(br.x, h + 10); ctx.lineTo(bl.x, h + 10); ctx.lineTo(bl.x, bl.y);
      ctx.closePath(); ctx.fill();
      // arms
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = shoulderW * 0.3;
      for (const [s, e, wr] of arm) {
        if (e.v < 0.3) continue;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
        if (wr.v > 0.3) ctx.lineTo(wr.x, wr.y);
        ctx.stroke();
      }
    },
  };
}

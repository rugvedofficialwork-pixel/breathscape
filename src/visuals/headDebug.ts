import { CONFIG } from '../config';
import type { PoseTracker } from '../tracking/pose';
import { headLevel } from '../tracking/headCurve';

const NOSE = 0, L_EAR = 7, R_EAR = 8;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Experiment overlay for "Breathe with: your head": the three tracked points on the (mirrored) camera image,
 * the ear line, the nose's height above it, and every step of the calculation that becomes the orb's level.
 * Shown during the breathing part when the head is chosen; H hides or shows it.
 */
export class HeadDebug {
  /** Off by default; H shows it (or ?debug=1). */
  visible = new URLSearchParams(location.search).get("debug") === "1";

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, tracker: PoseTracker, video: HTMLVideoElement): void {
    if (!this.visible) return;
    const lm = tracker.landmarks;
    const cfg = CONFIG.head;
    const AR = CONFIG.camera.width / CONFIG.camera.height;

    // Where the camera image actually sits on screen (the video is object-fit: cover and mirrored)
    const vw = video.videoWidth || CONFIG.camera.width, vh = video.videoHeight || CONFIG.camera.height;
    const sc = Math.max(w / vw, h / vh);
    const dw = vw * sc, dh = vh * sc, ox = (w - dw) / 2, oy = (h - dh) / 2;
    const P = (p: { x: number; y: number }) => ({ x: ox + (1 - p.x) * dw, y: oy + p.y * dh });

    const lines: [string, string][] = [];
    let level: number | null = null;
    let lift: number | null = null;
    ctx.save();
    ctx.font = '13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';

    const face = tracker.faceReady ? tracker.faceLms : null; // the last face seen (the orb holds if it is lost)
    if (face && tracker.faceForward) {
      // all 478 points, faint; forehead, nose tip and chin highlighted
      ctx.fillStyle = 'rgba(160, 220, 255, 0.55)';
      for (const p of face) { const q = P(p); ctx.fillRect(q.x - 1, q.y - 1, 2, 2); }
      const top = P(face[10]), chin = P(face[152]), nose = P(face[1]);
      ctx.strokeStyle = 'rgba(160, 220, 255, 0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(chin.x, chin.y); ctx.stroke(); ctx.setLineDash([]);
      for (const [q, c] of [[top, 'rgb(160,220,255)'], [chin, 'rgb(160,220,255)'], [nose, 'rgb(255,214,140)']] as const) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      // where the head points: the forward direction, drawn out of the nose (mirrored like the image; screen y is down)
      const f = tracker.faceForward, len = Math.hypot(top.x - chin.x, top.y - chin.y) * 0.9;
      const tip = { x: nose.x - f.x * len, y: nose.y - f.y * len };
      ctx.strokeStyle = 'rgba(255, 214, 140, 0.95)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(nose.x, nose.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 214, 140, 0.95)'; ctx.fill();
      ctx.fillStyle = 'rgba(255, 214, 140, 0.95)';
      ctx.fillText(`${tracker.pitchDeg >= 0 ? '+' : ''}${tracker.pitchDeg.toFixed(1)}°`, tip.x + 10, tip.y);

      const pr = tracker.pitchRawDeg, pd = tracker.pitchDeg, p0 = tracker.pitchBaseDeg, F = cfg.fullAtDeg, q = cfg.quietDeg;
      lift = pd - p0;
      const liftTxt = (Math.abs(lift) < 0.05 ? 0 : lift).toFixed(1);
      level = clamp01(headLevel(lift));
      const zone = Math.abs(lift) <= q ? `quiet zone (within ${q}°)` : lift > 0 ? 'following the head' : 'below the quiet zone';
      lines.push(
        ['tracking', tracker.headSourceNow === 'face' ? `face model, ${face.length} points` : tracker.headSourceNow === 'ears' ? 'face lost: using nose and ears' : 'nothing seen: holding'],
        ['head points to', `x ${f.x.toFixed(2)}  y ${f.y.toFixed(2)}  z ${f.z.toFixed(2)}`],
        ['pitch = atan(y / z)', `${pr.toFixed(1)}°  (+ = chin up)`],
        ['pitch, smoothed', `${pd.toFixed(1)}°`],
        ['resting pitch', `${p0.toFixed(1)}°  ${tracker.signals.calibrated ? 'learned at the start' : 'not calibrated yet'}`],
        ['lift', `${pd.toFixed(1)} − ${p0.toFixed(1)} = ${liftTxt}°  (full orb at ${F}°)`],
        ['level', `${level.toFixed(2)}  ${zone}`],
        ['orb', tracker.signals.handHeight.toFixed(2)],
      );
    } else if (!tracker.faceReady && lm && tracker.signals.tracking) {
      const nose = lm[NOSE], le = lm[L_EAR], re = lm[R_EAR];
      const mid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
      const d = Math.hypot((le.x - re.x) * AR, le.y - re.y) || 1e-3;
      const hgt = mid.y - nose.y;
      const raw = hgt / d;
      const r = tracker.headPitch, r0 = tracker.headBase;
      level = clamp01(cfg.restLevel + (r - r0) / cfg.range);

      // ear line, extended a little past the ears
      const a = P(le), b = P(re), m = P(mid), n = P(nose);
      const ex = (b.x - a.x) * 0.35, ey = (b.y - a.y) * 0.35;
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(a.x - ex, a.y - ey); ctx.lineTo(b.x + ex, b.y + ey); ctx.stroke();
      ctx.setLineDash([]);
      // nose height above the ear line
      ctx.strokeStyle = hgt >= 0 ? 'rgba(255, 214, 140, 0.95)' : 'rgba(255, 140, 140, 0.95)';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      // points
      const dot = (p: { x: number; y: number }, c: string, label: string) => {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        if (label) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(label, p.x + (label === 'nose' ? 10 : -8), p.y + (label === 'nose' ? 14 : -14)); }
      };
      dot(a, 'rgb(120, 200, 255)', 'ear');
      dot(b, 'rgb(120, 200, 255)', 'ear');
      dot(m, 'rgba(120, 200, 255, 0.6)', '');
      dot(n, 'rgb(255, 214, 140)', 'nose');
      ctx.fillStyle = 'rgba(255, 214, 140, 0.95)';
      ctx.textAlign = 'right';
      ctx.fillText(`h = ${hgt.toFixed(3)}`, Math.min(m.x, n.x) - 14, (m.y + n.y) / 2 + 14);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(120, 200, 255, 0.95)';
      ctx.fillText(`d = ${d.toFixed(3)}`, b.x + ex + 8, b.y + ey);

      lines.push(
        ['d   ear to ear', `${d.toFixed(3)}  (width × ${AR.toFixed(2)})`],
        ['h   nose above ears', `${hgt.toFixed(3)}  (${mid.y.toFixed(3)} − ${nose.y.toFixed(3)})`],
        ['tilt = h / d', raw.toFixed(3)],
        ['tilt, smoothed', r.toFixed(3)],
        ['resting tilt', `${r0.toFixed(3)}  ${tracker.signals.calibrated ? 'learned at the start' : 'not calibrated yet'}`],
        ['level', `${cfg.restLevel} + (${r.toFixed(2)} − ${r0.toFixed(2)}) / ${cfg.range} → ${level.toFixed(2)}`],
        ['orb', tracker.signals.handHeight.toFixed(2)],
      );
    } else {
      lines.push(['', !tracker.ready ? 'No camera: the orb follows the breath timer.' : tracker.faceReady ? 'No face seen. Face the camera.' : 'No face seen. Face the camera, with both ears visible.']);
    }

    // panel with the calculation
    const pad = 12, lh = 20, colW = 150;
    const plotH = lift !== null ? 96 : 0;
    const boxW = Math.min(w - 32, 440), boxH = pad * 2 + lh * (lines.length + 1) + (level !== null ? 26 : 0) + plotH;
    const bx = 16, by = 16; // top left, clear of the captions
    ctx.fillStyle = 'rgba(5, 6, 12, 0.72)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(face ? 'Head tilt → orb  ·  face model  ·  H hides this' : 'Head tilt → orb  ·  nose and ears  ·  H hides this', bx + pad, by + pad + lh / 2);
    lines.forEach(([k, v], i) => {
      const y = by + pad + lh * (i + 1.5);
      ctx.fillStyle = 'rgba(200, 200, 190, 0.85)'; ctx.fillText(k, bx + pad, y);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.fillText(v, bx + pad + (k ? colW : 0), y);
    });
    if (lift !== null) {
      // the curve: chin lift (x, from 20 down to 50 up) to orb level (y), with the quiet zone shaded and you on it
      const px = bx + pad + 26, py = by + pad + lh * (lines.length + 1) + 8, pw = boxW - pad * 2 - 34, ph = plotH - 26;
      const lo = -20, hi = 50, X = (d: number) => px + ((d - lo) / (hi - lo)) * pw, Y = (v: number) => py + ph - v * ph;
      ctx.fillStyle = 'rgba(120, 200, 255, 0.12)';
      ctx.fillRect(X(-cfg.quietDeg), py, X(cfg.quietDeg) - X(-cfg.quietDeg), ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.moveTo(X(0), py); ctx.lineTo(X(0), py + ph); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 214, 140, 0.9)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let d = lo; d <= hi; d += 0.5) { const x = X(d), y = Y(headLevel(d)); if (d === lo) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      const cl = Math.max(lo, Math.min(hi, lift));
      ctx.fillStyle = 'rgb(255, 255, 255)'; ctx.beginPath(); ctx.arc(X(cl), Y(headLevel(cl)), 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200, 200, 190, 0.8)'; ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      for (const d of [-cfg.quietDeg, 0, cfg.quietDeg, cfg.fullAtDeg]) ctx.fillText(`${d}°`, X(d), py + ph + 10);
      ctx.textAlign = 'right'; ctx.fillText('1', px - 6, Y(1)); ctx.fillText('0', px - 6, Y(0));
      ctx.textAlign = 'left'; ctx.font = '13px ui-monospace, Consolas, monospace';
    }
    if (level !== null) {
      // gauge: 0 (chin down) ... rest level (head level) ... 1 (full orb)
      const gx = bx + pad, gy = by + boxH - pad - 10, gw = boxW - pad * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(gx, gy, gw, 8);
      ctx.fillStyle = 'rgba(255, 214, 140, 0.9)'; ctx.fillRect(gx, gy, gw * tracker.signals.handHeight, 8);
      ctx.fillStyle = 'rgba(120, 200, 255, 0.95)'; ctx.fillRect(gx + gw * cfg.restLevel - 1, gy - 4, 2, 16);
    }
    ctx.restore();
  }
}

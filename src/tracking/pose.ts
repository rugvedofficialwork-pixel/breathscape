import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CONFIG } from '../config';
import { headLevel } from './headCurve';
import { OneEuro } from './filters';

export interface Point { x: number; y: number }

/** Clean signals for stages. Coordinates are normalized 0-1 and already mirrored to match the mirrored video. */
export interface Signals {
  handHeight: number;
  bothHandsRaised: boolean;
  /** Acceptance: both arms low (wrists below the shoulders) and open wide to the sides, held. */
  armsOpenLow: boolean;
  spread: number;
  chestPoint: Point;
  handPositions: { left: Point; right: Point };
  tracking: boolean;
  calibrated: boolean;
  source: 'pose' | 'manual';

  // ---- Part F2 finger gestures ----
  /** Thumb tip to index tip distance / hand size, per hand (small = pinched). Screen-left / screen-right hand. */
  pinchDist: { left: number; right: number };
  /** Pinched for >= pinchHoldMs (debounced). */
  pinched: { left: boolean; right: boolean };
  bothPinched: boolean;
  /** Mirrored screen positions of each pinch (midpoint of thumb and index tips). */
  pinchPoints: { left: Point; right: Point };
  /** Both index fingertips within a radius of the chest point, held >= chestHoldMs. */
  fingertipsAtChest: boolean;
}

const NOSE = 0, L_EAR = 7, R_EAR = 8;
const L_SHOULDER = 11, R_SHOULDER = 12, L_WRIST = 15, R_WRIST = 16;
const L_PINKY = 17, R_PINKY = 18, L_INDEX = 19, R_INDEX = 20;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Whole-hand centroid Y from the 21 hand landmarks (wrist, knuckles and every fingertip). */
function handCentroidY(hand: NormalizedLandmark[]): number {
  let sum = 0;
  for (const p of hand) sum += p.y;
  return sum / hand.length;
}

/** Fallback palm centre Y from pose: average of wrist, pinky and index knuckles (steadier than the wrist alone). */
function palmY(lm: NormalizedLandmark[], wrist: number, pinky: number, index: number): number {
  let sum = lm[wrist].y, n = 1;
  for (const i of [pinky, index]) {
    if ((lm[i].visibility ?? 1) > 0.4) { sum += lm[i].y; n++; }
  }
  return sum / n;
}

export class PoseTracker {
  signals: Signals = {
    handHeight: 0,
    bothHandsRaised: false,
    armsOpenLow: false,
    spread: 0,
    chestPoint: { x: 0.5, y: 0.5 },
    handPositions: { left: { x: 0.35, y: 0.75 }, right: { x: 0.65, y: 0.75 } },
    tracking: false,
    calibrated: false,
    source: 'pose',
    pinchDist: { left: 1, right: 1 },
    pinched: { left: false, right: false },
    bothPinched: false,
    pinchPoints: { left: { x: 0.4, y: 0.6 }, right: { x: 0.6, y: 0.6 } },
    fingertipsAtChest: false,
  };

  /** Raw landmarks (unmirrored, as MediaPipe returns them) for debug drawing. */
  landmarks: NormalizedLandmark[] | null = null;
  baseline: number = CONFIG.handHeight.defaultBaseline;
  // (typed as number: config literals are `as const`)
  ready = false;
  /** When set, pose is bypassed and these raw targets drive the signals (mouse/keyboard stand-ins). */
  manual: { handHeight: number; bothHandsRaised: boolean; spread: number; x: number } | null = null;

  /** Hand landmarks (unmirrored) for debug drawing; empty when no hand is seen. */
  handLms: NormalizedLandmark[][] = [];
  handSource: 'hand' | 'pose' = 'pose';
  /**
   * Experiment: what drives handHeight (the breathing orb). 'head' = tilting the head up and down (chin up = the
   * orb rises), measured from the pose model's nose and ears. Calibrate() then learns the level resting head.
   */
  breathSource: 'hand' | 'head' = 'hand';
  /** Head tilt: nose height above the ear line, in ear-to-ear distances (larger = chin up). Filtered. */
  headPitch = 0;
  /** headPitch of the resting head, from calibration. */
  headBase = 0;
  private filterHead = new OneEuro(CONFIG.head.filterMinCutoff, CONFIG.head.filterBeta);

  // ---- Head experiment, face model: 478 face points and the head's 3D rotation ----
  private faceLandmarker: FaceLandmarker | null = null;
  private fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  private delegate: 'GPU' | 'CPU' = 'GPU';
  private filterFace = new OneEuro(CONFIG.head.filterMinCutoffDeg, CONFIG.head.filterBetaDeg);
  private lastFaceDetect = 0;
  /** The 478 face points (unmirrored), for the overlay. */
  faceLms: NormalizedLandmark[] | null = null;
  /** The head's forward direction from the face model's rotation (camera space: x right, y up, z towards the camera). */
  faceForward: { x: number; y: number; z: number } | null = null;
  faceSeenAt = -Infinity;
  /** What the head level comes from right now (for the overlay). */
  headSourceNow: 'face' | 'ears' | 'none' = 'none';
  private calibEars: number[] = [];
  /** Head pitch in degrees, + = chin up. Raw from the model, and smoothed. */
  pitchRawDeg = 0;
  pitchDeg = 0;
  /** pitchDeg of the resting head, from calibration. */
  pitchBaseDeg = 0;
  get faceReady(): boolean { return !!this.faceLandmarker; }
  /** The face model is in use and has seen a face recently. */
  faceTracking(now = performance.now()): boolean { return !!this.faceLandmarker && now - this.faceSeenAt < CONFIG.tracking.lostGraceMs; }
  /** Hand model runs wherever a hand-driven signal is read; off only for the eyes-closed stretches. */
  handsEnabled = true;
  /** Debug/stand-in overrides (P = both pinched, F = fingertips at chest). */
  overrides = { bothPinched: false, fingertipsAtChest: false };
  /** True when detection is slow and pose/hand frames are being alternated. */
  slow = false;
  private avgDt = 33;
  private frameIdx = 0;
  private pinchSince: { left: number | null; right: number | null } = { left: null, right: null };
  private chestSince: number | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private filterY = new OneEuro(CONFIG.handHeight.filterMinCutoff, CONFIG.handHeight.filterBeta);
  private palmYHigh: number = CONFIG.handHeight.defaultBaseline;
  private top: number = CONFIG.handHeight.defaultBaseline;
  private lastDt = 33;
  private lastDetect = 0;
  private fresh = false;
  private landmarker: PoseLandmarker | null = null;
  private lastVideoTime = -1;
  private lastUpdate = 0;
  private lastSeen = -Infinity;
  private raisedSince: number | null = null;
  private openLowSince: number | null = null;
  private calibSamples: number[] | null = null;
  private calibResolve: ((ok: boolean) => void) | null = null;
  private calibEnd = 0;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(CONFIG.pose.wasmPath);
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.pose.modelPath, delegate },
        runningMode: 'VIDEO',
        numPoses: CONFIG.pose.numPoses,
        minPoseDetectionConfidence: CONFIG.pose.minDetectionConfidence,
        minPosePresenceConfidence: CONFIG.pose.minPresenceConfidence,
        minTrackingConfidence: CONFIG.pose.minTrackingConfidence,
      });
    const makeHand = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.pose.handModelPath, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    let delegate: 'GPU' | 'CPU' = 'GPU';
    try {
      this.landmarker = await make('GPU');
    } catch {
      delegate = 'CPU';
      this.landmarker = await make('CPU');
    }
    try {
      this.handLandmarker = await makeHand(delegate);
    } catch (err) {
      console.warn('[tracking] HandLandmarker unavailable, using pose palm', err);
    }
    this.fileset = fileset;
    this.delegate = delegate;
    this.ready = true;
  }

  /** The face model, loaded only for the head experiment. Without it the head falls back to the pose's nose and ears. */
  async initFace(): Promise<void> {
    if (this.faceLandmarker || !this.fileset) return;
    try {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(this.fileset, {
        baseOptions: { modelAssetPath: CONFIG.pose.faceModelPath, delegate: this.delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
      });
    } catch (err) {
      console.warn('[tracking] FaceLandmarker unavailable: the head uses the pose nose and ears', err);
    }
  }

  // ---- Your outline: the pose model's person mask, on while the breathing particles need it ----
  private segmentation = false;
  /** Where you are in the camera image (unmirrored, low resolution; alpha = how surely it is you). */
  personMask: HTMLCanvasElement | null = null;
  personMaskAt = -Infinity;
  private maskData: ImageData | null = null;

  /** Turn the person mask on or off (only the breathing particles use it; it costs a little per frame). */
  async setSegmentation(on: boolean): Promise<void> {
    if (on === this.segmentation || !this.landmarker) return;
    this.segmentation = on;
    try { await this.landmarker.setOptions({ outputSegmentationMasks: on }); } catch (e) { console.warn('[tracking] person mask unavailable', e); this.segmentation = false; }
    if (!on) this.personMaskAt = -Infinity;
  }

  /** Copy the mask into a small canvas (every 4th pixel is plenty: it is drawn with a soft edge). */
  private readMask(mask: { width: number; height: number; getAsFloat32Array(): Float32Array }, now: number): void {
    const step = 4, W = Math.floor(mask.width / step), H = Math.floor(mask.height / step);
    if (W < 2 || H < 2) return;
    const f = mask.getAsFloat32Array();
    const c = this.personMask ?? (this.personMask = document.createElement('canvas'));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.maskData = null; }
    const g = c.getContext('2d')!;
    const img = this.maskData ?? (this.maskData = g.createImageData(W, H));
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const row = y * step * mask.width;
      for (let x = 0; x < W; x++) {
        const v = f[row + x * step];
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = v > 0.5 ? 255 : v > 0.25 ? Math.round((v - 0.25) * 4 * 255) : 0; // a firm edge, slightly softened
      }
    }
    g.putImageData(img, 0, 0);
    this.personMaskAt = now;
  }

  /** Head tilt from the pose's nose and ears (ear-to-ear distances): the fallback, and the backup when the face is lost. */
  private readEarTilt(lm: NormalizedLandmark[], dtSec: number): void {
    const nose = lm[NOSE], le = lm[L_EAR], re = lm[R_EAR];
    if ((nose.visibility ?? 1) > 0.5 && (le.visibility ?? 1) > 0.3 && (re.visibility ?? 1) > 0.3) {
      const earD = Math.hypot((le.x - re.x) * (CONFIG.camera.width / CONFIG.camera.height), le.y - re.y) || 1e-3;
      this.headPitch = this.filterHead.filter(((le.y + re.y) / 2 - nose.y) / earD, dtSec);
    }
  }

  private readFace(video: HTMLVideoElement, now: number): void {
    const r = this.faceLandmarker!.detectForVideo(video, now);
    const lm = r.faceLandmarks[0];
    const m = r.facialTransformationMatrixes?.[0]?.data;
    if (!lm || !m) return;
    const dtSec = this.lastFaceDetect ? Math.min(0.2, (now - this.lastFaceDetect) / 1000) : 0.033;
    this.lastFaceDetect = now;
    this.faceLms = lm;
    this.faceSeenAt = now;
    // The rotation's third column is where the face points (column-major 4x4).
    const f = { x: m[8], y: m[9], z: m[10] };
    this.faceForward = f;
    // Pitch: how far that direction tilts up or down, in degrees. Linear in the actual head movement.
    this.pitchRawDeg = CONFIG.head.pitchSign * Math.atan2(f.y, Math.abs(f.z)) * (180 / Math.PI);
    this.pitchDeg = this.filterFace.filter(this.pitchRawDeg, dtSec);
  }
  /** Samples resting wrist Y for durationMs. Resolves false if no pose was seen. */
  calibrate(): Promise<boolean> {
    this.calibSamples = [];
    this.calibEnd = performance.now() + CONFIG.calibration.durationMs;
    return new Promise((resolve) => { this.calibResolve = resolve; });
  }

  get calibrating(): boolean { return this.calibSamples !== null; }

  update(now: number, video: HTMLVideoElement | null): void {
    const dt = this.lastUpdate ? Math.min(100, now - this.lastUpdate) : 16;
    this.lastUpdate = now;
    const s = this.signals;

    if (this.manual) {
      this.updateManual(dt);
      this.applyOverrides();
      return;
    }
    s.source = 'pose';

    if (this.landmarker && video && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      // dt between detected frames (not render frames) drives the filter
      this.lastDt = this.lastDetect ? Math.min(200, now - this.lastDetect) : 33;
      this.lastDetect = now;
      this.lastVideoTime = video.currentTime;
      this.avgDt += (this.lastDt - this.avgDt) * 0.1;
      const headFace = this.breathSource === 'head' && !!this.faceLandmarker;
      const hasHands = this.handsEnabled && !!this.handLandmarker && !headFace;
      // If detection is slow, alternate pose and hand frames instead of running both every frame
      this.slow = hasHands && this.avgDt > 1000 / CONFIG.hands.slowFps;
      this.frameIdx++;
      const runPose = headFace ? this.frameIdx % (this.segmentation ? 2 : 3) === 0 : !this.slow || this.frameIdx % 2 === 0;
      if (headFace) this.readFace(video, now);
      const runHands = hasHands && (!this.slow || this.frameIdx % 2 === 1);
      if (runPose) {
        const res = this.landmarker.detectForVideo(video, now);
        this.landmarks = res.landmarks[0] ?? null;
        const mask = res.segmentationMasks?.[0];
        if (mask) { if (this.segmentation) this.readMask(mask, now); for (const mk of res.segmentationMasks ?? []) mk.close(); }
        if (this.landmarks) { this.lastSeen = now; this.fresh = true; }
      }
      if (runHands) { this.handLms = this.handLandmarker!.detectForVideo(video, now).landmarks; this.fresh = true; }
      else if (!this.handsEnabled) this.handLms = [];
    }

    const lm = this.landmarks;
    const visible = !!lm && now - this.lastSeen < CONFIG.tracking.lostGraceMs;
    s.tracking = visible;

    // Head experiment with the face model: the orb follows the head's pitch angle, whether or not the body is seen.
    // If the face is lost for a moment, it follows the pose's nose and ears instead (calibrated at the same time,
    // converted to degrees), so every head movement still counts. It only holds when neither is seen.
    if (this.breathSource === 'head' && this.faceReady) {
      if (visible && lm && this.fresh) { this.readEarTilt(lm, this.lastDt / 1000); this.fresh = false; }
      const seen = this.faceTracking(now);
      // The resting head re-learns itself, so a calibration taken while the head was moving cannot stick: it follows
      // the head down quickly (the out-breath) and creeps up only very slowly (a held in-breath still counts as a lift).
      if (!this.calibrating) {
        const sec = dt / 1000, h = CONFIG.head;
        const follow = (base: number, now_: number) => base + (now_ - base) * (1 - Math.exp(-sec / (now_ < base ? h.restDownSec : h.restUpSec)));
        if (seen) this.pitchBaseDeg = follow(this.pitchBaseDeg, this.pitchDeg);
        if (visible) this.headBase = follow(this.headBase, this.headPitch);
      }
      const lift = seen ? this.pitchDeg - this.pitchBaseDeg : visible ? (this.headPitch - this.headBase) * CONFIG.head.ratioToDeg : null;
      if (lift !== null) {
        const rawHead = clamp01(headLevel(lift)); // quiet zone, then a gradual rise to full
        s.handHeight += (rawHead - s.handHeight) * CONFIG.handHeight.outputAlpha;
      }
      this.headSourceNow = seen ? 'face' : visible ? 'ears' : 'none';
      s.tracking = lift !== null;
      if (visible && lm) this.deriveRest(lm, now);
      this.applyOverrides();
      this.stepCalibration(now, seen || visible ? [] : null);
      return;
    }

    if (visible && lm) {
      this.derive(lm, now);
    } else {
      this.easeToNeutral(dt);
    }
    this.applyOverrides();
    this.stepCalibration(now, lm && visible ? lm : null);
  }

  private derive(lm: NormalizedLandmark[], now: number): void {
    const s = this.signals;

    // handHeight: from the HandLandmarker's finger/palm points (whole-hand centroid) when a hand is
    // seen, else the pose palm. One Euro filtered; only fed on genuinely new detections.
    if (this.fresh) {
      const dtSec = this.lastDt / 1000;
      let y: number;
      if (this.handLms.length) {
        y = Math.min(...this.handLms.map(handCentroidY));
        this.handSource = 'hand';
      } else {
        y = Math.min(
          palmY(lm, L_WRIST, L_PINKY, L_INDEX),
          palmY(lm, R_WRIST, R_PINKY, R_INDEX),
        );
        this.handSource = 'pose';
      }
      this.palmYHigh = this.filterY.filter(y, dtSec);
      this.readEarTilt(lm, dtSec);
      this.fresh = false;
    }
    if (this.breathSource === 'head') {
      const h = CONFIG.head;
      const rawHead = clamp01(h.restLevel + (this.headPitch - this.headBase) / h.range);
      s.handHeight += (rawHead - s.handHeight) * CONFIG.handHeight.outputAlpha;
      this.deriveRest(lm, now);
      return;
    }
    // The top of the range grows if you lift higher than expected, so the orb never saturates early
    const nominalTop = this.baseline - CONFIG.handHeight.raiseFraction;
    this.top = Math.min(this.top, this.palmYHigh);
    const topY = Math.min(nominalTop, this.top);
    const raw = clamp01((this.baseline - this.palmYHigh) / Math.max(0.05, this.baseline - topY));
    s.handHeight += (raw - s.handHeight) * CONFIG.handHeight.outputAlpha;
    this.deriveRest(lm, now);
  }

  /** Everything except handHeight: raised hands, spread, chest point, hand positions, pinch. */
  private deriveRest(lm: NormalizedLandmark[], now: number): void {
    const s = this.signals;
    const mx = (p: NormalizedLandmark): Point => ({ x: 1 - p.x, y: p.y });
    const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER], lw = lm[L_WRIST], rw = lm[R_WRIST];

    // bothHandsRaised (debounced)
    const margin = CONFIG.bothHands.margin;
    const raised = lw.y < ls.y - margin && rw.y < rs.y - margin;
    if (raised) {
      if (this.raisedSince === null) this.raisedSince = now;
      s.bothHandsRaised = now - this.raisedSince >= CONFIG.bothHands.holdMs;
    } else {
      this.raisedSince = null;
      s.bothHandsRaised = false;
    }

    // spread, normalized by shoulder width
    const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 1e-3;
    const wristD = Math.hypot(lw.x - rw.x, lw.y - rw.y);

    // armsOpenLow (Acceptance): wrists below the shoulders and well apart, held (debounced like raised hands)
    const openLow = lw.y > ls.y && rw.y > rs.y && wristD / shoulderW >= CONFIG.openLow.minSpread;
    if (openLow) {
      if (this.openLowSince === null) this.openLowSince = now;
      s.armsOpenLow = now - this.openLowSince >= CONFIG.openLow.holdMs;
    } else {
      this.openLowSince = null;
      s.armsOpenLow = false;
    }
    const rawSpread = clamp01((wristD / shoulderW - CONFIG.spread.min) / (CONFIG.spread.max - CONFIG.spread.min));
    s.spread += (rawSpread - s.spread) * CONFIG.spread.smoothingAlpha;

    // chest point and hands
    const mid = { x: 1 - (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + shoulderW * CONFIG.chest.shiftDownShoulderWidths };
    s.chestPoint = mid;
    s.handPositions = { left: mx(lw), right: mx(rw) };

    this.deriveHands(lm, now);
  }

  /** Part F2 signals: pinch per hand, fingertips at the chest, and a single slow index finger. */
  private deriveHands(lm: NormalizedLandmark[], now: number): void {
    const s = this.signals, hs = CONFIG.hands;
    const AR = CONFIG.camera.width / CONFIG.camera.height; // x and y are normalized separately; correct distances
    const hands = this.handsEnabled ? this.handLms.map((h) => ({ h, cx: 1 - h[9].x })).sort((a, b) => a.cx - b.cx) : [];
    const slots: { left: NormalizedLandmark[] | null; right: NormalizedLandmark[] | null } = { left: null, right: null };
    if (hands.length >= 2) { slots.left = hands[0].h; slots.right = hands[1].h; }
    else if (hands.length === 1) { if (hands[0].cx < 0.5) slots.left = hands[0].h; else slots.right = hands[0].h; }

    for (const side of ['left', 'right'] as const) {
      const h = slots[side];
      if (!h) { s.pinchDist[side] = 1; this.pinchSince[side] = null; s.pinched[side] = false; continue; }
      const d = (a: number, b: number) => Math.hypot((h[a].x - h[b].x) * AR, h[a].y - h[b].y);
      const ratio = d(4, 8) / Math.max(1e-3, d(0, 9));
      s.pinchDist[side] = Math.min(1.5, ratio);
      const limit = s.pinched[side] ? hs.pinchThreshold * hs.pinchReleaseFactor : hs.pinchThreshold;
      if (ratio < limit) {
        this.pinchSince[side] ??= now;
        s.pinched[side] = now - (this.pinchSince[side] as number) >= hs.pinchHoldMs;
      } else {
        this.pinchSince[side] = null;
        s.pinched[side] = false;
      }
      s.pinchPoints[side] = { x: 1 - (h[4].x + h[8].x) / 2, y: (h[4].y + h[8].y) / 2 };
    }
    s.bothPinched = s.pinched.left && s.pinched.right;

    // fingertips at the chest: both index tips (hand model, else pose index knuckles) near the chest point
    const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER];
    const sw = Math.hypot((ls.x - rs.x) * AR, ls.y - rs.y) || 1e-3;
    const tips: Point[] = slots.left && slots.right
      ? [slots.left[8], slots.right[8]].map((p) => ({ x: 1 - p.x, y: p.y }))
      : [lm[L_INDEX], lm[R_INDEX]].map((p) => ({ x: 1 - p.x, y: p.y }));
    const c = s.chestPoint;
    const tipsApart = Math.hypot((tips[0].x - tips[1].x) * AR, tips[0].y - tips[1].y);
    const near = tipsApart < hs.chestTipsApart * sw && tips.every((p) => Math.hypot((p.x - c.x) * AR, p.y - c.y) < hs.chestRadius * sw);
    if (near) {
      this.chestSince ??= now;
      s.fingertipsAtChest = now - this.chestSince >= hs.chestHoldMs;
    } else {
      this.chestSince = null;
      s.fingertipsAtChest = false;
    }
  }

  /**
   * Clears pinch/chest state without touching handHeight/spread/calibration. Pinch and chest detection run
   * continuously whenever hands are enabled (Parts E, F, F2, G alike), so a hand shape held during an earlier
   * part (e.g. a loosely closed hand while shaping the Part F effect) can otherwise read as an instant pinch
   * the moment Part F2 begins. Call this right as F2 starts so only a pinch made during F2 itself counts.
   */
  resetGestures(): void {
    const s = this.signals;
    s.pinched = { left: false, right: false }; s.bothPinched = false; s.fingertipsAtChest = false;
    this.pinchSince = { left: null, right: null }; this.chestSince = null;
  }

  /** Applies debug/stand-in overrides (P = both pinched, F = fingertips at chest). */
  private applyOverrides(): void {
    const s = this.signals, o = this.overrides, c = s.chestPoint;
    if (o.bothPinched) {
      if (!s.bothPinched) {
        s.pinchPoints = { left: { x: c.x - 0.13, y: c.y - 0.1 }, right: { x: c.x + 0.13, y: c.y - 0.1 } };
      }
      s.pinched = { left: true, right: true }; s.bothPinched = true;
    }
    if (o.fingertipsAtChest) s.fingertipsAtChest = true;
  }

  private easeToNeutral(dt: number): void {
    const s = this.signals;
    const k = 1 - Math.exp(-dt / (CONFIG.tracking.lostEaseMs / 3));
    s.handHeight += (0 - s.handHeight) * k;
    s.spread += (0 - s.spread) * k;
    s.bothHandsRaised = false;
    this.raisedSince = null;
    s.armsOpenLow = false;
    this.openLowSince = null;
    s.pinched = { left: false, right: false }; s.bothPinched = false; s.fingertipsAtChest = false;
    this.pinchSince = { left: null, right: null }; this.chestSince = null;
  }

  private stepCalibration(now: number, lm: NormalizedLandmark[] | null): void {
    if (!this.calibSamples) return;
    if (lm && this.breathSource === 'head' && this.faceReady) {
      if (this.faceTracking(now)) this.calibSamples.push(this.pitchDeg);
      if (this.landmarks) this.calibEars.push(this.headPitch);
    } else if (lm) this.calibSamples.push(this.breathSource !== 'head' ? this.palmYHigh : this.headPitch);
    if (now >= this.calibEnd) {
      const samples = this.calibSamples;
      this.calibSamples = null;
      // the head needs fewer samples: even one reading of the level head is a usable resting tilt
      const ok = samples.length >= (this.breathSource === 'head' ? 1 : 5);
      const ears = this.calibEars;
      this.calibEars = [];
      if (this.breathSource === 'head' && this.faceReady && ears.length) this.headBase = ears.reduce((a, b) => a + b, 0) / ears.length;
      if (ok && this.breathSource === 'head') {
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (this.faceReady) this.pitchBaseDeg = mean; else this.headBase = mean;
        this.signals.calibrated = true;
      } else if (ok) {
        this.baseline = samples.reduce((a, b) => a + b, 0) / samples.length;
        this.top = this.baseline; // relearn the top of the range from here
        this.signals.calibrated = true;
      }
      this.calibResolve?.(ok);
      this.calibResolve = null;
    }
  }

  private updateManual(dt: number): void {
    const s = this.signals, m = this.manual!;
    const a = CONFIG.standIns.smoothingAlpha;
    s.source = 'manual';
    s.tracking = true;
    s.handHeight += (m.handHeight - s.handHeight) * a;
    s.spread += (m.spread - s.spread) * a;
    s.bothHandsRaised = m.bothHandsRaised;
    s.armsOpenLow = m.bothHandsRaised; // stand-in: hold Space for either gesture
    s.chestPoint = { x: m.x, y: 0.62 };
    const half = 0.1 + s.spread * 0.3;
    s.handPositions = { left: { x: m.x - half, y: 0.55 }, right: { x: m.x + half, y: 0.55 } };
    void dt;
  }
}

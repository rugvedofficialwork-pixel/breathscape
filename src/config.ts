// All tunable thresholds, smoothing values and timings live here.
export const CONFIG = {
  pose: {
    modelPath: '/models/pose_landmarker_lite.task',
    handModelPath: '/models/hand_landmarker.task',
    faceModelPath: '/models/face_landmarker.task', // 478 face points + the head's 3D rotation (head experiment only)
    wasmPath: '/wasm',
    numPoses: 1,
    minDetectionConfidence: 0.5,
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
  camera: { width: 960, height: 540 },

  handHeight: {
    // "raised" = resting baseline minus this fraction of the frame height
    raiseFraction: 0.2, // nominal travel to fill the orb; auto-extends if you lift higher (never saturates early)
    // One Euro filter on the palm Y: lower minCutoff = smoother when still, higher beta = snappier when moving
    filterMinCutoff: 1.2,
    filterBeta: 6,
    outputAlpha: 0.5, // light final EMA per frame (1 = off)
    defaultBaseline: 0.75, // normalized wrist Y used until calibrate() runs
  },
  calibration: { durationMs: 1500 },

  /** Experiment: the breathing orb follows the head tilt instead of the hand ("Breathe with: head"). */
  head: {
    /** Face model (preferred): degrees of chin-up tilt from the resting head to a full orb. */
    fullAtDeg: 40,
    /** Quiet zone: within this many degrees of the resting head (up or down) the orb barely changes. */
    quietDeg: 10,
    /** How flat the quiet zone is (higher = flatter). 3: about +0.01 at 5 degrees, +0.09 at 10. */
    quietPower: 3,
    pitchSign: 1, // +1: chin up = positive pitch (checked against the face geometry on test photos)
    filterMinCutoffDeg: 1.0, // One Euro on the angle in degrees
    filterBetaDeg: 0.02,
    /** Fallback when the face model is unavailable (pose nose and ears): tilt in ear-to-ear distances for a full orb. */
    range: 0.32,
    restDownSec: 2, // the resting head follows the head down this quickly (corrects a calibration taken mid-lift)
    restUpSec: 40, // ...and creeps up this slowly (a held in-breath still counts)
    ratioToDeg: 70, // the nose-and-ears tilt converted to degrees (backup when the face is lost: about 0.32 = 22 degrees)
    restLevel: 0.1, // orb level with the head level (as calibrated); tilting down goes to 0
    filterMinCutoff: 1.0,
    filterBeta: 4,
  },

  bothHands: {
    holdMs: 500, // both wrists above their shoulders, continuously
    margin: 0, // extra normalized Y a wrist must clear its shoulder by
  },

  openLow: {
    // Acceptance's gesture: arms low and open, wrists at least this many shoulder widths apart
    minSpread: 1.6,
    holdMs: 700,
  },

  spread: {
    // wrist distance / shoulder width mapped from [min, max] to [0, 1]
    min: 1.0,
    max: 3.0,
    smoothingAlpha: 0.2,
  },

  chest: { shiftDownShoulderWidths: 0.35 },

  tracking: {
    lostGraceMs: 200, // pose must be missing this long before tracking = false
    lostEaseMs: 1000, // ease signals toward neutral over roughly this long
  },

  // Part F2 "Taking It In": finger gestures
  hands: {
    pinchThreshold: 0.3, // thumb tip to index tip distance / hand size (wrist to middle knuckle); below = pinched
    pinchReleaseFactor: 1.35, // hysteresis: must open past threshold x this to release
    pinchHoldMs: 300, // debounce before a pinch counts
    chestRadius: 0.45, // both index tips within this many shoulder-widths of the chest point (pinching in front of you must NOT count)
    chestTipsApart: 0.6, // ...and no further apart than this (fingertips together at the centre of the chest)
    chestHoldMs: 500,
    slowFps: 22, // below this, alternate hand and pose frames instead of running both every frame
  },

  // Part F2 timings (ms)
  f2: {
    hintAfterMs: 25000,
    proceedAfterMs: 45000,
    gatherOrbMax: 30, // px radius of each gathered orb at full brightness (scaled by stage size)
  },

  standIns: {
    // mouse Y = handHeight, hold Space = bothHandsRaised, mouse X distance from centre = spread
    smoothingAlpha: 0.2,
  },

  speech: {
    // recorded narration (public/audio, made by scripts/generate-voice.py)
    playbackRate: 0.95, // <1 = a little slower and deeper again on top of the generated voice
    clipPauseMs: 1500, // breath between sentences (was 1100: more room to land)
    clipVolume: 1.0,
    /** Your own recordings (public/audio-recorded): played at natural speed, at this level to match the generated voice. */
    ownVoiceVolume: 1.5, // your recordings measured about 3 dB quieter than the generated voice at the output (slow speech, more soft moments)
    warmthDb: 3, // low-shelf boost at 200Hz for a closer, deeper feel
    softTopHz: 7500, // gentle low-pass so the top end is not hissy
    // browser-voice fallback
    rate: 0.78, // calm and unhurried
    pitch: 0.6, // lower = deeper
    sentencePauseMs: 900, // pause between sentences
    leadInMs: 550, // breath before each line (was 400)
    captionLingerMs: 1800,
  },

  scene1: {
    /** Pre-session: pause between "Welcome..." and "Get comfortable...", and before the breathing begins. */
    preSessionPauseMs: 5000,
    afterPreSessionMs: 4000,
    cycles: 6,
    phaseMs: 4000, // fixed 4s inhale / hold / exhale / rest
    calibrationDelayMs: 4500, // into the opening line, once the "hand out" instruction has been heard
    afterOpenMs: 1800,
    afterCloseMs: 2500,
    dimMs: 7000, // orb dims to a point and screen fades to dark
    // per-cycle softening (index = cycle 0..5)
    speechVolume: [1, 0.92, 0.8, 0.62, 0.4, 0.3],
    speechRate: [0.82, 0.8, 0.78, 0.74, 0.7, 0.7],
    droneVolume: [0.16, 0.14, 0.12, 0.09, 0.05, 0.012],
    slowPerCycle: 0.9, // motion speed multiplier per cycle
    colorFrom: [255, 196, 106], // warm gold
    colorTo: [206, 226, 255], // pale blue-white
    /** Breathing visual: 'particles' (luminous particles rising with the breath) or 'orb' (the original orb). ?orb=1 = orb. */
    visual: 'particles' as 'particles' | 'orb',
    field: {
      count: 200, // particles at the last breath (fewer with reduced motion)
      startFraction: 0.5, // share of them at the first breath; it grows to all of them over the breaths
      reach: 0.62, // how far out the ring reaches, as a fraction of the screen width from you (0.5+ = past the edges)
      innerRadius: 0.12, // the nearest a particle comes to you (fraction of the reach)
      orbitRadPerSec: [0.002, 0.006], // how fast they circle you: very slow, so they barely move sideways (at most ~6 px/s)
      depthScale: 1.1, // size by distance: e^(1.1) = the nearest about 3x, the furthest about 1/3 (9x apart)
      sway: 0.035, // left-right drift breathed in, as a fraction of the smaller screen side (almost still breathed out)
      maxFallPerSec: 0.5, // the fastest they sink (a full fall takes at least about 2 s); rising is not limited
      behindFade: 0.9, // how completely they fade going straight behind you (1 = gone)
      lagMs: [900, 2000], // each follows the breath this slowly (different per particle: fluid, not in lockstep)
      // height above the bottom edge, in screen heights, for the lowest and highest particle:
      outBottom: -0.45, outTop: 0.2, // breathed out: most out of sight below, the rest within the bottom fifth
      inBottom: 0.06, inTop: 0.95, // breathed in: the whole screen
      dimAlpha: 0.35, // brightness breathed out (1 = breathed in)
      brightness: 1.6, // overall brightness boost
      size: 0.012, // glow radius, as a fraction of the smaller screen side
    },
    orbMinRadius: 0.055, // fraction of min(stage w, h)
    orbMaxRadius: 0.27,
    maxParticles: 220,
  },

  drone: {
    rootHz: 110,
    peakHz: 165, // pitch reached at the top of the inhale
    detuneCents: 7,
    lowpassHz: 800,
    shimmerHz: 5.5,
    shimmerDepth: 0.07,
    cueToneHz: { inhale: 261.63, hold: 329.63, exhale: 246.94, rest: 196 },
  },

  timeScales: [1, 4],
} as const;

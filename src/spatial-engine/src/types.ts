import type { Pos } from './core/coords';

export type { Pos };

export type Word = 'kindness' | 'acceptance' | 'courage' | 'calm';

/** Mixer groups. Beds and fx duck under the voice. */
export type BusName = 'bed' | 'fx' | 'voice';

/** Continuous gesture inputs, already normalised by the main project. */
export type ParamName = 'handHeight' | 'wristSpread' | 'armsRaised' | 'userScreenX' | 'windIntensity';

export interface PathPoint {
  /** Seconds from the start of the path. */
  t: number;
  az?: number;
  el?: number;
  dist?: number;
  /** Force the turning direction for this leg (default: shortest way). cw = front -> right -> behind. */
  turn?: 'cw' | 'ccw';
}

export interface PathDef {
  points: PathPoint[];
}

export interface CueDef {
  /**
   * point  = one sound at a fixed position
   * path   = one sound following a path
   * param  = ramp a param (fields: param, value, sec), e.g. the wind picking up
   * custom = implemented in src/cues
   */
  kind: 'point' | 'path' | 'param' | 'custom';
  /** point/path: seconds to wait before starting. */
  delay?: number;
  /** Only runs when this feature is switched on in cues.json "features" (e.g. the F2 proposals). */
  feature?: string;
  label?: string;
  bus?: BusName;
  /** Name of a sound in src/synth/sounds.ts. */
  sound?: string;
  pos?: Pos;
  path?: PathDef;
  /** Linear gain 0..1 at the source (before distance). */
  level?: number;
  /** Reverb send 0..1. */
  wet?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** For point cues with a continuous sound: how long to play (seconds). Omit = until stopped. */
  hold?: number;
  /** Named moments (seconds from the cue start); cue(...).marker(name) resolves then. */
  markers?: Record<string, number>;
  /** Extra settings passed to the sound or custom cue. */
  [key: string]: unknown;
}

export interface ParamSpec {
  min: number;
  max: number;
  /** Value to relax towards when tracking is lost. */
  rest: number;
  /** One-pole smoothing time constant, seconds. */
  smoothSec: number;
  /** false = not a gesture (e.g. windIntensity from the timeline): unaffected by tracking loss. */
  gesture?: boolean;
}

export interface VoicePathDef {
  pos?: Pos;
  path?: PathDef;
  /** Reverb send for the voice while on this path. */
  wet?: number;
  /** Voice level (1 = normal). */
  level?: number;
  /** Glide time to a static pos, seconds. */
  glideSec?: number;
  /** Named moments along the path (seconds from its start), e.g. "behind". */
  markers?: Record<string, number>;
  label?: string;
}

export interface GlobalDef {
  /** Audio buffer size requested when the engine creates its own AudioContext (seconds). */
  latencySec?: number;
  masterLevel: number;
  maxPanners: number;
  minFadeSec: number;
  controlHz: number;
  /** Path automation points per second. */
  pathRate: number;
  distance: {
    refDist: number;
    nearMaxGain: number;
    minGain: number;
    airRefDist: number;
    airMinHz: number;
    airMaxHz: number;
    wetDistanceExponent: number;
  };
  reverb: { seconds: number; preDelayMs: number; damping: number; returnLevel: number; impulseFile?: string };
  limiter: { thresholdDb: number; kneeDb: number; ratio: number; attack: number; release: number; makeupTrimDb: number; ceiling: number };
  duck: { depthDb: number; attackSec: number; releaseSec: number; floorDb: number; rangeDb: number };
  tracking: { holdSec: number; relaxSec: number };
  /** Helps sounds (especially in front) feel outside the head. */
  externalize: {
    earlyReflections: boolean;
    erLevel: number;
    /** Per-source send into the early reflections (after distance). */
    erSend: number;
    /** Very slow, tiny listener head movement. */
    headSway: boolean;
    swayAzDeg: number;
    swayElDeg: number;
    swayPeriodSec: number;
  };
  /** Narration clips played with playVoice() (the main project's own player keeps its own settings). */
  voiceClips: { rate: number; gain: number; warmthDb: number; softTopHz: number };
}

export interface CueFile {
  /** Optional files in assets/ to preload (see assets/README.md). */
  assets?: string[];
  /** Optional groups of cues, off unless switched on (e.g. { "partF2": false }). */
  features?: Record<string, boolean>;
  global: GlobalDef;
  params: Record<ParamName, ParamSpec>;
  voicePaths: Record<string, VoicePathDef>;
  cues: Record<string, CueDef>;
}

/** Snapshot of one active source, for the visualiser. */
export interface SourceInfo {
  id: number;
  label: string;
  bus: BusName;
  pos: Pos;
  level: number;
}

export interface CueHandle {
  readonly id: string;
  /** Fade out and end (default: the cue's own fadeOut). */
  stop(fadeSec?: number): void;
  /** Resolves when the cue has fully finished. */
  readonly done: Promise<void>;
  /** Resolves at a named marker from cues.json (or immediately if it has passed / does not exist). */
  marker(name: string): Promise<void>;
  /** Live setting for cues that accept one (see each cue's notes). */
  control(name: string, value?: unknown): void;
}

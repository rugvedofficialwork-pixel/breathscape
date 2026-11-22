import { fromXYZ, toXYZ, type Pos, type XYZ } from './coords';
import { clamp, glide, holdAt } from './math';
import type { Path } from './paths';
import type { BusName, GlobalDef } from '../types';

/** What a source needs from the engine (kept small so sources are easy to test and reuse). */
export interface SourceHost {
  readonly ctx: BaseAudioContext;
  readonly global: GlobalDef;
  busInput(bus: BusName): AudioNode;
  readonly reverbInput: AudioNode;
  readonly erInput: AudioNode;
  register(s: SpatialSource): void;
  unregister(s: SpatialSource): void;
  /** Run a callback once audio time reaches t (works in realtime and offline). */
  afterTime(t: number, cb: () => void): void;
}

export interface SourceOpts {
  label: string;
  bus: BusName;
  pos: Pos;
  /** Reverb send 0..1. */
  wet?: number;
  /** Early-reflection send (default global.externalize.erSend). */
  er?: number;
}

let nextId = 1;

/** Compute these params once per render block (see the constructor). */
export function kRate(...params: AudioParam[]): void {
  for (const p of params) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      /* some browsers do not allow it on every param: stays a-rate */
    }
  }
}

/**
 * The one building block every sound goes through:
 *
 *   input -> air lowpass -> fade -> distance gain -> HRTF panner -> bus
 *                                \-> reverb send ---------------------> shared reverb
 *
 * Position, distance roll-off (level + high-frequency loss), reverb amount and
 * fades behave the same way for every sound. Sounds only differ in what they
 * feed into `input`.
 */
export class SpatialSource {
  readonly id = nextId++;
  readonly label: string;
  readonly bus: BusName;
  /** Connect the sound here. */
  readonly input: GainNode;

  private readonly air: BiquadFilterNode;
  private readonly occLp: BiquadFilterNode;
  private readonly occGain: GainNode;
  private readonly fade: GainNode;
  private readonly distGain: GainNode;
  private readonly panner: PannerNode;
  private readonly send: GainNode;
  private readonly erSend: GainNode;
  private wet: number;
  /** The engine's own record of movement and fades (see posAt). */
  private motion: { kind: 'still'; pos: Pos } | { kind: 'glide'; from: XYZ; to: XYZ; t0: number; tc: number } | { kind: 'path'; path: Path; t0: number };
  private lvl = { from: 0, to: 0, t0: 0, sec: 1, linear: true };
  private released = false;
  private readonly onEnd: (() => void)[] = [];

  constructor(private readonly host: SourceHost, opts: SourceOpts) {
    const c = host.ctx;
    this.label = opts.label;
    this.bus = opts.bus;
    this.motion = { kind: 'still', pos: { ...opts.pos } };
    this.wet = opts.wet ?? 0.15;

    // A point source is mono: stereo files are folded down here before the HRTF.
    this.input = new GainNode(c, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.air = c.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.Q.value = 0.5;
    this.fade = c.createGain();
    this.fade.gain.value = 0;
    this.distGain = c.createGain();
    this.send = c.createGain();
    this.panner = new PannerNode(c, {
      panningModel: 'HRTF',
      // Distance loudness is handled by distGain (our own law, with a near-field cap), not by the panner.
      distanceModel: 'inverse',
      refDistance: 1,
      rolloffFactor: 0,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
    });

    // Occlusion (a wall or a shut window between the sound and the listener): off until setOcclusion() is used.
    this.occLp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.occGain = new GainNode(c, { gain: 1 });
    this.input.connect(this.air).connect(this.occLp).connect(this.occGain).connect(this.fade);
    this.fade.connect(this.distGain).connect(this.panner).connect(host.busInput(this.bus));
    this.fade.connect(this.send).connect(host.reverbInput);
    this.erSend = new GainNode(c, { gain: opts.er ?? host.global.externalize.erSend });
    this.distGain.connect(this.erSend).connect(host.erInput);

    // These only ever change slowly (movement, distance). Computing them once per
    // 128-sample block instead of for every sample is inaudible and far cheaper:
    // a-rate panner positions and filter frequencies are among the most expensive
    // things in Web Audio (per-sample HRTF angles, per-sample filter coefficients).
    kRate(this.panner.positionX, this.panner.positionY, this.panner.positionZ, this.distGain.gain, this.air.frequency, this.send.gain, this.erSend.gain);

    this.applyNow(opts.pos);
    this.lastTarget = toXYZ(opts.pos);
    this.lastDist = opts.pos.dist;
    host.register(this);
  }

  // ------------------------------------------------------------ distance model
  private distanceGain(d: number): number {
    const g = this.host.global.distance;
    return clamp(g.refDist / Math.max(0.05, d), g.minGain, g.nearMaxGain);
  }

  /** Far sources lose their top end (air absorption), close ones are full range. */
  private airCutoff(d: number): number {
    const g = this.host.global.distance;
    return clamp(g.airMaxHz * Math.pow(g.airRefDist / Math.max(0.05, d), 1.1), g.airMinHz, g.airMaxHz);
  }

  /** Reverb falls more slowly than the direct sound, so distant sources sound further away. */
  private sendGain(d: number): number {
    return this.wet * Math.pow(this.distanceGain(d), this.host.global.distance.wetDistanceExponent);
  }

  private applyNow(p: Pos): void {
    const v = toXYZ(p);
    const t = this.host.ctx.currentTime;
    this.panner.positionX.setValueAtTime(v.x, t);
    this.panner.positionY.setValueAtTime(v.y, t);
    this.panner.positionZ.setValueAtTime(v.z, t);
    this.distGain.gain.setValueAtTime(this.distanceGain(p.dist), t);
    this.air.frequency.setValueAtTime(this.airCutoff(p.dist), t);
    this.send.gain.setValueAtTime(this.sendGain(p.dist), t);
  }

  // ------------------------------------------------------------ movement
  private lastTarget: XYZ;
  private lastDist: number;

  /**
   * Glide to a position (exponential approach, time constant ~ glideSec / 3).
   * Calls that would not move the source (under ~3 mm) are skipped, and the
   * distance-driven settings are only touched when the distance changes.
   */
  setPosition(p: Pos, glideSec = 0.3, at = this.host.ctx.currentTime): void {
    const v = toXYZ(p);
    const moved = Math.hypot(v.x - this.lastTarget.x, v.y - this.lastTarget.y, v.z - this.lastTarget.z);
    if (moved < 0.003 && this.motion.kind !== 'path') return;
    const tc = Math.max(0.02, glideSec / 3);
    this.motion = { kind: 'glide', from: toXYZ(this.posAt(at)), to: v, t0: at, tc };
    this.lastTarget = v;
    glide(this.panner.positionX, v.x, at, tc);
    glide(this.panner.positionY, v.y, at, tc);
    glide(this.panner.positionZ, v.z, at, tc);
    if (Math.abs(p.dist - this.lastDist) > 0.005) {
      this.lastDist = p.dist;
      glide(this.distGain.gain, this.distanceGain(p.dist), at, tc);
      glide(this.air.frequency, this.airCutoff(p.dist), at, tc);
      glide(this.send.gain, this.sendGain(p.dist), at, tc);
    }
  }

  /**
   * Follow a path from `at` (audio time). Written as dense linear ramps sampled
   * from the spherical path, so the motion is smooth and works offline too.
   * Returns the audio time the path ends.
   */
  followPath(path: Path, at = this.host.ctx.currentTime): number {
    const params = [this.panner.positionX, this.panner.positionY, this.panner.positionZ, this.distGain.gain, this.air.frequency, this.send.gain];
    for (const p of params) holdAt(p, at);
    const step = 1 / this.host.global.pathRate;
    const n = Math.max(1, Math.ceil(path.duration / step));
    for (let i = 1; i <= n; i++) {
      const tp = Math.min(path.duration, i * step);
      const p = path.at(tp);
      const v = toXYZ(p);
      const when = at + tp;
      this.panner.positionX.linearRampToValueAtTime(v.x, when);
      this.panner.positionY.linearRampToValueAtTime(v.y, when);
      this.panner.positionZ.linearRampToValueAtTime(v.z, when);
      this.distGain.gain.linearRampToValueAtTime(this.distanceGain(p.dist), when);
      this.air.frequency.linearRampToValueAtTime(this.airCutoff(p.dist), when);
      this.send.gain.linearRampToValueAtTime(this.sendGain(p.dist), when);
    }
    this.motion = { kind: 'path', path, t0: at };
    this.lastTarget = toXYZ(path.end);
    this.lastDist = path.end.dist;
    return at + path.duration;
  }

  /** 0 = nothing in the way, 1 = behind glass: the top goes and the level drops, as when a window is shut. */
  setOcclusion(amount: number, sec = 0.2, at = this.host.ctx.currentTime): void {
    const a = clamp(amount, 0, 1);
    glide(this.occLp.frequency, 20000 * Math.pow(650 / 20000, a), at, Math.max(0.02, sec / 3));
    glide(this.occGain.gain, 1 - 0.55 * a, at, Math.max(0.02, sec / 3));
  }

  setWet(wet: number, sec = 1): void {
    this.wet = clamp(wet, 0, 1);
    this.lastDist = -1; // next setPosition refreshes the send too
    glide(this.send.gain, this.sendGain(this.currentPos().dist), this.host.ctx.currentTime, sec / 3);
  }

  /**
   * Where the source is at audio time t, from the engine's own record of the
   * movement. (Reading AudioParam.value back is unreliable: Chrome stops updating
   * it while a source is silent, e.g. between two sentences.)
   */
  posAt(t: number): Pos {
    const m = this.motion;
    if (m.kind === 'still') return { ...m.pos };
    if (m.kind === 'path') return m.path.at(clamp(t - m.t0, 0, m.path.duration));
    const k = t <= m.t0 ? 0 : 1 - Math.exp(-(t - m.t0) / m.tc);
    return fromXYZ({ x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k, z: m.from.z + (m.to.z - m.from.z) * k });
  }

  private levelAt(t: number): number {
    const l = this.lvl;
    if (t <= l.t0) return l.from;
    if (l.linear) return l.from + (l.to - l.from) * Math.min(1, (t - l.t0) / l.sec);
    return l.to + (l.from - l.to) * Math.exp(-(t - l.t0) / (l.sec / 3));
  }

  // ------------------------------------------------------------ level
  /**
   * Fade to a level over `sec` (never shorter than global.minFadeSec).
   * Up: linear ramp (no sudden onset). Down: exponential approach, ~95% gone
   * after `sec`, with a soft tail.
   */
  fadeTo(level: number, sec: number, at = this.host.ctx.currentTime): void {
    const s = Math.max(this.host.global.minFadeSec, sec);
    const g = this.fade.gain;
    const from = this.levelAt(at);
    holdAt(g, at);
    const linear = level > from;
    if (linear) g.linearRampToValueAtTime(level, at + s);
    else g.setTargetAtTime(level, at, s / 3);
    this.lvl = { from, to: level, t0: at, sec: s, linear };
  }

  /** Fade out, then disconnect and free the panner. */
  release(sec: number, at = this.host.ctx.currentTime): void {
    if (this.released) return;
    this.released = true;
    const s = Math.max(this.host.global.minFadeSec, sec);
    this.fadeTo(0, s, at);
    const endAt = at + s * 2 + 0.05; // below -50 dB by now: disconnecting is inaudible
    this.host.afterTime(endAt, () => this.dispose());
  }

  whenEnded(cb: () => void): void {
    this.onEnd.push(cb);
  }

  get isReleased(): boolean {
    return this.released;
  }

  private dispose(): void {
    try {
      this.input.disconnect();
      this.occLp.disconnect();
      this.occGain.disconnect();
      this.fade.disconnect();
      this.distGain.disconnect();
      this.panner.disconnect();
      this.send.disconnect();
      this.erSend.disconnect();
    } catch {
      /* already disconnected */
    }
    this.host.unregister(this);
    for (const cb of this.onEnd) cb();
  }

  // ------------------------------------------------------------ read-back (visualiser, voice allocation, paths)
  currentPos(): Pos {
    return this.posAt(this.host.ctx.currentTime);
  }

  /** Current audible level (fade x distance), roughly 0..1.5. */
  currentLevel(): number {
    const t = this.host.ctx.currentTime;
    return this.levelAt(t) * this.distanceGain(this.posAt(t).dist);
  }
}

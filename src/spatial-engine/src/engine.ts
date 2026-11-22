import { Assets } from './assets';
import { ControlClock } from './core/clock';
import { toXYZ } from './core/coords';
import { clamp, wrapAz } from './core/math';
import { prepareWater } from './synth/nature';
import { Mixer, type SpaceDef } from './core/mixer';
import { Params } from './core/params';
import { kRate, SpatialSource, type SourceHost, type SourceOpts } from './core/source';
import { runBasic } from './cues/basic';
import { CUSTOM_CUES } from './cues/custom';
import { CueRun } from './cues/run';
import type { BusName, CueFile, CueHandle, GlobalDef, ParamName, SourceInfo, Word } from './types';
import { VoiceChannel, type PlayVoiceOpts } from './voice';

export type EngineEvent = 'log' | 'subtitle' | 'marker' | 'cue';
type Listener = (detail: unknown) => void;

export interface EngineOptions {
  context: BaseAudioContext;
  cues: CueFile;
  word: Word;
  assetsBaseUrl: string;
  /** Where the engine's output goes (default: context.destination). */
  destination?: AudioNode;
}

/**
 * The spatial audio engine. Knows nothing about webcams, UI or gesture
 * libraries: it takes named cues and plain numbers.
 */
export class Engine implements SourceHost {
  readonly ctx: BaseAudioContext;
  readonly assets: Assets;
  readonly params: Params;
  readonly clock: ControlClock;
  cues: CueFile;
  word: Word;

  private readonly mixer: Mixer;
  private readonly sources = new Set<SpatialSource>();
  private readonly running = new Map<string, CueRun>();
  private readonly listeners = new Map<EngineEvent, Set<Listener>>();
  private _voice: VoiceChannel | null = null;

  constructor(o: EngineOptions) {
    this.ctx = o.context;
    this.cues = o.cues;
    this.word = o.word;
    this.assets = new Assets(this.ctx, o.assetsBaseUrl);
    this.mixer = new Mixer(this.ctx, this.cues.global, o.destination ?? this.ctx.destination);
    this.params = new Params(this.cues.params, this.cues.global);
    this.clock = new ControlClock(this.ctx, this.cues.global.controlHz);
    this.headSway = this.cues.global.externalize.headSway;
    const l = this.ctx.listener;
    if (l.forwardX) kRate(l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ, l.positionX, l.positionY, l.positionZ);
    this.clock.onTick((dt, now) => {
      this.params.tick(dt);
      this.mixer.tick(dt);
      this.swayTick(now);
    });
    // Offline renders step the control clock with suspend(); create the engine before startRendering().
    if (this.ctx instanceof OfflineAudioContext) this.clock.startOffline(this.ctx);
    else this.clock.startRealtime();
  }

  // ------------------------------------------------------------ SourceHost
  get global(): GlobalDef {
    return this.cues.global;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  busInput(bus: BusName): AudioNode {
    return this.mixer.input(bus);
  }

  get reverbInput(): AudioNode {
    return this.mixer.reverbInput;
  }

  get erInput(): AudioNode {
    return this.mixer.erInput;
  }

  // ------------------------------------------------------------ externalisation
  private headSway: boolean;
  private swayAmount = 0;

  /**
   * A very slow, tiny turn of the listener's head (two slow sines, so it never
   * feels like a regular wobble). The small changes help the brain place
   * sounds, especially in front, outside the head. Fades in/out when toggled.
   */
  private swayN = 0;

  private swayTick(now: number): void {
    const x = this.global.externalize;
    this.swayAmount += ((this.headSway ? 1 : 0) - this.swayAmount) * 0.02;
    // Moving the listener makes every HRTF source recompute its angles, so update the
    // (very slow) sway only ~4 times a second and let the glide fill in between.
    const headMoved = Math.abs(this.head.yaw - this.headSent.yaw) > 1 || Math.abs(this.head.pitch - this.headSent.pitch) > 1;
    if (this.swayN++ % 8 && !headMoved) return;
    if (this.swayAmount < 0.001 && !this.headSway && !headMoved) return;
    this.headSent = { ...this.head };
    const P = x.swayPeriodSec;
    const az = this.head.yaw + this.swayAmount * x.swayAzDeg * (0.65 * Math.sin((2 * Math.PI * now) / P) + 0.35 * Math.sin((2 * Math.PI * now) / (P * 0.61) + 1.3));
    const el = this.head.pitch + this.swayAmount * x.swayElDeg * Math.sin((2 * Math.PI * now) / (P * 1.37) + 0.4);
    const f = toXYZ({ az, el, dist: 1 });
    const u = toXYZ({ az, el: el + 90, dist: 1 });
    const l = this.ctx.listener;
    if (l.forwardX) {
      const t = this.ctx.currentTime;
      l.forwardX.setTargetAtTime(f.x, t, 0.12);
      l.forwardY.setTargetAtTime(f.y, t, 0.12);
      l.forwardZ.setTargetAtTime(f.z, t, 0.12);
      l.upX.setTargetAtTime(u.x, t, 0.12);
      l.upY.setTargetAtTime(u.y, t, 0.12);
      l.upZ.setTargetAtTime(u.z, t, 0.12);
    } else {
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  private head = { yaw: 0, pitch: 0 };
  private headSent = { yaw: 0, pitch: 0 };

  /**
   * Where the listener's head is pointing, in degrees: yaw +right, pitch +up, 0 = straight ahead.
   * Every spatial source stays where it is in the room while the head turns (the narrator, which is
   * head-locked, does not move). Call as often as you like; only changes over 1 degree reach the panners.
   */
  setHeadPose(pose: { yaw: number; pitch: number }): void {
    this.head = { yaw: clamp(pose.yaw, -80, 80), pitch: clamp(pose.pitch, -50, 50) };
  }

  /**
   * A plain input to a bus with no panner: a sound that stays inside the head and does not turn with it
   * (the narrator; the listener's own heartbeat). Optional reverb send so it still sits in the room.
   */
  headLocked(bus: BusName, wet = 0): GainNode {
    const g = this.ctx.createGain();
    g.connect(this.mixer.input(bus));
    if (wet > 0) g.connect(new GainNode(this.ctx, { gain: wet })).connect(this.mixer.reverbInput);
    return g;
  }

  /** Crossfade to another acoustic space (see Mixer.setSpace). */
  setSpace(def: SpaceDef, sec = 2): void {
    this.mixer.setSpace(def, sec);
  }

  /** Level of a whole group: 'voice', 'bed' or 'fx'. */
  setBusLevel(bus: BusName, v: number, sec = 1): void {
    this.mixer.setBusLevel(bus, v, sec);
  }

  /** A/B switches for the externalisation helpers (defaults come from cues.json). */
  setExternalization(o: { earlyReflections?: boolean; headSway?: boolean }): void {
    if (o.earlyReflections !== undefined) this.mixer.setEarlyReflections(o.earlyReflections);
    if (o.headSway !== undefined) this.headSway = o.headSway;
  }

  register(s: SpatialSource): void {
    this.sources.add(s);
  }

  unregister(s: SpatialSource): void {
    this.sources.delete(s);
  }

  afterTime(t: number, cb: () => void): void {
    this.clock.at(t, cb);
  }

  at(t: number, cb: () => void): void {
    this.clock.at(t, cb);
  }

  /**
   * New spatial source. Keeps the number of HRTF panners under the budget: if
   * full, the quietest non-voice source is faded out quickly to make room.
   */
  createSource(o: SourceOpts): SpatialSource {
    const live = [...this.sources].filter((s) => !s.isReleased);
    if (live.length >= this.global.maxPanners) {
      const victim = live.filter((s) => s.bus !== 'voice').sort((a, b) => a.currentLevel() - b.currentLevel())[0];
      if (victim) {
        this.emit('log', `panner budget (${this.global.maxPanners}) reached: fading out "${victim.label}"`);
        victim.release(0.3);
      }
    }
    return new SpatialSource(this, { ...o, wet: o.wet ?? 0.15 });
  }

  // ------------------------------------------------------------ events
  on(type: EngineEvent, cb: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  emit(type: EngineEvent, detail: unknown): void {
    this.listeners.get(type)?.forEach((cb) => cb(detail));
  }

  // ------------------------------------------------------------ public API
  async unlock(): Promise<void> {
    if (this.ctx instanceof AudioContext && this.ctx.state !== 'running') await this.ctx.resume();
  }

  get voice(): VoiceChannel {
    if (!this._voice) this._voice = new VoiceChannel(this);
    return this._voice;
  }

  /** Where the main project connects its own narration player. */
  get voiceInput(): AudioNode {
    return this.voice.input;
  }

  /**
   * Fire a named cue. Ids from `voicePaths` in cues.json also work here
   * (e.g. 'stage2.voice.arc' moves the narration voice).
   */
  cue(id: string, opts: Record<string, unknown> = {}): CueHandle {
    const def = this.cues.cues[id];
    if (!def && this.cues.voicePaths[id]) {
      const run = this.voice.setPath(id);
      this.emit('cue', id);
      return run;
    }
    if (!def) throw new Error(`Unknown cue: ${id}`);
    if (def.feature && !this.features[def.feature]) {
      this.emit('log', `${id} skipped: feature "${def.feature}" is off (proposal; switch it on in cues.json "features")`);
      const off = new CueRun(id, this, this.now, {}, () => undefined, 0);
      off.finish();
      return off;
    }
    this.running.get(id)?.stop();
    let run: CueRun;
    if (def.kind === 'param') {
      const sec = typeof def.sec === 'number' ? def.sec : 4;
      this.params.ramp(def.param as ParamName, def.value as number, sec);
      const r = new CueRun(id, this, this.now, {}, () => undefined, 0);
      this.at(this.now + sec, () => r.finish());
      run = r;
    } else if (def.kind === 'custom') {
      const impl = CUSTOM_CUES[id];
      if (!impl) throw new Error(`Cue ${id} is "custom" but has no implementation in src/cues`);
      run = impl(this, id, def, opts);
    } else {
      run = runBasic(this, id, def);
    }
    this.running.set(id, run);
    void run.done.then(() => {
      if (this.running.get(id) === run) this.running.delete(id);
    });
    this.emit('cue', id);
    return run;
  }

  stopCue(id: string, fadeSec?: number): void {
    this.running.get(id)?.stop(fadeSec);
  }

  /** The running instance of a cue, if any. */
  getRunning(id: string): CueRun | undefined {
    const r = this.running.get(id);
    return r && !r.isStopped ? r : undefined;
  }

  /** Send a live setting to a running cue (e.g. 'stage1.breathDrone', 'mode', 'hand'). */
  cueControl(id: string, name: string, value?: unknown): void {
    this.getRunning(id)?.control(name, value);
  }

  /** Resolves after `sec` of audio time (also correct in offline renders). */
  wait(sec: number): Promise<void> {
    return new Promise((r) => this.clock.at(this.now + Math.max(0, sec), r));
  }

  runningCues(): string[] {
    return [...this.running.keys()];
  }

  setParam(name: ParamName, value: number): void {
    this.params.set(name, value);
  }

  /** Move a param gradually over `sec` (for timeline-driven changes such as windIntensity). */
  rampParam(name: ParamName, value: number, sec: number): void {
    this.params.ramp(name, value, sec);
  }

  /**
   * Load the optional asset files (wind, water, impulse response) so cues can use
   * them the moment they start. Missing files are fine: cues fall back to generated sound.
   */
  async preloadAssets(): Promise<void> {
    const files = this.cues.assets ?? [];
    await Promise.all(files.map((f) => this.assets.load(f)));
    const ir = this.cues.global.reverb.impulseFile;
    const buf = ir ? this.assets.peek(ir) : null;
    if (buf) this.mixer.setImpulse(buf);
    if (!this.assets.peek('water_loop.wav')) prepareWater(this.ctx);
    const found = files.filter((f) => this.assets.peek(f));
    this.emit('log', found.length ? `assets loaded: ${found.join(', ')}` : 'no asset files found: using generated fallbacks');
  }

  getParam(name: ParamName): number {
    return this.params.get(name);
  }

  /** Tell the engine the camera lost / found the user. While lost, gesture params hold, then relax slowly. */
  setTracking(ok: boolean): void {
    this.params.setTracking(ok);
  }

  setWord(w: Word): void {
    this.word = w;
  }

  private featureOverrides: Record<string, boolean> = {};

  get features(): Record<string, boolean> {
    return { ...this.cues.features, ...this.featureOverrides };
  }

  /** Switch an optional cue group on or off at runtime (e.g. 'partF2'). */
  setFeature(name: string, on: boolean): void {
    this.featureOverrides[name] = on;
  }

  playVoice(src: string | AudioBuffer, opts: PlayVoiceOpts = {}): Promise<void> {
    return this.voice.play(src, opts);
  }

  setVoicePath(name: string): CueHandle {
    return this.voice.setPath(name);
  }

  setMasterVolume(v: number): void {
    this.mixer.setMasterVolume(v);
  }

  stopAll(opts: { fadeSec?: number } = {}): void {
    const f = opts.fadeSec ?? 2;
    for (const run of [...this.running.values()]) run.stop(f);
    this._voice?.stopClips(Math.min(f, 0.5));
  }

  /** Swap in edited cue data (the harness does this live when cues.json changes). */
  reloadCues(cues: CueFile): void {
    this.cues = cues;
    this.params.update(cues.params, cues.global);
    this.mixer.updateGlobal(cues.global);
    this.emit('log', 'cues.json reloaded');
  }

  /** Snapshot of every live source (for the visualiser). */
  activeSources(): SourceInfo[] {
    return [...this.sources].map((s) => {
      const p = s.currentPos();
      return { id: s.id, label: s.label, bus: s.bus, pos: { ...p, az: wrapAz(p.az) }, level: s.currentLevel() };
    });
  }

  get duckAmount(): number {
    return this.mixer.duckAmount;
  }

  dispose(): void {
    this.clock.stop();
    this.stopAll({ fadeSec: 0.2 });
  }
}

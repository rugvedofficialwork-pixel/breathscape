import type { Engine } from '../engine';
import type { Pos } from '../core/coords';
import { wrapAz } from '../core/math';
import { Path } from '../core/paths';
import type { SpatialSource } from '../core/source';
import * as S from '../synth/city';
import { wind, type LiveSound } from '../synth/nature';
import { chime, thump } from '../synth/pulse';
import type { BusName } from '../types';
import { LEVELS, POS, SPACES } from './plan';

type Live = { src: SpatialSource; sound: { stop(when: number): void; set?(v: number, t: number): void; setIntensity?(v: number, t: number): void } };

/**
 * The 3D sound score of "Ten Past Three": every place, thing and animal of the story, placed around
 * the listener. The story's timeline calls these methods by name; all the numbers live in plan.ts.
 * Nothing here knows about the camera or the screen.
 */
export class TenPastScore {
  readonly c: BaseAudioContext;
  /** The narrator: head-locked, in the middle of the listener's head. Connect the narration player here. */
  readonly narrator: GainNode;
  /** The crow's voice. Connect its clips here. It has a place in the room, and that place moves. */
  readonly crow: GainNode;
  private crowSrc: SpatialSource;
  /** Inside the body: the heartbeat. */
  private body: GainNode;
  private live = new Map<string, Live>();
  private hbTimer = 0;
  private hbBpm = 0;
  private whisperOn = false;
  private whisperBufs: AudioBuffer[] = [];
  private whisperSrc: { src: SpatialSource; az: number; speed: number }[] = [];
  private whisperGain = 0;
  private flight = { yaw: 0, spread: 0, alt: 0, dawn: 0 };
  /** Everything scheduled for the future is dropped when this changes. */
  private epoch = 0;

  constructor(private eng: Engine) {
    this.c = eng.ctx;
    const c = this.c;
    // Narrator: a little low warmth and a soft top, so it sits close and calm.
    this.narrator = c.createGain();
    const warm = new BiquadFilterNode(c, { type: 'lowshelf', frequency: 160, gain: 4 });
    const body = new BiquadFilterNode(c, { type: 'peaking', frequency: 320, Q: 0.8, gain: -1.5 });
    const soft = new BiquadFilterNode(c, { type: 'lowpass', frequency: 7500, Q: 0.5 });
    this.narrator.connect(warm).connect(body).connect(soft).connect(eng.headLocked('voice', LEVELS.narratorWet));

    // Crow: dry and thin and close. A different animal from the narrator.
    this.crow = c.createGain();
    const hp = new BiquadFilterNode(c, { type: 'highpass', frequency: 220, Q: 0.6 });
    const edge = new BiquadFilterNode(c, { type: 'peaking', frequency: 2500, Q: 1, gain: 3.5 });
    const top = new BiquadFilterNode(c, { type: 'lowpass', frequency: 7000, Q: 0.6 });
    this.crowSrc = eng.createSource({ label: 'crow', bus: 'voice', pos: POS.crowLedge, wet: 0.12, er: 0.5 });
    this.crow.connect(hp).connect(edge).connect(top).connect(this.crowSrc.input);
    this.crowSrc.fadeTo(1, 0.05);

    this.body = eng.headLocked('fx', 0);
  }

  /** Where the listener's head is pointing, degrees. Everything but the narrator and the heartbeat stays put in the room. */
  headPose(yaw: number, pitch: number): void { this.eng.setHeadPose({ yaw, pitch }); }

  /** Sound levels from the settings. */
  ambience(v: number): void {
    this.eng.setBusLevel('bed', v, 0.3);
    this.eng.setBusLevel('fx', v, 0.3);
  }

  /** A soft tone that travels once round the head: "can you hear this go round?" */
  headphoneCheck(): void {
    const sec = 6;
    const src = this.eng.createSource({ label: 'check', bus: 'fx', pos: { az: -90, el: 0, dist: 1.2 }, wet: 0.1 });
    const t = this.c.currentTime + 0.05;
    src.fadeTo(1, 0.3, t);
    const o = new OscillatorNode(this.c, { type: 'triangle', frequency: 330 });
    const g = new GainNode(this.c, { gain: 0.16 });
    o.connect(g).connect(src.input);
    o.start(t);
    o.stop(t + sec + 1);
    src.followPath(new Path({ points: [
      { t: 0, az: -90 }, { t: sec / 4, az: 0, turn: 'cw' }, { t: sec / 2, az: 90, turn: 'cw' }, { t: (3 * sec) / 4, az: 180, turn: 'cw' }, { t: sec, az: 270, turn: 'cw' },
    ] }, { az: -90, el: 0, dist: 1.2 }), t);
    this.eng.at(t + sec, () => src.release(0.5));
  }

  // ------------------------------------------------------------------ helpers
  private later(sec: number, fn: () => void): void {
    const e = this.epoch;
    this.eng.at(this.c.currentTime + sec, () => { if (e === this.epoch) fn(); });
  }

  private loop(name: string, make: () => S.Loop | LiveSound, pos: Pos, level: number, fade: number, o: { bus?: BusName; wet?: number } = {}): SpatialSource {
    this.stop(name, 0.4);
    const src = this.eng.createSource({ label: name, bus: o.bus ?? 'bed', pos, wet: o.wet ?? 0.1 });
    const sound = make();
    sound.out.connect(src.input);
    const t = this.c.currentTime + 0.02;
    sound.start(t);
    src.fadeTo(level, fade, t);
    this.live.set(name, { src, sound });
    return src;
  }

  stop(name: string, fade = 2): void {
    const l = this.live.get(name);
    if (!l) return;
    this.live.delete(name);
    const end = this.c.currentTime + fade * 2 + 0.2;
    l.src.release(fade);
    l.sound.stop(end);
  }

  level(name: string, level: number, sec = 2): void { this.live.get(name)?.src.fadeTo(level, sec); }
  move(name: string, pos: Pos, sec = 2): void { this.live.get(name)?.src.setPosition(pos, sec); }
  private ctl(name: string, v: number): void {
    const l = this.live.get(name);
    if (!l) return;
    const t = this.c.currentTime;
    if (l.sound.set) l.sound.set(v, t);
    else l.sound.setIntensity?.(v, t);
  }

  /** A one-shot at a place in the room, freed when it has finished. */
  private shot(label: string, pos: Pos, sec: number, level: number, wet: number, fire: (dest: AudioNode, t: number) => void, bus: BusName = 'fx'): SpatialSource {
    const src = this.eng.createSource({ label, bus, pos, wet });
    const t = this.c.currentTime + 0.02;
    src.fadeTo(level, 0.05, t);
    fire(src.input, t);
    this.eng.at(t + sec, () => src.release(0.5));
    return src;
  }

  // ------------------------------------------------------------------ the breath
  private tone: ReturnType<typeof S.breathTone> | null = null;

  breathStart(): void {
    this.eng.setSpace(SPACES.room, 0.2);
    this.loop('breath', () => (this.tone = S.breathTone(this.c)), POS.breathFar, LEVELS.breathTone, 5, { wet: 0.25 });
  }

  /** The tone comes towards the listener on the inhale and goes away on the exhale. */
  breathPhase(phase: 'inhale' | 'hold' | 'exhale' | 'rest', sec: number, softness = 0): void {
    const t = this.c.currentTime;
    const lvl = LEVELS.breathTone * (1 - 0.65 * softness);
    if (phase === 'inhale') { this.tone?.glide(165, sec, t); this.move('breath', POS.breathNear, sec); this.level('breath', lvl, sec); }
    if (phase === 'hold') this.level('breath', lvl * 0.9, sec);
    if (phase === 'exhale') { this.tone?.glide(110, sec, t); this.move('breath', POS.breathFar, sec); this.level('breath', lvl * 0.7, sec); }
    if (phase === 'rest') this.level('breath', lvl * 0.25, sec);
  }

  breathEnd(sec = 6): void { this.stop('breath', sec); }

  /** A soft single chime in the middle of the room. */
  chimeSoft(hz = 523.25, amp = 0.34, decay = 5): void {
    this.shot('chime', POS.chime, decay + 1, 1, 0.35, (d, t) => chime(this.c, d, t, hz, amp, decay));
  }

  // ------------------------------------------------------------------ the bedroom
  bedroom(): void {
    this.eng.setSpace(SPACES.bedroom, 3);
    this.loop('fan', () => S.ceilingFan(this.c), POS.fan, LEVELS.fan, 6, { wet: 0.08 });
    this.loop('city', () => S.cityFar(this.c), POS.cityBehindWall, LEVELS.cityClosed, 8);
    this.ctl('city', 0);
    this.heartbeat(78, LEVELS.heartbeat);
  }

  /** The phone's small cold coin: falls from the chest down out of the bottom of the world, and never lands. */
  coin(): void {
    const src = this.eng.createSource({ label: 'coin', bus: 'fx', pos: POS.coinTop, wet: 0.7 });
    const t = this.c.currentTime + 0.02;
    src.fadeTo(1, 0.05, t);
    S.coinFall(this.c, src.input, t, 0.5);
    src.followPath(new Path(POS.coinPath), t);
    this.eng.at(t + 9, () => src.release(1));
  }

  heartbeat(bpm: number, amp: number): void {
    this.hbBpm = bpm;
    this.hbAmp = amp;
    if (this.hbTimer) return;
    this.hbTimer = 1;
    const e = this.epoch;
    const beat = () => {
      if (e !== this.epoch || !this.hbBpm) { this.hbTimer = 0; return; }
      const t = this.c.currentTime + 0.03;
      thump(this.c, this.body, t, this.hbAmp, 44);
      thump(this.c, this.body, t + Math.min(0.3, (60 / this.hbBpm) * 0.32), this.hbAmp * 0.62, 44);
      this.eng.at(t + 60 / this.hbBpm, beat);
    };
    beat();
  }
  private hbAmp = 0;
  heartbeatStop(): void { this.hbBpm = 0; }

  // ------------------------------------------------------------------ the kitchen
  steps(n: number, from: Pos, to: Pos, every = 0.62): void {
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      const side = i % 2 ? 14 : -14;
      this.later(i * every, () => this.shot('step', { az: from.az + (to.az - from.az) * u + side, el: from.el + (to.el - from.el) * u, dist: from.dist + (to.dist - from.dist) * u }, 0.8, 1, 0.2, (d, t) => S.footstep(this.c, d, t, LEVELS.step)));
    }
  }

  getUp(): void {
    this.stop('fan', 7);
    this.steps(7, POS.feet, POS.feet);
  }

  kitchen(): void {
    this.eng.setSpace(SPACES.kitchen, 4);
    this.loop('fridge', () => S.fridge(this.c), POS.fridge, LEVELS.fridge, 5, { wet: 0.2 });
    // The window is open: the city is on the crow's side, and closer than it was.
    this.loop('city', () => S.cityFar(this.c), POS.cityWindow, LEVELS.cityOpen, 4);
    this.ctl('city', 0.4);
  }

  tapRuns(sec = 3.5): void {
    this.loop('tap', () => S.tap(this.c), POS.tap, LEVELS.tap, 0.25, { wet: 0.25 });
    this.later(sec, () => this.stop('tap', 0.3));
  }

  beakOnFrame(): void {
    this.crowSrc.setPosition(POS.crowLedge, 0.1);
    this.shot('beak', POS.crowLedge, 2, 1, 0.25, (d, t) => S.beakTaps(this.c, d, t, LEVELS.beak));
  }

  /** "I shut the window, and it goes on through the glass." */
  shutWindow(): void {
    this.shot('sash', POS.crowLedge, 2, 1, 0.2, (d, t) => S.windowShut(this.c, d, t, LEVELS.sash));
    this.later(0.45, () => {
      this.crowSrc.setOcclusion(1, 0.1);
      const c = this.live.get('city');
      c?.src.setOcclusion(1, 0.1);
      this.level('city', LEVELS.cityClosed, 0.2);
    });
  }

  /** "I open the window, and the heat comes in, and the smell of the street." */
  openWindow(): void {
    this.shot('sash', POS.crowLedge, 2, 1, 0.2, (d, t) => S.windowOpen(this.c, d, t, LEVELS.sash));
    this.later(0.2, () => {
      this.crowSrc.setOcclusion(0, 0.6);
      this.live.get('city')?.src.setOcclusion(0, 1);
      this.level('city', LEVELS.cityOpen * 1.5, 2.5);
      this.ctl('city', 0.75);
    });
  }

  /** "The crow steps over the sill and onto my shoulder": it travels round the head and lands, close to the right ear. */
  crowToShoulder(): void {
    const t = this.c.currentTime + 0.02;
    const flutter = this.eng.createSource({ label: 'crow-wing', bus: 'fx', pos: POS.crowLedge, wet: 0.1 });
    flutter.fadeTo(1, 0.05, t);
    S.wingFlutter(this.c, flutter.input, t, LEVELS.flutter, 6);
    flutter.followPath(new Path(POS.crowToShoulder), t);
    this.crowSrc.followPath(new Path(POS.crowToShoulder), t);
    this.eng.at(t + 2.6, () => flutter.release(0.5));
    this.crowSrc.setWet(0.03, 1);
    this.later(1.1, () => this.shot('crow-land', POS.crowShoulder, 1.5, 1, 0.04, (d, tt) => S.wingFlutter(this.c, d, tt, LEVELS.flutter * 0.7, 3)));
  }

  // ------------------------------------------------------------------ the roof
  stairs(): void {
    this.stop('fridge', 3);
    this.eng.setSpace(SPACES.stair, 2);
    this.level('city', LEVELS.cityClosed * 0.6, 2.5);
    this.steps(9, POS.feet, POS.stepUp, 0.56);
  }

  doorToRoof(): void {
    this.shot('door', POS.door, 3, 1, 0.3, (d, t) => S.doorOpens(this.c, d, t, LEVELS.door));
    this.later(1.1, () => {
      this.eng.setSpace(SPACES.roof, 2.5);
      this.loop('roofWind', () => wind(this.c, WIND_ROOF), POS.windFront, LEVELS.roofWind, 3, { wet: 0.05 });
      this.ctl('roofWind', 0.25);
      this.loop('city', () => S.cityFar(this.c), POS.cityBelowRoof, LEVELS.cityRoof, 3, { wet: 0.02 });
      this.ctl('city', 0.9);
    });
    // A washing-line peg ticks now and then, off to the left.
    const peg = () => {
      if (!this.live.has('roofWind')) return;
      this.shot('peg', POS.peg, 1, 1, 0.1, (d, t) => S.washingLine(this.c, d, t, LEVELS.peg));
      this.later(5 + Math.random() * 8, peg);
    };
    this.later(5, peg);
  }

  horseAppears(): void {
    this.loop('horse', () => S.horseBreath(this.c), POS.horseFar, LEVELS.horseBreath, 6, { wet: 0.05 });
  }

  /** "I put my hand on its side." It is close now, and there is a warmth you hear in the body. */
  horseTouch(): void {
    this.move('horse', POS.horseNear, 5);
    this.level('horse', LEVELS.horseBreath * 1.35, 5);
    this.shot('hide', POS.horseHand, 3, 1, 0.05, (d, t) => S.hideRub(this.c, d, t, LEVELS.hide));
    this.loop('warmth', () => S.warmPad(this.c), POS.warmth, LEVELS.warmth * 0.5, 8, { wet: 0.1 });
    this.ctl('warmth', 0.25);
    this.heartbeat(62, LEVELS.heartbeat * 0.8);
  }

  /** The August afternoon: the sea comes up from behind, the city and the wind go down. */
  memoryOn(): void {
    this.loop('sea', () => S.seaWash(this.c), POS.seaBehind, LEVELS.sea, 10, { wet: 0.15 });
    this.level('roofWind', LEVELS.roofWind * 0.5, 8);
    this.level('city', LEVELS.cityRoof * 0.4, 8);
    this.level('warmth', LEVELS.warmth, 10);
    this.ctl('warmth', 0.55);
    this.later(7, () => this.shot('gull', POS.gull, 3, 1, 0.5, (d, t) => S.gull(this.c, d, t, LEVELS.gull)));
    this.later(19, () => this.shot('gull', POS.gull2, 3, 1, 0.5, (d, t) => S.gull(this.c, d, t, LEVELS.gull * 0.7)));
    this.heartbeat(56, LEVELS.heartbeat * 0.65);
  }

  memoryOff(): void {
    this.stop('sea', 8);
    this.level('roofWind', LEVELS.roofWind, 6);
    this.level('city', LEVELS.cityRoof, 6);
  }

  /** "I find that my hand has gone to my ribs." If the listener's hand really has, the warmth answers. */
  bloomWarmth(amount: number): void {
    this.level('warmth', LEVELS.warmth * (1 + 0.9 * amount), 2);
    this.ctl('warmth', 0.55 + 0.4 * amount);
  }

  /** The wings open on either side of the listener and go on opening, further than the roof. */
  wingsOpen(): void {
    const sec = 11;
    for (const [pos0, path, delay] of [[POS.wingLeftStart, POS.wingLeftPath, 0], [POS.wingRightStart, POS.wingRightPath, 4]] as const) {
      this.later(delay, () => {
        const src = this.eng.createSource({ label: 'wing', bus: 'fx', pos: pos0, wet: 0.25 });
        const t = this.c.currentTime + 0.02;
        src.fadeTo(1, 0.05, t);
        S.wingUnfurl(this.c, src.input, t, LEVELS.wingUnfurl, sec);
        src.followPath(new Path(path), t);
        this.eng.at(t + sec + 2, () => src.release(1.5));
      });
    }
    this.level('warmth', LEVELS.warmth * 0.5, 8);
    this.heartbeatStop();
  }

  /** "The roof simply goes down." The city sinks from under the feet and the air comes up. */
  liftOff(): void {
    this.stop('horse', 6);
    this.eng.setSpace(SPACES.sky, 6);
    this.move('city', POS.cityFarBelow, 12);
    this.level('city', LEVELS.cityRoof * 0.85, 10);
    this.stop('roofWind', 5);
    this.loop('flightWind', () => wind(this.c, WIND_FLIGHT), POS.windFront, LEVELS.flightWind, 6, { wet: 0 });
    this.ctl('flightWind', 0.45);
    // Slow, enormous wing strokes, left and right together.
    const stroke = () => {
      if (!this.autoBeat) return;
      this.beat(0.75);
      this.later(4.2, stroke);
    };
    this.autoBeat = true;
    stroke();
  }
  private autoBeat = false;
  stopAutoBeat(): void { this.autoBeat = false; }

  /** One wingbeat, heard on both sides. */
  beat(strength: number, width = 0.5): void {
    const w = 40 + 60 * width;
    for (const az of [-w, w]) {
      this.shot('beat', { az, el: -8, dist: 1.8 + 2.2 * width }, 1.6, 1, 0.12, (d, t) => S.wingbeat(this.c, d, t, strength, LEVELS.wingbeat));
    }
  }

  // ------------------------------------------------------------------ the crows of the city
  /** Ring of quiet human voices below the listener, drifting from front to back as we pass over. */
  whispersStart(buffers: AudioBuffer[], level = LEVELS.whispers): void {
    if (!buffers.length) return;
    this.whisperBufs = buffers;
    this.whisperOn = true;
    this.whisperGain = level;
    for (let i = 0; i < 9; i++) {
      const az = -160 + i * 40 + (Math.random() - 0.5) * 16;
      const src = this.eng.createSource({ label: 'whisper', bus: 'fx', pos: { az, el: -40 - Math.random() * 25, dist: 3 + Math.random() * 3.5 }, wet: 0.2 });
      src.fadeTo(1, 4);
      this.whisperSrc.push({ src, az, speed: 3 + Math.random() * 3 });
      this.whisperSpeak(i, 1 + Math.random() * 7);
    }
  }

  private whisperSpeak(i: number, delay: number): void {
    this.later(delay, () => {
      if (!this.whisperOn) return;
      const w = this.whisperSrc[i];
      if (!w) return;
      const buf = this.whisperBufs[Math.floor(Math.random() * this.whisperBufs.length)];
      const n = new AudioBufferSourceNode(this.c, { buffer: buf, playbackRate: 0.92 + Math.random() * 0.16 });
      const lp = new BiquadFilterNode(this.c, { type: 'bandpass', frequency: 1300 + Math.random() * 700, Q: 0.5 });
      const g = new GainNode(this.c, { gain: this.whisperGain });
      n.connect(lp).connect(g).connect(w.src.input);
      n.onended = () => g.disconnect();
      n.start();
      // each one passes slowly from in front to behind the listener
      w.az = wrapAz(w.az + 24);
      w.src.setPosition({ az: w.az, el: -40 - Math.random() * 25, dist: 3 + Math.random() * 3.5 }, 5);
      this.whisperSpeak(i, buf.duration + w.speed * Math.random() + 1);
    });
  }

  whispersVolume(level: number): void { this.whisperGain = level; }

  whispersStop(fade = 8): void {
    this.whisperOn = false;
    for (const w of this.whisperSrc) w.src.release(fade);
    this.whisperSrc = [];
  }

  // ------------------------------------------------------------------ the flight (the listener's own wings)
  flightStart(): void {
    this.stopAutoBeat();
    this.eng.setSpace(SPACES.sky, 2);
    if (!this.live.has('flightWind')) {
      this.loop('flightWind', () => wind(this.c, WIND_FLIGHT), POS.windFront, LEVELS.flightWind, 4, { wet: 0 });
    }
    if (!this.live.has('city')) {
      this.loop('city', () => S.cityFar(this.c), POS.cityFarBelow, LEVELS.cityRoof * 0.8, 4);
    }
    this.ctl('city', 0.9);
    this.loop('dawn', () => S.dawnPad(this.c), POS.sun, 0, 4, { wet: 0.25 });
    this.loop('flock', () => S.flockFlutter(this.c), POS.flock, 0, 3, { bus: 'fx', wet: 0.3 });
    this.flight = { yaw: 0, spread: 0, alt: 0, dawn: 0 };
    this.crowSrc.setPosition(POS.crowShoulder, 0.3);
    this.crowSrc.setOcclusion(0, 0.1);
  }

  /** The wings unfold on the listener's own arms. */
  ownWingsOpen(): void {
    for (const [p0, p1] of [[POS.ownWingLeftA, POS.ownWingLeftB], [POS.ownWingRightA, POS.ownWingRightB]] as const) {
      const src = this.eng.createSource({ label: 'own-wing', bus: 'fx', pos: p0, wet: 0.2 });
      const t = this.c.currentTime + 0.02;
      src.fadeTo(1, 0.05, t);
      S.wingUnfurl(this.c, src.input, t, LEVELS.ownWing, 4);
      src.setPosition(p1, 3, t);
      this.eng.at(t + 5, () => src.release(1));
    }
    this.level('warmth', 0, 3);
  }

  /** dawn, spread 0..1; yaw degrees of the turn; alt 0..1. Call often: only real changes reach the audio. */
  flightUpdate(o: { dawn: number; spread: number; yaw: number; alt: number; lift: number }): void {
    const f = this.flight;
    if (Math.abs(o.yaw - f.yaw) > 2) {
      f.yaw = o.yaw;
      // The sun and the wind stay put in the world while you turn through them.
      this.move('dawn', { ...POS.sun, az: wrapAz(POS.sun.az - o.yaw) }, 0.6);
      this.move('city', { ...POS.cityFarBelow, az: wrapAz(POS.cityFarBelow.az - o.yaw * 0.5) }, 0.6);
      this.move('flightWind', { ...POS.windFront, az: wrapAz(POS.windFront.az + o.yaw * 0.4) }, 0.6);
    }
    if (Math.abs(o.dawn - f.dawn) > 0.01 || Math.abs(o.spread - f.spread) > 0.02) {
      f.dawn = o.dawn; f.spread = o.spread;
      this.level('dawn', LEVELS.dawn * (0.25 + 0.75 * o.dawn) * (1 + 0.25 * o.lift), 0.7);
      this.ctl('dawn', o.dawn * (0.7 + 0.3 * o.spread));
    }
    if (Math.abs(o.alt - f.alt) > 0.02) {
      f.alt = o.alt;
      this.level('city', LEVELS.cityRoof * (0.9 - 0.65 * o.alt) * (1 - 0.5 * o.dawn), 1);
      this.ctl('flightWind', 0.3 + 0.55 * o.alt);
    }
  }

  /** The crows lift off the ledges: the whispers thin out, the sound of wings comes up all around. */
  crowsRise(amount: number): void {
    this.level('flock', LEVELS.flock * amount, 2);
    this.ctl('flock', amount);
    this.move('flock', { ...POS.flock, el: POS.flock.el + 60 * amount, dist: POS.flock.dist * (1 - 0.3 * amount) }, 2);
  }

  sparkleAt(side: 'left' | 'right', up = true): void {
    this.shot('sparkle', side === 'left' ? POS.sparkleL : POS.sparkleR, 3, 1, 0.45, (d, t) => S.sparkle(this.c, d, t, LEVELS.sparkle, up));
  }

  /** The light is taken in at the chest: from all around to the centre, then the body warms. */
  chestContact(): void {
    const t = this.c.currentTime + 0.02;
    S.chestBloom(this.c, this.body, t, LEVELS.chestBloom, 8);
    thump(this.c, this.body, t, 0.5, 52);
    this.heartbeat(56, LEVELS.heartbeat * 0.75);
    this.later(12, () => this.heartbeatStop());
    for (const az of [-120, 120, 0]) {
      this.shot('ring', { az, el: 15, dist: 1.2 }, 5, 1, 0.8, (d, tt) => chime(this.c, d, tt, 659.25, 0.13, 4.5));
    }
  }

  /** Coming down into the morning: birds around the listener, a street waking up, the air slows. */
  landing(): void {
    this.stop('flock', 6);
    this.whispersStop(3);
    this.ctl('flightWind', 0.08);
    this.level('flightWind', LEVELS.flightWind * 0.3, 6);
    this.eng.setSpace(SPACES.roofMorning, 6);
    this.move('city', POS.cityBelowRoof, 6);
    this.level('city', LEVELS.cityRoof * 0.95, 6);
    this.ctl('city', 1);
    POS.birdSpots.forEach((p, i) => this.later(i * 0.8, () => this.loop(`birds${i}`, () => S.birds(this.c), p, LEVELS.birds, 7, { wet: 0.35 })));
    this.level('dawn', LEVELS.dawn * 0.55, 8);
  }

  /** The crow comes back to the sill, in the plain air on the listener's left. */
  crowToSill(): void {
    this.crowSrc.setPosition(POS.crowSill, 3);
    this.crowSrc.setWet(0.15, 2);
    this.shot('crow-land', POS.crowSill, 2, 1, 0.2, (d, t) => S.wingFlutter(this.c, d, t, LEVELS.flutter * 0.6, 3));
  }

  /** Puts the crow where a session wants it, with no movement. */
  crowAt(pos: Pos): void { this.crowSrc.setPosition(pos, 0.1); }

  /** All beds fade; used at the end of a session. */
  fadeAll(sec = 6): void {
    this.heartbeatStop();
    this.stopAutoBeat();
    this.whispersStop(sec);
    for (const name of [...this.live.keys()]) this.stop(name, sec);
  }

  /** Immediately quiet, with no scheduled sound still to come. */
  reset(sec = 0.3): void {
    this.epoch++;
    this.fadeAll(sec);
    this.hbTimer = 0;
    this.crowSrc.setOcclusion(0, 0.1);
    this.crowSrc.setPosition(POS.crowLedge, 0.05);
    this.crowSrc.setWet(0.12, 0.2);
  }
}

const WIND_ROOF = {
  bandHz: 480,
  gustHz: [0.09, 0.15] as [number, number],
  intensity: { levelMin: 0.45, levelMax: 1, brightHzMin: 420, brightHzMax: 2200, gustMin: 0.12, gustMax: 0.4, rateMin: 0.7, rateMax: 1.5 },
};
const WIND_FLIGHT = {
  bandHz: 620,
  gustHz: [0.06, 0.11] as [number, number],
  intensity: { levelMin: 0.45, levelMax: 1, brightHzMin: 500, brightHzMax: 3600, gustMin: 0.1, gustMax: 0.32, rateMin: 0.7, rateMax: 1.4 },
};

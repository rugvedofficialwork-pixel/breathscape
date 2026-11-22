import { holdAt } from './core/math';
import { CueRun } from './cues/run';
import type { Engine } from './engine';

export interface PlayVoiceOpts {
  /** Move the voice to this voice path (from cues.json voicePaths) as the clip starts. */
  path?: string;
  /** Clip gain (1 = as recorded). */
  gain?: number;
  /** Text for the subtitle log (and the placeholder when the file is missing). */
  text?: string;
  /** Playback rate (default global.voiceClips.rate). */
  rate?: number;
}

/**
 * The narration voice is one spatial source that stays alive all session.
 * Clips (or the main project's own player) feed `input`; voice paths move the
 * source, so a movement can span several sentence clips and the pauses between them.
 */
export class VoiceChannel {
  /**
   * The narrator is always centred: head-locked, no 3D position, so it never moves with the story or with the
   * listener's head. Voice paths still change its level, but no longer its place.
   */
  private readonly level: GainNode;
  private readonly inNode: GainNode;
  private currentPath: CueRun | null = null;
  private clips = new Map<AudioBufferSourceNode, GainNode>();

  constructor(private readonly eng: Engine) {
    const out = eng.headLocked('voice', eng.cues.voicePaths.center?.wet ?? 0.05);
    this.level = new GainNode(eng.ctx, { gain: 0 });
    this.inNode = new GainNode(eng.ctx, { gain: 1 });
    this.inNode.connect(this.level).connect(out);
    this.level.gain.linearRampToValueAtTime(eng.cues.voicePaths.center?.level ?? 1, eng.now + 0.2);
  }

  get input(): AudioNode {
    return this.inNode;
  }

  get pathName(): string | null {
    return this.currentPath?.id ?? null;
  }

  /** A named voice path: only its level is used now (the voice stays centred). Returns a handle with markers. */
  setPath(name: string): CueRun {
    const def = this.eng.cues.voicePaths[name];
    if (!def) throw new Error(`Unknown voice path: ${name}`);
    this.currentPath?.finish();
    const t0 = this.eng.now + 0.02;
    const glideSec = def.glideSec ?? 2;
    // keep the path's length so markers and anything waiting on it still line up
    const end = def.path ? t0 + Math.max(...def.path.points.map((p) => p.t ?? 0), glideSec) : t0 + glideSec;
    if (def.level !== undefined) {
      holdAt(this.level.gain, t0);
      this.level.gain.linearRampToValueAtTime(def.level, t0 + Math.max(glideSec, 0.5));
    }
    const run = new CueRun(name, this.eng, t0, def.markers ?? {}, () => undefined, 0);
    this.currentPath = run;
    this.eng.at(end, () => run.finish());
    this.eng.emit('log', `voice → ${name}`);
    return run;
  }

  /** Play one narration clip through the spatial voice. Resolves when it has finished. */
  async play(src: string | AudioBuffer, opts: PlayVoiceOpts = {}): Promise<void> {
    const buf = typeof src === 'string' ? await this.eng.assets.load(src) : src;
    if (opts.path) this.setPath(opts.path);
    if (opts.text) this.eng.emit('subtitle', opts.text);
    if (!buf) {
      // Placeholder: nothing to play yet. Keep the timing roughly right so sequences still flow.
      const label = typeof src === 'string' ? src : 'buffer';
      this.eng.emit('log', `voice placeholder (no file): ${label}`);
      const sec = opts.text ? Math.min(12, 0.5 + opts.text.length * 0.065) : 2;
      await new Promise<void>((r) => this.eng.at(this.eng.now + sec, r));
      return;
    }
    const c = this.eng.ctx;
    const rate = opts.rate ?? this.eng.global.voiceClips.rate;
    const node = new AudioBufferSourceNode(c, { buffer: buf, playbackRate: rate });
    const g = new GainNode(c, { gain: 0 });
    const t = this.eng.now + 0.02;
    const dur = buf.duration / rate;
    const vol = (opts.gain ?? 1) * this.eng.global.voiceClips.gain;
    // tiny edge fades: never a click at the start or end of a clip
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, Math.max(t + 0.03, t + dur - 0.06));
    g.gain.linearRampToValueAtTime(0, t + dur);
    node.connect(g).connect(this.clipBus());
    this.clips.set(node, g);
    node.start(t);
    // Resolve on the audio clock (not onended) so sequences are sample-accurate in offline renders too.
    await new Promise<void>((resolve) =>
      this.eng.at(t + dur, () => {
        this.clips.delete(node);
        this.eng.at(this.eng.now + 0.1, () => g.disconnect());
        resolve();
      }),
    );
  }

  private eq: AudioNode | null = null;

  /** Clip EQ, as in the main project's voice bus: a touch of low warmth and a soft top. */
  private clipBus(): AudioNode {
    if (this.eq) return this.eq;
    const c = this.eng.ctx;
    const v = this.eng.global.voiceClips;
    const warm = new BiquadFilterNode(c, { type: 'lowshelf', frequency: 200, gain: v.warmthDb });
    const soft = new BiquadFilterNode(c, { type: 'lowpass', frequency: v.softTopHz, Q: 0.5 });
    warm.connect(soft).connect(this.inNode);
    this.eq = warm;
    return warm;
  }

  /** Stop clips that are playing (with a short fade), keep the channel alive. */
  stopClips(fadeSec = 0.3): void {
    const t = this.eng.now;
    const s = Math.max(this.eng.global.minFadeSec, fadeSec);
    for (const [n, g] of this.clips) {
      holdAt(g.gain, t);
      g.gain.linearRampToValueAtTime(0, t + s);
      try {
        n.stop(t + s + 0.02);
      } catch {
        /* already stopped */
      }
    }
  }
}

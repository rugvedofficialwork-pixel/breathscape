import type { Word } from '../state';
import { cue, ensure, getEngine, stopCue } from './spatial';

/** What the effect layer needs from its sound. Both the 3D version (below) and the original stereo EffectAudio provide it. */
export interface EffectSound {
  riseTone(): void;
  endTone(sec: number): void;
  swell(): void;
  startEffect(word: Word): void;
  /** intensity 0-1 (arm spread), pan -1..1 (on-screen X), vis 0-1, raised 0-1 (hand height), fade 0-1 (Part G release). */
  update(intensity: number, pan: number, vis: number, raised?: number, fade?: number): void;
  chime(pan: number, volume: number): void;
  stopEffect(sec: number): void;
  pinchTick(pan?: number): void;
  contactTone(): void;
  whooshReverse(): void;
  /** Part G begins: from now the sound follows the hands down. */
  release?(): void;
  stopAll(): void;
}

const BED = 'stage3.partB.ambientBed';
const EFFECT = 'stage3.partF.effect';
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Parts D-G in 3D, from the spatial engine's cues (src/spatial-engine/cues.json, Stage 3 D-G):
 * the rising tone resolves in front, the swell widens around and above you as the arms go up, the word's
 * effect follows your arm spread and where you stand, the pinch and chest gather the sound in, and the
 * return fades the effect and the world at the rate your hands come down.
 */
export class SpatialEffectAudio implements EffectSound {
  private releasing = false;

  riseTone(): void { cue('stage3.partD.resolve'); } // "The path opens.": the trial's pulse slows away, a warm tone rises in front
  endTone(sec: number): void { stopCue('stage3.partD.risingTone', sec); }

  swell(): void {
    ensure(BED); // the world from Part B (already playing when the journey came first)
    cue('stage3.partE.swell');
  }

  startEffect(word: Word): void {
    const e = getEngine();
    e?.setWord(word);
    ensure(BED);
    this.releasing = false;
    cue(EFFECT, { word });
  }

  update(intensity: number, pan: number, _vis: number, raised = 0.9, fade = 1): void {
    const e = getEngine();
    if (!e) return;
    e.setTracking(true); // the layer handles lost tracking itself (timed fade), so the engine just follows it
    e.setParam('wristSpread', clamp(intensity * fade, 0, 1));
    e.setParam('userScreenX', clamp(pan / 0.9, -1, 1));
    e.setParam('armsRaised', this.releasing ? clamp(fade, 0, 1) : clamp(Math.max(0.35, raised), 0, 1));
  }

  chime(): void { /* the 3D effect places its own chimes around you */ }

  stopEffect(sec: number): void {
    getEngine()?.cueControl('stage3.partG.return', 'complete');
    stopCue(EFFECT, sec);
    stopCue(BED, sec + 1);
  }

  pinchTick(): void { cue('stage3.partF2.gather'); } // the sound around you converges on your fingertips

  contactTone(): void {
    cue('stage3.partF2.chest');
    setTimeout(() => cue('stage3.partF2.letItIn'), 1400); // it sinks in, and a warm low tone blooms
  }

  whooshReverse(): void { cue('stage3.partG.whoosh'); }

  release(): void {
    this.releasing = true;
    cue('stage3.partG.return');
  }

  stopAll(): void {
    this.releasing = false;
    for (const id of ['stage3.partD.risingTone', 'stage3.partE.swell', EFFECT, 'stage3.partF2.warmBloom', 'stage3.partG.return']) stopCue(id, 0.4);
    // The world bed (Part B) is left alone: it carries from the journey into the door scene; a skip or reset stops it in main.ts.
  }
}

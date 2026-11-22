import cuesJson from '../spatial-engine/cues.json';
import { Engine } from '../spatial-engine/src/engine';
import type { CueFile, CueHandle } from '../spatial-engine/src/types';
import type { Word } from '../state';
import { getCtx, getMaster } from './drone';

/**
 * The 3D (binaural, HRTF) sound for headphones. One engine, inside the app's own AudioContext, playing into
 * the same master as the drone. The narration voice is one of its sources, so the voice can move
 * (Stage 2, Movement 3) and sit in a space. Everything it plays is named in src/spatial-engine/cues.json.
 *
 * Off with ?spatial=0 (then the voice and Parts D-G use the original stereo sound).
 */
let engine: Engine | null = null;
let ready: Promise<void> | null = null;

export const spatialWanted = () => new URLSearchParams(location.search).get('spatial') !== '0';

/** Call after initAudio(), from the Begin click. */
export function initSpatial(word: Word): Promise<void> {
  if (!spatialWanted()) return Promise.resolve();
  if (!engine) {
    engine = new Engine({ context: getCtx(), cues: cuesJson as unknown as CueFile, word, assetsBaseUrl: '/spatial/', destination: getMaster() });
    void engine.voice; // the voice channel exists before the first line
    engine.setFeature('partF2', true); // Part F2 (pinch, chest, "Let it in") is part of this session, not a proposal
    ready = engine.preloadAssets().catch((e) => console.warn('[spatial] assets', e));
  }
  return ready ?? Promise.resolve();
}

export const getEngine = (): Engine | null => engine;

/** Fire a cue if the engine is on. Never throws: a sound problem must not stop the session. */
export function cue(id: string, opts: Record<string, unknown> = {}): CueHandle | null {
  if (!engine) return null;
  try { return engine.cue(id, opts); } catch (e) { console.warn('[spatial] cue', id, e); return null; }
}

/** Start a cue only if it is not already playing (so jumping into a part sets up what it needs). */
export function ensure(id: string, opts: Record<string, unknown> = {}): void {
  if (engine && !engine.getRunning(id)) cue(id, opts);
}

export function stopCue(id: string, fadeSec = 1): void {
  try { engine?.stopCue(id, fadeSec); } catch { /* not running */ }
}

/** Fade out every cue (the voice channel stays) and put the voice back in front. */
export function stopAllSpatial(fadeSec = 0.4): void {
  if (!engine) return;
  for (const id of engine.runningCues()) stopCue(id, fadeSec);
  cue('center');
}

/** Wait for a voice-path marker (e.g. the arc passing behind the listener), with a time limit. */
export async function marker(handle: CueHandle | null, name: string, maxMs: number): Promise<void> {
  if (!handle) return;
  await Promise.race([handle.marker(name), new Promise<void>((r) => setTimeout(r, maxMs))]);
}

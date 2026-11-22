import { CONFIG } from './config';
import { LINE_MAP, lineText } from './content/lines';
import { hideCaption, showCaption } from './captions';
import { sleep } from './engine/timeline';
import { getCtx, getMaster } from './audio/drone';
import { getEngine } from './audio/spatial';
import { state } from './state';

/**
 * Narration. Every line goes through speak(lineId).
 * 1. Recorded clips (public/audio/manifest.json, one MP3 per sentence, made by scripts/generate-voice.py)
 * 2. Fallback: the browser's speechSynthesis, tuned low and slow.
 *
 * Your own recordings (public/audio-recorded, exported by the door-recorder app, same layout and manifest) replace
 * the generated voice line by line: any line recorded in full plays in your voice, at its natural speed.
 */

// ------------------------------------------------------------------ recorded clips
let manifest: Record<string, string[]> = {};
/** Line ids that play in the user's own recorded voice. */
const ownVoice = new Set<string>();
let voiceLabel = 'browser';
const buffers = new Map<string, AudioBuffer>();
let bus: { input: GainNode } | null = null;
let current: AudioBufferSourceNode | null = null;
let currentDone: (() => void) | null = null;

async function loadManifest(): Promise<void> {
  try {
    const res = await fetch('/audio/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const json = await res.json();
    const meta = json._voice;
    delete json._voice;
    manifest = json;
    voiceLabel = meta ? `${meta.voice} ${meta.rate} ${meta.pitch}` : 'recorded';
  } catch { /* no recorded audio: fall back to browser TTS */ }
  await loadOwnVoice();
}

/** Sentences in a line, split exactly as play() splits them (one clip each). */
function sentenceCount(id: string): number {
  const line = LINE_MAP.get(id);
  if (!line) return -1;
  return line.parts.filter((p): p is string => typeof p === 'string').reduce((n, p) => n + p.split(/(?<=[.!?])\s+/).length, 0);
}

async function loadOwnVoice(): Promise<void> {
  try {
    const res = await fetch('/audio-recorded/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const json = await res.json() as Record<string, string[]>;
    delete (json as Record<string, unknown>)._voice;
    for (const [id, files] of Object.entries(json)) {
      // Only whole lines: a line half in one voice and half in another would sound like two people
      if (!Array.isArray(files) || files.length !== sentenceCount(id)) { console.warn(`[speech] own recording for ${id} skipped: ${files?.length} clips, the line has ${sentenceCount(id)} sentences`); continue; }
      manifest[id] = files.map((f) => `/audio-recorded/${f}`);
      ownVoice.add(id);
    }
    if (ownVoice.size) console.info('[speech] your own voice for', ownVoice.size, 'lines:', [...ownVoice].join(' '));
  } catch { /* no own recordings yet */ }
}

/** Voice bus: a touch of low-end warmth and a soft top, so the narration sits close and calm. */
function voiceBus(): GainNode {
  if (bus) return bus.input;
  const c = getCtx();
  const input = c.createGain();
  const warm = c.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 200; warm.gain.value = CONFIG.speech.warmthDb;
  const soft = c.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = CONFIG.speech.softTopHz; soft.Q.value = 0.5;
  // With the 3D engine on, the voice is one of its sources: it can move, and it sits in the same space as the world.
  const engine = getEngine();
  input.connect(warm).connect(soft).connect(engine ? engine.voiceInput : getMaster());
  bus = { input };
  return input;
}

async function clipBuffer(file: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(file);
  if (hit) return hit;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry: a transient hiccup should not change the voice
    try {
      const res = await fetch(file.startsWith('/') ? file : `/audio/${file}`);
      if (!res.ok) continue;
      const buf = await getCtx().decodeAudioData(await res.arrayBuffer());
      buffers.set(file, buf);
      return buf;
    } catch { /* retry */ }
  }
  return null;
}

/** Decode all clips in the background so playback never waits on the network. */
function preloadClips(): void {
  const files = Object.values(manifest).flat();
  let i = 0;
  const worker = async () => { while (i < files.length) await clipBuffer(files[i++]); };
  void Promise.all([worker(), worker(), worker()]);
}

function playClip(buf: AudioBuffer, volume: number, myGen: number, rate: number = CONFIG.speech.playbackRate): Promise<void> {
  return new Promise((resolve) => {
    if (myGen !== gen) return resolve();
    const c = getCtx();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate; // generated voice: slightly slower and deeper again; your own voice: as recorded
    const g = c.createGain();
    const t = c.currentTime, dur = buf.duration / src.playbackRate.value;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.06); // no clicks
    g.gain.setValueAtTime(volume, Math.max(t + 0.06, t + dur - 0.12));
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g).connect(voiceBus());
    current = src;
    currentDone = resolve;
    src.onended = () => { if (current === src) { current = null; currentDone = null; } resolve(); };
    src.start(t);
  });
}

// ------------------------------------------------------------------ browser TTS fallback
const VOICE_PREFS: RegExp[] = [
  /Ryan.*Natural/i, /Guy.*Natural/i, /Davis.*Natural/i, /Christopher.*Natural/i, /Eric.*Natural/i,
  /Natural/i, /Google UK English Male/i, /\bDavid\b/i, /\bDaniel\b/i, /\bAlex\b/i, /\bMark\b/i, /Male/i,
];
let voice: SpeechSynthesisVoice | null = null;
let gen = 0;

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return [];
  const v = speechSynthesis.getVoices();
  if (v.length) return v;
  await new Promise<void>((res) => {
    speechSynthesis.addEventListener('voiceschanged', () => res(), { once: true });
    setTimeout(res, 1500);
  });
  return speechSynthesis.getVoices();
}

export async function initSpeech(): Promise<void> {
  await loadManifest();
  if (Object.keys(manifest).length) {
    preloadClips();
    console.info('[speech] recorded narration:', voiceLabel, `(${Object.keys(manifest).length} lines)`);
    return;
  }
  const all = (await loadVoices()).filter((v) => v.lang.toLowerCase().startsWith('en'));
  const wanted = new URLSearchParams(location.search).get('voice');
  if (wanted) voice = all.find((v) => v.name.toLowerCase().includes(wanted.toLowerCase())) ?? null;
  for (const re of VOICE_PREFS) {
    if (voice) break;
    voice = all.find((v) => re.test(v.name)) ?? null;
  }
  voice ??= all[0] ?? null;
  console.info('[speech] browser voice:', voice?.name, '| available:', all.map((v) => v.name));
}

export function currentVoiceName(): string {
  return Object.keys(manifest).length ? voiceLabel : (voice?.name ?? 'none');
}

export function cancelSpeech(): void {
  epoch++; // drops every line still waiting its turn
  gen++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (current) { try { current.stop(); } catch { /* already stopped */ } current = null; }
  currentDone?.(); currentDone = null;
}

export interface SpeakOpts {
  volume?: number; rate?: number; pitch?: number; caption?: boolean;
  /** Cut whatever is playing right now instead of waiting for it to finish (default: wait, never cut mid-word). */
  interrupt?: boolean;
}

/** Bumped by cancelSpeech(): lines queued before it are dropped. */
let epoch = 0;
let tail: Promise<void> = Promise.resolve();
/** Sentences that had no usable recording (the player stays silent for them rather than switching voice). */
let missingClips = 0;
export const speechStats = () => ({ missingClips, recorded: Object.keys(manifest).length > 0 });

/** Breath after a sentence: longer for trailing "...", very short sentences, questions and long sentences. */
function gapAfter(sentence: string, base: number): number {
  const words = sentence.trim().split(/\s+/).length;
  if (/(\.\.\.|…)$/.test(sentence.trim())) return base * 1.6;
  if (words <= 2) return base * 1.35;
  if (/\?$/.test(sentence.trim())) return base * 1.2;
  if (sentence.length > 110) return base * 1.15;
  return base;
}

function say(text: string, o: { volume: number; rate: number; pitch: number }, myGen: number): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || myGen !== gen) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = o.rate; u.pitch = o.pitch; u.volume = o.volume;
    const safety = setTimeout(resolve, text.length * 150 + 3000);
    const done = () => { clearTimeout(safety); resolve(); };
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  });
}

// ------------------------------------------------------------------ speak()
/**
 * Speak a manifest line, slowly, with breaths between sentences.
 * At time scale > 1 speech is skipped and only the caption shows.
 */
export function speak(id: string, opts: SpeakOpts = {}): Promise<void> {
  if (!LINE_MAP.has(id)) throw new Error(`Unknown line: ${id}`);
  if (opts.interrupt) return play(id, opts);
  // A line already playing is allowed to finish (up to a few seconds) so nothing is cut off mid-word
  const myEpoch = epoch, prev = tail;
  const p = (async () => {
    await Promise.race([prev, new Promise<void>((r) => setTimeout(r, 3500))]);
    if (myEpoch !== epoch) return;
    await play(id, opts);
  })();
  tail = p.catch(() => undefined);
  return p;
}

async function play(id: string, opts: SpeakOpts): Promise<void> {
  const line = LINE_MAP.get(id)!;
  if (!line) throw new Error(`Unknown line: ${id}`);
  const s = CONFIG.speech;
  const o = { volume: opts.volume ?? 1, rate: opts.rate ?? s.rate, pitch: opts.pitch ?? s.pitch };
  const myGen = ++gen;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (current) { try { current.stop(); } catch { /* already stopped */ } current = null; }

  const text = lineText(id);
  const captions = opts.caption !== false;
  const clips = manifest[id];
  let tok = -1;

  if (state.timeScale > 1) {
    if (captions) tok = showCaption(text.length > 160 ? text.slice(0, 160) + '…' : text);
    await sleep(Math.min(3000, text.length * 45));
  } else {
    await sleep(s.leadInMs);
    let k = 0; // sentence counter across the whole line, matches the clip order
    for (const part of line.parts) {
      if (myGen !== gen) return;
      if (typeof part === 'number') { await sleep(part); continue; }
      const sentences = part.split(/(?<=[.!?])\s+/);
      // Short paragraphs are captioned whole; long ones sentence by sentence so the screen stays calm
      const longPart = part.length > 130;
      if (captions && !longPart) tok = showCaption(part);
      for (let i = 0; i < sentences.length; i++, k++) {
        if (myGen !== gen) return;
        if (captions && longPart) tok = showCaption(sentences[i]);
        const recorded = Object.keys(manifest).length > 0;
        const buf = clips?.[k] ? await clipBuffer(clips[k]) : null;
        if (myGen !== gen) return;
        if (buf) {
          const own = ownVoice.has(id);
          await playClip(buf, o.volume * (own ? s.ownVoiceVolume : s.clipVolume), myGen, own ? 1 : s.playbackRate);
        } else if (recorded) {
          // Recordings are in use: never switch to a different (robotic) voice mid-session. Stay silent, keep the caption.
          missingClips++;
          console.warn(`[speech] no usable recording for ${id} sentence ${k}; staying silent`);
          await sleep(Math.min(6000, sentences[i].length * 60));
        } else {
          await say(sentences[i], o, myGen);
        }
        if (i < sentences.length - 1) await sleep(buf ? gapAfter(sentences[i], s.clipPauseMs) : s.sentencePauseMs);
      }
    }
  }
  if (myGen === gen && tok >= 0) hideCaption(s.captionLingerMs, tok);
}

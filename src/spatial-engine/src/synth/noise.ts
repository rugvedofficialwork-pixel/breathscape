export type NoiseKind = 'white' | 'pink' | 'brown';

const SECONDS = 8;
const LOOP_TRIM = 0.05;
const cache = new WeakMap<BaseAudioContext, Partial<Record<NoiseKind, AudioBuffer>>>();

/** Loopable mono noise buffers, made once per context. */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let entry = cache.get(ctx);
  if (!entry) cache.set(ctx, (entry = {}));
  const hit = entry[kind];
  if (hit) return hit;

  const len = Math.round(ctx.sampleRate * SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = brown;
    }
  }
  // Remove DC and normalise. The last 50 ms are crossfaded into the start and the
  // loop ends where that tail begins (see LOOP_TRIM), so the seam is continuous.
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    d[i] -= mean;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  const fade = Math.round(ctx.sampleRate * LOOP_TRIM);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  for (let i = 0; i < len; i++) d[i] *= 0.9 / peak;
  entry[kind] = buf;
  return buf;
}

/**
 * A looping noise source. Each call starts at a random offset, so several
 * sources made from the same buffer are decorrelated (sound like separate
 * things in space, not one sound copied).
 */
export function noiseSource(ctx: BaseAudioContext, kind: NoiseKind): { node: AudioBufferSourceNode; start(when: number): void } {
  const node = ctx.createBufferSource();
  const buf = noiseBuffer(ctx, kind);
  node.buffer = buf;
  node.loop = true;
  node.loopStart = 0;
  node.loopEnd = (buf.length - Math.round(ctx.sampleRate * LOOP_TRIM)) / ctx.sampleRate;
  const offset = Math.random() * (node.loopEnd - 0.1);
  return { node, start: (when: number) => node.start(when, offset) };
}

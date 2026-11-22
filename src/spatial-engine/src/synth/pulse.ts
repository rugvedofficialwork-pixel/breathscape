/**
 * One soft heartbeat thump: a low sine that drops slightly in pitch, with a
 * 40 ms rise (defined, but never a click) and a smooth decay.
 * Used by the Part C tension pulse and the Calm heartbeat.
 */
export function thump(ctx: BaseAudioContext, dest: AudioNode, t: number, amp: number, hz: number): void {
  const env = new GainNode(ctx, { gain: 0 });
  const o1 = new OscillatorNode(ctx, { type: 'sine' });
  const o2 = new OscillatorNode(ctx, { type: 'sine' });
  o1.frequency.setValueAtTime(hz * 1.35, t);
  o1.frequency.exponentialRampToValueAtTime(hz, t + 0.12);
  o2.frequency.setValueAtTime(hz * 2.7, t);
  o2.frequency.exponentialRampToValueAtTime(hz * 2, t + 0.12);
  o1.connect(env);
  o2.connect(new GainNode(ctx, { gain: 0.22 })).connect(env);
  env.connect(dest);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + 0.04);
  env.gain.setTargetAtTime(0, t + 0.06, 0.09);
  o1.start(t);
  o2.start(t);
  o1.stop(t + 0.6);
  o2.stop(t + 0.6);
  o2.onended = () => env.disconnect();
}

/** "lub-dub" at time t; returns nothing, schedules both beats. */
export function heartbeat(ctx: BaseAudioContext, dest: AudioNode, t: number, amp: number, hz: number, bpm: number): void {
  thump(ctx, dest, t, amp, hz);
  thump(ctx, dest, t + Math.min(0.3, (60 / bpm) * 0.32), amp * 0.65, hz);
}

/**
 * A soft bell: inharmonic partials that die away at different rates.
 * 25 ms rise so it blooms rather than strikes.
 */
export function chime(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, amp: number, decaySec = 2.8): void {
  const env = new GainNode(ctx, { gain: 0 });
  env.connect(dest);
  const oscs: OscillatorNode[] = [];
  for (const [mult, a, d] of [[1, 1, 1], [2.76, 0.22, 0.5], [5.4, 0.05, 0.25]] as const) {
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: hz * mult });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.025);
    g.gain.setTargetAtTime(0, t + 0.03, (decaySec * d) / 4);
    o.connect(g).connect(env);
    o.start(t);
    o.stop(t + decaySec + 0.2);
    oscs.push(o);
  }
  env.gain.setValueAtTime(amp, t);
  oscs[0].onended = () => env.disconnect();
}

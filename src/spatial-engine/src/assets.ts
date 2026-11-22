/**
 * Loads audio files relative to assetsBaseUrl. A missing or broken file
 * resolves to null (never throws), so every caller can fall back to a
 * procedural sound and the session keeps running.
 */
export class Assets {
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private done = new Map<string, AudioBuffer | null>();

  /** Already-loaded result: a buffer, null (missing/broken), or undefined (not loaded yet). */
  peek(nameOrUrl: string): AudioBuffer | null | undefined {
    return this.done.get(this.url(nameOrUrl));
  }

  constructor(private readonly ctx: BaseAudioContext, private readonly baseUrl: string) {}

  url(nameOrUrl: string): string {
    if (/^(https?:|blob:|data:|\/)/.test(nameOrUrl)) return nameOrUrl;
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
    return base + nameOrUrl;
  }

  load(nameOrUrl: string): Promise<AudioBuffer | null> {
    const url = this.url(nameOrUrl);
    let p = this.cache.get(url);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const type = res.headers.get('content-type') ?? '';
          if (type.includes('text/html')) return null; // dev servers answer missing files with index.html
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      })().then((b) => {
        this.done.set(url, b);
        return b;
      });
      this.cache.set(url, p);
    }
    return p;
  }
}

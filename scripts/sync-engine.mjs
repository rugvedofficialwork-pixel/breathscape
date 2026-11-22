// Copies the spatial audio engine (a separate project, on its ten-past-three branch) into this app,
// so the app is self-contained (The Door, full version). Run this after changing the engine: npm run sync-engine
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, '..', 'the-door-spatial-audio-story-2');
const dest = join(root, 'src', 'spatial-engine');
if (!existsSync(engine)) throw new Error(`Engine project not found at ${engine}`);
rmSync(dest, { recursive: true, force: true });
cpSync(join(engine, 'src'), join(dest, 'src'), { recursive: true });
cpSync(join(engine, 'cues.json'), join(dest, 'cues.json'));
console.log('[sync-engine] copied from', engine);

// Dumps src/content/lines.ts to JSON, split into the same sentence units speech.ts plays at runtime.
// Node 24 runs the .ts file directly (type stripping).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES } from '../src/content/lines.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = LINES.map((l) => ({
  id: l.id,
  sentences: l.parts
    .filter((p) => typeof p === 'string')
    .flatMap((p) => p.split(/(?<=[.!?])\s+/)),
}));
writeFileSync(join(root, 'scripts', 'lines.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(`[dump-lines] ${out.length} lines, ${out.reduce((n, l) => n + l.sentences.length, 0)} sentences`);

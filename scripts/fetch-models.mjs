// Downloads the PoseLandmarker (lite) model and copies the MediaPipe WASM runtime
// into /public so nothing is loaded from a CDN at runtime.
import { createWriteStream, existsSync, mkdirSync, cpSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = join(root, 'public', 'models');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, 'public', 'wasm');
const modelFile = join(modelDir, 'pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

mkdirSync(modelDir, { recursive: true });

const HAND_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

for (const [file, url] of [
  [modelFile, MODEL_URL],
  [join(modelDir, 'hand_landmarker.task'), HAND_URL],
  [join(modelDir, 'face_landmarker.task'), 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
]) {
  if (existsSync(file)) {
    console.log(`[fetch-models] ${file.split(/[\\/]/).pop()} already present`);
    continue;
  }
  console.log(`[fetch-models] downloading ${url.split('/').pop()} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, wasmDest, { recursive: true });
  console.log('[fetch-models] wasm runtime copied');
} else {
  console.warn('[fetch-models] tasks-vision not installed yet; run npm install first');
}

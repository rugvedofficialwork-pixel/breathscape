import './style.css';
import './mist.css';
import { PoseTracker } from './tracking/pose';
import { attachStandIns } from './tracking/standins';
import { createDebug } from './debug';
import { CONFIG } from './config';
import { Drone, getMaster, initAudio } from './audio/drone';
import { Orb } from './visuals/orb';
import { HeadDebug } from './visuals/headDebug';
import { bodyShape } from './visuals/body';
import { initSpeech, cancelSpeech, speechStats } from './speech';
import { runScene1 } from './scenes/scene1';
import { getEngine, initSpatial, stopAllSpatial } from './audio/spatial';
import { hideCaption, hideHint } from './captions';
import { stageFx } from './stagefx';
import type { RunHandle } from './engine/timeline';
import { prefersReducedMotion, state } from './state';

const params = new URLSearchParams(location.search);
const debugOn = params.get('debug') === '1';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('canvas');
const stage = $('stage');
const startEl = $('start');
const beginBtn = $<HTMLButtonElement>('begin');
const statusEl = $('status');
const againBtn = $<HTMLButtonElement>('again');
const endCard = $('endcard');
const skipBtn = $<HTMLButtonElement>('skip');
const debugPanel = $('debug');
const ctx = canvas.getContext('2d')!;

const reduced = prefersReducedMotion();
const tracker = new PoseTracker();
const standIns = attachStandIns(tracker, stage);
const orb = new Orb(tracker, reduced);
orb.bodyProvider = (w, h) => (cameraOn ? bodyShape(tracker, video, w, h) : null); // particles pass behind you
const headDebug = new HeadDebug(); // experiment: the head-tilt tracking and its math, during the breathing
const drawDebug = debugOn ? createDebug(debugPanel, tracker) : null;
// Handy for poking at things from the console in debug mode
if (debugOn) (window as unknown as { __cfg: object }).__cfg = CONFIG.scene1;
if (debugOn) (window as unknown as { __door: object }).__door = { state, tracker, stageFx, get engine() { return getEngine(); }, get master() { return getMaster(); }, orbRef: orb, speechStats };
let drone = new Drone();
let runHandle: RunHandle = { aborted: false };
let cameraOn = false;

function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function startCamera(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CONFIG.camera.width, height: CONFIG.camera.height, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    return true;
  } catch {
    return false;
  }
}

let lastFrame = 0;
function loop(now: number) {
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
  lastFrame = now;
  tracker.update(now, cameraOn ? video : null);
  const r = stage.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  orb.draw(ctx, r.width, r.height, now);
  if (state.breath === 'head' && state.scene === 1 && state.part === '1') headDebug.draw(ctx, r.width, r.height, tracker, video);

  // webcam visibility: scene 1 follows the orb's dimming, later scenes ease to a target
  const target = 0.4 * (1 - orb.darkAmt);
  stageFx.video += (target - stageFx.video) * (1 - Math.exp(-dt / stageFx.tauMs));
  video.style.opacity = String(stageFx.video);

  drawDebug?.(now, ctx, r.width, r.height);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ running scenes
function resetRun() {
  runHandle.aborted = true;
  cancelSpeech();
  runHandle = { aborted: false };
  endCard.classList.add('gone');
  hideCaption();
  hideHint();
  stopAllSpatial(0.4);
  tracker.handsEnabled = true;
  orb.reset();
  drone.fadeOut(0.3);
  drone = new Drone();
  stageFx.tauMs = 700;
}

/** Welcome and breathing, then the end card. */
async function playBreathing() {
  resetRun();
  const handle = runHandle;
  skipBtn.textContent = 'Skip ▸';
  skipBtn.classList.remove('gone');
  stageFx.videoTarget = 0.4;
  await runScene1({ tracker, orb, drone }, handle);
  if (!handle.aborted) showEndCard();
}

function showEndCard() {
  skipBtn.classList.add('gone');
  state.scene = 3; state.part = 'end';
  stageFx.videoTarget = 0; stageFx.tauMs = 2500;
  hideCaption();
  endCard.classList.remove('gone');
}

skipBtn.addEventListener('click', () => { resetRun(); showEndCard(); });
againBtn.addEventListener('click', () => { resetRun(); stageFx.video = 0; void playBreathing(); });

// ------------------------------------------------------------------ start-up flow
async function start() {
  state.breath = 'head'; // the breathing follows the head
  statusEl.textContent = 'Asking for your camera…';
  cameraOn = await startCamera();
  if (cameraOn && !tracker.ready) {
    statusEl.textContent = 'Loading pose model…';
    try { await tracker.init(); } catch (err) { console.error(err); cameraOn = false; }
  }
  if (cameraOn && tracker.ready && !tracker.faceReady) {
    statusEl.textContent = 'Loading face model…';
    await tracker.initFace();
  }
  startEl.classList.add('gone');
  requestAnimationFrame(loop);
  void playBreathing();
}

beginBtn.addEventListener('click', async () => {
  beginBtn.disabled = true;
  initAudio(); // needs this user gesture
  statusEl.textContent = 'Getting the voice ready…';
  await initSpatial(state.word); // the 3D sound (off with ?spatial=0)
  await initSpeech();
  await start();
});

// ------------------------------------------------------------------ keys
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'c') void tracker.calibrate();
  if (k === 'm') standIns.toggle();
  if (k === 'h') headDebug.visible = !headDebug.visible;
  if (!debugOn) return;
  if (k === 't') {
    const i = CONFIG.timeScales.indexOf(state.timeScale as never);
    state.timeScale = CONFIG.timeScales[(i + 1) % CONFIG.timeScales.length];
  }
  if (k === 's') { resetRun(); showEndCard(); }
});

// Fake @mediapipe/tasks-vision bundle for the smoke test. It follows the real 0.10.14 API shapes used by the app.
import { SEG_LABELS } from './config.js';
const S = globalThis.__SMOKE;           // shared state set by smoke-main.mjs: { handResult(), faceResult(), personMask(), counts }
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async (_f, o) => { S.counts.handCreated.push(o.baseOptions.delegate); return { detectForVideo: () => S.handResult(), close() {} }; } };
export const FaceLandmarker = { createFromOptions: async (_f, o) => { S.counts.faceCreated.push({ delegate: o.baseOptions.delegate, opts: { ...o } }); return { detectForVideo: () => { S.counts.faceCalls++; return S.faceResult(); }, close() {} }; } };
export const ImageSegmenter = { createFromOptions: async (_f, o) => {
  S.counts.segCreated.push(o.baseOptions.delegate); let first = true;
  return { getLabels: () => SEG_LABELS, close() {}, segmentForVideo(_src, _ts, cb) {
    const W = 384, H = 216, n = W * H, flat = first; first = false; S.counts.segCalls++;
    const person = flat ? new Float32Array(n) : S.personMask(W, H), hair = flat ? new Float32Array(n) : S.hairMask(W, H);
    const bg = Float32Array.from(person, v => 1 - v), zero = new Float32Array(n);
    const bufs = [bg, hair, zero, zero, zero, zero]; cb({ confidenceMasks: bufs.map(a => ({ width: W, height: H, getAsFloat32Array: () => a })) });
  } };
} };

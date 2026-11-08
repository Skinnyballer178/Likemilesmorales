// End-to-end smoke test of main.js with a fake DOM, fake camera and fake MediaPipe models (the real model hosts are not reachable
// from the build sandbox). Usage: node smoke-main.mjs "?face=on&debug=1"   (exit code 0 = all checks passed)
import { register } from 'node:module';
import { makeFace } from './synthface.mjs';
import { frameHands, rect } from './synth.mjs';
const search = process.argv[2] ?? '';
const A = 1280 / 720, errors = [];
console.error = (...a) => { const m = a.map(String).join(' '); if (!/WebGL not available/.test(m)) errors.push(m); };   // the fake DOM has no WebGL: the window layer reports that itself
const counts = { handCreated: [], faceCreated: [], segCreated: [], faceCalls: 0, segCalls: 0 };
let frame = 0;
const faceXY = () => ({ cx: 0.5 + 0.08 * Math.sin(frame / 15), cy: 0.45 });
globalThis.__SMOKE = {
  counts,
  handResult() {                                                    // two "C" hands making a frame, so the window (and segmentation) is wanted
    const q = rect(0.7, 0.55, 0.3, 0.45, 0, A), hs = frameHands({ tl: q.tl, tr: q.tr, br: q.br, bl: q.bl }, { mirror: true });
    return { landmarks: hs.map(h => h.lm), handedness: hs.map(h => [{ categoryName: h.label, score: h.score }]) };
  },
  faceResult() { const { cx, cy } = faceXY(); const raw = makeFace({ aspect: A, cx: 1 - cx, cy, height: 0.3, yaw: 10 * Math.sin(frame / 20) }); return raw.result; },   // raw (unmirrored) camera coordinates
  personMask(W, H) { const o = new Float32Array(W * H), { cx, cy } = faceXY(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = ((x + 0.5) / W - cx) * A, dy = (y + 0.5) / H - cy; o[y * W + x] = Math.hypot(dx / 0.17, dy / 0.3) < 1 || (y / H > cy + 0.2) ? 1 : 0; } return o; },
  hairMask(W, H) { const o = new Float32Array(W * H), { cx, cy } = faceXY(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = ((x + 0.5) / W - cx) * A, dy = (y + 0.5) / H - cy; o[y * W + x] = Math.abs(dx) < 0.12 && dy < -0.10 && dy > -0.26 ? 1 : 0; } return o; },
};
register('./smoke-loader.mjs', import.meta.url);

// ---- fake DOM ----
const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const listeners = {};
const mkEl = id => { const el = { id, width: 1280, height: 720, style: {}, dataset: {}, textContent: '', hidden: false, videoWidth: 1280, videoHeight: 720, readyState: 4, currentTime: 0, getContext: () => (id === 'fx' || id === 'suit' ? null : ctx2d()), addEventListener(t, fn) { (listeners[id + ':' + t] ||= []).push(fn); }, play: async () => {}, getVideoTracks: () => [], checked: true, value: 'suit' }; return el; };
const els = {};
globalThis.document = { hidden: false, body: { dataset: {} }, getElementById: id => (els[id] ||= mkEl(id)), querySelectorAll: () => [], createElement: () => mkEl('tmp'), addEventListener() {} };
globalThis.location = { search };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node-smoke', platform: 'Linux', maxTouchPoints: 0, mediaDevices: { getUserMedia: async () => ({ getVideoTracks: () => [{ addEventListener() {}, stop() {} }], getTracks: () => [] }) } } });
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = h => clearTimeout(h);
const cam = els.cam = mkEl('cam'); cam.requestVideoFrameCallback = cb => setTimeout(() => { frame++; cam.currentTime += 1 / 30; cb(); }, 12); cam.cancelVideoFrameCallback = h => clearTimeout(h);

await import('./main.js');
listeners['start:click'][0]();                                     // press "Start camera"
await new Promise(r => setTimeout(r, 2600));                       // ~100 camera frames; the debug panel refreshes once a second
const text = els.debug.textContent, has = re => re.test(text);
const faceOn = /face=on/.test(search), dbgOn = /debug/.test(search), checks = [];
const check = (name, ok, extra = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' · ' + extra : ''}`); };
check('app is running', document.body.dataset.state === 'running', document.body.dataset.state);
check('hands model created', counts.handCreated.length === 1);
check('segmentation ran (window wanted)', counts.segCalls > 3, `${counts.segCalls} calls`);
if (faceOn) {
  check('face model created once with the expected options', counts.faceCreated.length === 1 && counts.faceCreated[0].opts.numFaces === 1 && counts.faceCreated[0].opts.outputFacialTransformationMatrixes === true);
  check('face model ran on camera frames', counts.faceCalls > 10, `${counts.faceCalls} calls`);
  if (!dbgOn) check('no debug panel without ?debug=1', text === '' || text === undefined, 'seam is not built either'); else {
  check('debug: face tracking line', has(/face: tracking · conf 1\.00/), (text.match(/face: .*/) || [''])[0]);
  check('debug: face pose line', has(/face pose: yaw -?\d+ \(landmarks -?\d+\) pitch -?\d+ roll -?\d+ · \w+/), (text.match(/face pose: .*/) || [''])[0]);
  check('debug: seam line with mask and hair', has(/seam: coverage [1-9][\d.]*% .* mask yes · hair yes/), (text.match(/seam: .*/) || [''])[0]);
  check('debug: seam hair cut and person clip are live numbers', has(/hair cut (?!0\.00%)/), '');
  }
} else if (/face=off/.test(search)) {
  check('?face=off: face model NOT created and never called', counts.faceCreated.length === 0 && counts.faceCalls === 0);
  check('?face=off: no face lines in the debug panel', !has(/face/));
} else {
  // S8: the face model is part of the boot (FACE.enabled) but only RUNS while the mask gesture needs it (outfit worn) or when debugging
  check('face model created at boot (FACE.enabled)', counts.faceCreated.length === 1);
  if (dbgOn) check('?debug=1: face model runs for the debug view', counts.faceCalls > 10, `${counts.faceCalls} calls`);
  else check('face model idle until an outfit is worn (no WebGL here, so only the 2 warm-up calls)', counts.faceCalls <= 2, `${counts.faceCalls} calls`);
}
if (dbgOn) check('debug: mask line shows the idle mask state', has(/mask: hidden 0% · idle \(/), (text.match(/mask: .*/) || [''])[0]);
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('\n' + text.split('\n').join('\n  '));
process.exit(checks.every(Boolean) ? 0 : 1);

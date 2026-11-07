import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFaceOverlay } from './faceoverlay.js';
import { createFaceTracker, normalizeFaceResult } from './facelm.js';
import { buildSeam } from './faceseam.js';
import { makeFace } from './synthface.mjs';

const A = 16 / 9;
const fakeCtx = () => { const calls = {}; return { calls, proxy: new Proxy({}, { get: (_, k) => (k === 'canvas' ? null : (...a) => { calls[k] = (calls[k] || 0) + 1; return k === 'createImageData' ? { data: new Uint8ClampedArray(a[0] * a[1] * 4) } : undefined; }), set: () => true }) }; };
const fakeCanvas = () => { const c = fakeCtx(); return { width: 0, height: 0, getContext: () => c.proxy }; };

test('overlay: draws the outline, axis, markers, text and the seam tint; draws nothing for no face; never throws', () => {
  const face = createFaceTracker().update(normalizeFaceResult(makeFace({ aspect: A }).result), 0, { mirror: true, aspect: A });
  const seam = buildSeam({ face, aspect: A });
  const c = fakeCtx(); drawFaceOverlay(c.proxy, 1280, 720, face, seam, fakeCanvas);
  assert.ok(c.calls.stroke >= 2 && c.calls.arc >= 4 && c.calls.fillText === 1 && c.calls.drawImage === 1, JSON.stringify(c.calls));
  const d = fakeCtx(); drawFaceOverlay(d.proxy, 1280, 720, { present: false }, null, fakeCanvas); drawFaceOverlay(d.proxy, 1280, 720, null, null, fakeCanvas);
  assert.deepEqual(d.calls, {});
  const e = fakeCtx(); drawFaceOverlay(e.proxy, 1280, 720, face, null, fakeCanvas); assert.ok(!e.calls.drawImage, 'no seam = no tint');
});

// The real model cannot run here (no network to the model host), so the loader is tested against a fake FaceLandmarker that follows
// the tasks-vision 0.10.14 API: createFromOptions-like create(), detectForVideo(video, ts) -> { faceLandmarks, facialTransformationMatrixes: [{rows, columns, data}] }.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceDetector, pickFaceDelegate } from './facetracker.js';
import { FACE } from './config.js';
import { makeFace } from './synthface.mjs';

// behaviour: (delegate) => { createError?, frame(video, delegate) -> result | 'throw' }
function fakeApi(behaviour) {
  const log = { created: [], closed: 0, timestamps: [], calls: 0 };
  return { log, api: { create: async delegate => {
    log.created.push(delegate); const b = behaviour(delegate);
    if (b.createError) throw new Error(b.createError);
    return { close: () => { log.closed++; }, detectForVideo(video, ts) { log.calls++; log.timestamps.push(ts); const r = b.frame(video, delegate); if (r === 'throw') throw new Error('gl error'); return r; } };
  } } };
}
const face = makeFace({}).result, none = { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] };
const mk = (b, o = {}) => { const f = fakeApi(b); let t = 0; const statuses = []; const d = createFaceDetector({ loadApi: async () => f.api, nav: {}, search: '', onStatus: (s, n) => statuses.push(s), now: () => (t += 3), ...o }); return { d, f, statuses }; };
const quiet = fn => { const e = console.error, w = console.warn; console.error = console.warn = () => {}; return Promise.resolve(fn()).finally(() => { console.error = e; console.warn = w; }); };

test('delegate choice: GPU by default, CPU on iOS/iPadOS, ?facedelegate overrides', () => {
  assert.equal(pickFaceDelegate({ nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' } }), 'GPU');
  assert.equal(pickFaceDelegate({ nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' } }), 'CPU');
  assert.equal(pickFaceDelegate({ nav: { platform: 'MacIntel', maxTouchPoints: 5 } }), 'CPU');
  assert.equal(pickFaceDelegate({ nav: { platform: 'MacIntel', maxTouchPoints: 0 } }), 'GPU');
  assert.equal(pickFaceDelegate({ nav: {}, search: '?facedelegate=cpu' }), 'CPU');
  assert.equal(pickFaceDelegate({ nav: { userAgent: 'iPhone' }, search: '?facedelegate=gpu' }), 'GPU');
});

test('load + detect: ready status, a face comes back as plain data, no face = null, nothing before load = undefined', async () => {
  const { d, f, statuses } = mk(() => ({ frame: () => face }));
  assert.equal(d.detect({}), undefined, 'not loaded yet');
  assert.ok(await d.load()); assert.equal(d.status, 'ready'); assert.deepEqual(f.log.created, ['GPU']); assert.ok(statuses.includes('loading'));
  const r = d.detect({}); assert.equal(r.pts.length, 478); assert.equal(r.matrix.length, 16);
  let phase = 'face'; const g = mk(() => ({ frame: () => (phase === 'face' ? face : none) }));
  await g.d.load(); assert.ok(g.d.detect({})); phase = 'none'; assert.equal(g.d.detect({}), null);
  assert.equal(g.d.detections, 1); assert.equal(g.d.empty, 1);
});

test('GPU load failure falls back to CPU once; CPU failing too = failed, and detect stays quiet', async () => quiet(async () => {
  const a = mk(d => ({ createError: d === 'GPU' ? 'no webgl' : null, frame: () => face }));
  assert.ok(await a.d.load()); assert.deepEqual(a.f.log.created, ['GPU', 'CPU']); assert.equal(a.d.delegate, 'CPU'); assert.equal(a.d.status, 'ready');
  const b = mk(() => ({ createError: 'broken', frame: () => face }));
  assert.equal(await b.d.load(), false); assert.equal(b.d.status, 'failed'); assert.equal(b.d.detect({}), undefined);
}));

test('run-time errors: single errors are tolerated, repeated ones switch GPU -> CPU once, then give up', async () => quiet(async () => {
  let calls = 0;
  const { d, f } = mk(del => ({ frame: () => { if (del === 'GPU') { calls++; if (calls >= 2) return 'throw'; } return face; } }));
  await d.load(); assert.ok(d.detect({}));
  for (let i = 0; i < FACE.maxErrors; i++) assert.equal(d.detect({}), undefined);
  await new Promise(r => setTimeout(r, 10)); assert.equal(d.status, 'ready'); assert.equal(d.delegate, 'CPU'); assert.deepEqual(f.log.created, ['GPU', 'CPU']);
  assert.ok(d.detect({}), 'works again on CPU');
  const h = mk(() => ({ frame: () => 'throw' })); await h.d.load();
  const burst = async () => { for (let i = 0; i < FACE.maxErrors + 1; i++) h.d.detect({}); await new Promise(r => setTimeout(r, 10)); };
  await burst(); assert.equal(h.d.status, 'ready'); assert.equal(h.d.delegate, 'CPU');          // first failure burst: GPU -> CPU
  await burst(); assert.equal(h.d.status, 'failed'); assert.equal(h.d.detect({}), undefined);   // CPU fails too: give up, never loop
  assert.deepEqual(h.f.log.created, ['GPU', 'CPU']);
}));

test('output in a shape we do not understand counts as an error (and recovers when it stops)', async () => quiet(async () => {
  const badFrame = { faceLandmarks: [new Array(10).fill({ x: 0, y: 0, z: 0 })] };
  let bad = true; const { d } = mk(() => ({ frame: () => (bad ? badFrame : face) }));
  await d.load(); assert.equal(d.detect({}), undefined); assert.equal(d.detect({}), undefined);
  bad = false; assert.ok(d.detect({})); bad = true; assert.equal(d.detect({}), undefined); assert.equal(d.status, 'ready', 'errors were reset by the good frame');
}));

test('timestamps are strictly increasing even when the clock stalls or goes back', async () => {
  let t = 100; const f = fakeApi(() => ({ frame: () => face })); const d = createFaceDetector({ loadApi: async () => f.api, nav: {}, search: '', now: () => t });
  await d.load(); for (let i = 0; i < 6; i++) { d.detect({}); if (i === 3) t -= 50; }
  for (let i = 1; i < f.log.timestamps.length; i++) assert.ok(f.log.timestamps[i] > f.log.timestamps[i - 1]);
});

test('cadence governor: slow inference makes it run every 2nd/3rd frame (skipped frames return undefined), and it recovers', async () => {
  let cost = 40; let t = 0;
  const f = fakeApi(() => ({ frame: () => { t += cost; return face; } })), d = createFaceDetector({ loadApi: async () => f.api, nav: {}, search: '', now: () => t });
  await d.load();
  for (let i = 0; i < 60; i++) d.detect({});
  assert.equal(d.every, FACE.governor.maxEvery, 'slow = every 3rd frame');
  const before = f.log.calls; let ran = 0; for (let i = 0; i < 30; i++) if (d.detect({}) !== undefined) ran++;
  assert.equal(ran, 10); assert.equal(f.log.calls - before, 10);
  cost = 2; for (let i = 0; i < 200; i++) d.detect({}); assert.equal(d.every, 1);
});

test('options reach the model: one face, matrices on, blendshapes off; pause() restarts the cadence; close() frees the model', async () => {
  assert.equal(FACE.options.numFaces, 1); assert.equal(FACE.options.outputFacialTransformationMatrixes, true); assert.equal(FACE.options.outputFaceBlendshapes, false);
  const { d, f } = mk(() => ({ frame: () => face })); await d.load(); d.detect({}); d.pause(); assert.ok(d.detect({}) !== undefined, 'first frame after pause runs');
  d.close(); assert.equal(f.log.closed, 1); assert.equal(d.status, 'idle'); assert.equal(d.detect({}), undefined);
});

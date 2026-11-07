// The real model cannot run here (no network to the model host), so the loader is tested against a fake ImageSegmenter
// that follows the real tasks-vision 0.10.14 API: createFromOptions-like create(), getLabels(), segmentForVideo(image, ts, callback),
// confidenceMasks[i].getAsFloat32Array(), and masks that are only valid DURING the callback (the fake wipes them afterwards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSegmenter, pickDelegate, isIOS } from './segmenter.js';
import { SEG, SEG_LABELS } from './config.js';
import { personMask } from './synthmask.mjs';

const W = SEG.inputWidth, H = SEG.inputHeight;
const canvasFactory = () => ({ width: W, height: H, getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }) });
const hand = (x, y) => ({ score: 0.95, pts: Array.from({ length: 21 }, () => ({ x, y })) });

// behaviour: (delegate) => { labels, frame(imageSource) -> Float32Array person confidence or 'throw' }
function fakeApi(behaviour) {
  const log = { created: [], closed: 0, calls: [], timestamps: [] };
  return { log, api: {
    create: async delegate => {
      log.created.push(delegate); const b = behaviour(delegate);
      if (b.createError) throw new Error(b.createError);
      return {
        getLabels: () => b.labels ?? SEG_LABELS,
        close: () => { log.closed++; },
        segmentForVideo(src, ts, cb) {
          log.timestamps.push(ts);
          const person = b.frame(src, delegate); if (person === 'throw') throw new Error('gpu readback failed');
          const bg = Float32Array.from(person, v => 1 - v), zero = new Float32Array(person.length);
          const bufs = [bg, zero, zero, zero, zero, zero];
          const masks = bufs.map(a => ({ width: W, height: H, getAsFloat32Array: () => a }));
          cb({ confidenceMasks: masks });
          bufs.forEach(a => a.fill(NaN));                // MediaPipe owns these only during the callback: anything kept must have been copied
        },
      };
    },
  } };
}
const flat = () => new Float32Array(W * H);                     // no person
const person = (cx = 0.5) => personMask(W, H, { cx });
const mk = (b, o = {}) => { const f = fakeApi(b); let t = 0; const statuses = []; const s = createSegmenter({ loadApi: async () => f.api, makeCanvas: canvasFactory, nav: {}, search: '', onStatus: (st, n) => statuses.push(st), now: () => (t += 3), ...o }); return { s, f, statuses }; };

test('delegate choice: GPU by default, CPU on iPhone/iPad (incl. iPadOS as Mac), URL override wins', () => {
  assert.equal(pickDelegate({ nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, search: '' }), 'GPU');
  assert.equal(pickDelegate({ nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } }), 'CPU');
  assert.equal(pickDelegate({ nav: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 } }), 'CPU');
  assert.equal(pickDelegate({ nav: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 } }), 'GPU');
  assert.equal(pickDelegate({ nav: { userAgent: 'iPhone' }, search: '?segdelegate=gpu' }), 'GPU');
  assert.equal(pickDelegate({ nav: {}, search: '?segdelegate=cpu' }), 'CPU');
  assert.ok(isIOS({ userAgent: 'iPad'}));
});

test('load: healthy model passes the self-test on the first delegate', async () => {
  const { s, f, statuses } = mk(() => ({ frame: flat }));
  assert.equal(await s.load(), true);
  assert.equal(s.status, 'ready'); assert.deepEqual(f.log.created, ['GPU']); assert.deepEqual(statuses.slice(0, 3), ['loading', 'testing', 'ready']);
});

test('load: GPU that returns a wrong category order (flat picture = all person) falls back to CPU, which is fine', async () => {
  const { s, f } = mk(d => ({ frame: d === 'GPU' ? () => new Float32Array(W * H).fill(1) : flat }));
  assert.equal(await s.load(), true);
  assert.deepEqual(f.log.created, ['GPU', 'CPU']); assert.equal(s.delegate, 'CPU'); assert.ok(f.log.closed >= 1, 'the failed GPU model was closed');
});

test('load: GPU that cannot even start falls back to CPU; failing on CPU as well ends in "failed" (no endless loop)', async () => {
  let r = mk(d => (d === 'GPU' ? { createError: 'no webgl2' } : { frame: flat }));
  assert.equal(await r.s.load(), true); assert.equal(r.s.delegate, 'CPU');
  r = mk(() => ({ frame: () => new Float32Array(W * H).fill(1) }));
  assert.equal(await r.s.load(), false); assert.equal(r.s.status, 'failed'); assert.deepEqual(r.f.log.created, ['GPU', 'CPU']);
  r = mk(() => ({ createError: 'model 404' }));
  assert.equal(await r.s.load(), false); assert.equal(r.s.status, 'failed');
});

test('load: unexpected labels are a hard failure on every delegate; missing labels are tolerated; ?segtest=off skips the test', async () => {
  let r = mk(() => ({ frame: flat, labels: ['person', 'background'] }));
  assert.equal(await r.s.load(), false); assert.match(r.s.note, /labels|expected/);
  r = mk(() => ({ frame: flat, labels: [] })); assert.equal(await r.s.load(), true);
  r = mk(() => ({ frame: () => new Float32Array(W * H).fill(1) }), { search: '?segtest=off' }); assert.equal(await r.s.load(), true);
});

test('process: returns a packed display-orientation mask, copies data out of the callback, timestamps strictly increase', async () => {
  let real = false; const { s, f } = mk(() => ({ frame: () => (real ? person(0.3) : flat()) }));   // the self-test frame must be background
  await s.load(); real = true;
  let m; for (let i = 0; i < 6; i++) m = s.process({ /* the display canvas */ }, 1000 + i * 33, []);
  assert.ok(m && m.w === W && m.h === H && m.data.length === W * H * 4);
  assert.ok(m.data.every(v => v === v && v >= 0 && v <= 255), 'no NaN: the data was copied before the model wiped its buffers');
  const at = (cx, y) => m.data[(y * W + Math.round(cx * H * (16 / 9) / (H * 16 / 9) * W)) * 4] / 255;   // R channel at picture-x cx, row y
  assert.ok(at(0.3, H - 5) > 0.9 && at(0.9, H - 5) < 0.1 && at(0.3, 3) < 0.1, 'the person is where it was drawn: low left of centre, not at the right, not at the top');
  const ts = f.log.timestamps; for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], 'timestamps strictly increase');
  assert.ok(s.avgMs >= 0);
});

test('process: nothing before the model is ready; a slow model makes the governor skip frames', async () => {
  const { s } = mk(() => ({ frame: flat }));
  assert.equal(s.process({}, 0, []), null);
  let clock = 0; const f = fakeApi(() => ({ frame: flat }));
  const slow = createSegmenter({ loadApi: async () => f.api, makeCanvas: canvasFactory, nav: {}, search: '', now: () => (clock += 20) }); // every inference "takes" 20 ms
  await slow.load(); let ran = 0;
  for (let i = 0; i < 60; i++) if (slow.process({}, i * 33, [])) ran++;
  console.log(`# slow model (20 ms): governor runs it every ${slow.every} frame(s), ${ran} of 60`);
  assert.ok(slow.every >= 2 && ran < 45);
});

test('runtime errors: three in a row on GPU switch to CPU; on CPU the segmenter gives up quietly (process keeps returning null)', async () => {
  let breakGpu = false; const { s, f } = mk(d => ({ frame: () => (d === 'GPU' && breakGpu ? 'throw' : flat()) }));
  await s.load(); breakGpu = true;
  for (let i = 0; i < 5; i++) s.process({}, i * 33, []);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(f.log.created, ['GPU', 'CPU']); assert.equal(s.status, 'ready'); assert.equal(s.delegate, 'CPU');
  // CPU failing as well: gives up
  const g = fakeApi(() => ({ frame: flat })); let boom = false; const base = g.api.create;
  g.api.create = async d => { const m = await base(d); const seg = m.segmentForVideo; m.segmentForVideo = (...a) => { if (boom) throw new Error('x'); return seg.apply(m, a); }; return m; };
  const s4 = createSegmenter({ loadApi: async () => g.api, makeCanvas: canvasFactory, nav: {}, search: '?segdelegate=cpu', now: (() => { let t = 0; return () => (t += 33); })() });
  await s4.load(); boom = true; for (let i = 0; i < 6; i++) assert.equal(s4.process({}, i * 33, []), null);
  assert.equal(s4.status, 'failed');
});

test('live hand cross-check: a mask that ignores the hands switches GPU->CPU once, then is marked suspect and stops producing masks', async () => {
  let real = false;
  const { s, f } = mk(() => ({ frame: () => (real ? flat() : flat()) }));           // model says "nobody there" even on real frames
  await s.load(); real = true; let m = 'init';
  for (let i = 0; i < 60; i++) { m = s.process({}, 1000 + i * 33, [hand(0.5, 0.5)]); await new Promise(r => setImmediate(r)); }
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(f.log.created, ['GPU', 'CPU'], 'tried CPU exactly once');
  for (let i = 0; i < 80; i++) { m = s.process({}, 5000 + i * 33, [hand(0.5, 0.5)]); await new Promise(r => setImmediate(r)); }
  assert.equal(s.status, 'suspect'); assert.equal(m, null);
  assert.equal(f.log.created.length, 2, 'no endless reload loop');
});

test('live hand cross-check: a correct mask with hands in view stays ready and reports its agreement', async () => {
  let real = false; const { s } = mk(() => ({ frame: () => (real ? person(0.5) : flat()) }));
  await s.load(); real = true;
  for (let i = 0; i < 60; i++) s.process({}, 1000 + i * 33, [hand(0.5, 0.75)]);        // palm in the shoulders region of the synthetic person
  assert.equal(s.status, 'ready'); assert.ok(s.agreement >= 0.9, `agreement ${s.agreement}`); assert.equal(s.verdict, 'ok');
});

test('pause() makes the next mask start fresh (no blending with the stale one)', async () => {
  let level = 0; const { s } = mk(() => ({ frame: () => new Float32Array(W * H).fill(level) }));
  level = 0; await s.load();                                    // flat test: level 0 = background
  level = 0.5; s.process({}, 1000, []); level = 0.55;
  const blended = s.process({}, 1033, []).data[0];              // smoothed toward 0.55 but not there yet
  assert.ok(blended < Math.round(0.55 * 255) && blended > Math.round(0.5 * 255) - 1);
  s.pause();
  assert.equal(s.process({}, 1066, []).data[0], Math.round(Math.fround(0.55) * 255), 'after pause the new mask is taken as is');
});

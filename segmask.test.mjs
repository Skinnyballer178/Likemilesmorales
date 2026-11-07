import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLabels, evaluateFlatTest, flatStats, readLayers, createMaskSmoother, maskFresh, palmCentre, sampleMask, createHandAgreement, createGovernor, CHANNEL } from './segmask.js';
import { SEG, SEG_LABELS } from './config.js';
import { personMask } from './synthmask.mjs';
import { rng, gauss } from './synth.mjs';

const MW = 96, MH = 54, FR = 1000 / 30;
const fakeMPMask = arr => ({ width: MW, height: MH, getAsFloat32Array: () => arr });
const std = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const px = (mask, x, y, ch = 0) => mask.data[(y * mask.w + x) * 4 + ch] / 255;

test('labels check: the expected 6 labels pass; wrong count, wrong order, missing are reported', () => {
  assert.ok(checkLabels(SEG_LABELS).ok);
  assert.ok(checkLabels(['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others']).ok);
  assert.equal(checkLabels(['person', 'background']).ok, false);
  assert.equal(checkLabels(['hair', 'background', 'body-skin', 'face-skin', 'clothes', 'others']).ok, false);
  const none = checkLabels([]); assert.equal(none.ok, false); assert.ok(none.unknown);   // "unknown" is not treated as a hard failure by the glue
  assert.ok(checkLabels(undefined).unknown);
});

test('flat-picture test: background passes; inverted categories, NaN, wrong size and a phantom person fail', () => {
  const n = MW * MH, mk = v => new Float32Array(n).fill(v);
  assert.ok(evaluateFlatTest(flatStats(mk(0.98), MW, MH, MW, MH)).ok);
  assert.equal(evaluateFlatTest(flatStats(mk(0.02), MW, MH, MW, MH)).ok, false);           // categories flipped: flat picture = all person
  const nan = mk(0.9); nan[5] = NaN; assert.equal(evaluateFlatTest(flatStats(nan, MW, MH, MW, MH)).ok, false);
  assert.equal(evaluateFlatTest(flatStats(mk(0.98), MW, MH, MW * 2, MH)).ok, false);       // wrong mask size
  const blob = mk(0.98); for (let i = 0; i < n * 0.4; i++) blob[i] = 0.05;
  assert.equal(evaluateFlatTest(flatStats(blob, MW, MH, MW, MH)).ok, false);               // 40% phantom person
  const ok = mk(0.98); for (let i = 0; i < n * 0.05; i++) ok[i] = 0.2; assert.ok(evaluateFlatTest(flatStats(ok, MW, MH, MW, MH)).ok); // a little noise is fine
});

test('readLayers: person = 1 - background, other layers only when asked, data is copied', () => {
  const n = MW * MH, bg = new Float32Array(n).fill(0.25), hair = new Float32Array(n).fill(0.1), b2 = new Float32Array(n).fill(0.3), f3 = new Float32Array(n).fill(0.2), cl = new Float32Array(n).fill(0.15);
  let reads = []; const masks = [bg, hair, b2, f3, cl, new Float32Array(n)].map((a, i) => ({ width: MW, height: MH, getAsFloat32Array: () => { reads.push(i); return a; } }));
  let L = readLayers(masks, ['person']);
  assert.deepEqual(reads, [0], 'only the background mask is read for the person layer');
  assert.ok(Math.abs(L.person[0] - 0.75) < 1e-6 && L.hair === undefined);
  bg.fill(0); assert.ok(Math.abs(L.person[0] - 0.75) < 1e-6, 'must not alias the model buffer');
  bg.fill(0.25); reads = [];
  L = readLayers(masks, ['person', 'hair', 'skin', 'clothes']);
  assert.ok(Math.abs(L.hair[3] - 0.1) < 1e-6 && Math.abs(L.skin[3] - 0.5) < 1e-6 && Math.abs(L.clothes[3] - 0.15) < 1e-6);
  assert.deepEqual([...new Set(reads)].sort(), [0, 1, 2, 3, 4]);
});

test('smoother: edge flicker is calmed a lot, but a static silhouette stays where it is', () => {
  const sm = createMaskSmoother(), truth = personMask(MW, MH, { cx: 0.5 });
  const rawDev = [], smDev = []; let last;
  for (let f = 0; f < 90; f++) {
    const noisy = personMask(MW, MH, { cx: 0.5, noise: 0.22, seed: f + 1 });             // edge pixels flicker by +-0.22
    last = sm.update({ person: noisy }, MW, MH, f * FR);
    if (f >= 30) for (let i = 0; i < truth.length; i++) if (truth[i] > 0.1 && truth[i] < 0.9) { rawDev.push(noisy[i] - truth[i]); smDev.push(last.data[i * 4] / 255 - truth[i]); }
  }
  const r = std(rawDev), s = std(smDev);
  console.log(`# edge pixel deviation from truth: raw ${r.toFixed(3)}, smoothed ${s.toFixed(3)} (${(100 * (1 - s / r)).toFixed(0)}% less)`);
  assert.ok(s < r * 0.6, 'smoothing should remove most of the flicker');
  // interior and far background unchanged
  assert.ok(Math.abs(px(last, MW / 2 | 0, MH - 3) - 1) < 0.02 && px(last, 2, 2) < 0.02);
});

test('smoother: real movement is followed at once (no ghost), and a person leaving disappears in a few frames', () => {
  const sm = createMaskSmoother(); let m;
  const empty = new Float32Array(MW * MH), full = personMask(MW, MH, { cx: 0.5 });
  for (let f = 0; f < 10; f++) m = sm.update({ person: empty }, MW, MH, f * FR);
  m = sm.update({ person: full }, MW, MH, 10 * FR);                                      // person steps in
  assert.ok(px(m, MW / 2 | 0, MH - 3) > 0.9, `entering: interior reached ${px(m, MW / 2 | 0, MH - 3).toFixed(2)} on the first frame`);
  for (let f = 11; f < 20; f++) m = sm.update({ person: full }, MW, MH, f * FR);
  let frames = 0;
  while (frames < 10) { m = sm.update({ person: empty }, MW, MH, (20 + frames) * FR); frames++; if (px(m, MW / 2 | 0, MH - 3) < 0.05) break; }
  console.log(`# person leaves: mask gone after ${frames} frame(s)`);
  assert.ok(frames <= 3, `ghost lasted ${frames} frames`);
});

test('smoother: a moving silhouette keeps a high overlap with the truth (IoU) and beats raw jittery masks', () => {
  const sm = createMaskSmoother(), iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k] > 0.5, y = b[k] > 0.5; if (x && y) i++; if (x || y) u++; } return i / u; };
  const rawI = [], smI = [];
  for (let f = 0; f < 120; f++) {
    const cx = 0.5 + 0.2 * Math.sin(f / 18), truth = personMask(MW, MH, { cx }), noisy = personMask(MW, MH, { cx, noise: 0.3, seed: f + 5 });
    const m = sm.update({ person: noisy }, MW, MH, f * FR);
    if (f > 20) { rawI.push(iou(noisy, truth)); smI.push(iou(Float32Array.from({ length: truth.length }, (_, k) => m.data[k * 4] / 255), truth)); }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`# moving person IoU vs truth: raw ${avg(rawI).toFixed(3)}, smoothed ${avg(smI).toFixed(3)}`);
  assert.ok(avg(smI) > 0.93 && avg(smI) >= avg(rawI) - 0.005);
});

test('smoother: frame-rate independent, resets on size change or a long gap, rejects bad layer sizes', () => {
  const a = createMaskSmoother(), b = createMaskSmoother();
  const lo = new Float32Array(MW * MH).fill(0.5), hi = new Float32Array(MW * MH).fill(0.6);
  a.update({ person: lo }, MW, MH, 0); b.update({ person: lo }, MW, MH, 0);
  let ma, mb;
  for (let t = 16.7; t <= 200; t += 16.7) ma = a.update({ person: hi }, MW, MH, t);           // 60 fps
  for (let t = 50; t <= 200; t += 50) mb = b.update({ person: hi }, MW, MH, t);              // 20 fps
  assert.ok(Math.abs(ma.data[0] - mb.data[0]) <= 3, `60 fps ${ma.data[0]} vs 20 fps ${mb.data[0]} after the same 200 ms`);
  const m1 = a.update({ person: lo }, MW, MH, 200 + 5000);                                     // long gap: starts from the new mask
  assert.equal(m1.data[0], Math.round(0.5 * 255));
  const half = new Float32Array((MW / 2) * (MH / 2)).fill(0.7);
  const m2 = a.update({ person: half }, MW / 2, MH / 2, 5100 + 1);                             // size change: starts fresh at the new size
  assert.equal(m2.w, MW / 2); assert.equal(m2.data[0], Math.round(Math.fround(0.7) * 255));
  assert.throws(() => a.update({ person: new Float32Array(5) }, MW, MH, 6000));
});

test('packing: channels land in R, G, B, A; layers that are off stay zero; values stay 0..255', () => {
  const sm = createMaskSmoother(), n = MW * MH, f = v => new Float32Array(n).fill(v);
  const m = sm.update({ person: f(1), hair: f(0.5), clothes: f(0.2), skin: f(2) /* out of range: clamped */ }, MW, MH, 0);
  assert.deepEqual([...m.data.slice(0, 4)], [255, Math.round(127.5), 255, Math.round(51)]);
  assert.equal(CHANNEL.person, 0);
  const m2 = createMaskSmoother().update({ person: f(0.3) }, MW, MH, 0);
  assert.deepEqual([...m2.data.slice(0, 4)], [Math.round(76.5), 0, 0, 0]);
  assert.equal(m.data.length, n * 4); assert.equal(m.seq, 1);
});

test('maskFresh: a mask older than staleMs is no longer used', () => {
  assert.ok(maskFresh(1000, 500)); assert.ok(maskFresh(1500, 500, 1000)); assert.equal(maskFresh(1501, 500, 1000), false); assert.equal(maskFresh(10, null), false);
});

// ---- live hand cross-check ----
const handAt = (x, y, score = 0.95) => ({ score, pts: Array.from({ length: 21 }, () => ({ x, y })) });
const blobMask = (cx, cy, rad = 0.1) => ({ w: MW, h: MH, data: Uint8Array.from({ length: MW * MH * 4 }, (_, i) => { if (i % 4) return 0; const k = i / 4, x = (k % MW + 0.5) / MW, y = (k / MW | 0) / MH + 0.5 / MH; return Math.hypot((x - cx) * 16 / 9, y - cy) < rad ? 255 : 0; }) });

test('hand cross-check: agrees when palms are inside the mask, flags a mask that ignores hands', () => {
  const good = createHandAgreement(), bad = createHandAgreement(), r = rng(3);
  for (let i = 0; i < 60; i++) {
    const x = 0.3 + 0.4 * r(), y = 0.3 + 0.4 * r();
    good.add(blobMask(x, y), [handAt(x, y)]);                      // person mask is where the hand is
    bad.add(blobMask(1 - x, 1 - y, 0.05), [handAt(x, y)]);          // person mask is elsewhere (or inverted)
  }
  console.log(`# hand agreement: good mask ${good.rate.toFixed(2)}, broken mask ${bad.rate.toFixed(2)}`);
  assert.equal(good.verdict, 'ok'); assert.equal(bad.verdict, 'suspect');
  const few = createHandAgreement(); few.add(blobMask(0.5, 0.5), [handAt(0.5, 0.5)]); assert.equal(few.verdict, 'unknown', 'no verdict from a handful of samples');
});

test('hand cross-check ignores weak or edge-of-picture hands, and recovers (rolling window)', () => {
  const a = createHandAgreement({ minSamples: 10, window: 20 });
  for (let i = 0; i < 30; i++) a.add(blobMask(0.5, 0.5), [handAt(0.5, 0.5, 0.3), handAt(0.995, 0.5), handAt(0.5, 0.5, 0.9)]);
  assert.equal(a.samples, 20); assert.equal(a.rate, 1);
  for (let i = 0; i < 30; i++) a.add(blobMask(0.9, 0.9, 0.02), [handAt(0.5, 0.5)]);
  assert.equal(a.verdict, 'suspect');
  for (let i = 0; i < 30; i++) a.add(blobMask(0.5, 0.5), [handAt(0.5, 0.5)]);
  assert.equal(a.verdict, 'ok');
  assert.deepEqual(palmCentre(handAt(0.4, 0.6)), { x: 0.4, y: 0.6 });
  assert.equal(sampleMask(blobMask(0.5, 0.5), 0.5, 0.5), 1);
});

test('governor: stays at every frame when fast, backs off when slow, steps back down with hysteresis', () => {
  const g = createGovernor();
  for (let i = 0; i < 20; i++) { assert.ok(g.tick()); g.report(5); }
  assert.equal(g.every, 1);
  for (let i = 0; i < 20; i++) g.report(26); assert.equal(g.every, 3, 'slow model: every 3rd frame (cap)');
  const runs = Array.from({ length: 9 }, () => g.tick()).filter(Boolean).length; assert.equal(runs, 3);
  for (let i = 0; i < 60; i++) g.report(4); assert.equal(g.every, 1, 'fast again');
  const h = createGovernor(); for (let i = 0; i < 40; i++) h.report(12.5); const e = h.every; for (let i = 0; i < 40; i++) h.report(12.5); assert.equal(h.every, e, 'stable at the boundary, no flapping');
  const cap = createGovernor(); for (let i = 0; i < 30; i++) cap.report(500); assert.equal(cap.every, SEG.governor.maxEvery);
});

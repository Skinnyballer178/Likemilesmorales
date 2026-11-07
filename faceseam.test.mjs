import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeam, featherAt, seamPolygon } from './faceseam.js';
import { createFaceTracker, normalizeFaceResult, fromHead, toHead, FACE_OVAL } from './facelm.js';
import { SEAM } from './config.js';
import { makeFace } from './synthface.mjs';

const A = 16 / 9, { w: GW, h: GH } = SEAM.grid;
const snap = (opt = {}, mirror = false) => createFaceTracker().update(normalizeFaceResult(makeFace({ aspect: A, ...opt }).result), 0, { mirror, aspect: A });
const at = (map, p) => { const x = Math.min(map.w - 1, Math.max(0, Math.floor(p.x * map.w))), y = Math.min(map.h - 1, Math.max(0, Math.floor(p.y * map.h))); return map.data[y * map.w + x] / 255; };
const atHead = (map, face, s, t) => at(map, fromHead(face.head, s, t));
const mkMask = (w, h, { person = () => 1, hair = () => 0 } = {}) => { const data = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const nx = (x + 0.5) / w, ny = (y + 0.5) / h, o = (y * w + x) * 4; data[o] = Math.round(255 * person(nx, ny)); data[o + 1] = Math.round(255 * hair(nx, ny)); } return { w, h, data, seq: 1 }; };
// width (in face heights) over which alpha falls from 0.9 to 0.1 walking outward along the head axis (dir +1 = up past the forehead, -1 = down past the chin)
const transition = (map, face, dir, from) => { let hi = null, lo = null; for (let k = 0; k <= 400; k++) { const t = from + dir * k * 0.002, a = atHead(map, face, 0, t); if (hi === null && a < 0.9) hi = k * 0.002; if (lo === null && a < 0.1) { lo = k * 0.002; break; } } return { hi, lo, width: lo - hi }; };

test('featherAt: rows are hit exactly and blended smoothly, widest at the neck and tightest at the hairline', () => {
  for (const [t, w, b] of SEAM.feather) { const f = featherAt(t); assert.ok(Math.abs(f.width - w) < 1e-12 && Math.abs(f.bias - b) < 1e-12); }
  assert.ok(featherAt(1.4).width === SEAM.feather[0][1] && featherAt(-0.3).width === SEAM.feather.at(-1)[1], 'clamped outside the range');
  let prev = featherAt(1).width; for (let t = 1; t >= 0; t -= 0.02) { const w = featherAt(t).width; assert.ok(w >= prev - 1e-12, 'never narrows going down the face'); prev = w; }
  assert.ok(featherAt(0).width > featherAt(1).width * 2.5);
});

test('shape: full in the middle, nothing far outside, steady falloff, bbox wraps the region', () => {
  const f = snap({ cx: 0.5, cy: 0.45, height: 0.3 }), m = buildSeam({ face: f, aspect: A });
  assert.ok(atHead(m, f, 0, 0.5) > 0.99 && atHead(m, f, 0.2, 0.6) > 0.99 && atHead(m, f, -0.2, 0.3) > 0.9);
  assert.equal(atHead(m, f, 0, 1.4), 0); assert.equal(atHead(m, f, 0.9, 0.5), 0); assert.equal(atHead(m, f, 0, -0.5), 0);
  let prev = 1; for (let t = 0.5; t <= 1.4; t += 0.01) { const a = atHead(m, f, 0, t); assert.ok(a <= prev + 0.02, `monotone up the face at t=${t.toFixed(2)}`); prev = a; }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (m.data[y * GW + x]) { const b = m.bbox; assert.ok(x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1); }
  assert.ok(m.bbox.x0 > 0 && m.bbox.x1 < GW && m.stats.coverage > 0.01);
  const half = [...m.data].filter(v => v >= 128).length / (GW * GH);      // area where the mask is at least half on ~ the oval area
  const poly = seamPolygon(f), area = Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + (p.X * q.Y - q.X * p.Y); }, 0)) / 2 / A;
  console.log(`# half-on area ${(half * 100).toFixed(2)}% of the picture vs oval area ${(area * 100).toFixed(2)}%`);
  assert.ok(half > area * 0.85 && half < area * 1.3);
});

test('feather: the fade into the neck is much longer than at the hairline', () => {
  const f = snap({ height: 0.3 }), m = buildSeam({ face: f, aspect: A });
  const top = transition(m, f, +1, 0.9), neck = transition(m, f, -1, 0.1);
  console.log(`# transition width (face heights): hairline ${top.width.toFixed(3)}, neck ${neck.width.toFixed(3)}`);
  assert.ok(top.width > 0.02 && top.width < 0.09, 'hairline is tight');
  assert.ok(neck.width > top.width * 1.8, 'neck is soft');
});

test('the seam rotates with the head: alpha mass is balanced left/right of the head axis at any roll, and it is the exact mirror under mirroring', () => {
  for (const roll of [0, 30, -45]) for (const height of [0.3, 0.5]) {
    const f = snap({ roll, cx: 0.5, height }), m = buildSeam({ face: f, aspect: A });
    let left = 0, right = 0;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const a = m.data[y * GW + x] / 255; if (!a) continue; const s = toHead(f.head, { x: (x + 0.5) / GW, y: (y + 0.5) / GH }).s; if (s > 0) right += a; else left += a; }
    assert.ok(Math.abs(left - right) / (left + right) < 0.03, `roll ${roll} h ${height}: left ${left.toFixed(1)} right ${right.toFixed(1)}`);
    const t = toHead(f.head, fromHead(f.head, 0, 1.25)).t; assert.ok(Math.abs(t - 1.25) < 1e-9);
  }
  const a = buildSeam({ face: snap({ cx: 0.5, cy: 0.45, yaw: 0 }, false), aspect: A }), b = buildSeam({ face: snap({ cx: 0.5, cy: 0.45, yaw: 0 }, true), aspect: A });
  let diff = 0; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) diff += Math.abs(a.data[y * GW + x] - b.data[y * GW + (GW - 1 - x)]);
  assert.ok(diff / (GW * GH * 255) < 0.01, 'mirror image');
  const r0 = buildSeam({ face: snap({ roll: 0 }), aspect: A }), r30 = buildSeam({ face: snap({ roll: 30 }), aspect: A });
  const cx = m => { let sx = 0, sw = 0; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const v = m.data[y * GW + x]; sx += v * (y < GH / 2 ? 1 : 0) * x; sw += v * (y < GH / 2 ? 1 : 0); } return sx / sw; };
  assert.ok(cx(r30) > cx(r0) + 0.3, 'tilting the head clockwise moves the top of the region toward display-right');
});

test('hair in front of the forehead cuts the mask there, but hair at the cheeks or beard height does not', () => {
  const f = snap({ height: 0.3 }), plain = buildSeam({ face: f, aspect: A });
  const hairAt = (s0, s1, t0, t1) => (x, y) => { const q = toHead(f.head, { x, y }); return q.s >= s0 && q.s <= s1 && q.t >= t0 && q.t <= t1 ? 1 : 0; };
  const mask = hair => mkMask(96, 54, { hair });
  const fringe = buildSeam({ face: f, mask: mask(hairAt(-0.5, 0.5, 0.80, 1.2)), aspect: A, hairLayer: true });
  assert.ok(atHead(fringe, f, 0, 0.92) < atHead(plain, f, 0, 0.92) * 0.3, 'fringe covers the upper forehead');
  assert.ok(Math.abs(atHead(fringe, f, 0, 0.4) - atHead(plain, f, 0, 0.4)) < 0.02, 'lower face untouched');
  const beard = buildSeam({ face: f, mask: mask(hairAt(-0.4, 0.4, 0.0, 0.4)), aspect: A, hairLayer: true });
  assert.ok(Math.abs(atHead(beard, f, 0, 0.2) - atHead(plain, f, 0, 0.2)) < 0.02, 'beard-height "hair" never cuts the mask');
  const off = buildSeam({ face: f, mask: mask(hairAt(-0.5, 0.5, 0.80, 1.2)), aspect: A, hairLayer: false });
  assert.ok(Math.abs(atHead(off, f, 0, 0.92) - atHead(plain, f, 0, 0.92)) < 0.02 && off.stats.hairUsed === false, 'hair channel ignored when the layer is not switched on');
  const soft = buildSeam({ face: f, mask: mask((x, y) => 0.5 * hairAt(-0.5, 0.5, 0.80, 1.2)(x, y)), aspect: A, hairLayer: true });
  const a = atHead(soft, f, 0, 0.92), p = atHead(plain, f, 0, 0.92); assert.ok(a < p && a > atHead(fringe, f, 0, 0.92), 'half-confident hair cuts about half');
  assert.ok(fringe.stats.hairUsed && fringe.stats.hairCut > 0 && plain.stats.hairCut === 0);
});

test('the mask never leaves the person: zero where the person mask is zero, unchanged where it is full, soft in between', () => {
  const f = snap({ cx: 0.5, height: 0.3 }), plain = buildSeam({ face: f, aspect: A });
  const full = buildSeam({ face: f, mask: mkMask(96, 54), aspect: A });
  assert.ok(Math.abs(atHead(full, f, 0, 0.5) - atHead(plain, f, 0, 0.5)) < 1e-6 && full.stats.personClip === 0);
  const half = buildSeam({ face: f, mask: mkMask(96, 54, { person: x => (x < 0.5 ? 0 : 1) }), aspect: A });
  const L = { x: 0.46, y: f.eyeMid.y }, R = { x: 0.54, y: f.eyeMid.y };   // both inside the face (half width is about 0.066 here)
  assert.equal(at(half, L), 0); assert.ok(at(half, R) > 0.9);
  assert.ok(half.stats.personClip > 0);
  const soft = buildSeam({ face: f, mask: mkMask(96, 54, { person: () => 0.5 }), aspect: A });
  assert.ok(atHead(soft, f, 0, 0.5) > 0.2 && atHead(soft, f, 0, 0.5) < 0.8, 'uncertain person = half mask');
  const empty = buildSeam({ face: f, mask: mkMask(96, 54, { person: () => 0 }), aspect: A });
  assert.equal(empty.bbox, null); assert.ok(empty.data.every(v => v === 0));
});

test('confidence fades the mask out evenly; no face means an empty map with no bbox; a held face keeps its shape', () => {
  const f = snap({}), full = buildSeam({ face: f, aspect: A }), half = buildSeam({ face: { ...f, conf: 0.5 }, aspect: A });
  for (const [s, t] of [[0, 0.5], [0.3, 0.8], [0, 1.02], [0, -0.05]]) { const a = atHead(full, f, s, t), b = atHead(half, f, s, t); assert.ok(Math.abs(b - a * 0.5) < 0.01, `${s},${t}`); }
  for (const face of [null, undefined, { present: false, conf: 0 }, { ...f, present: false }, { ...f, conf: 0 }]) { const m = buildSeam({ face, aspect: A }); assert.equal(m.bbox, null); assert.ok(m.data.every(v => v === 0)); assert.equal(m.stats.coverage, 0); }
});

test('faces at the picture edge or partly outside it: no crash, finite values, bbox inside the grid, no wrap-around', () => {
  for (const [cx, cy] of [[0.0, 0.5], [1.0, 0.5], [0.5, 0.0], [0.5, 1.0], [-0.1, 1.1], [0.97, 0.03]]) {
    const f = createFaceTracker().update(normalizeFaceResult(makeFace({ aspect: A, cx, cy, height: 0.35 }).result), 0, { mirror: false, aspect: A });
    const m = buildSeam({ face: f, aspect: A });
    assert.ok(m.data.length === GW * GH);
    if (m.bbox) assert.ok(m.bbox.x0 >= 0 && m.bbox.y0 >= 0 && m.bbox.x1 <= GW && m.bbox.y1 <= GH);
    if (cx === 0.0) assert.ok([...Array(GH).keys()].every(y => m.data[y * GW + GW - 1] === 0), 'left-edge face does not wrap to the right edge');
  }
});

test('output buffer is reused (no allocation per frame), seq counts up, old content is cleared', () => {
  const f = snap({}), a = buildSeam({ face: f, aspect: A }), data = a.data, seq = a.seq;
  const b = buildSeam({ face: snap({ cx: 0.25 }), aspect: A, out: a });
  assert.ok(b === a && b.data === data && b.seq === seq + 1);
  assert.equal(atHead(b, f, 0, 0.5), 0, 'the old position was cleared'); assert.ok(at(b, { x: 0.25, y: 0.45 }) > 0.9);
  const c = buildSeam({ face: null, aspect: A, out: b }); assert.ok(c.data.every(v => v === 0));
});

test('cost: a frame takes a few milliseconds at most (informational number printed)', () => {
  const f = snap({ cx: 0.5, height: 0.45 }), mask = mkMask(384, 216, { hair: (x, y) => (y < 0.3 ? 1 : 0) });
  let out = null; const t0 = performance.now(), N = 60;
  for (let i = 0; i < N; i++) out = buildSeam({ face: f, mask, aspect: A, out, hairLayer: true });
  const ms = (performance.now() - t0) / N; console.log(`# seam build: ${ms.toFixed(2)} ms per frame (large face, ${GW}x${GH} map)`);
  assert.ok(ms < 12);
});

test('polygon: one vertex per oval landmark with positive widths, in picture-height units', () => {
  const f = snap({ height: 0.3 }), poly = seamPolygon(f);
  assert.equal(poly.length, FACE_OVAL.length);
  assert.ok(poly.every(p => p.w > 0 && p.b >= 0 && p.b <= 1));
  const top = poly[0], chin = poly[18]; assert.ok(chin.w > top.w * 2.5 && Math.abs(top.w - SEAM.feather[0][1] * 0.3) < 1e-6);
});

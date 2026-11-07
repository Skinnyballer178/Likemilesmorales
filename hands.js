import { FILTER, MODELS, WASM_BASE, BUNDLE_URL, HAND_OPTIONS } from './config.js';
import { OneEuro } from './filters.js';

// Model output -> [{label, score, lm:[{x,y,z}*21]}]. Handles both `handedness` and older `handednesses`.
export function normalizeResult(r) {
  const lms = r?.landmarks || [], cats = r?.handedness || r?.handednesses || [];
  return lms.map((lm, i) => ({
    label: cats[i]?.[0]?.categoryName ?? '?', score: cats[i]?.[0]?.score ?? 0,
    lm: lm.map(p => ({ x: p.x, y: p.y, z: p.z })),
  }));
}
// Compact form used by the debug recorder (landmark replay files).
export const toRecorded = hands => hands.map(h => ({ label: h.label, score: +h.score.toFixed(3), lm: h.lm.map(p => [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)]) }));
export const fromRecorded = hands => hands.map(h => ({ ...h, lm: h.lm.map(([x, y, z]) => ({ x, y, z })) }));

const flip = l => (l === 'Left' ? 'Right' : l === 'Right' ? 'Left' : l);

// Turns raw detections into stable, smoothed hands in DISPLAY coordinates (x flipped when mirrored).
// Each hand keeps a stable slot (0/1) by nearest-wrist matching, so crossing hands do not swap filters.
// `label` is the person's real hand assuming an UNMIRRORED feed (the model assumes a mirrored one, so we flip it);
// `rawLabel` is untouched. The gesture never relies on labels, only on geometry.
export function createHandTracker({ filter = FILTER, matchDist = 0.3, dropMs = 400, slots: n = 2 } = {}) {
  const slots = Array.from({ length: n }, () => ({ active: false, lastT: -Infinity, wrist: null, f: Array.from({ length: 42 }, () => new OneEuro(filter)) }));
  const free = s => { s.active = false; s.f.forEach(f => f.reset()); };

  function process(hands, t, mirror = true) {
    for (const s of slots) if (s.active && t - s.lastT > dropMs) free(s);
    const det = hands.slice(0, n).map(h => ({ h, raw: h.lm.map(p => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z })) }));
    const pairs = [];
    det.forEach((d, i) => slots.forEach((s, j) => s.active && pairs.push({ i, j, d: Math.hypot(d.raw[0].x - s.wrist.x, d.raw[0].y - s.wrist.y) })));
    pairs.sort((a, b) => a.d - b.d);
    const assign = new Map(), taken = new Set();
    for (const p of pairs) if (p.d <= matchDist && !assign.has(p.i) && !taken.has(p.j)) { assign.set(p.i, p.j); taken.add(p.j); }
    const out = [];
    det.forEach((d, i) => {
      let j = assign.get(i);
      if (j === undefined) {
        j = slots.findIndex((s, k) => !s.active && !taken.has(k));
        if (j < 0) return;
        taken.add(j); slots[j].active = true;
      }
      const s = slots[j]; s.lastT = t; s.wrist = d.raw[0];
      const pts = d.raw.map((p, k) => ({ x: s.f[k * 2].filter(p.x, t), y: s.f[k * 2 + 1].filter(p.y, t), z: p.z }));
      out.push({ slot: j, label: flip(d.h.label), rawLabel: d.h.label, score: d.h.score, pts, raw: d.raw });
    });
    return out.sort((a, b) => a.slot - b.slot);
  }
  return { process, reset: () => slots.forEach(free) };
}

// Loads HandLandmarker (2 hands, VIDEO mode). GPU first; pass { delegate: 'CPU' } to force CPU.
export async function loadHandLandmarker({ delegate = 'GPU' } = {}) {
  const { FilesetResolver, HandLandmarker } = await import(BUNDLE_URL);
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = d => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODELS.hand, delegate: d }, runningMode: 'VIDEO', ...HAND_OPTIONS });
  let used = delegate, lm;
  try { lm = await make(delegate); } catch (e) { if (delegate === 'CPU') throw e; used = 'CPU'; lm = await make('CPU'); }
  return { delegate: used, detect: (video, tMs) => normalizeResult(lm.detectForVideo(video, tMs)), close: () => lm.close() };
}

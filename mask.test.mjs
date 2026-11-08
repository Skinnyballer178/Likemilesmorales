import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaskGesture, judgeFist, curlRatios, palmCenter, palmSize, startZone, MASK_STATE, PHASE } from './mask.js';
import { createFaceTracker, normalizeFaceResult, fromHead, toHead } from './facelm.js';
import { makeFace } from './synthface.mjs';
import { fistHand } from './synthfist.mjs';
import { MASK_GESTURE as M, FACE } from './config.js';
import { frameHands, rect, rng, gauss } from './synth.mjs';

const DT = 1000 / 30, A = 16 / 9, TOP = 1 + FACE.headTopAllow;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ---- harness: a head (synthetic face) and ONE fist moving along a path given in HEAD coordinates ----
// path = [[ms, t, s, open], ...] linearly interpolated (held before the first and after the last key). t: 0 chin, 1 forehead, TOP head top.
function sample(path, ms) {
  if (ms <= path[0][0]) return { t: path[0][1], s: path[0][2], open: path[0][3] ?? 0 };
  for (let i = 1; i < path.length; i++) if (ms <= path[i][0]) {
    const [a, b] = [path[i - 1], path[i]], k = (ms - a[0]) / (b[0] - a[0] || 1), L = (x, y) => x + (y - x) * k;
    return { t: L(a[1], b[1]), s: L(a[2], b[2]), open: L(a[3] ?? 0, b[3] ?? 0) };
  }
  const z = path.at(-1); return { t: z[1], s: z[2], open: z[3] ?? 0 };
}
function run({ path, ms, face = {}, aspect = A, mask = createMaskGesture(), extra = () => [], enabled = () => true, noFace = () => false, noHands = () => false, noise = 0, seed = 5, between = () => {} } = {}) {
  const tracker = createFaceTracker(), r = rng(seed), snaps = []; let lastHead = null;
  for (let i = 0, n = Math.round(ms / DT); i <= n; i++) {
    const t = i * DT, fo = typeof face === 'function' ? face(t) : face;
    const fs = noFace(t) ? tracker.update(null, t, { mirror: false, aspect }) : tracker.update(normalizeFaceResult(makeFace({ aspect, ...fo }).result), t, { mirror: false, aspect });
    if (fs.head) lastHead = fs.head;
    const p = sample(path, t), hands = [];
    if (!noHands(t) && lastHead) {                                       // the hand keeps moving even when the face model lost the face
      const c = fromHead(lastHead, p.s, p.t);
      hands.push(fistHand({ x: c.x + (noise ? noise * gauss(r) / aspect : 0), y: c.y + (noise ? noise * gauss(r) : 0), open: p.open, aspect, slot: 0 }));
    }
    extra(t, fs, aspect).forEach(h => hands.push(h));
    between(t);
    snaps.push({ t, face: fs, snap: mask.update({ hands, face: fs, t, aspect, enabled: enabled(t) }) });
  }
  return { snaps, mask, last: snaps.at(-1).snap };
}
const phases = snaps => snaps.map(s => s.snap.phase).filter((p, i, a) => i === 0 || p !== a[i - 1]);
const maxP = snaps => Math.max(...snaps.map(s => s.snap.progress));
const everState = (snaps, st) => snaps.some(s => s.snap.state === st);
// the reference pull: rest above the head, pull to the chin, lower the hand and open it
const PULL = (t0 = 500, dur = 900, from = 1.9) => [[0, from, 0, 0], [t0, from, 0, 0], [t0 + dur, 0.0, 0, 0], [t0 + dur + 300, 0.0, 0, 0], [t0 + dur + 600, -0.9, 0, 0], [t0 + dur + 700, -0.9, 0, 1]];

// ---- fist geometry ----
test('fist: curl ratios separate a closed fist from an open hand; orientation does not matter', () => {
  for (const angle of [0, 90, 180, -35]) {
    const f = fistHand({ x: 0.5, y: 0.5, open: 0, angle }), o = fistHand({ x: 0.5, y: 0.5, open: 1, angle });
    assert.ok(curlRatios(f.pts, A).every(r => r < 1.0), `fist ratios at ${angle}`);
    assert.ok(curlRatios(o.pts, A).every(r => r > 1.7), `open ratios at ${angle}`);
    assert.equal(judgeFist(f, A).fist, true); assert.equal(judgeFist(o, A).fist, false);
  }
});
test('fist: hysteresis (strict to start, looser to stay), three fingers keep but cannot start', () => {
  const half = fistHand({ x: 0.5, y: 0.5, open: 0.5 });           // ratio 1.33: between enter 1.25 and exit 1.45
  assert.equal(judgeFist(half, A, false).fist, false); assert.equal(judgeFist(half, A, true).fist, true);
  const three = fistHand({ x: 0.5, y: 0.5, open: [0, 0, 0, 1] });
  assert.equal(judgeFist(three, A, false).fist, false, 'three curled fingers do not start a fist'); assert.equal(judgeFist(three, A, true).fist, true, 'but keep one');
  assert.equal(judgeFist(fistHand({ x: 0.5, y: 0.5, open: [0, 0, 1, 1] }), A, true).fist, false, 'two curled fingers is not a fist');
});
test('fist: low confidence, tiny or huge palms and a missing hand are never fists; palm centre is exact', () => {
  assert.equal(judgeFist(fistHand({ x: 0.5, y: 0.5, score: 0.3 }), A).fist, false);
  assert.equal(judgeFist(fistHand({ x: 0.5, y: 0.5, size: 0.01 }), A).reason, 'palm-size');
  assert.equal(judgeFist(fistHand({ x: 0.5, y: 0.5, size: 0.9 }), A).reason, 'palm-size');
  assert.equal(judgeFist(null, A).fist, false);
  const h = fistHand({ x: 0.31, y: 0.62, size: 0.12, angle: 20 }), c = palmCenter(h.pts);
  assert.ok(near(c.x, 0.31, 1e-9) && near(c.y, 0.62, 1e-9), 'palm centre');
  assert.ok(near(palmSize(h.pts, A), 0.12, 0.002), 'palm size');
});
test('the two-C window frame hands are never a fist (the two gestures cannot be confused)', () => {
  const hands = frameHands(rect(0.5, 0.5, 0.3, 0.45)).map((h, i) => ({ ...h, slot: i, pts: h.lm.map(p => ({ x: 1 - p.x, y: p.y, z: 0 })) }));
  hands.forEach(h => assert.equal(judgeFist(h, A).fist, false));
});

// ---- the start zone ----
test('start zone: head top minus the margin; cropped head top = top strip of the picture', () => {
  const tr = createFaceTracker(), f = tr.update(normalizeFaceResult(makeFace({ cx: 0.5, cy: 0.5, height: 0.3 }).result), 0, { mirror: false, aspect: A });
  const z = startZone(f); assert.ok(near(z.tMin, TOP - M.startBelowTop) && !z.cropped);
  const tr2 = createFaceTracker(), g = tr2.update(normalizeFaceResult(makeFace({ cx: 0.5, cy: 0.3, height: 0.3 }).result), 0, { mirror: false, aspect: A });
  const z2 = startZone(g); assert.ok(z2.cropped && z2.tMin < z.tMin, `cropped zone ${z2.tMin.toFixed(2)}`);
  assert.ok(near(fromHead(g.head, 0, z2.tMin).y, M.topStripY, 0.01), 'zone edge at the strip');
});

// ---- the gesture ----
test('full pull: armed > pulling > completing > worn; progress follows the fist, never goes backwards, ends worn at 1', () => {
  const { snaps, last } = run({ path: PULL(), ms: 3200 });
  assert.deepEqual(phases(snaps), [PHASE.ARMED, PHASE.PULLING, PHASE.COMPLETING, PHASE.WORN]);
  const pulling = snaps.filter(s => s.snap.phase === PHASE.PULLING).map(s => s.snap.progress);
  assert.ok(pulling.every((p, i) => i === 0 || p >= pulling[i - 1] - 1e-12), 'monotone while pulling');
  assert.equal(last.state, MASK_STATE.WORN); assert.equal(last.progress, 1);
  assert.equal(snaps.find(s => s.snap.phase === PHASE.ARMED).snap.state, MASK_STATE.HIDDEN, 'armed shows nothing yet');
  const mid = snaps.find(s => s.t >= 500 + 450).snap;                     // halfway down the path (fist at t 0.95)
  assert.ok(mid.progress > 0.25 && mid.progress < 0.75, `mid-pull progress ${mid.progress.toFixed(2)}`);
});
test('progress follows the fist: it tracks the lowest point reached', () => {
  const { snaps } = run({ path: [[0, 1.9, 0], [500, 1.9, 0], [1100, 0.7, 0], [1500, 0.7, 0]], ms: 1500 });
  const p = snaps.at(-1).snap.progress, expect = (TOP - M.startBelowTop - 0.7) / (TOP - M.startBelowTop - M.endT);
  assert.ok(Math.abs(p - expect) < 0.08, `progress ${p.toFixed(2)} expected about ${expect.toFixed(2)}`);
});
test('worn persists: the hand lowers, opens, leaves, the face disappears, nothing takes it off; reset() does', () => {
  const r = run({ path: PULL(), ms: 6000, noHands: t => t > 3300, noFace: t => t > 4000 });
  assert.equal(r.last.state, MASK_STATE.WORN); assert.equal(r.last.progress, 1);
  r.mask.reset(); const s = r.mask.update({ hands: [], face: null, t: 7000, aspect: A });
  assert.equal(s.state, MASK_STATE.HIDDEN); assert.equal(s.progress, 0);
});
test('worn is final: a second pull changes nothing', () => {
  const p1 = PULL(), path = [...p1, [3300, 1.9, 0, 0], [3800, 1.9, 0, 0], [4700, 0, 0, 0], [5200, 0, 0, 0]];
  const r = run({ path, ms: 5200 });
  assert.equal(r.last.stats.completions, 1); assert.equal(r.last.state, MASK_STATE.WORN);
});
test('half pull then the hand opens: cancelled, the mask melts away, never worn', () => {
  const path = [[0, 1.9, 0, 0], [500, 1.9, 0, 0], [1100, 0.7, 0, 0], [1300, 0.7, 0, 0], [1450, 0.7, 0, 1], [2600, 0.7, 0, 1]];
  const { snaps, last } = run({ path, ms: 2600 });
  assert.equal(last.stats.lastCancel, 'fist-opened'); assert.equal(last.state, MASK_STATE.HIDDEN); assert.equal(last.progress, 0);
  assert.ok(maxP(snaps) > 0.3 && maxP(snaps) < 0.8, `peak ${maxP(snaps).toFixed(2)}`); assert.ok(!everState(snaps, MASK_STATE.WORN));
  const ps = snaps.filter(s => s.snap.phase === PHASE.IDLE && s.snap.progress > 0).map(s => s.snap.progress);
  assert.ok(ps.every((p, i) => i === 0 || p <= ps[i - 1] + 1e-12), 'un-reveals smoothly (never grows again)');
});
test('half pull that just stops is cancelled by the stall timer', () => {
  const { last } = run({ path: [[0, 1.9, 0], [500, 1.9, 0], [1100, 0.7, 0], [4000, 0.7, 0]], ms: 4000 });
  assert.equal(last.stats.lastCancel, 'stalled'); assert.equal(last.state, MASK_STATE.HIDDEN);
});
test('pass-by: a fist swiping across the face (or above the head) never reveals anything', () => {
  for (const path of [[[0, 0.7, -2.5], [600, 0.7, 2.5]], [[0, 0.7, 0], [400, 0.7, 1.8]], [[0, 1.9, -2.5], [500, 1.9, 2.5]], [[0, 0.4, 2], [900, 0.9, -2]]]) {
    const { snaps } = run({ path, ms: 1200 });
    assert.ok(snaps.every(s => s.snap.state === MASK_STATE.HIDDEN && s.snap.progress === 0), JSON.stringify(path));
    assert.ok(snaps.every(s => s.snap.phase !== PHASE.PULLING));
  }
});
test('swipe up from the chin never counts; resting up there and then pulling down does', () => {
  const up = run({ path: [[0, 0, 0], [400, 1.9, 0], [700, 1.9, 0]], ms: 700 });
  assert.ok(up.snaps.every(s => s.snap.state === MASK_STATE.HIDDEN) && up.snaps.every(s => s.snap.phase !== PHASE.PULLING));
  const both = run({ path: [[0, 0, 0], [400, 1.9, 0], [1000, 1.9, 0], [1900, 0, 0], [2200, 0, 0]], ms: 3200 });
  assert.equal(both.last.state, MASK_STATE.WORN);
});
test('a fist moving down without resting above the head first never arms', () => {
  const { snaps, last } = run({ path: [[0, 1.45, 0], [900, 0, 0], [1300, 0, 0]], ms: 1400 });
  assert.ok(!snaps.some(s => s.snap.phase === PHASE.PULLING)); assert.equal(last.state, MASK_STATE.HIDDEN);
});
test('two hands: a second fist cancels a pull and blocks arming; an open second hand is ignored', () => {
  const second = (open, from) => (t, fs) => (t >= from ? [fistHand({ x: 0.2, y: 0.5, open, slot: 1 })] : []);
  const mid = run({ path: PULL(), ms: 3200, extra: second(0, 900) });
  assert.equal(mid.last.stats.lastCancel, 'two-fists'); assert.notEqual(mid.last.state, MASK_STATE.WORN);
  const pre = run({ path: PULL(), ms: 1400, extra: second(0, 0) });
  assert.ok(pre.snaps.every(s => s.snap.phase === PHASE.IDLE));
  const openOne = run({ path: PULL(), ms: 3200, extra: second(1, 0) });
  assert.equal(openOne.last.state, MASK_STATE.WORN);
});
test('speed: a normal quick pull and a slow pull work; a flick and a crawl do not', () => {
  const at = dur => run({ path: [[0, 1.9, 0], [400, 1.9, 0], [400 + dur, 0, 0], [400 + dur + 400, 0, 0]], ms: 400 + dur + 600 }).last;
  assert.equal(at(450).state, MASK_STATE.WORN, 'quick'); assert.equal(at(3000).state, MASK_STATE.WORN, 'slow');
  assert.equal(at(120).stats.lastCancel, 'too-fast'); assert.equal(at(120).state, MASK_STATE.HIDDEN);
  assert.equal(at(8000).stats.lastCancel, 'too-slow'); assert.equal(at(8000).state, MASK_STATE.HIDDEN);
});
test('jitter and small wobbles are tolerated; moving up a lot, or sideways out of the corridor, cancels', () => {
  const wob = [[0, 1.9, 0], [500, 1.9, 0], [800, 1.1, 0], [950, 1.2, 0], [1250, 0.5, 0], [1400, 0.62, 0], [1700, 0, 0], [2000, 0, 0]];
  assert.equal(run({ path: wob, ms: 3000, noise: 0.012 }).last.state, MASK_STATE.WORN, 'jitter + 0.1 wobble');
  const up = run({ path: [[0, 1.9, 0], [500, 1.9, 0], [900, 1.0, 0], [1100, 1.45, 0], [1800, 1.45, 0]], ms: 1800 }).last;
  assert.equal(up.stats.lastCancel, 'moved-up'); assert.equal(up.state, MASK_STATE.HIDDEN);
  const side = run({ path: [[0, 1.9, 0], [500, 1.9, 0], [1000, 0.9, 0], [1400, 0.6, 1.5], [1800, 0.6, 1.5]], ms: 1800 }).last;
  assert.equal(side.stats.lastCancel, 'left-corridor');
});
test('head-relative: a tilted, moving, smaller head gives the same result (head position, roll, yaw and distance do not matter)', () => {
  for (const face of [{ cx: 0.35, cy: 0.62, height: 0.22, roll: 25 }, { cx: 0.7, cy: 0.6, height: 0.34, roll: -20, yaw: 15 }, { cx: 0.5, cy: 0.7, height: 0.18, roll: 0, pitch: 10 }])
    assert.equal(run({ path: PULL(), ms: 3200, face }).last.state, MASK_STATE.WORN, JSON.stringify(face));
  const drift = t => ({ cx: 0.35 + 0.25 * Math.min(1, t / 2000), cy: 0.6, height: 0.26, roll: 15 * Math.sin(t / 700) });
  assert.equal(run({ path: PULL(), ms: 3200, face: drift }).last.state, MASK_STATE.WORN, 'head moving during the pull');
});
test('other aspect ratios and head top cropped by the picture (fallback zone) work', () => {
  assert.equal(run({ path: PULL(), ms: 3200, aspect: 4 / 3 }).last.state, MASK_STATE.WORN, '4:3');
  const cropped = { cx: 0.5, cy: 0.3, height: 0.3 };                       // head top lies above the picture
  const path = [[0, 1.25, 0], [500, 1.25, 0], [1400, 0, 0], [1700, 0, 0]];   // the fist rests in the top strip of the picture
  assert.equal(run({ path, ms: 2600, face: cropped }).last.state, MASK_STATE.WORN, 'cropped head top');
});
test('no face: never arms; a face lost during the pull cancels; a short face blip is ridden out', () => {
  assert.ok(run({ path: PULL(), ms: 3000, noFace: () => true }).snaps.every(s => s.snap.state === MASK_STATE.HIDDEN));
  const lost = run({ path: [[0, 1.9, 0], [500, 1.9, 0], [1100, 0.8, 0], [4000, 0.8, 0]], ms: 4000, noFace: t => t > 1300 }).last;
  assert.equal(lost.stats.lastCancel, 'face-lost'); assert.equal(lost.state, MASK_STATE.HIDDEN);
  assert.equal(run({ path: PULL(), ms: 3200, noFace: t => t > 800 && t < 920 }).last.state, MASK_STATE.WORN, '120 ms blip');
});
test('hand tracking blips: a fist lost for a moment is held; lost for long cancels', () => {
  assert.equal(run({ path: PULL(), ms: 3200, noHands: t => t > 1000 && t < 1100 }).last.state, MASK_STATE.WORN, '100 ms dropout');
  assert.equal(run({ path: PULL(), ms: 3200, noHands: t => t > 1000 && t < 1500 }).last.stats.lastCancel, 'fist-opened', '500 ms dropout');
});
test('enabled=false: never arms, drops a gesture in progress, but never takes a worn mask off', () => {
  assert.ok(run({ path: PULL(), ms: 3000, enabled: () => false }).snaps.every(s => s.snap.state === MASK_STATE.HIDDEN));
  const mid = run({ path: PULL(), ms: 3000, enabled: t => t < 1000 }).last; assert.equal(mid.state, MASK_STATE.HIDDEN); assert.equal(mid.stats.lastCancel, 'disabled');
  assert.equal(run({ path: PULL(), ms: 4000, enabled: t => t < 2400 }).last.state, MASK_STATE.WORN);
});
test('the fist needs a short rest above the head (armMs) and a whole fist (open hand above the head does nothing)', () => {
  const open = run({ path: [[0, 1.9, 0, 1], [500, 1.9, 0, 1], [1400, 0, 0, 1], [1800, 0, 0, 1]], ms: 1800 });
  assert.ok(open.snaps.every(s => s.snap.state === MASK_STATE.HIDDEN && s.snap.phase === PHASE.IDLE), 'open hand');
  const arm = run({ path: [[0, 1.9, 0], [500, 1.9, 0]], ms: 500 }).snaps;
  const i = arm.findIndex(s => s.snap.phase === PHASE.ARMED); assert.ok(i >= 0);
  assert.ok(arm[i].snap.reason === 'arming' && arm.find(s => s.snap.reason === 'armed').t - arm[i].t >= M.armMs - DT, 'arms after armMs');
});
test('the gesture is a pure function of its inputs: replaying gives the identical snapshots', () => {
  const a = run({ path: PULL(), ms: 3200, noise: 0.01, seed: 11 }).snaps.map(s => JSON.stringify(s.snap));
  const b = run({ path: PULL(), ms: 3200, noise: 0.01, seed: 11 }).snaps.map(s => JSON.stringify(s.snap));
  assert.deepEqual(a, b);
});

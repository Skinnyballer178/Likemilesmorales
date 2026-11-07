import test from 'node:test';
import assert from 'node:assert/strict';
import { FACE_OVAL, LM, normalizeFaceResult, validPoints, toDisplayPoints, headFrame, toHead, fromHead, headTop, landmarkYaw, matrixPose, mirrorMatrix, createPoseAgreement, createFaceTracker } from './facelm.js';
import { FACE } from './config.js';
import { makeFace, rotation, matrixFrom } from './synthface.mjs';
import { rng } from './synth.mjs';

const A = 16 / 9, FR = 1000 / 30;
const disp = (f, mirror = false) => toDisplayPoints(f.pts, mirror);
const std = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const track = (frames, { mirror = false, cfg = FACE } = {}) => { const tr = createFaceTracker({ config: cfg }); let s; frames.forEach((r, i) => { s = tr.update(r, i * FR, { mirror, aspect: A }); }); return { tr, s }; };

test('oval: 36 distinct landmarks, a closed loop that includes forehead (10) and chin (152)', () => {
  assert.equal(FACE_OVAL.length, 36); assert.equal(new Set(FACE_OVAL).size, 36);
  assert.ok(FACE_OVAL.includes(LM.FOREHEAD) && FACE_OVAL.includes(LM.CHIN) && FACE_OVAL.includes(LM.CHEEK_A) && FACE_OVAL.includes(LM.CHEEK_B));
  assert.ok(FACE_OVAL.every(i => i >= 0 && i < 468));
  // neighbours on the loop are close together on a real-looking face (no jumps across the face)
  const p = disp(makeFace({ aspect: A }));
  for (let k = 0; k < 36; k++) { const a = p[FACE_OVAL[k]], b = p[FACE_OVAL[(k + 1) % 36]]; assert.ok(Math.hypot((a.x - b.x) * A, a.y - b.y) < 0.12, `gap at ${k}`); }
});

test('normalizeFaceResult: reads landmarks and the matrix, rejects short, missing and empty results', () => {
  const f = makeFace({ aspect: A }), n = normalizeFaceResult(f.result);
  assert.equal(n.pts.length, 478); assert.equal(n.matrix.length, 16);
  assert.ok(normalizeFaceResult(makeFace({ withMatrix: false }).result).matrix === null);
  assert.equal(normalizeFaceResult({ faceLandmarks: [] }), null);
  assert.equal(normalizeFaceResult({ faceLandmarks: [f.pts.slice(0, 100)] }), null);
  assert.equal(normalizeFaceResult(undefined), null); assert.equal(normalizeFaceResult({}), null);
  assert.ok(normalizeFaceResult({ faceLandmarks: [f.pts.slice(0, 468)], facialTransformationMatrixes: [Float32Array.from(f.matrix)] }).matrix, 'a bare 16-array matrix is accepted too');
  const bad = f.pts.map(p => ({ ...p })); bad[5].x = NaN;
  assert.equal(validPoints(bad), false); assert.equal(validPoints(f.pts), true);
});

test('head frame: chin is t=0, landmark 10 is t=1, the head top is above it; to/from head coordinates round-trip at any roll, scale and aspect', () => {
  for (const asp of [16 / 9, 4 / 3, 9 / 16]) for (const roll of [-40, 0, 25, 80]) for (const h of [0.15, 0.4]) {
    const f = makeFace({ aspect: asp, roll, height: h, cx: 0.45, cy: 0.5 }), p = disp(f), fr = headFrame(p, asp);
    const c = toHead(fr, p[LM.CHIN]), t10 = toHead(fr, p[LM.FOREHEAD]);
    assert.ok(Math.abs(c.s) < 1e-9 && Math.abs(c.t) < 1e-9 && Math.abs(t10.s) < 1e-9 && Math.abs(t10.t - 1) < 1e-9);
    assert.ok(Math.abs(fr.h - h) < 1e-6, 'face height in picture-height units');
    for (const [s, t] of [[0.3, 0.5], [-0.4, 1.3], [0, -0.2]]) { const q = fromHead(fr, s, t), b = toHead(fr, q); assert.ok(Math.abs(b.s - s) < 1e-9 && Math.abs(b.t - t) < 1e-9); }
    const top = toHead(fr, headTop(fr, 0.45)); assert.ok(Math.abs(top.t - 1.45) < 1e-9 && Math.abs(top.s) < 1e-9);
  }
  assert.equal(headFrame(Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 })), A), null, 'degenerate face');
});

test('head frame follows the head: roll angle is reported with the right sign and the head top moves with the tilt', () => {
  for (const roll of [-50, -20, 0, 20, 50]) {
    const fr = headFrame(disp(makeFace({ roll, aspect: A })), A);
    assert.ok(Math.abs(fr.roll - roll) < 1e-6, `roll ${roll} -> ${fr.roll}`);
  }
  const upright = headFrame(disp(makeFace({ aspect: A })), A), tilted = headFrame(disp(makeFace({ roll: 30, aspect: A })), A);
  assert.ok(headTop(tilted).x > headTop(upright).x + 0.01, 'tilting clockwise moves the head top toward display-right');
  assert.ok(headTop(upright).y < upright.origin.y, 'upright: head top is above the chin on screen (smaller y)');
});

test('mirroring: raw landmarks flipped for display give the mirror image: roll and yaw change sign, the head frame stays consistent', () => {
  const f = makeFace({ yaw: 25, roll: 15, aspect: A, cx: 0.3 });
  const raw = headFrame(disp(f, false), A), mir = headFrame(disp(f, true), A);
  assert.ok(Math.abs(raw.roll + mir.roll) < 1e-6);
  assert.ok(Math.abs(raw.h - mir.h) < 1e-9);
  const yRaw = landmarkYaw(disp(f, false), raw), yMir = landmarkYaw(disp(f, true), mir);
  assert.ok(yRaw > 10 && Math.abs(yRaw + yMir) < 1e-6, `yaw ${yRaw} vs ${yMir}`);
  const mpR = matrixPose(f.matrix, false), mpM = matrixPose(f.matrix, true);
  assert.ok(Math.abs(mpR.yaw + mpM.yaw) < 1e-6 && Math.abs(mpR.roll + mpM.roll) < 1e-6 && Math.abs(mpR.pitch - mpM.pitch) < 1e-6);
});

test('landmark yaw: sign and order are right and it is monotonic; it needs no matrix', () => {
  const yaws = [-50, -30, -10, 0, 10, 30, 50].map(y => { const p = disp(makeFace({ yaw: y, aspect: A })); return landmarkYaw(p, headFrame(p, A), 1.02); });
  for (let i = 1; i < yaws.length; i++) assert.ok(yaws[i] > yaws[i - 1], 'monotonic');
  assert.ok(yaws[3] === 0 || Math.abs(yaws[3]) < 1e-6);
  [-30, -10, 10, 30].forEach((y, i) => { const v = yaws[[1, 2, 4, 5][i]]; assert.ok(Math.abs(v - y) < 6, `yaw ${y} estimated ${v.toFixed(1)}`); });
  // pitch and roll do not fake a yaw
  for (const [pi, ro] of [[25, 0], [0, 35], [-20, -30]]) { const p = disp(makeFace({ pitch: pi, roll: ro, aspect: A })); assert.ok(Math.abs(landmarkYaw(p, headFrame(p, A), 1.02)) < 5, `pitch ${pi} roll ${ro}`); }
});

test('matrix pose: yaw, pitch and roll are read back from known rotations; garbage matrices are refused', () => {
  for (const [y, p, r] of [[0, 0, 0], [35, 0, 0], [-35, 0, 0], [0, 20, 0], [0, -20, 0], [0, 0, 30], [0, 0, -30]]) {
    const m = matrixPose(matrixFrom(rotation(y, p, r)), false);
    assert.ok(Math.abs(m.yaw - y) < 1e-3 && Math.abs(m.pitch - p) < 1e-3 && Math.abs(m.roll - r) < 1e-3, `${y}/${p}/${r} -> ${m.yaw}/${m.pitch}/${m.roll}`);
  }
  assert.equal(matrixPose(null), null); assert.equal(matrixPose(new Float32Array(16).fill(NaN)), null); assert.equal(matrixPose(new Float32Array(9)), null);
  const R = rotation(30, 10, 20), M = matrixFrom(R), mir = matrixPose(mirrorMatrix(M), false), want = matrixPose(M, true);
  assert.ok(Math.abs(mir.yaw - want.yaw) < 1e-3 && Math.abs(mir.roll - want.roll) < 1e-3 && Math.abs(mir.pitch - want.pitch) < 1e-3, 'mirrorMatrix agrees with the mirror flags');
});

test('pose agreement: ok when the matrix turns the same way, flipped when it is consistently opposite, suspect when unrelated, unknown early', () => {
  const run = fn => { const a = createPoseAgreement(); const r = rng(3); for (let i = 0; i < 120; i++) { const y = (r() - 0.5) * 100; a.add(y, fn(y, r), 0, 0); } return a; };
  assert.equal(createPoseAgreement().verdict, 'unknown');
  assert.equal(run(y => y * 0.9).verdict, 'ok');
  assert.equal(run(y => -y * 0.9).verdict, 'flipped');
  assert.equal(run((y, r) => (r() - 0.5) * 100).verdict, 'suspect');
  const small = createPoseAgreement(); for (let i = 0; i < 200; i++) small.add(3, -3, 0, 0); assert.equal(small.verdict, 'unknown', 'tiny angles carry no information');
  const a = createPoseAgreement(); a.add(0, 0, 10, 40); a.add(0, 0, 10, 12); assert.equal(a.rollRate, 0.5);
});

test('tracker: a steady face is smoothed (jitter drops a lot) and stays where it is', () => {
  const truth = makeFace({ aspect: A, yaw: 10 });
  const frames = Array.from({ length: 120 }, (_, i) => normalizeFaceResult(makeFace({ aspect: A, yaw: 10, noise: 0.003, seed: i + 1 }).result));
  const tr = createFaceTracker(), rawDev = [], smDev = []; let s;
  frames.forEach((fr, i) => { s = tr.update(fr, i * FR, { mirror: false, aspect: A }); if (i > 30) for (const id of [LM.NOSE, LM.CHIN, 33, 263]) { rawDev.push(fr.pts[id].x - truth.pts[id].x); smDev.push(s.pts[id].x - truth.pts[id].x); } });
  const a = std(rawDev), b = std(smDev); console.log(`# landmark jitter: raw ${a.toFixed(5)}, smoothed ${b.toFixed(5)} (${(100 * (1 - b / a)).toFixed(0)}% less)`);
  assert.ok(b < a * 0.55, 'jitter reduced');
  assert.ok(Math.abs(s.pts[LM.NOSE].x - truth.pts[LM.NOSE].x) < 0.002 && s.present && s.conf === 1);
});

test('tracker: a moving head is followed with little lag; a sudden big jump restarts the smoothing instead of smearing', () => {
  const tr = createFaceTracker(); let s, lag = 0;
  for (let i = 0; i < 90; i++) {                         // sweep sideways at 0.3 picture widths per second
    const cx = 0.3 + 0.3 * (i * FR / 1000); s = tr.update(normalizeFaceResult(makeFace({ aspect: A, cx }).result), i * FR, { mirror: false, aspect: A });
    if (i > 30) lag = Math.max(lag, Math.abs(s.pts[LM.NOSE].x - (cx + 0))); // nose x of an unrotated face = cx
  }
  console.log(`# max lag while sweeping at 0.3/s: ${lag.toFixed(4)} picture widths`);
  assert.ok(lag < 0.012, 'lag small');
  const tj = createFaceTracker(); tj.update(normalizeFaceResult(makeFace({ cx: 0.2 }).result), 0, { mirror: false, aspect: A });
  const j = tj.update(normalizeFaceResult(makeFace({ cx: 0.8 }).result), FR, { mirror: false, aspect: A });
  assert.ok(Math.abs(j.pts[LM.NOSE].x - 0.8) < 1e-6 && tj.resets >= 1, 'jump = reset, lands exactly on the new face');
});

test('tracker: dropout holds the pose, then confidence fades to 0 (never snaps); the face comes back clean', () => {
  const tr = createFaceTracker(), face = normalizeFaceResult(makeFace({ aspect: A }).result), opt = { mirror: false, aspect: A };
  let t = 0; for (; t < 300; t += FR) tr.update(face, t, opt);
  const at = ms => tr.update(null, t - FR + ms, opt);
  const held = at(FACE.holdMs - 10); assert.equal(held.conf, 1); assert.ok(held.present && held.pts);
  const mid = at(FACE.holdMs + FACE.fadeMs / 2); assert.ok(mid.conf > 0.4 && mid.conf < 0.6 && mid.present, `mid fade ${mid.conf}`);
  let prev = 1; for (let ms = FACE.holdMs; ms <= FACE.holdMs + FACE.fadeMs; ms += 20) { const c = at(ms).conf; assert.ok(c <= prev + 1e-12); prev = c; }   // monotonic, no snap
  const gone = at(FACE.holdMs + FACE.fadeMs + 10); assert.equal(gone.conf, 0); assert.equal(gone.present, false); assert.equal(gone.pts, null);
  const back = tr.update(normalizeFaceResult(makeFace({ aspect: A, cx: 0.7 }).result), t + 3000, opt);
  assert.ok(back.present && back.conf === 1 && Math.abs(back.pts[LM.NOSE].x - 0.7) < 1e-6, 'no smoothing from the stale position');
  assert.ok(tr.update(undefined, t + 3010, opt).present, 'a cadence skip (undefined) is not a loss');
});

test('tracker: false detections are ignored (tiny, huge, NaN, short); an empty tracker is safe', () => {
  const tr = createFaceTracker(), opt = { mirror: false, aspect: A };
  assert.equal(tr.update(undefined, 0, opt).present, false); assert.equal(tr.update(null, 10, opt).present, false);
  for (const bad of [makeFace({ height: 0.02 }), makeFace({ height: 3 })]) assert.equal(tr.update(normalizeFaceResult(bad.result), 20, opt).present, false);
  const nan = makeFace({}).pts.map(p => ({ ...p })); nan[1].x = NaN;
  assert.equal(tr.update({ pts: nan, matrix: null }, 30, opt).present, false);
  assert.equal(tr.update({ pts: nan.slice(0, 50), matrix: null }, 40, opt).present, false);
  assert.ok(tr.rejected >= 4);
  assert.ok(tr.update(normalizeFaceResult(makeFace({}).result), 50, opt).present, 'a good face right after is accepted');
});

test('tracker pose: landmarks until the matrix is proven, then the matrix; a flipped matrix is corrected; an unrelated one is ignored', () => {
  const sweep = (matrixSign, noMatrix = false) => {
    const tr = createFaceTracker(); let s, i = 0;
    for (; i < 160; i++) { const yaw = 45 * Math.sin(i / 12); s = tr.update(normalizeFaceResult(makeFace({ aspect: A, yaw, noise: 0.0005, seed: i + 1, matrixSign, withMatrix: !noMatrix }).result), i * FR, { mirror: false, aspect: A }); if (i === 5) assert.equal(s.poseSource, 'landmarks', 'unproven matrix is not used'); }
    return { s, yaw: 45 * Math.sin((i - 1) / 12) };
  };
  const ok = sweep(1); assert.equal(ok.s.poseVerdict, 'ok'); assert.equal(ok.s.poseSource, 'matrix'); assert.ok(Math.abs(ok.s.yaw - ok.yaw) < 4);
  const fl = sweep(-1); assert.equal(fl.s.poseVerdict, 'flipped'); assert.match(fl.s.poseSource, /negated/); assert.ok(Math.abs(fl.s.yaw - fl.yaw) < 4, 'corrected yaw has the right sign');
  const nm = sweep(1, true); assert.equal(nm.s.poseSource, 'landmarks'); assert.ok(Math.abs(nm.s.yaw - nm.yaw) < 20 && Math.sign(nm.s.yaw) === Math.sign(nm.yaw));
  assert.ok(Math.abs(ok.s.roll) < 1 && ok.s.matrix.length === 16, `roll ${ok.s.roll}`);
});

test('snapshot geometry: box wraps the oval, head top is above the box top for an upright face, everything is finite', () => {
  const { s } = track([normalizeFaceResult(makeFace({ aspect: A, cx: 0.4, cy: 0.5, height: 0.3 }).result)], { mirror: true });
  assert.ok(s.box.x1 > s.box.x0 && s.box.y1 > s.box.y0);
  assert.ok(s.headTop.y < s.box.y0, 'hair allowance puts the head top above the forehead point');
  assert.ok(Math.abs(s.headTop.x - s.eyeMid.x) < 0.01, 'and it is centred above the face');
  assert.ok(Math.abs(s.pts[LM.NOSE].x - (1 - (0.4 + 0)) ) < 1e-6, 'mirrored: x flipped');
  for (const k of ['yaw', 'pitch', 'roll']) assert.ok(Number.isFinite(s[k]));
  assert.ok(s.pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

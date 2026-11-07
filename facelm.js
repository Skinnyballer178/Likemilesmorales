// Face geometry and tracking (Session 5). Pure functions: no DOM, no MediaPipe, no GL, so everything is unit-tested in node.
// Coordinates: "display" = normalized 0..1 in the picture the person SEES (x already flipped when mirrored, y down).
// Distances and angles are computed in "picture-height units" (x multiplied by the aspect ratio), so a circle stays a circle.
//
// Head frame (what S8 and S9 use): origin = chin (landmark 152), axis "up" = chin -> landmark 10 (forehead), "right" = up turned
// 90 degrees clockwise on screen. Head coordinates (s, t): t = 0 at the chin, 1 at landmark 10, headTop at 1 + FACE.headTopAllow;
// s = sideways distance along "right". Both are in FACE-HEIGHT units, so head position, tilt and distance to the camera do not matter.
import { FACE } from './config.js';
import { OneEuro } from './filters.js';

// MediaPipe face mesh landmark ids (canonical 468 points + 10 iris points = 478).
export const LM = { FOREHEAD: 10, CHIN: 152, CHEEK_A: 234, CHEEK_B: 454, NOSE: 1, BROW_MID: 168, EYE_A_OUT: 33, EYE_A_IN: 133, EYE_B_OUT: 263, EYE_B_IN: 362, MOUTH_A: 61, MOUTH_B: 291, LIP_TOP: 13, LIP_BOT: 14, IRIS_A: 468, IRIS_B: 473 };
// The outline of the face as an ordered loop of 36 landmarks (forehead, around one side, chin, back up the other side).
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const MIN_POINTS = 468;

const RAD = 180 / Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---- 1. model output -> plain data ----
// FaceLandmarkerResult -> null | { pts: [{x,y,z}] (raw, video orientation), matrix: Float32Array(16) | null }
export function normalizeFaceResult(r) {
  const lm = r && r.faceLandmarks && r.faceLandmarks[0];
  if (!lm || lm.length < MIN_POINTS) return null;
  const m = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
  const d = m && (m.data || m);
  return { pts: lm.map(p => ({ x: p.x, y: p.y, z: p.z || 0 })), matrix: d && d.length === 16 ? Float32Array.from(d) : null };
}
export function validPoints(pts) {
  if (!Array.isArray(pts) || pts.length < MIN_POINTS) return false;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false; }
  return true;
}
export const toDisplayPoints = (pts, mirror) => pts.map(p => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z || 0 }));

// ---- 2. the head frame ----
// Returns null for a degenerate face (chin and forehead on the same spot).
export function headFrame(pts, aspect = 16 / 9) {
  const a = pts[LM.CHIN], b = pts[LM.FOREHEAD];
  const dx = (b.x - a.x) * aspect, dy = b.y - a.y, h = Math.hypot(dx, dy);
  if (!(h > 1e-6)) return null;
  const up = { x: dx / h, y: dy / h };
  const right = { x: -up.y, y: up.x };
  const roll = Math.atan2(right.y, right.x) * RAD;      // clockwise on screen = positive (top of the head toward display-right)
  return { origin: { x: a.x, y: a.y }, up, right, h, aspect, roll };
}
// display point -> head coordinates
export function toHead(f, p) {
  const X = (p.x - f.origin.x) * f.aspect, Y = p.y - f.origin.y;
  return { s: (X * f.right.x + Y * f.right.y) / f.h, t: (X * f.up.x + Y * f.up.y) / f.h };
}
// head coordinates -> display point
export function fromHead(f, s, t) {
  const X = (s * f.right.x + t * f.up.x) * f.h, Y = (s * f.right.y + t * f.up.y) * f.h;
  return { x: f.origin.x + X / f.aspect, y: f.origin.y + Y };
}
export const headTop = (f, allow = FACE.headTopAllow) => fromHead(f, 0, 1 + allow);

export function faceBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of FACE_OVAL) { const p = pts[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1 };
}
export const ovalPolygon = pts => FACE_OVAL.map(i => ({ x: pts[i].x, y: pts[i].y }));

// ---- 3. pose ----
// Yaw from the landmarks alone: where the nose tip sits between the two cheek points. Positive = nose toward display-right.
// tan(yaw) = offset / noseDepth, where offset is measured in half face widths. Approximate (about +-10 degrees), but it needs no matrix.
export function landmarkYaw(pts, f, noseDepth = FACE.noseDepth) {
  const A = pts[LM.CHEEK_A], B = pts[LM.CHEEK_B], N = pts[LM.NOSE], asp = f.aspect;
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const half = Math.hypot((B.x - A.x) * asp, B.y - A.y) / 2;
  if (!(half > 1e-6)) return 0;
  const off = ((N.x - mx) * asp * f.right.x + (N.y - my) * f.right.y) / half;
  return Math.atan(off / noseDepth) * RAD;
}
// Pose from MediaPipe's facial transformation matrix (4x4, column-major).
// ASSUMED convention (checked at run time by createPoseAgreement, not taken on trust): camera space has x to the image right, y up,
// z toward the viewer; the face looks along its model +z (the third column), and its up axis is the second column.
// Returns { yaw, pitch, roll } in degrees for the RAW camera image; mirrored display flips yaw and roll.
export function matrixPose(m, mirror = true) {
  if (!m || m.length !== 16 || !m.every(Number.isFinite)) return null;
  const n = { x: m[8], y: m[9], z: m[10] }, u = { x: m[4], y: m[5] };
  const nl = Math.hypot(n.x, n.y, n.z) || 1;
  const yaw = Math.atan2(n.x, n.z) * RAD, pitch = Math.asin(clamp(n.y / nl, -1, 1)) * RAD, roll = Math.atan2(u.x, u.y) * RAD;
  return mirror ? { yaw: -yaw, pitch, roll: -roll } : { yaw, pitch, roll };
}
// Mirrors the matrix itself for a mirrored display (x axis flipped on both sides: M' = F M F, F = diag(-1,1,1,1)), column-major in and out.
export function mirrorMatrix(m) {
  const o = Float32Array.from(m), flipRow = [0], flipCol = [0];
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) if ((flipRow.includes(r)) !== (flipCol.includes(c))) o[c * 4 + r] = -m[c * 4 + r];
  return o;
}

// Cross-check of the matrix against the landmarks while the app runs (same idea as the S4 hand/mask agreement).
//   ok = same turn direction, flipped = consistently opposite (the convention differs: use the matrix with its yaw negated),
//   suspect = no clear relation (do not use the matrix), unknown = not enough samples yet.
export function createPoseAgreement({ window: win = FACE.pose.window, minAngle = FACE.pose.minAngle, agreeMin = FACE.pose.agreeMin, minSamples = FACE.pose.minSamples, rollTolDeg = FACE.pose.rollTolDeg } = {}) {
  let yawRing = [], rollRing = [];
  const push = (ring, v) => { ring.push(v); if (ring.length > win) ring.shift(); };
  const rate = ring => (ring.length ? ring.reduce((a, b) => a + b, 0) / ring.length : null);
  return {
    add(yawLm, yawM, rollFrame, rollM) {
      if (Math.abs(yawLm) >= minAngle && Math.abs(yawM) >= minAngle) push(yawRing, Math.sign(yawLm) === Math.sign(yawM) ? 1 : 0);
      push(rollRing, Math.abs(rollFrame - rollM) <= rollTolDeg ? 1 : 0);
    },
    get yawRate() { return rate(yawRing); }, get rollRate() { return rate(rollRing); }, get samples() { return yawRing.length; },
    get verdict() {
      if (yawRing.length < minSamples) return 'unknown';
      const r = rate(yawRing);
      return r >= agreeMin ? 'ok' : r <= 1 - agreeMin ? 'flipped' : 'suspect';
    },
    reset() { yawRing = []; rollRing = []; },
  };
}

// ---- 4. the tracker ----
// update(result, tMs, { mirror, aspect }):  result undefined = no new detection this frame (cadence skip),
// null = the model ran and saw no face, { pts, matrix } = a detection (from normalizeFaceResult).
// Returns a snapshot (always an object):
//   { present, conf (0..1), pts (smoothed, display), box, head (frame), headTop, chin, eyeMid, yaw, pitch, roll, poseSource, poseVerdict, matrix, ageMs, aspect }
export function createFaceTracker({ config = FACE } = {}) {
  const nf = () => Array.from({ length: 956 }, () => new OneEuro(config.filter));   // 478 points x (x, y); more than 478 are never used
  let filters = nf(), lastDet = -Infinity, last = null, lastCentre = null, rejected = 0, resets = 0;
  const agree = createPoseAgreement(config.pose);

  const resetFilters = () => { filters.forEach(f => f.reset()); resets++; };
  const none = (conf = 0) => ({ present: false, conf, pts: null, head: null, ageMs: Infinity });

  function ingest(res, t, mirror, aspect) {
    if (!res || !validPoints(res.pts)) { rejected++; return false; }
    const raw = toDisplayPoints(res.pts, mirror);
    const f0 = headFrame(raw, aspect);
    if (!f0 || f0.h < config.minHeight || f0.h > config.maxHeight) { rejected++; return false; }
    const centre = raw[LM.BROW_MID];
    const jumped = lastCentre && Math.hypot((centre.x - lastCentre.x) * aspect, centre.y - lastCentre.y) > config.jumpDist;
    if (t - lastDet > config.resetGapMs || t < lastDet || jumped) resetFilters();
    const pts = raw.map((p, i) => ({ x: filters[i * 2].filter(p.x, t), y: filters[i * 2 + 1].filter(p.y, t), z: p.z }));
    const head = headFrame(pts, aspect);
    if (!head) { rejected++; return false; }
    lastCentre = { x: centre.x, y: centre.y }; lastDet = t;
    const yawLm = landmarkYaw(pts, head, config.noseDepth);
    let yaw = yawLm, pitch = 0, source = 'landmarks', verdict = agree.verdict, matrix = null;
    const mp = matrixPose(res.matrix, mirror);
    if (mp) {
      agree.add(yawLm, mp.yaw, head.roll, mp.roll); verdict = agree.verdict;
      if (verdict === 'ok') { yaw = mp.yaw; source = 'matrix'; }
      else if (verdict === 'flipped') { yaw = -mp.yaw; source = 'matrix (yaw negated)'; }
      pitch = mp.pitch;
      matrix = mirror ? mirrorMatrix(res.matrix) : Float32Array.from(res.matrix);
    }
    last = { present: true, pts, box: faceBox(pts), head, headTop: headTop(head, config.headTopAllow), chin: pts[LM.CHIN], eyeMid: pts[LM.BROW_MID], yaw, yawLandmarks: yawLm, pitch, roll: head.roll, poseSource: source, poseVerdict: verdict, matrix, aspect, mirror };
    return true;
  }

  function update(result, tMs, { mirror = true, aspect = 16 / 9 } = {}) {
    if (result) ingest(result, tMs, mirror, aspect);
    else if (result === null) { /* the model ran and saw nobody: the hold/fade below does the rest */ }
    if (!last) return none();
    const age = tMs - lastDet;
    const conf = age <= config.holdMs ? 1 : clamp(1 - (age - config.holdMs) / config.fadeMs, 0, 1);
    if (conf <= 0) return { ...none(), poseVerdict: agree.verdict, ageMs: age };
    return { ...last, conf, ageMs: age };
  }
  return {
    update,
    reset() { filters.forEach(f => f.reset()); last = null; lastCentre = null; lastDet = -Infinity; agree.reset(); },
    get rejected() { return rejected; }, get resets() { return resets; }, get agreement() { return agree; },
  };
}

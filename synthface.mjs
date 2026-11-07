// Synthetic face for tests and previews: a simple 3D head model (478 landmark ids) rotated, scaled and placed like the real
// FaceLandmarker would report it for an UNMIRRORED camera image. Face height = distance from landmark 10 to the chin (152).
// Model space (face-height units): x to the image right, y up, z toward the camera; chin at y = -0.5, landmark 10 at y = +0.5.
// Pose sign conventions (same as facelm.js): yaw > 0 nose toward image-right, pitch > 0 looks up, roll > 0 top of the head toward image-right.
import { rng, gauss } from './synth.mjs';
import { FACE_OVAL, LM } from './facelm.js';

const RAD = Math.PI / 180;
const HALF_W = 0.39;
const MODEL = (() => {
  const P = Array.from({ length: 478 }, () => null);
  FACE_OVAL.forEach((id, k) => {                      // the oval: an ellipse, landmark 10 at the top, 152 at the bottom, 454/234 at the cheeks
    const a = k * 10 * RAD;
    P[id] = [HALF_W * Math.sin(a), 0.5 * Math.cos(a), -0.05 + 0.17 * Math.abs(Math.cos(a))];
  });
  const set = (id, x, y, z) => { P[id] = [x, y, z]; };
  set(LM.NOSE, 0, -0.04, 0.34); set(LM.BROW_MID, 0, 0.17, 0.12);
  set(LM.EYE_A_OUT, -0.2, 0.12, 0.08); set(LM.EYE_A_IN, -0.08, 0.12, 0.1); set(LM.EYE_B_OUT, 0.2, 0.12, 0.08); set(LM.EYE_B_IN, 0.08, 0.12, 0.1);
  set(LM.MOUTH_A, -0.13, -0.27, 0.1); set(LM.MOUTH_B, 0.13, -0.27, 0.1); set(LM.LIP_TOP, 0, -0.25, 0.14); set(LM.LIP_BOT, 0, -0.29, 0.14);
  set(LM.IRIS_A, -0.14, 0.12, 0.1); set(LM.IRIS_B, 0.14, 0.12, 0.1);
  const r = rng(99);                                  // everything else: deterministic points on the front of the face
  for (let i = 0; i < 478; i++) if (!P[i]) { const a = r() * 2 * Math.PI, d = Math.sqrt(r()) * 0.9; P[i] = [HALF_W * d * Math.sin(a), 0.5 * d * Math.cos(a), 0.15 * (1 - d * d)]; }
  return P;
})();

// R = Rz(roll) . Rpitch . Ryaw, row-major 3x3
export function rotation(yawDeg = 0, pitchDeg = 0, rollDeg = 0) {
  const y = yawDeg * RAD, p = pitchDeg * RAD, r = rollDeg * RAD;
  const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const Rp = [[1, 0, 0], [0, Math.cos(p), Math.sin(p)], [0, -Math.sin(p), Math.cos(p)]];
  const Rz = [[Math.cos(r), Math.sin(r), 0], [-Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
  return mul(Rz, mul(Rp, Ry));
}
export const matrixFrom = R => { const m = new Float32Array(16); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[r][c]; m[14] = -40; m[15] = 1; return m; };

// cx, cy: where the face centre (halfway between 10 and the chin) lands, normalized 0..1. height: face height in picture heights.
// noise: landmark jitter in picture-height units. matrixSign: -1 simulates a matrix with the opposite yaw/roll convention.
export function makeFace({ cx = 0.5, cy = 0.45, height = 0.3, yaw = 0, pitch = 0, roll = 0, aspect = 16 / 9, noise = 0, seed = 1, matrixSign = 1, withMatrix = true } = {}) {
  const R = rotation(yaw, pitch, roll), r = rng(seed);
  const pts = MODEL.map(([mx, my, mz]) => {
    const X = R[0][0] * mx + R[0][1] * my + R[0][2] * mz, Y = R[1][0] * mx + R[1][1] * my + R[1][2] * mz, Z = R[2][0] * mx + R[2][1] * my + R[2][2] * mz;
    return { x: cx + (height * X + (noise ? noise * gauss(r) : 0)) / aspect, y: cy - height * Y + (noise ? noise * gauss(r) : 0), z: -Z * height };
  });
  let m = matrixFrom(R);
  if (matrixSign < 0) m = matrixFrom(rotation(-yaw, pitch, -roll));
  return { pts, matrix: withMatrix ? m : null, result: { faceLandmarks: [pts], facialTransformationMatrixes: withMatrix ? [{ rows: 4, columns: 4, data: Array.from(m) }] : [] } };
}
export const modelPoint = id => MODEL[id].slice();

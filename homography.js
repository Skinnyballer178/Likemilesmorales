// Homography math for the frame window (pure functions, no DOM/GL, unit-tested in node).
// Matrices are row-major 3x3 as [[a,b,c],[d,e,f],[g,h,i]]. Coordinates are NORMALIZED display coords
// (0..1 across, 0..1 down) unless a function says "aspect space" (x multiplied by width/height).

// Unit square -> quad. Corner order matches the gesture: TL, TR, BR, BL  <->  uv (0,0), (1,0), (1,1), (0,1).
// Heckbert's projective mapping. Returns null for a degenerate quad (collinear corners / ~zero area).
export function squareToQuad(c) {
  if (!c || c.length !== 4 || c.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const [p0, p1, p2, p3] = c;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const H = [
    [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x],
    [p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y],
    [g, h, 1],
  ];
  // Area guard: reject collapsed quads (the matrix itself would be singular).
  return Math.abs(det3(H)) < 1e-14 ? null : H;
}

export const det3 = m =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

export function invert3(m) {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-14) return null;
  const [[a, b, c], [e, f, g], [h, i, j]] = m, k = 1 / d;
  return [
    [(f * j - g * i) * k, (c * i - b * j) * k, (b * g - c * f) * k],
    [(g * h - e * j) * k, (a * j - c * h) * k, (c * e - a * g) * k],
    [(e * i - f * h) * k, (b * h - a * i) * k, (a * f - b * e) * k],
  ];
}

export function applyH(m, u, v) {
  const w = m[2][0] * u + m[2][1] * v + m[2][2];
  return { x: (m[0][0] * u + m[0][1] * v + m[0][2]) / w, y: (m[1][0] * u + m[1][1] * v + m[1][2]) / w };
}

// Row-major 3x3 -> Float32Array in column-major order (what gl.uniformMatrix3fv wants with transpose=false).
export const toColumnMajor = m => new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);

// Everything the renderer needs for one frame, or null if the quad is unusable.
//  corners: 4 normalized points TL,TR,BR,BL (the full frame the user made)
//  hu, hv:  half-extent of the VISIBLE window in uv space (0.5 = fully open); the open/close animation shrinks these
//  returns { H, hinv (column-major Float32Array), quad (Float32Array(8), visible corners in aspect space), visible (4 normalized points) }
export function windowGeometry(corners, hu = 0.5, hv = 0.5, aspect = 16 / 9) {
  const H = squareToQuad(corners);
  if (!H) return null;
  const Hi = invert3(H);
  if (!Hi) return null;
  const uv = [[0.5 - hu, 0.5 - hv], [0.5 + hu, 0.5 - hv], [0.5 + hu, 0.5 + hv], [0.5 - hu, 0.5 + hv]];
  const visible = uv.map(([u, v]) => applyH(H, u, v));
  const quad = new Float32Array(8);
  visible.forEach((p, i) => { quad[i * 2] = p.x * aspect; quad[i * 2 + 1] = p.y; });
  return { H, hinv: toColumnMajor(Hi), quad, visible };
}

// Point-in-convex-quad (clockwise on screen, y down) in normalized coords; used by tests as the CPU ground truth.
export function insideQuad(pts, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cr === 0) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

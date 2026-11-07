// Hair/neck seam (Session 5). Pure functions: builds the soft-edged "face region" alpha map that the S9 mask render multiplies
// its texture by, so the mask meets the hair crisply, fades softly into the neck, never leaves the person silhouette and
// lets a fringe of hair stay in front of it.
//   alpha(pixel) = faceRegion(pixel)  x  (1 - hair in front of the forehead)  x  personInside(pixel)  x  face confidence
// A map is { w, h, data: Uint8Array (row 0 = top, display orientation), bbox:{x0,y0,x1,y1} (grid pixels, inclusive-exclusive), seq, stats }.
import { SEAM, SEG } from './config.js';
import { FACE_OVAL, toHead } from './facelm.js';

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };

// Feather width and outside-bias at face height t (0 chin .. 1 landmark 10): rows of cfg.feather blended with a smoothstep.
export function featherAt(t, rows = SEAM.feather) {
  if (t >= rows[0][0]) return { width: rows[0][1], bias: rows[0][2] };
  for (let i = 0; i < rows.length - 1; i++) {
    const [t0, w0, b0] = rows[i], [t1, w1, b1] = rows[i + 1];
    if (t <= t0 && t >= t1) { const k = smooth(t0, t1, t); return { width: w0 + (w1 - w0) * k, bias: b0 + (b1 - b0) * k }; }
  }
  const last = rows[rows.length - 1]; return { width: last[1], bias: last[2] };
}

// Signed distance (picture-height units, positive inside) from point (X, Y) to a polygon, plus the feather parameters at the nearest boundary point.
// poly: [{X, Y, w, b}] (X already multiplied by the aspect ratio).
function nearest(poly, X, Y) {
  let best = Infinity, w = 0, b = 0, crossings = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const ex = q.X - p.X, ey = q.Y - p.Y, len2 = ex * ex + ey * ey;
    let u = len2 > 0 ? ((X - p.X) * ex + (Y - p.Y) * ey) / len2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = X - (p.X + ex * u), dy = Y - (p.Y + ey * u), d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; w = p.w + (q.w - p.w) * u; b = p.b + (q.b - p.b) * u; }
    if ((p.Y > Y) !== (q.Y > Y) && X < p.X + ((Y - p.Y) / (q.Y - p.Y)) * ex) crossings++;   // ray casting
  }
  const d = Math.sqrt(best);
  return { d: crossings % 2 ? d : -d, w, b };
}

// Bilinear sample of one channel of a packed mask at display position (nx, ny); pixel centres sit at (i + 0.5) / size, edges clamp.
// (Nearest-pixel lookups made hard-edged masks stair-step along the hairline.)
function sampleMask(mask, nx, ny, ch) {
  const fx = nx * mask.w - 0.5, fy = ny * mask.h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const X0 = x0 < 0 ? 0 : x0 >= mask.w ? mask.w - 1 : x0, X1 = x0 + 1 < 0 ? 0 : x0 + 1 >= mask.w ? mask.w - 1 : x0 + 1;
  const Y0 = y0 < 0 ? 0 : y0 >= mask.h ? mask.h - 1 : y0, Y1 = y0 + 1 < 0 ? 0 : y0 + 1 >= mask.h ? mask.h - 1 : y0 + 1;
  const d = mask.data, w = mask.w;
  const a = d[(Y0 * w + X0) * 4 + ch] * (1 - ax) + d[(Y0 * w + X1) * 4 + ch] * ax, b = d[(Y1 * w + X0) * 4 + ch] * (1 - ax) + d[(Y1 * w + X1) * 4 + ch] * ax;
  return (a * (1 - ay) + b * ay) / 255;
}

// Builds the polygon of the face region with per-vertex feather settings (feather widths are in picture-height units).
export function seamPolygon(face, cfg = SEAM) {
  const f = face.head, asp = f.aspect;
  return FACE_OVAL.map(i => {
    const p = face.pts[i], { t } = toHead(f, p), { width, bias } = featherAt(t, cfg.feather);
    return { X: p.x * asp, Y: p.y, w: width * f.h, b: bias };
  });
}

// face: a tracker snapshot (present, conf, pts, head). mask: S4 packed mask { w, h, data RGBA } or null. Returns a map (see top of file).
// hairLayer: whether the mask's G channel holds hair (S4 leaves a layer at 0 when it is not asked for).
// `out` may be a previous map of the same size: its buffer is reused (no allocation per frame).
export function buildSeam({ face, mask = null, aspect, cfg = SEAM, out = null, hairLayer = SEG.layers.includes('hair') }) {
  const { w, h } = cfg.grid;
  const map = out && out.w === w && out.h === h ? out : { w, h, data: new Uint8Array(w * h), bbox: null, seq: 0, stats: null };
  map.data.fill(0); map.bbox = null; map.seq++;
  map.stats = { coverage: 0, hairCut: 0, personClip: 0, maskUsed: !!mask, hairUsed: false };
  if (!face || !face.present || !(face.conf > 0) || !face.head) return map;
  const asp = aspect || face.head.aspect, f = face.head;
  const poly = seamPolygon(face, cfg), reach = Math.max(...poly.map(p => p.w * (1 + p.b)));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { if (p.X < minX) minX = p.X; if (p.X > maxX) maxX = p.X; if (p.Y < minY) minY = p.Y; if (p.Y > maxY) maxY = p.Y; }
  const x0 = Math.max(0, Math.floor((minX - reach) / asp * w)), x1 = Math.min(w, Math.ceil((maxX + reach) / asp * w) + 1);
  const y0 = Math.max(0, Math.floor((minY - reach) * h)), y1 = Math.min(h, Math.ceil((maxY + reach) * h) + 1);
  if (x1 <= x0 || y1 <= y0) return map;
  const hair = cfg.hair, pr = cfg.person;
  const hasHair = !!mask && !!mask.data && hairLayer;      // the hair channel (G) is only filled when the segmenter was asked for it
  map.stats.hairUsed = hasHair;
  let covered = 0, hairCut = 0, clipped = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const nx = (x + 0.5) / w, ny = (y + 0.5) / h, X = nx * asp, Y = ny;
      const { d, w: fw, b } = nearest(poly, X, Y);
      if (d < -fw * b) continue;                                    // beyond the fade on the outside: exactly 0
      let a = smooth(-b * fw, (1 - b) * fw, d);
      if (a <= 0) continue;
      if (mask && mask.data) {
        const person = smooth(pr[0], pr[1], sampleMask(mask, nx, ny, 0));
        if (person < 1) clipped += a * (1 - person);
        a *= person;
        if (hasHair && a > 0) {
          const t = toHead(f, { x: nx, y: ny }).t, ramp = smooth(hair.from, hair.to, t);
          if (ramp > 0) {
            const hv = sampleMask(mask, nx, ny, 1), keep = 1 - hair.keep * hv * ramp; hairCut += a * (1 - keep); a *= keep;
          }
        }
      }
      a *= clamp01(face.conf);
      if (a > 0) {
        const v = Math.round(a * 255); map.data[y * w + x] = v; covered += a;
        if (!map.bbox) map.bbox = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
        else { const bb = map.bbox; if (x < bb.x0) bb.x0 = x; if (y < bb.y0) bb.y0 = y; if (x + 1 > bb.x1) bb.x1 = x + 1; if (y + 1 > bb.y1) bb.y1 = y + 1; }
      }
    }
  }
  const n = w * h;
  map.stats.coverage = covered / n; map.stats.hairCut = hairCut / n; map.stats.personClip = clipped / n;
  return map;
}

// Synthetic person silhouettes for tests and previews: a soft head + neck + shoulders (+ optional raised hand) as a
// person-confidence array in DISPLAY orientation (row 0 = top), like the model's output would be.
// Coordinates are picture-height units: x is multiplied by the aspect ratio so shapes are not stretched.
import { rng } from './synth.mjs';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// shapes: ellipses {cx, cy, rx, ry} in picture-height units
export function silhouetteShapes({ cx = 0.5, aspect = 16 / 9, headY = 0.40, scale = 1, hand = null } = {}) {
  const X = cx * aspect, s = scale, shapes = [
    { cx: X, cy: headY, rx: 0.085 * s, ry: 0.11 * s },            // head
    { cx: X, cy: headY + 0.14 * s, rx: 0.035 * s, ry: 0.07 * s },  // neck
    { cx: X, cy: headY + 0.55 * s, rx: 0.30 * s, ry: 0.36 * s },   // shoulders and chest
  ];
  if (hand) shapes.push({ cx: hand.x * aspect, cy: hand.y, rx: 0.035 * s, ry: 0.05 * s });
  return shapes;
}
export function personMask(w, h, { edge = 0.006, noise = 0, seed = 1, ...opt } = {}) {
  const aspect = opt.aspect ?? w / h, shapes = silhouetteShapes({ ...opt, aspect }), r = rng(seed), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x + 0.5) / w * aspect, py = (y + 0.5) / h; let v = 0;
    for (const e of shapes) {
      const f = 1 - Math.hypot((px - e.cx) / e.rx, (py - e.cy) / e.ry);       // > 0 inside
      v = Math.max(v, smooth(-edge, edge, f * Math.min(e.rx, e.ry)));
    }
    if (noise) v = Math.min(1, Math.max(0, v + (r() - 0.5) * 2 * noise * (v > 0.02 && v < 0.98 ? 1 : 0.15)));
    out[y * w + x] = v;
  }
  return out;
}
// Fake camera picture (RGB 0..255 function of normalized x,y) with the same silhouette painted in, for previews.
export function fakeCamera(opt = {}) {
  const aspect = opt.aspect ?? 16 / 9, shapes = silhouetteShapes({ ...opt, aspect });
  return (x, y) => {
    let v = 0; const px = x * aspect;
    for (const e of shapes) { const f = 1 - Math.hypot((px - e.cx) / e.rx, (y - e.cy) / e.ry); v = Math.max(v, smooth(-0.004, 0.004, f * Math.min(e.rx, e.ry))); }
    const bg = [92 + 40 * x, 84 + 30 * y, 78 + 26 * x];                        // a plain room
    const body = [196 - 30 * y, 150 - 30 * y, 124 - 20 * y];                   // skin / shirt tone
    return bg.map((c, i) => c * (1 - v) + body[i] * v);
  };
}

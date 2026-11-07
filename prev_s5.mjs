// Seam preview (no GPU needed): paints a synthetic person (hair, face, neck, shoulders), runs the face tracker + seam on its landmarks,
// and writes PNGs showing a stand-in red mask multiplied by the seam alpha. Usage: node prev_s5.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';
import { makeFace } from './synthface.mjs';
import { createFaceTracker, normalizeFaceResult, toHead } from './facelm.js';
import { buildSeam } from './faceseam.js';
const out = process.argv[2] || 'preview-s5', W = 960, H = 540, A = W / H, MW = 384, MH = 216;
mkdirSync(out, { recursive: true });

function scene({ cx, cy, height, roll = 0, yaw = 0, fringe = true }) {
  const fr = makeFace({ aspect: A, cx, cy, height, roll, yaw });
  const tr = createFaceTracker().update(normalizeFaceResult(fr.result), 0, { mirror: false, aspect: A });
  const head = tr.head;
  const q = (x, y) => toHead(head, { x, y });                                // head coordinates of a picture point
  const person = (x, y) => { const { s, t } = q(x, y); const head2 = Math.hypot(s / 0.50, (t - 0.62) / 0.82) < 1, neck = Math.abs(s) < 0.25 && t < 0.2 && t > -0.9, sh = t < -0.55 && Math.abs(s) < 1.5 && Math.hypot(s / 1.55, (t + 1.45) / 0.9) < 1; return head2 || neck || sh ? 1 : 0; };
  const hair = (x, y) => { const { s, t } = q(x, y); const inHead = Math.hypot(s / 0.50, (t - 0.62) / 0.82) < 1; const onFace = Math.hypot(s / 0.39, (t - 0.5) / 0.5) < 1; const cap = t > (fringe ? 0.80 : 0.97) - 0.25 * Math.abs(s) * 0 || (Math.abs(s) > 0.33 && t > 0.45); return inHead && cap && !(onFace && t < 0.80 - 0 && Math.abs(s) < 0.3 && t < 0.8) ? 1 : 0; };
  const color = (x, y) => {
    const bg = [70 + 40 * x, 66 + 30 * y, 78 + 20 * x];
    if (!person(x, y)) return bg;
    const { s, t } = q(x, y);
    if (hair(x, y)) return [58, 38, 26];
    if (t < -0.55) return [74, 90, 128];                                        // shirt
    return t < 0.0 && Math.abs(s) < 0.25 ? [190, 140, 112] : [226, 170, 140];  // neck darker, face lighter
  };
  return { tr, color, person, hair };
}
function maskFrom(sc) {
  const data = new Uint8Array(MW * MH * 4);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const nx = (x + 0.5) / MW, ny = (y + 0.5) / MH, o = (y * MW + x) * 4; data[o] = sc.person(nx, ny) * 255; data[o + 1] = sc.hair(nx, ny) * 255; }
  return { w: MW, h: MH, data, seq: 1 };
}
function render(name, opt, { useMask = true, view = 'mask' } = {}) {
  const sc = scene(opt), mask = useMask ? maskFrom(sc) : null, seam = buildSeam({ face: sc.tr, mask, aspect: A, hairLayer: true });
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5) / W, ny = (y + 0.5) / H, base = sc.color(nx, ny);
    // bilinear-ish: sample the 192x108 map smoothly so the preview shows what a GPU texture lookup would
    const fx = nx * seam.w - 0.5, fy = ny * seam.h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const g = (xx, yy) => seam.data[Math.min(seam.h - 1, Math.max(0, yy)) * seam.w + Math.min(seam.w - 1, Math.max(0, xx))] / 255;
    const a = (g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax) * (1 - ay) + (g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax) * ay;
    const mask = [200, 20, 36], col = view === 'alpha' ? [a * 255, a * 255, a * 255] : base.map((c, i) => c * (1 - a * 0.92) + mask[i] * a * 0.92);
    const o = (y * W + x) * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
  }
  writeFileSync(`${out}/${name}.png`, encodePNG(W, H, px));
  return seam.stats;
}
const poses = { frontal: { cx: 0.5, cy: 0.40, height: 0.34 }, tilted: { cx: 0.42, cy: 0.42, height: 0.34, roll: 22, yaw: 18 }, nofringe: { cx: 0.55, cy: 0.40, height: 0.34, roll: -10, fringe: false } };
for (const [n, o] of Object.entries(poses)) { const s = render(`${n}-mask-over-person`, o); render(`${n}-alpha`, o, { view: 'alpha' }); console.log(n, JSON.stringify(s)); }
render('frontal-no-segmentation', poses.frontal, { useMask: false });
console.log('ok');

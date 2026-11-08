// Preview of the textured looks on the synthetic person using the REAL fabric pictures (assets/*.webp converted to /tmp/*.rgba by a python one-liner). Dev tool only.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import createGL from 'gl';
import { createSuitRenderer } from './suitgl.js';
import { analyzeBody, wristBands } from './suitmodel.js';
import { encodePNG, compositeOverCamera } from './png.mjs';
const W = 960, H = 540, A = W / H, gl = createGL(W, H, { preserveDrawingBuffer: true, premultipliedAlpha: true });
const r = createSuitRenderer({ gl, width: W, height: H });
r.setTexture('suit', { w: 540, h: 1200, data: new Uint8Array(readFileSync('/tmp/suit.rgba')) }); r.setTexture('jacket', { w: 750, h: 1720, data: new Uint8Array(readFileSync('/tmp/jacket.rgba')) });
// a more person-like mask: head+neck, shoulders sloping, torso, both arms hanging
const w = 192, h = 108, data = new Uint8Array(w * h * 4), set = (x, y, p, s, c) => { const i = (y * w + x) * 4; data[i] = p ? 255 : 0; data[i + 2] = s ? 255 : 0; data[i + 3] = c ? 255 : 0; };
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const hx = (x - 96) / 15, hy = (y - 26) / 20;
  if (hx * hx + hy * hy <= 1) set(x, y, 1, 1, 0);
  else if (y >= 40 && y < 48 && Math.abs(x - 96) < 7) set(x, y, 1, 1, 0);                                  // neck
  else if (y >= 48 && Math.abs(x - 96) < 22 + Math.min(y - 48, 14) * 1.6) set(x, y, 1, 0, 1);              // shoulders widening into the torso
  else if (y >= 62 && Math.abs(x - 96) < 44) set(x, y, 1, 0, 1);
  else if (y >= 55 && ((x > 134 && x < 150) || (x > 42 && x < 58))) set(x, y, 1, 1, 0);                    // bare arms
}
const mask = { w, h, data }, body = analyzeBody(mask); r.setMask(mask);
mkdirSync('preview-s7b', { recursive: true });
const cam = (u, v) => { const x = Math.min(w - 1, Math.floor(u * w)), y = Math.min(h - 1, Math.floor(v * h)), i = (y * w + x) * 4; return data[i + 2] ? [205, 160, 135] : data[i + 3] ? [150, 150, 160] : data[i] ? [200, 200, 200] : [120, 110, 100]; };
for (const look of ['suit', 'jacket']) {
  r.draw({ body, bands: [], aspect: A, look }); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  writeFileSync(`preview-s7b/${look}.png`, encodePNG(W, H, compositeOverCamera(W, H, px, cam)));
}
console.log('body', JSON.stringify(body));

// Headless WebGL tests for the Suit look. Run with:  xvfb-run -a node --test suitgl.test.mjs   (needs the optional "gl" package)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSuitRenderer } from './suitgl.js';
import { analyzeBody, wristBands } from './suitmodel.js';
import { encodePNG, compositeOverCamera } from './png.mjs';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { /* optional */ }
const W = 640, H = 360, A = W / H;
const gl = createGL ? createGL(W, H, { preserveDrawingBuffer: true, premultipliedAlpha: true }) : null;
const skip = gl ? false : 'no headless WebGL here (install "gl" and run under xvfb-run -a)';
const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
const at = (px, x, y) => { const i = ((H - 1 - Math.round(y * H - 0.5)) * W + Math.round(x * W - 0.5)) * 4; return [...px.slice(i, i + 4)]; };   // x, y from the top-left like the picture

// Person on a 96x54 mask: head (skin), torso (clothes), a raised forearm + hand (skin) on the right of the head.
function scene() {
  const w = 96, h = 54, data = new Uint8Array(w * h * 4);
  const set = (x, y, p, s, c) => { const i = (y * w + x) * 4; data[i] = p ? 255 : 0; data[i + 1] = 0; data[i + 2] = s ? 255 : 0; data[i + 3] = c ? 255 : 0; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hy = (y - 13) / 7, hx = (x - 48) / 8;
    if (hx * hx + hy * hy <= 1) set(x, y, 1, 1, 0);
    else if (y >= 26 && x >= 24 && x < 72) set(x, y, 1, 0, 1);
    else if (x >= 66 && x < 72 && y >= 10 && y < 26) set(x, y, 1, 1, 0);            // raised forearm next to the head, above the shoulder line
  }
  const mask = { w, h, data }, body = analyzeBody(mask);
  const pts = Array.from({ length: 21 }, () => ({ x: 0.69, y: 0.3 })); pts[0] = { x: 0.69, y: 0.45 }; pts[9] = { x: 0.69, y: 0.3 };
  return { mask, body, bands: wristBands([{ pts }], A) };
}

test('Suit: paints body and hand, leaves the head and background alone, red emblem on the chest', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene();
  r.setMask(s.mask); assert.ok(r.draw({ body: s.body, bands: s.bands, aspect: A }));
  const px = read();
  assert.equal(at(px, 0.5, 0.24)[3], 0, 'face is not painted');
  assert.equal(at(px, 0.1, 0.5)[3], 0, 'background is not painted');
  const shirt = []; for (let i = 0; i < 12; i++) shirt.push(at(px, 0.3 + 0.035 * i, 0.8));
  assert.ok(shirt.every(p => p[3] > 200) && shirt.filter(p => p[0] < 90).length >= 6, 'shirt becomes a dark suit with web lines: ' + shirt.join(' | '));
  const c = s.body.chest, ring = at(px, c.x + 0.14 * c.s, c.y);       // on the emblem ring (chest width units)
  assert.ok(ring[3] > 200 && ring[0] > ring[2] * 2, 'emblem ring is red: ' + ring);
  const hand = at(px, 0.69, 0.33); assert.ok(hand[3] > 150, 'raised hand above the neck line is suited: ' + hand);
  let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 120 && px[i] > px[i + 2] * 2) red++;
  assert.ok(red > 300, 'red web/emblem/band pixels exist: ' + red);
});

test('Suit: emblem follows the body (moves with the chest)', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene();
  r.setMask(s.mask);
  const shifted = { ...s.body, chest: { ...s.body.chest, x: s.body.chest.x - 0.1 } };
  const centroid = body => { r.draw({ body, bands: [], aspect: A }); const px = read(); let sx = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (px[i] > 140 && px[i] > px[i + 2] * 2 && Math.abs(y / H - (1 - body.chest.y)) < 0.05 && Math.abs(x / W - body.chest.x) < 0.16 * body.chest.s / A * 1) { sx += x; n++; } } return sx / n / W; };
  assert.ok(centroid(s.body) - centroid(shifted) > 0.05);
});

test('Suit: no mask / no body = nothing drawn', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene();
  assert.equal(r.draw({ body: s.body, bands: [], aspect: A }), false);
  r.setMask(s.mask); assert.equal(r.draw({ body: null, bands: [], aspect: A }), false);
});

test('Suit: frame time and preview PNG', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  const t0 = performance.now(); for (let i = 0; i < 20; i++) { r.draw({ body: s.body, bands: s.bands, aspect: A }); read(); }
  const ms = (performance.now() - t0) / 20; console.log(`suit draw+readback ${ms.toFixed(1)} ms (software GL, upper bound)`);
  assert.ok(ms < 150);
  r.draw({ body: s.body, bands: s.bands, aspect: A });
  const cam = (u, v) => { const m = s.mask, x = Math.min(m.w - 1, Math.floor(u * m.w)), y = Math.min(m.h - 1, Math.floor(v * m.h)), i = (y * m.w + x) * 4; return m.data[i + 2] ? [205, 160, 135] : m.data[i + 3] ? [70, 100, 160] : m.data[i] ? [200, 200, 200] : [90, 95, 105]; };
  mkdirSync('preview-s6', { recursive: true });
  writeFileSync('preview-s6/suit.png', encodePNG(W, H, compositeOverCamera(W, H, read(), cam)));
});

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
  const c = s.body.chest, ring = at(px, c.x + 0.2 * c.s, c.y);        // on the emblem ring (0.2 chest widths)
  assert.ok(ring[3] > 200 && ring[0] > ring[2] * 2, 'emblem ring is red: ' + ring);
  const hand = at(px, 0.69, 0.33); assert.ok(hand[3] > 150, 'raised hand above the neck line is suited: ' + hand);
  let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 70 && px[i] > px[i + 2] * 2) red++;
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

// ---- Session 7: Jacket look ----
const jacket = (r, s) => r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'jacket' });

test('Jacket: blue puffer on the torso, red hood around the head, face opening left clear, hand in front of the sleeve', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  assert.ok(jacket(r, s)); const px = read(), h = s.body.head;
  const torso = []; for (let i = 0; i < 4; i++) torso.push(at(px, 0.28 + 0.025 * i, 0.82), at(px, 0.62 + 0.025 * i, 0.82));
  assert.ok(torso.every(p => p[3] > 220 && p[2] > p[0] * 1.5), 'jacket panels are blue and opaque: ' + torso.join(' | '));
  const suitMid = at(px, 0.5, 0.85); let hoodie = [0, 0, 0, 0]; for (let x = 0.53; x < 0.6; x += 0.004) { const p = at(px, x, 0.85); if (p[0] > hoodie[0]) hoodie = p; }
  assert.ok(suitMid[3] > 200 && suitMid[2] < 70, 'open front shows the dark suit: ' + suitMid);
  assert.ok(hoodie[3] > 200 && hoodie[0] > hoodie[2] * 2, 'red hoodie strip beside it: ' + hoodie);
  const face = at(px, h.cx, h.cy); assert.equal(face[3], 0, 'face opening stays clear: ' + face);
  const hood = at(px, h.cx, h.cy - h.ry * 1.15); assert.ok(hood[3] > 220 && hood[0] > hood[2] * 3, 'hood above the head is red: ' + hood);
  const hoodSide = at(px, h.cx - h.rx * 1.25, h.cy); assert.ok(hoodSide[3] > 220 && hoodSide[0] > hoodSide[2] * 3, 'hood beside the face is red: ' + hoodSide);
  assert.equal(at(px, 0.05, 0.5)[3], 0, 'far background untouched');
  const hand = at(px, 0.69, 0.33); assert.ok(hand[3] > 150 && hand[2] < 80, 'raised hand is a dark suit glove, over the hood/sleeve: ' + hand);
});

test('Jacket: puffer bulk grows the silhouette by about SUIT.jacket.bulk, and no further', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask); jacket(r, s); const px = read();
  const bulkX = 0.07 * s.body.chest.s * A / A;                    // chest-width units -> picture-height units -> x units (divide by aspect)
  const edge = 72 / 96;                                           // right edge of the torso in the mask
  assert.ok(at(px, edge + bulkX * 0.4, 0.85)[3] > 80, 'inside the bulk band');
  assert.equal(at(px, edge + bulkX * 2.5 + 0.02, 0.85)[3], 0, 'beyond the bulk band');
});

test('Jacket: quilting rows run across the torso (colour repeats down the chest, not across it)', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask); jacket(r, s); const px = read();
  const col = y => at(px, 0.34, y)[2], variance = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; };
  const down = [], across = []; for (let i = 0; i < 30; i++) { down.push(col(0.62 + i * 0.012)); across.push(at(px, 0.30 + i * 0.002, 0.8)[2]); }
  assert.ok(variance(down) > 4 * variance(across), `rows vary down (${variance(down).toFixed(0)}) more than across (${variance(across).toFixed(0)})`);
});

test('Jacket: suit and jacket never mix (no red emblem in Jacket, no blue in Suit)', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  const blue = px => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200 && px[i + 2] > px[i] * 1.6 && px[i + 2] > 90) n++; return n; };
  r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'suit' }); assert.ok(blue(read()) < 50, 'no blue in Suit');
  jacket(r, s); const px = read(); assert.ok(blue(px) > 3000, 'blue in Jacket');
  const reds = px => { let n = 0; for (let y = 0.8; y < 0.98; y += 0.004) for (const x0 of [0.29, 0.61]) for (let x = x0; x < x0 + 0.09; x += 0.004) { const p = at(px, x, y); if (p[3] > 200 && p[0] > p[2] * 2) n++; } return n; };
  assert.equal(reds(px), 0, 'no red web / emblem on the jacket body');
  r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'suit' }); assert.ok(reds(read()) > 40, 'the same area has red web in Suit');
});

test('Jacket: preview PNG and frame time', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  const t0 = performance.now(); for (let i = 0; i < 20; i++) { jacket(r, s); read(); }
  const ms = (performance.now() - t0) / 20; console.log(`jacket draw+readback ${ms.toFixed(1)} ms (software GL, upper bound)`); assert.ok(ms < 200);
  jacket(r, s);
  const cam = (u, v) => { const m = s.mask, x = Math.min(m.w - 1, Math.floor(u * m.w)), y = Math.min(m.h - 1, Math.floor(v * m.h)), i = (y * m.w + x) * 4; return m.data[i + 2] ? [205, 160, 135] : m.data[i + 3] ? [70, 100, 160] : m.data[i] ? [200, 200, 200] : [90, 95, 105]; };
  mkdirSync('preview-s7', { recursive: true });
  writeFileSync('preview-s7/jacket.png', encodePNG(W, H, compositeOverCamera(W, H, read(), cam)));
});

test('Reveal: 0 draws nothing, in between draws some slices, 1 draws everything; light shading multiplies the fabric', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  const alphaCount = px => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 20) n++; return n; };
  r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'suit', reveal: 0 }); assert.equal(alphaCount(read()), 0, 'nothing before the frame');
  r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'suit', reveal: 1 }); const full = alphaCount(read());
  r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'suit', reveal: 0.5 }); const half = alphaCount(read());
  assert.ok(half > full * 0.15 && half < full * 0.95, `half-way reveal shows some slices: ${half} of ${full}`);
  // light: a bright camera picture makes the fabric lighter than a dark one
  const mk = v => ({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(v) });
  const bright = (lumV, avgV) => { r.setLight(mk(lumV), mk(avgV)); r.draw({ body: s.body, bands: s.bands, aspect: A, look: 'jacket' }); const p = at(read(), 0.3, 0.85); return p[2]; };
  assert.ok(bright(230, 128) > bright(128, 128) && bright(128, 128) > bright(40, 128), 'brighter live picture = lighter fabric');
});

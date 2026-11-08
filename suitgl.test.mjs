// Headless WebGL tests for the Suit / Jacket looks (textured). Run with:  xvfb-run -a node --test suitgl.test.mjs   (needs the optional "gl" package)
// The fabric textures here are synthetic position maps (red = x, green = y of the texel), so every test can tell exactly WHICH texel of the Grok picture a screen pixel shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuitRenderer } from './suitgl.js';
import { analyzeBody, wristBands, armSides } from './suitmodel.js';
import { SUIT, TEX } from './config.js';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { /* optional */ }
const W = 640, H = 360, A = W / H;
const gl = createGL ? createGL(W, H, { preserveDrawingBuffer: true, premultipliedAlpha: true }) : null;
const skip = gl ? false : 'no headless WebGL here (install "gl" and run under xvfb-run -a)';
const readPx = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
// x, y from the top-left (0..1) like the picture; returns un-premultiplied [r, g, b, a] in 0..1
const at = (px, x, y) => { const i = ((H - 1 - Math.round(y * H - 0.5)) * W + Math.round(x * W - 0.5)) * 4, a = px[i + 3] / 255; return a > 0 ? [px[i] / 255 / a, px[i + 1] / 255 / a, px[i + 2] / 255 / a, a] : [0, 0, 0, 0]; };
const near = (v, e, tol, msg) => assert.ok(Math.abs(v - e) <= tol, `${msg}: got ${v.toFixed(3)}, expected ${e.toFixed(3)} (+-${tol})`);

// position-map texture for a crop of cw x ch original pixels, drawn at 2x
function posTex(crop) { const w = crop[2] * 2, h = crop[3] * 2, data = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = Math.round(255 * x / w); data[i + 1] = Math.round(255 * y / h); data[i + 2] = 128; data[i + 3] = 255; } return { w, h, data }; }
const solidTex = (crop, rgb) => { const w = 8, h = 8, data = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4); return { w, h, data }; };
const texel = (T, px, py) => [(px - T.crop[0]) / T.crop[2], (py - T.crop[1]) / T.crop[3]];   // original px -> expected [R, G]

function renderer() { const r = createSuitRenderer({ gl, width: W, height: H }); r.setTexture('suit', posTex(TEX.suit.crop)); r.setTexture('jacket', posTex(TEX.jacket.crop)); return r; }

// Person on a 96x54 mask: head (skin), torso (clothes), a raised forearm + hand (skin) on the right of the head.
function scene() {
  const w = 96, h = 54, data = new Uint8Array(w * h * 4);
  const set = (x, y, p, s, c) => { const i = (y * w + x) * 4; data[i] = p ? 255 : 0; data[i + 1] = 0; data[i + 2] = s ? 255 : 0; data[i + 3] = c ? 255 : 0; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hy = (y - 13) / 7, hx = (x - 48) / 8;
    if (hx * hx + hy * hy <= 1) set(x, y, 1, 1, 0);
    else if (y >= 26 && x >= 24 && x < 72) set(x, y, 1, 0, 1);
    else if (x >= 66 && x < 72 && y >= 10 && y < 26) set(x, y, 1, 1, 0);
  }
  const mask = { w, h, data }, body = analyzeBody(mask);
  const pts = Array.from({ length: 21 }, () => ({ x: 0.69, y: 0.3 })); pts[0] = { x: 0.69, y: 0.45 }; pts[9] = { x: 0.69, y: 0.3 };
  return { mask, body, bands: wristBands([{ pts }], A) };
}
const draw = (r, s, o = {}) => r.draw({ body: s.body, bands: s.bands, aspect: A, ...o });

// JS mirror of the shader's lookup (figPx), used to predict which texel a pixel must show
function figPxJS(look, s, X, Y, bands = s.bands) {
  const F = TEX[look], cw = s.body.chest.s * A, k = F.cw / cw, cx = s.body.chest.x * A;
  const p = [X * A, Y], tor = [F.cx + (p[0] - cx) * k, F.shoulderY + (p[1] - s.body.torso) * k];
  const qx = (p[0] - cx) / cw, sw = Math.min(1, Math.max(0, (Math.abs(qx) - 0.40) / 0.12)), sm = sw * sw * (3 - 2 * sw);
  const arms = armSides(bands, s.body, A, SUIT), ua = qx > 0 ? arms.right : arms.left, fa = qx > 0 ? F.armR : F.armL;
  const rel = [p[0] - ua.x, p[1] - ua.y], along = rel[0] * ua.dx + rel[1] * ua.dy, across = -rel[0] * ua.dy + rel[1] * ua.dx;
  const arm = [fa.s[0] + (along * fa.d[0] + across * -fa.d[1]) * k, fa.s[1] + (along * fa.d[1] + across * fa.d[0]) * k];
  return [tor[0] + (arm[0] - tor[0]) * sm, tor[1] + (arm[1] - tor[1]) * sm];
}

test('Suit: torso pixels show the texel the shoulder-line / chest-width mapping predicts; the face and background stay clear', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); assert.ok(draw(r, s)); const px = readPx();
  for (const [dx, dy] of [[0, 0.03], [0.15 * s.body.chest.s, 0.03], [-0.12 * s.body.chest.s, 0.12], [0.05, 0.3]]) {
    const X = s.body.chest.x + dx, Y = s.body.torso + dy, c = at(px, X, Y), e = figPxJS('suit', s, X, Y), [er, eg] = texel(TEX.suit, e[0], e[1]);
    assert.ok(c[3] > 0.9 * SUIT.alpha, `opaque at ${X.toFixed(2)},${Y.toFixed(2)}`); near(c[0], er, 0.05, `texel x at ${X.toFixed(2)},${Y.toFixed(2)}`); near(c[1], eg, 0.05, `texel y at ${X.toFixed(2)},${Y.toFixed(2)}`);
  }
  const c0 = at(px, s.body.chest.x, s.body.torso + 0.03); near(c0[0], texel(TEX.suit, TEX.suit.cx, 0)[0], 0.05, 'centre line of the figure is on the user centre'); near(c0[1], texel(TEX.suit, 0, TEX.suit.shoulderY + 0.03 / (s.body.chest.s * A) * TEX.suit.cw)[1], 0.05, 'shoulder line is on the user shoulder line');
  assert.equal(at(px, s.body.head.cx, s.body.head.cy)[3], 0, 'face is not painted');
  assert.equal(at(px, 0.05, 0.5)[3], 0, 'background is not painted');
});

test('Suit: the fabric follows the body (moves with the chest) and scales with it', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); const first = c => { draw(r, { ...s, body: c }); const px = readPx(); for (let x = 0; x < 1; x += 0.002) { const p = at(px, x, 0.8); if (p[3] > 0.5) return x; } return -1; };
  const shifted = { ...s.body, chest: { ...s.body.chest, x: s.body.chest.x - 0.1 } };
  // the texel under a fixed screen point must change by the shift scaled to figure pixels
  draw(r, s); const a = at(readPx(), 0.5, 0.7); draw(r, { ...s, body: shifted }); const b = at(readPx(), 0.5, 0.7);
  near(a[0] - b[0], -(0.1 / s.body.chest.s) * TEX.suit.cw / TEX.suit.crop[2], 0.04, 'texel x shifts by the chest shift (in figure pixels)');
  const big = { ...s.body, chest: { ...s.body.chest, s: s.body.chest.s * 1.5 } }; draw(r, { ...s, body: big }); const c = at(readPx(), 0.5 + 0.1, 0.7), d = (() => { draw(r, s); return at(readPx(), 0.6, 0.7); })();
  assert.ok(Math.abs(c[0] - 0.5) < Math.abs(d[0] - 0.5), 'a bigger body = the figure is shown larger (less texel distance for the same offset)');
  assert.ok(first(s.body) >= 0);
});

test('Suit: sleeves follow the arm axis (hanging arm and a raised, tracked hand)', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); draw(r, s); const px = readPx();
  for (const [X, Y] of [[0.72, 0.62], [0.28, 0.7]]) {
    const c = at(px, X, Y), e = figPxJS('suit', s, X, Y), [er, eg] = texel(TEX.suit, e[0], e[1]);
    assert.ok(c[3] > 0.5, 'sleeve pixel covered'); near(c[0], er, 0.05, `sleeve texel x at ${X},${Y}`); near(c[1], eg, 0.05, `sleeve texel y at ${X},${Y}`);
  }
  // raise the right sleeve: with the hand up, the right sleeve axis points up, so a point above the shoulder maps further UP the figure's arm than a hanging one
  const pts = Array.from({ length: 21 }, () => ({ x: 0.75, y: 0.15 })); pts[0] = { x: 0.74, y: 0.22 }; pts[9] = { x: 0.75, y: 0.14 };   // a hand held high on the right
  const high = wristBands([{ pts }], A), up = armSides(high, s.body, A, SUIT).right;
  assert.ok(up.dy < -0.5, 'right sleeve axis points up towards the tracked hand: ' + JSON.stringify(up));
  const s2 = { ...s, bands: high }; r.draw({ body: s2.body, bands: high, aspect: A }); const c = at(readPx(), 0.72, 0.62), e = figPxJS('suit', s2, 0.72, 0.62, high), [er, eg] = texel(TEX.suit, e[0], e[1]);
  near(c[0], er, 0.05, 'raised-arm texel x'); near(c[1], eg, 0.05, 'raised-arm texel y');
  assert.ok(Math.hypot(...figPxJS('suit', s2, 0.74, 0.62, high).map((v, i) => v - figPxJS('suit', s, 0.74, 0.62, s.bands)[i])) > 5, 'a raised arm changes the lookup');
});

test('Suit: hands are plain suit fabric (glove patch), even above the neck line', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); draw(r, s); const c = at(readPx(), 0.72, 0.33), h = s.bands[0].hand, cw = s.body.chest.s * A;
  const gx = TEX.glove[0] + (0.72 * A - h.x) / cw * TEX.suit.cw, gy = TEX.glove[1] + (0.33 - h.y) / cw * TEX.suit.cw, [er, eg] = texel(TEX.suit, gx, gy);
  assert.ok(c[3] > 0.9, 'hand covered ' + c); near(c[0], er, 0.05, 'glove texel x'); near(c[1], eg, 0.05, 'glove texel y');
});

test('Jacket: puffer from the jacket picture, hood from the figure hood stretched over the head, face opening clear, hand in front', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); assert.ok(draw(r, s, { look: 'jacket' })); const px = readPx(), hd = s.body.head;
  for (const [dx, dy] of [[0.1, 0.1], [-0.1, 0.2]]) {
    const X = s.body.chest.x + dx, Y = s.body.torso + dy, c = at(px, X, Y), e = figPxJS('jacket', s, X, Y), [er, eg] = texel(TEX.jacket, e[0], e[1]);
    assert.ok(c[3] > 0.9, 'jacket opaque'); near(c[0], er, 0.05, `jacket texel x at ${X.toFixed(2)},${Y.toFixed(2)}`); near(c[1], eg, 0.05, `jacket texel y at ${X.toFixed(2)},${Y.toFixed(2)}`);
  }
  assert.equal(at(px, hd.cx, hd.cy)[3], 0, 'face opening stays clear');
  // hood ring above the head: texel = hood centre + (p - opening centre)/opening radius * hood half size
  const oc = [hd.cx * A, hd.cy + 0.02 * hd.ry], orad = [hd.rx * A * 0.84, hd.ry * 0.92], Y = hd.cy - 1.45 * orad[1], hq = [0, (Y - oc[1]) / orad[1]];
  const e = [TEX.jacket.hood.c[0] + hq[0] * TEX.jacket.hood.r[0], TEX.jacket.hood.c[1] + hq[1] * TEX.jacket.hood.r[1]], [er, eg] = texel(TEX.jacket, e[0], e[1]), c = at(px, hd.cx, Y);
  assert.ok(c[3] > 0.9, 'hood ring covered'); near(c[0], er, 0.05, 'hood texel x'); near(c[1], eg, 0.05, 'hood texel y');
  assert.equal(at(px, 0.05, 0.5)[3], 0, 'far background untouched');
  const glove = at(px, 0.72, 0.33); assert.ok(glove[3] > 0.9, 'raised hand covered over the hood');
  const h = s.bands[0].hand, cw = s.body.chest.s * A, [gr, gg] = texel(TEX.suit, TEX.glove[0] + (0.72 * A - h.x) / cw * TEX.suit.cw, TEX.glove[1] + (0.33 - h.y) / cw * TEX.suit.cw);
  near(glove[0], gr, 0.05, 'hand shows the suit fabric (not the sleeve)'); near(glove[1], gg, 0.05, 'hand shows the suit fabric y');
});

test('Jacket: bulk grows the silhouette a little past the body, and no further', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask); draw(r, s, { look: 'jacket' }); const px = readPx();
  const bulkX = SUIT.jacket.bulk * s.body.chest.s, edge = 72 / 96;
  assert.ok(at(px, edge + bulkX * 0.4, 0.85)[3] > 0.3, 'inside the bulk band'); assert.equal(at(px, edge + bulkX * 2.5 + 0.02, 0.85)[3], 0, 'beyond the bulk band');
});

test('No fabric picture loaded = nothing drawn (no code-drawn fallback); Jacket needs the jacket picture', { skip }, () => {
  const r = createSuitRenderer({ gl, width: W, height: H }), s = scene(); r.setMask(s.mask);
  assert.equal(draw(r, s), false, 'no textures: nothing');
  r.setTexture('suit', solidTex(TEX.suit.crop, [10, 10, 10])); assert.equal(draw(r, s), true, 'suit picture: Suit look draws');
  assert.equal(draw(r, s, { look: 'jacket' }), false, 'Jacket look waits for its own picture');
  r.setTexture('jacket', solidTex(TEX.jacket.crop, [20, 80, 110])); assert.equal(draw(r, s, { look: 'jacket' }), true);
});

test('No mask / no body = nothing drawn', { skip }, () => {
  const r = renderer(), s = scene();
  assert.equal(draw(r, s), false); r.setMask(s.mask); assert.equal(r.draw({ body: null, bands: [], aspect: A }), false);
});

test('Reveal: 0 draws nothing, in between draws some slices, 1 draws everything; light shading multiplies the fabric', { skip }, () => {
  const r = renderer(), s = scene(); r.setMask(s.mask);
  const alphaCount = px => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 20) n++; return n; };
  draw(r, s, { reveal: 0 }); assert.equal(alphaCount(readPx()), 0, 'nothing before the frame');
  draw(r, s, { reveal: 1 }); const full = alphaCount(readPx()); draw(r, s, { reveal: 0.5 }); const half = alphaCount(readPx());
  assert.ok(half > full * 0.15 && half < full * 0.95, `half-way reveal shows some slices: ${half} of ${full}`);
  const mk = v => ({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(v) });
  const lit = (l, a) => { r.setLight(mk(l), mk(a)); draw(r, s, { look: 'jacket' }); const p = readPx(), i = ((H - 1 - Math.round(0.8 * H)) * W + Math.round(0.3 * W)) * 4; return p[i + 1]; };
  assert.ok(lit(230, 128) > lit(128, 128) && lit(128, 128) > lit(40, 128), 'brighter live picture = lighter fabric');
});

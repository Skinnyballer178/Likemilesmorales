// Headless WebGL tests. Run with:  xvfb-run -a node --test windowgl.test.mjs   (needs the optional "gl" package)
// Skips itself cleanly when no GL context can be made, so plain `npm test` never fails on a machine without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { frameHands, rect } from './synth.mjs';
import { replay } from './replay.mjs';
import { createWindowController } from './windowctl.js';
import { createWindowRenderer } from './windowgl.js';
import { windowGeometry, applyH, insideQuad, invert3 } from './homography.js';
import { encodePNG, compositeOverCamera } from './png.mjs';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { /* optional */ }
const W = 640, H = 360, A = W / H, DT = 1000 / 30, FR = 1000 / 60;
const gl = createGL ? createGL(W, H, { preserveDrawingBuffer: true, premultipliedAlpha: true }) : null;
const skip = gl ? false : 'no headless WebGL here (install "gl" and run under xvfb-run -a)';
const read = (w = W, h = H) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };

// A realistic landmark story at 30 Hz: no hands -> C-frame (sliding, tilting) -> hold -> 4-frame dropout -> hold -> hands away.
function story() {
  const frames = []; let t = 0;
  const add = (n, fn) => { for (let i = 0; i < n; i++, t += DT) frames.push({ t, hands: fn(i) }); };
  add(10, () => []);
  add(75, i => frameHands(rect(0.35 + 0.004 * i, 0.5, 0.28, 0.45, -6 + 0.2 * i, A)));
  add(45, () => frameHands(rect(0.65, 0.5, 0.28, 0.45, 9, A)));
  add(4, () => []);
  add(30, () => frameHands(rect(0.65, 0.5, 0.28, 0.45, 9, A)));
  add(40, () => []);
  return frames;
}

// Gesture snapshots at 30 Hz -> controller target; display frames at 60 Hz. Returns one record per display frame.
function simulate(onDraw) {
  const frames = story(), { snaps } = replay(frames, { mirror: true, aspect: A });
  const ctl = createWindowController(), out = [];
  let di = 0;
  for (let t = 0; t <= frames.at(-1).t + 1000; t += FR) {
    while (di < frames.length && frames[di].t <= t) { ctl.setTarget(snaps[di].corners); di++; }
    const f = ctl.step(t), target = di ? snaps[di - 1].corners : null;
    out.push({ t, f, target, snap: snaps[Math.max(0, di - 1)] });
    onDraw && onDraw(f, t, out.length - 1);
  }
  return out;
}

test('replayed landmarks: the window follows the gesture through open, hold, dropout and close', { skip }, () => {
  const sim = simulate();
  const phases = sim.map(s => s.f.phase).filter((p, i, a) => i === 0 || p !== a[i - 1]); // consecutive runs
  assert.deepEqual(phases, ['closed', 'opening', 'open', 'closing', 'closed']);
  const drop0 = (10 + 75 + 45) * DT, drop1 = drop0 + 4 * DT;
  assert.ok(sim.filter(s => s.t >= drop0 && s.t <= drop1 + 100).every(s => s.f.phase === 'open'), 'window closed during a 4-frame dropout');
});

test('corner accuracy: rendered mask matches the analytic quad (edge pixels only differ)', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H }), sim = simulate();
  // sample frames: moving, and settled in the second hold
  const picks = [sim.findIndex(s => s.f.phase === 'open' && s.t > 1500), sim.findIndex(s => s.t > 3300), sim.findIndex(s => s.t > 4300 && s.f.phase === 'open')].filter(i => i > 0);
  assert.ok(picks.length >= 2);
  for (const i of picks) {
    const f = sim[i].f; assert.equal(f.phase, 'open');
    r.draw(f, { aspect: A, mode: 'mask' }); const px = read();
    const cs = f.corners.map(c => ({ x: c.x * W, y: c.y * H }));
    let bad = 0, maxBadDist = 0, inPx = 0;
    const segDist = (x, y) => Math.min(...cs.map((a, k) => { const b = cs[(k + 1) % 4], abx = b.x - a.x, aby = b.y - a.y, tt = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby))); return Math.hypot(x - (a.x + abx * tt), y - (a.y + aby * tt)); }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gpu = px[((H - 1 - y) * W + x) * 4 + 3] > 127, cpu = insideQuad(cs, x + 0.5, y + 0.5);
      if (cpu) inPx++;
      if (gpu !== cpu) { bad++; maxBadDist = Math.max(maxBadDist, segDist(x + 0.5, y + 0.5)); }
    }
    console.log(`# mask frame t=${sim[i].t.toFixed(0)}ms: ${inPx} px inside, ${bad} mismatched, farthest mismatch ${maxBadDist.toFixed(2)} px from an edge`);
    assert.ok(maxBadDist <= 1.0, `mismatch ${maxBadDist.toFixed(2)} px from an edge`);
    assert.ok(bad / inPx < 0.005);
    // each corner pixel region: the mask must reach within 2 px of every corner
    for (const c of cs) { let best = 1e9; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[((H - 1 - y) * W + x) * 4 + 3] > 127) best = Math.min(best, Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y)); assert.ok(best <= 2.5, `corner is ${best.toFixed(2)} px from the mask`); }
  }
});

test('homography on the GPU: fill uv matches the CPU mapping (perspective-correct)', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const quads = [[{ x: .3, y: .2 }, { x: .7, y: .25 }, { x: .72, y: .8 }, { x: .28, y: .7 }], [{ x: .2, y: .3 }, { x: .8, y: .1 }, { x: .85, y: .9 }, { x: .15, y: .6 }]];
  for (const q of quads) {
    r.draw({ visible: true, corners: q, hu: 0.5, hv: 0.5, flash: 0 }, { aspect: A, mode: 'uv' }); const px = read();
    const g = windowGeometry(q, 0.5, 0.5, A); let worst = 0, n = 0;
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = applyH(g.H, u, v), x = Math.floor(p.x * W), y = Math.floor(p.y * H), i = ((H - 1 - y) * W + x) * 4;
      // pixel (x,y) is not exactly at p; compare against the uv of that pixel centre computed on the CPU
      const e = applyH(invert3(g.H), (x + 0.5) / W, (y + 0.5) / H);
      worst = Math.max(worst, Math.abs(px[i] / 255 - e.x), Math.abs(px[i + 1] / 255 - e.y)); n++;
    }
    console.log(`# uv decode: ${n} samples, worst error ${worst.toFixed(4)} (8-bit step = 0.0039)`);
    assert.ok(worst < 0.012);
  }
});
test('open/close animation: lit area only grows while opening and only shrinks while closing', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const sim = simulate(); const area = [];
  for (const s of sim) { r.draw(s.f, { aspect: A, mode: 'mask' }); const px = read(); let a = 0; for (let i = 3; i < px.length; i += 4) a += px[i] > 127; area.push([s.f.phase, a]); }
  const seg = ph => { const i0 = area.findIndex(a => a[0] === ph); let i1 = i0; while (i1 + 1 < area.length && area[i1 + 1][0] === ph) i1++; return area.slice(i0, i1 + 1).map(a => a[1]); };
  const op = seg('opening'), cl = seg('closing');
  assert.ok(op.length > 15 && cl.length > 10);
  for (let i = 1; i < op.length; i++) assert.ok(op[i] >= op[i - 1] * 0.97, `opening shrank at ${i}`);
  for (let i = 1; i < cl.length; i++) assert.ok(cl[i] <= cl[i - 1] * 1.03, `closing grew at ${i}`);
  assert.ok(op[0] < 200 && op.at(-1) > 15000 && cl.at(-1) < 500, `ends: ${op[0]} -> ${op.at(-1)}, closing -> ${cl.at(-1)}`);
});

test('reduced-flash: no open flash, no bolt gating; normal mode does flash', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const q = rect(0.5, 0.5, 0.3, 0.45, 0, A), corners = [q.tl, q.tr, q.br, q.bl];
  const lum = reduced => { r.draw({ visible: true, corners, hu: 0.5, hv: 0.5, flash: 1 }, { aspect: A, timeS: 5, reduced }); const px = read(); let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2]; return s; };
  const normal = lum(false), calm = lum(true);
  console.log(`# summed brightness right after opening: normal ${normal}, reduced ${calm}`);
  assert.ok(calm < normal);
  // calm output is identical for any flash value
  const a = (() => { r.draw({ visible: true, corners, hu: .5, hv: .5, flash: 0 }, { aspect: A, timeS: 5, reduced: true }); return read(); })();
  const b = (() => { r.draw({ visible: true, corners, hu: .5, hv: .5, flash: 1 }, { aspect: A, timeS: 5, reduced: true }); return read(); })();
  assert.deepEqual(a, b);
});

test('frame time and previews', { skip }, () => {
  const w = 960, h = 540, big = createGL(w, h, { preserveDrawingBuffer: true, premultipliedAlpha: true });
  const r = createWindowRenderer({ gl: big, width: w, height: h });
  const sim = simulate(); const ms = [];
  for (let k = 0; k < 150; k++) { const s = sim[Math.min(k + 20, sim.length - 1)]; const t0 = performance.now(); r.draw(s.f, { aspect: A, timeS: s.t / 1000 }); big.finish(); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b);
  console.log(`# 960x540 software-rendered (CPU only, upper bound): median ${ms[75].toFixed(1)} ms, p95 ${ms[142].toFixed(1)} ms, max ${ms[149].toFixed(1)} ms`);
  assert.ok(ms[142] < 250);
  const dir = process.env.PREVIEW_DIR; if (dir) { mkdirSync(dir, { recursive: true }); const px = new Uint8Array(w * h * 4); big.readPixels(0, 0, w, h, big.RGBA, big.UNSIGNED_BYTE, px); writeFileSync(`${dir}/last-frame.png`, encodePNG(w, h, compositeOverCamera(w, h, px))); }
});

// ---------------- Session 4: person cut-out, neon background, rim light ----------------
import { personMask } from './synthmask.mjs';
import { createMaskSmoother } from './segmask.js';
const MW = 192, MH = 108;
const packed = (opt = {}) => createMaskSmoother().update({ person: personMask(MW, MH, { aspect: A, ...opt }) }, MW, MH, 0);
const bigQuad = rect(0.5, 0.5, 0.9, 0.9, 0, A), BQ = [bigQuad.tl, bigQuad.tr, bigQuad.br, bigQuad.bl];
const open = { visible: true, corners: BQ, hu: 0.5, hv: 0.5, flash: 0 };
const alphaAt = (px, x, y) => px[((H - 1 - y) * W + x) * 4 + 3];
const rgbAt = (px, x, y) => { const i = ((H - 1 - y) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };

test('cut-out: the person stays visible (window transparent there), the rest is covered by the background', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H }), m = packed({ cx: 0.5 }), truth = personMask(W, H, { aspect: A, cx: 0.5 });
  r.setMask(m); r.draw(open, { aspect: A, timeS: 3 }); const px = read();
  let inside = 0, wrongIn = 0, outside = 0, wrongOut = 0;
  for (let y = Math.round(0.08 * H); y < Math.round(0.92 * H); y += 2) for (let x = Math.round(0.08 * W); x < Math.round(0.92 * W); x += 2) {   // well inside the window (its edge glow is not part of this test)
    const t = truth[y * W + x], a = alphaAt(px, x, y);
    if (t > 0.98) { inside++; if (a > 40) wrongIn++; }            // person: camera shows through (alpha ~0)
    else if (t < 0.02) { outside++; if (a < 215) wrongOut++; }    // background: window covers (alpha ~255)
  }
  console.log(`# cut-out: ${inside} person samples (${wrongIn} covered by mistake), ${outside} background samples (${wrongOut} left uncovered)`);
  assert.ok(inside > 3000 && outside > 3000);
  assert.ok(wrongIn / inside < 0.05, `${wrongIn}/${inside} person pixels covered`);
  assert.ok(wrongOut / outside < 0.02, `${wrongOut}/${outside} background pixels uncovered`);
});

test('cut-out orientation: a person on the LEFT of the picture is cut out on the left, high things stay high', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  r.setMask(packed({ cx: 0.25 })); r.draw(open, { aspect: A, timeS: 3 }); const px = read();
  const hx = Math.round(0.25 * W), hy = Math.round(0.40 * H);               // head centre of the synthetic person
  assert.ok(alphaAt(px, hx, hy) < 40, 'head is cut out where it was drawn');
  assert.ok(alphaAt(px, Math.round(0.75 * W), hy) > 215, 'mirror image position is covered (no left/right flip)');
  assert.ok(alphaAt(px, hx, Math.round(0.08 * H)) > 215, 'above the head is covered (no up/down flip)');
  assert.ok(alphaAt(px, hx, Math.round(0.85 * H)) < 40, 'shoulders at the bottom are cut out');
});

test('no mask, a cleared mask, or a stale one: the whole window is covered; the old S3 geometry modes ignore the mask', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  r.draw(open, { aspect: A, timeS: 3 }); assert.ok(alphaAt(read(), W / 2, H / 2) > 250);
  r.setMask(packed()); r.setMask(null); r.draw(open, { aspect: A, timeS: 3 }); assert.ok(alphaAt(read(), Math.round(0.5 * W), Math.round(0.4 * H)) > 250, 'cleared mask no longer cuts');
  r.setMask(packed()); r.draw(open, { aspect: A, mode: 'mask' }); assert.ok(alphaAt(read(), Math.round(0.5 * W), Math.round(0.4 * H)) > 250, 'mask mode is pure geometry');
  assert.throws(() => r.setMask({ w: 4, h: 4, data: new Uint8Array(10) }), /does not match/);
});

test('mask outside the window does nothing (no leaks outside the frame)', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H }), q = rect(0.7, 0.5, 0.3, 0.5, 0, A), Q = [q.tl, q.tr, q.br, q.bl];
  r.setMask(packed({ cx: 0.2 })); r.draw({ visible: true, corners: Q, hu: .5, hv: .5, flash: 0 }, { aspect: A, timeS: 3 }); const px = read();
  let leak = 0; for (let y = 0; y < H; y += 2) for (let x = 0; x < W * 0.4; x += 2) leak += px[((H - 1 - y) * W + x) * 4 + 3];   // far left, outside the window and its glow
  assert.equal(leak, 0);
});

test('person edge: soft transition (a few pixels), rim light only on the edge and only inside the window', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H }), m = packed({ cx: 0.5 });
  r.setMask(m); r.draw(open, { aspect: A, timeS: 3 }); const px = read(), y = Math.round(0.40 * H);
  // walk right from the head centre across the edge along one row: alpha goes 0 -> ~255
  const row = []; for (let x = Math.round(0.5 * W); x < W - 40; x++) row.push(alphaAt(px, x, y));
  const i0 = row.findIndex(a => a > 30), i1 = row.findIndex(a => a > 225);
  console.log(`# head edge transition: ${i1 - i0} px wide (alpha 30 -> 225)`);
  assert.ok(i0 > 0 && i1 > i0 && i1 - i0 <= 8, 'edge is soft but not blurry');
  // rim: pixels in the transition carry light, pixels deep inside the person do not
  const lit = rgbAt(px, Math.round(0.5 * W) + i0 + 1, y), deep = rgbAt(px, Math.round(0.5 * W), y);
  assert.ok(Math.max(...lit) > 20 && Math.max(...deep) === 0, `rim ${lit} deep ${deep}`);
  // with the window closed (not visible) nothing at all is drawn
  assert.equal(r.draw({ visible: false }, {}), false);
});

test('neon background: lively but valid (no NaN/black holes), moves in normal mode, is perfectly still in reduced mode', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const shot = (timeS, reduced) => { r.draw(open, { aspect: A, timeS, reduced }); return read(); };
  const a = shot(5, false), b = shot(6.3, false), c = shot(5, true), d = shot(40, true);
  // interior only (the window's edge glow has its own comet animation and a faint halo that reaches a little way inside)
  const interior = (u, v, m = 0.12) => { let sum = 0, max = 0; for (let y = Math.round(m * H); y < Math.round((1 - m) * H); y++) for (let x = Math.round(m * W); x < Math.round((1 - m) * W); x++) { const i = ((H - 1 - y) * W + x) * 4; for (let k = 0; k < 3; k++) { const df = Math.abs(u[i + k] - v[i + k]); sum += df; max = Math.max(max, df); } } return { sum, max }; };
  const colours = new Set(); let dark = 0, n = 0;
  for (let y = 40; y < H - 40; y += 3) for (let x = 40; x < W - 40; x += 3) { const [R, G, B] = rgbAt(a, x, y); colours.add((R >> 4) << 8 | (G >> 4) << 4 | (B >> 4)); if (R + G + B < 12) dark++; n++; }
  assert.ok(colours.size > 60, `only ${colours.size} colours`);
  assert.ok(dark / n < 0.3, `${(100 * dark / n).toFixed(0)}% pure black`);
  assert.ok(interior(a, b).sum > 2000, 'normal mode animates');
  assert.ok(interior(c, d).max <= 2, `reduced mode: the picture inside the window is still (max change ${interior(c, d).max} levels, only the edge-glow halo)`);
  assert.equal(interior(c, d, 0.3).max, 0, 'deep inside the window nothing changes at all');
});

test('neon background: windows flip at most ~3 times per second and never as a big flash (reduced-flash rules)', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const lum = t => { r.draw(open, { aspect: A, timeS: t, reduced: false }); const px = read(); let s = 0, n = 0; for (let i = 0; i < px.length; i += 16) { s += px[i] + px[i + 1] + px[i + 2]; n++; } return s / n; };
  const series = []; for (let t = 10; t < 14; t += 1 / 30) series.push(lum(t));
  let maxJump = 0; for (let i = 1; i < series.length; i++) maxJump = Math.max(maxJump, Math.abs(series[i] - series[i - 1]) / Math.max(series[i - 1], 1));
  console.log(`# neon: largest frame-to-frame change in average brightness ${(maxJump * 100).toFixed(1)}%`);
  assert.ok(maxJump < 0.08, 'no flashes: the average brightness never jumps');
});

test('background keeps its proportions: a circle stays round in wide, tall and tilted windows (uv and window aspect are wired right)', { skip }, () => {
  const r = createWindowRenderer({ gl, width: W, height: H });
  const size = (cw, ch, deg) => {
    const q = rect(0.5, 0.5, cw, ch, deg, A), Q = [q.tl, q.tr, q.br, q.bl];
    r.draw({ visible: true, corners: Q, hu: .5, hv: .5, flash: 0 }, { aspect: A, timeS: 3, reduced: true, mode: 'circle' }); const px = read();
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    const gx0 = Math.round((0.5 - cw / 2) * W) + 14, gx1 = Math.round((0.5 + cw / 2) * W) - 14, gy0 = Math.round((0.5 - ch / 2) * H) + 14, gy1 = Math.round((0.5 + ch / 2) * H) - 14; // inside the window only: its edge glow is not the test pattern
    for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) { const [R, G, B] = rgbAt(px, x, y); if (R > 200 && G > 200 && B > 200) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  for (const [cw, ch] of [[0.8, 0.8], [0.9, 0.55], [0.4, 0.9]]) {
    const s = size(cw, ch, 0), ratio = s.w / s.h; console.log(`# circle in a ${cw}x${ch} window: ${s.w}x${s.h} px (ratio ${ratio.toFixed(3)})`);
    assert.ok(Math.abs(ratio - 1) < 0.04, `circle ratio ${ratio.toFixed(3)}`);
  }
  // the circle has radius 0.3 WINDOW heights, so its diameter is 0.6 of the window's height in pixels
  for (const [cw, ch] of [[0.8, 0.8], [0.9, 0.55], [0.4, 0.9]]) { const s = size(cw, ch, 0); assert.ok(Math.abs(s.h - 0.6 * ch * H) <= 4, `diameter ${s.h} vs ${(0.6 * ch * H).toFixed(0)}`); }
});

test('S4 frame time: neon + cut-out at 960x540 (software GL = upper bound), and previews', { skip }, () => {
  const w = 960, h = 540, big = createGL(w, h, { preserveDrawingBuffer: true, premultipliedAlpha: true });
  const r = createWindowRenderer({ gl: big, width: w, height: h }), sm = createMaskSmoother();
  r.setMask(sm.update({ person: personMask(384, 216, { aspect: A }) }, 384, 216, 0));
  const ms = []; for (let k = 0; k < 60; k++) { const t0 = performance.now(); r.draw(open, { aspect: A, timeS: k / 30 }); big.finish(); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b); console.log(`# neon + cut-out at 960x540, software-rendered: median ${ms[30].toFixed(1)} ms, p95 ${ms[57].toFixed(1)} ms`);
  assert.ok(ms[57] < 400);
  const one = personMask(384, 216, { aspect: A }), up = []; for (let k = 0; k < 60; k++) { const m = sm.update({ person: one }, 384, 216, 1000 + k * 33), t0 = performance.now(); r.setMask(m); up.push(performance.now() - t0); }
  up.sort((a, b) => a - b); console.log(`# mask upload 384x216 RGBA: median ${up[30].toFixed(2)} ms`);
  assert.ok(up[57] < 20);
});

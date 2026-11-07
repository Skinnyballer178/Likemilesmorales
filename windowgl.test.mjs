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

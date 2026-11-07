import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowController, smoothDamp, openShape } from './windowctl.js';
import { WINDOW } from './config.js';
import { rect } from './synth.mjs';

const A = 16 / 9, FR = 1000 / 60;
const quad = (cx = 0.5, cy = 0.5, deg = 0) => { const q = rect(cx, cy, 0.3, 0.45, deg, A); return [q.tl, q.tr, q.br, q.bl]; };
const cx = f => f.corners.reduce((s, c) => s + c.x, 0) / 4;
const run = (c, t0, t1) => { let f; for (let t = t0; t <= t1 + 1e-9; t += FR) f = c.step(t); return f; };

test('smoothDamp: converges to the target without overshoot, at any frame rate', () => {
  for (const dt of [4, 8, 16.7, 33, 100]) {
    let x = 0, v = 0, max = 0;
    for (let t = 0; t < 1000; t += dt) { [x, v] = smoothDamp(x, 1, v, 0.045, dt / 1000); max = Math.max(max, x); }
    assert.ok(max <= 1 + 1e-9, `overshoot at dt=${dt}`);
    assert.ok(Math.abs(x - 1) < 1e-3, `not converged at dt=${dt}`);
  }
});

test('opens in place from closed, then follows; shape grows monotonically and ends fully open', () => {
  const c = createWindowController();
  assert.equal(c.step(0).visible, false);
  c.setTarget(quad());
  let prev = { hu: -1, hv: -1, p: -1 }, f;
  const t0 = 16;
  for (let t = t0; t <= t0 + WINDOW.openMs + 40; t += FR) {
    f = c.step(t);
    assert.ok(f.hu >= prev.hu - 1e-12 && f.hv >= prev.hv - 1e-12 && f.p >= prev.p);
    prev = f;
  }
  assert.equal(f.phase, 'open'); assert.ok(f.hu === 0.5 && f.hv === 0.5);
  assert.ok(Math.abs(cx(f) - 0.5) < 1e-9, 'opened at the target, no fly-in');
  assert.ok(openShape(0.05).hv === 0, 'starts as a line');
});

test('flash fires on open and decays to 0; it is not retriggered by a lost-frame hold', () => {
  const c = createWindowController(); c.setTarget(quad()); c.step(0);
  assert.ok(c.step(10).flash > 0.9);
  assert.equal(run(c, 20, 20 + WINDOW.flashMs + 50).flash, 0);
  c.setTarget(quad()); assert.equal(c.step(2000).flash, 0);
});

test('closes when the target goes away (collapse, then gone) and can reopen', () => {
  const c = createWindowController(); c.setTarget(quad()); run(c, 0, 600);
  c.setTarget(null);
  let f = c.step(616); assert.equal(f.phase, 'closing');
  f = run(c, 632, 616 + WINDOW.closeMs + 40);
  assert.equal(f.phase, 'closed'); assert.equal(f.visible, false);
  c.setTarget(quad(0.3)); f = c.step(900);
  assert.equal(f.phase, 'opening'); assert.ok(Math.abs(cx(f) - 0.3) < 1e-9);
});

test('reversing mid-open is continuous (no jump in shape)', () => {
  const c = createWindowController(); c.setTarget(quad()); const a = run(c, 0, 200);
  c.setTarget(null); const b = c.step(200 + FR);
  assert.ok(Math.abs(b.p - a.p) < 0.1 && Math.abs(b.hu - a.hu) < 0.1 && Math.abs(b.hv - a.hv) < 0.1);
  c.setTarget(quad()); const d = c.step(200 + 2 * FR);
  assert.ok(d.p > b.p, 're-opening resumes from where it was');
});

test('render-rate interpolation: 30 Hz detection, 60 Hz drawing -> smooth, small lag, no stalls', () => {
  const c = createWindowController(), V = 0.3 / 1000; // target slides 0.3 units per second
  const truth = t => 0.2 + V * t;
  c.setTarget(quad(truth(0))); run(c, 0, 600);
  const xs = []; let lastDet = -1e9;
  for (let t = 600; t <= 2600; t += FR) {
    if (t - lastDet >= 1000 / 30) { lastDet = t; c.setTarget(quad(truth(t))); }
    xs.push([t, cx(c.step(t))]);
  }
  const steps = xs.slice(1).map((p, i) => p[1] - xs[i][1]).slice(30); // skip settling
  const mean = steps.reduce((a, b) => a + b) / steps.length;
  assert.ok(Math.min(...steps) > 0, 'a frame stalled');
  assert.ok(Math.max(...steps) / mean < 1.6, `uneven motion: max/mean = ${(Math.max(...steps) / mean).toFixed(2)}`);
  const lag = Math.max(...xs.slice(40).map(([t, x]) => truth(t) - x));
  assert.ok(lag < 0.03, `lag too large: ${lag}`); // ~ velocity * (smooth time + detect interval)
});

test('detector stalls: window holds its place; a long gap (tab switch) never jumps', () => {
  const c = createWindowController(); c.setTarget(quad(0.4)); run(c, 0, 600);
  const a = cx(c.step(616)); run(c, 632, 2000); assert.ok(Math.abs(cx(c.step(2016)) - a) < 1e-9);
  c.setTarget(quad(0.6)); const f = c.step(2016 + 60000); // 60 s hidden
  assert.ok(Math.abs(cx(f) - 0.4) > 1e-6 && cx(f) < 0.6 + 1e-9, 'dt is clamped, moves partway at most');
});

test('invalid targets close the window instead of crashing', () => {
  const c = createWindowController(); c.setTarget(quad()); run(c, 0, 600);
  c.setTarget([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  assert.equal(c.step(616).phase, 'closing');
});

test('controller cost per frame is negligible', () => {
  const c = createWindowController(); c.setTarget(quad());
  const t0 = performance.now(); for (let i = 0; i < 100000; i++) c.step(i * FR);
  const per = (performance.now() - t0) / 100000;
  console.log(`# controller step: ${(per * 1000).toFixed(2)} us/frame`);
  assert.ok(per < 0.02);
});

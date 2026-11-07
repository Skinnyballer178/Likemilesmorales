import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBody, createBodyTracker, wristBands } from './suitmodel.js';

// Synthetic person: head ellipse (skin) over a torso of clothes. Normalised sizes: image 96x54.
function person({ w = 96, h = 54, headCx = 48, headTop = 6, headRx = 8, headH = 14, shoulderY = 26, torsoL = 28, torsoR = 68, clothes = true } = {}) {
  const data = new Uint8Array(w * h * 4);
  const set = (x, y, p, s, c) => { const i = (y * w + x) * 4; data[i] = p ? 255 : 0; data[i + 2] = s ? 255 : 0; data[i + 3] = c ? 255 : 0; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hy = (y - (headTop + headH / 2)) / (headH / 2), hx = (x - headCx) / headRx;
    if (hx * hx + hy * hy <= 1) set(x, y, 1, 1, 0);                                  // head
    else if (y >= shoulderY && x >= torsoL && x < torsoR) set(x, y, 1, !clothes, clothes);  // torso
  }
  return { w, h, data };
}

test('analyzeBody finds the head above the torso and the chest on the clothes', () => {
  const b = analyzeBody(person());
  assert.ok(b && b.usedClothes);
  assert.ok(Math.abs(b.head.cx - 0.5) < 0.03, 'head centred');
  assert.ok(b.head.cy < b.torso, 'head above torso top');
  assert.ok(b.chest.y > b.torso && b.chest.y < 1, 'chest below the torso top');
  assert.ok(Math.abs(b.chest.x - 0.5) < 0.02, 'chest centred on the clothes');
  assert.ok(Math.abs(b.chest.s - (68 - 28) / 96) < 0.03, 'chest width = clothes width');
});

test('chest follows the body when it moves sideways and scales when it is closer', () => {
  const a = analyzeBody(person()), s = analyzeBody(person({ headCx: 70, torsoL: 50, torsoR: 90 }));
  assert.ok(s.chest.x > a.chest.x + 0.15);
  const big = analyzeBody(person({ torsoL: 10, torsoR: 86 }));
  assert.ok(big.chest.s > a.chest.s * 1.7);
});

test('no clothes: falls back to the person silhouette', () => {
  const b = analyzeBody(person({ clothes: false }));
  assert.ok(b && !b.usedClothes && b.chest.s > 0.2);
});

test('empty mask = nobody', () => {
  assert.equal(analyzeBody({ w: 48, h: 27, data: new Uint8Array(48 * 27 * 4) }), null);
  assert.equal(analyzeBody(null), null);
});

test('tracker smooths small changes, restarts after a gap, forgets on null', () => {
  const t = createBodyTracker({ tauMs: 100, resetGapMs: 500 });
  const a = analyzeBody(person()), b = analyzeBody(person({ headCx: 60, torsoL: 40, torsoR: 80 }));
  const x0 = t.update(a, 0).chest.x, x1 = t.update(b, 33).chest.x;
  assert.ok(x1 > x0 && x1 < b.chest.x, 'moves toward the target but not all the way');
  assert.equal(Math.round(t.update(b, 2000).chest.x * 1000), Math.round(b.chest.x * 1000), 'gap restarts');
  assert.equal(t.update(null, 2100), null); assert.equal(t.body, null);
});

test('wristBands: band sits past the wrist, away from the fingers; hand region covers the fingers', () => {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  pts[0] = { x: 0.5, y: 0.6 }; pts[9] = { x: 0.5, y: 0.5 };      // fingers up, wrist below
  const [h] = wristBands([{ pts }], 16 / 9);
  assert.ok(h.band.y > 0.6, 'band below the wrist (towards the elbow)');
  assert.ok(Math.abs(h.band.dx) < 1e-9 && h.band.dy > 0.99);
  assert.ok(h.hand.y < 0.6 && h.hand.r > 0.1, 'hand region towards the fingers');
  assert.equal(wristBands([], 1.7).length, 0);
  assert.equal(wristBands([{ pts: pts.slice(0, 5) }], 1.7).length, 0);
});

import { armSides } from './suitmodel.js';
test('armSides: hanging arms point down and outward; a raised hand turns that sleeve toward the wrist', () => {
  const body = { chest: { x: 0.5, y: 0.6, s: 0.4 }, torso: 0.5 }, A = 16 / 9;
  const a = armSides([], body, A);
  assert.ok(a.left.dx < 0 && a.right.dx > 0 && a.left.dy > 0.9 && a.right.dy > 0.9, 'hanging');
  assert.ok(a.left.x < 0.5 * A && a.right.x > 0.5 * A, 'shoulders on each side of the chest');
  const hand = { band: { x: 0.8 * A, y: 0.2 }, hand: {} };
  const b = armSides([hand], body, A);
  assert.ok(b.right.dy < 0, 'right sleeve points up toward the raised wrist'); assert.deepEqual([b.left.dx < 0, b.left.dy > 0.9], [true, true], 'left sleeve unchanged');
  assert.ok(Math.abs(Math.hypot(b.right.dx, b.right.dy) - 1) < 1e-9, 'unit direction');
});

test('analyzeBody: a raised arm beside the head does not widen the head; tracked hands are ignored entirely', () => {
  const w = 96, h = 54, make = withArm => { const m = person(); if (withArm) for (let y = 10; y < 22; y++) for (let x = 56; x < 76; x++) { const i = (y * w + x) * 4; m.data[i] = 255; m.data[i + 2] = 255; } return m; };
  const plain = analyzeBody(make(false)), arm = analyzeBody(make(true));
  const span = (arm.torso - arm.top) * h; assert.ok(arm.head.rx * w <= 0.48 * span + 1e-6, `arm touching the head: rx bounded by the head height (${(arm.head.rx * w).toFixed(1)} px vs span ${span.toFixed(1)})`);
  // a tracked hand covering that arm region: ignored
  const A = 1, hand = { hand: { x: 67 / 96 * A, y: 16 / 54, r: 7 / 54 } };
  const withHand = analyzeBody(make(true), undefined, { hands: [hand], aspect: A });
  assert.ok(Math.abs(withHand.head.cx - plain.head.cx) < 0.02 && withHand.top > 0.05);
});

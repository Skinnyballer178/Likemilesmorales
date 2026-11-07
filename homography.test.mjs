import test from 'node:test';
import assert from 'node:assert/strict';
import { squareToQuad, invert3, applyH, windowGeometry, insideQuad } from './homography.js';
import { rect, rng } from './synth.mjs';

const A = 16 / 9, R = rng(11);
const quads = [
  ...[0, 15, -20, 45, 90].map(d => { const q = rect(0.5, 0.5, 0.3, 0.45, d, A); return [q.tl, q.tr, q.br, q.bl]; }),
  [{ x: .3, y: .2 }, { x: .7, y: .25 }, { x: .72, y: .8 }, { x: .28, y: .7 }],   // perspective-ish
  [{ x: .2, y: .3 }, { x: .8, y: .1 }, { x: .85, y: .9 }, { x: .15, y: .6 }],    // strong perspective
];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('squareToQuad maps the unit-square corners exactly onto the given corners (TL,TR,BR,BL)', () => {
  for (const q of quads) {
    const H = squareToQuad(q);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => assert.ok(dist(applyH(H, u, v), q[i]) < 1e-9));
  }
});

test('inverse round-trips and the centre lands inside the quad', () => {
  for (const q of quads) {
    const H = squareToQuad(q), Hi = invert3(H);
    for (let i = 0; i < 20; i++) {
      const u = R(), v = R(), p = applyH(H, u, v), b = applyH(Hi, p.x, p.y);
      assert.ok(Math.abs(b.x - u) < 1e-9 && Math.abs(b.y - v) < 1e-9);
      assert.ok(insideQuad(q, p.x, p.y));
    }
  }
});

test('degenerate quads are rejected instead of producing NaNs', () => {
  const line = [{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .8, y: .8 }, { x: .3, y: .3 }];
  assert.equal(squareToQuad(line), null);
  assert.equal(squareToQuad([{ x: .5, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .5 }]), null);
  assert.equal(squareToQuad([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), null);
  assert.equal(squareToQuad(null), null);
});

test('windowGeometry: fully open = the corners (in aspect space); smaller hu/hv shrink inside the quad', () => {
  for (const q of quads) {
    const g = windowGeometry(q, 0.5, 0.5, A);
    q.forEach((p, i) => { assert.ok(Math.abs(g.quad[i * 2] - p.x * A) < 1e-5 && Math.abs(g.quad[i * 2 + 1] - p.y) < 1e-5); });
    const s = windowGeometry(q, 0.25, 0.1, A);
    s.visible.forEach(p => assert.ok(insideQuad(q, p.x, p.y)));
    assert.equal(g.hinv.length, 9);
  }
});

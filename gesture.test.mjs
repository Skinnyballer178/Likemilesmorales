import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro } from './filters.js';
import { createHandTracker } from './hands.js';
import { createFrameGesture, evaluate } from './gesture.js';
import { GESTURE } from './config.js';
import { frameHands, rect, rng, gauss } from './synth.mjs';
import { replay } from './replay.mjs';

const DT = 1000 / 30, A = 16 / 9;
// Build frames: fn(i) -> raw hands (or [] for a dropout)
const frames = (n, fn, t0 = 0) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * DT, hands: fn(i) }));
const ms = n => Math.ceil(n / DT);
const std = xs => { const m = xs.reduce((a, b) => a + b) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const R = rect(0.5, 0.5, 0.3, 0.45);
const states = ev => ev.map(e => e.to).join('>');

test('One Euro: steadies jitter at rest, follows a fast move', () => {
  const f = new OneEuro({ minCutoff: 1, beta: 4, dCutoff: 1 }), r = rng(3);
  const raw = [], out = [];
  for (let i = 0; i < 90; i++) { const v = 0.5 + 0.004 * gauss(r); raw.push(v); out.push(f.filter(v, i * DT)); }
  assert.ok(std(out.slice(30)) < std(raw.slice(30)) * 0.6, 'jitter reduced');
  let y = 0; for (let i = 0; i < 6; i++) y = f.filter(0.9, 3000 + i * DT); // step of 0.4 in 6 frames
  assert.ok(y > 0.8, `fast move tracked, got ${y.toFixed(3)}`);
});

test('tracker: mirror flips x, labels flip, slots survive list reordering', () => {
  const tr = createHandTracker();
  const a = tr.process(frameHands(R, { mirror: false }), 0, true);
  assert.equal(a.length, 2);
  assert.ok(near(a[0].raw[4].x, 1 - frameHands(R, { mirror: false })[0].lm[4].x));
  assert.equal(a[0].label, 'Right'); assert.equal(a[0].rawLabel, 'Left');
  const slotOfLeft = a.find(h => h.rawLabel === 'Left').slot;
  const b = tr.process(frameHands(R, { mirror: false, swapOrder: true }), DT, true);
  assert.equal(b.find(h => h.rawLabel === 'Left').slot, slotOfLeft);
});

test('clean frame: IDLE>ARMING>ACTIVE after hold time, corners ordered TL,TR,BR,BL', () => {
  const { events, snaps } = replay(frames(ms(1000), () => frameHands(R)));
  assert.equal(states(events), 'arming>active');
  const lockT = events[1].t - events[0].t;
  assert.ok(lockT >= GESTURE.holdMs && lockT < GESTURE.holdMs + 2 * DT, `lock after ${lockT.toFixed(0)}ms`);
  const c = snaps.at(-1).corners;
  [R.tl, R.tr, R.br, R.bl].forEach((p, i) => assert.ok(near(c[i].x, p.x, 1e-6) && near(c[i].y, p.y, 1e-6), `corner ${i}`));
});

test('mirror off gives identical display corners to mirror on when feed is mirrored accordingly', () => {
  const a = replay(frames(ms(800), () => frameHands(R, { mirror: true })), { mirror: true }).snaps.at(-1).corners;
  const b = replay(frames(ms(800), () => frameHands(R, { mirror: false })), { mirror: false }).snaps.at(-1).corners;
  a.forEach((p, i) => assert.ok(near(p.x, b[i].x) && near(p.y, b[i].y)));
});

test('hold time: a frame shown too briefly never locks', () => {
  const f = frames(ms(150), () => frameHands(R)).concat(frames(ms(600), () => [], 150));
  const { events } = replay(f);
  assert.equal(states(events), 'arming>idle');
});

test('dropout within grace holds corners (no jump, no end); beyond grace ends', () => {
  const seg = (n, hands, t0) => frames(n, () => hands, t0);
  const f = [...seg(ms(700), frameHands(R), 0), ...seg(ms(200), [], 700), ...seg(ms(500), frameHands(R), 900)];
  const { events, snaps } = replay(f);
  assert.equal(states(events), 'arming>active>lost>active');
  const during = snaps.filter(s => s.state === 'lost');
  assert.ok(during.length > 0 && during.every(s => s.corners && near(s.corners[0].x, R.tl.x, 1e-6)));
  const long = replay([...seg(ms(700), frameHands(R), 0), ...seg(ms(900), [], 700)]);
  assert.equal(states(long.events), 'arming>active>lost>idle');
});

test('hysteresis: area between exit and enter thresholds cannot start but can keep', () => {
  const small = rect(0.5, 0.5, 0.15, 0.15);          // ~0.0225: below enter 0.03, above exit 0.015
  assert.ok(evaluate(frameHands(small).map(h => ({ ...h, pts: h.lm.map(p => ({ x: 1 - p.x, y: p.y })) })), GESTURE.enter).reason === 'too-small');
  assert.equal(states(replay(frames(ms(1000), () => frameHands(small))).events), '');
  const f = [...frames(ms(600), () => frameHands(R)), ...frames(ms(600), () => frameHands(small))];
  const { events } = replay(f.map((x, i) => ({ ...x, t: i * DT })));
  assert.equal(states(events), 'arming>active', 'stays active while shrinking to the looser exit threshold');
});

test('crossed hands: interleaved tips never arm; hands on swapped sides still work', () => {
  assert.equal(states(replay(frames(ms(1000), () => frameHands(R, { interleave: true }))).events), '');
  const swapped = replay(frames(ms(800), () => frameHands(R, { swapOrder: true })));
  assert.equal(states(swapped.events), 'arming>active');
  assert.equal(replay(frames(5, () => frameHands(R, { interleave: true }))).snaps.at(-1).reason, 'crossed');
});

test('rejects: one hand, low confidence, tiny, non-convex, degenerate', () => {
  const reason = hands => replay(frames(3, () => hands)).snaps.at(-1).reason;
  assert.equal(reason(frameHands(R).slice(0, 1)), 'one-hand');
  assert.equal(reason(frameHands(R, { scoreB: 0.2 })), 'low-confidence');
  assert.equal(reason(frameHands(rect(0.5, 0.5, 0.05, 0.05))), 'too-small');
  const dart = { ...R, br: { x: 0.5, y: 0.45 } };           // one tip pushed inside the quad
  assert.ok(['not-convex', 'crossed'].includes(reason(frameHands(dart))));
  const flat = rect(0.5, 0.5, 0.4, 0.01);
  assert.ok(['not-convex', 'degenerate', 'too-small', 'tips-together'].includes(reason(frameHands(flat))));
});

test('rotation sweep keeps corner identity stable through 45 degrees', () => {
  const f = frames(ms(4000), i => frameHands(rect(0.5, 0.5, 0.3, 0.45 * 1.0, -10 + (i / ms(4000)) * 80)));
  const { snaps, events } = replay(f);
  assert.equal(states(events), 'arming>active');
  const active = snaps.filter(s => s.corners);
  for (let i = 1; i < active.length; i++) active[i].corners.forEach((p, k) => assert.ok(Math.hypot(p.x - active[i - 1].corners[k].x, p.y - active[i - 1].corners[k].y) < 0.08, `corner ${k} jumped at ${i}`));
});

test('noisy hands: stays locked and corners are steadier than raw', () => {
  const r = rng(11), seq = frames(ms(3000), () => frameHands(R, { noise: 0.004, r }));
  const { snaps, events } = replay(seq);
  assert.equal(states(events), 'arming>active', 'no flicker');
  const sm = snaps.slice(40).map(s => s.corners[0].x), rawX = seq.slice(40).map(f => 1 - f.hands[0].lm[8].x);
  assert.ok(std(sm) < std(rawX) * 0.6, `smoothed ${std(sm).toFixed(5)} vs raw ${std(rawX).toFixed(5)}`);
});

test('gesture reset returns to idle', () => {
  const g = createFrameGesture(); g.reset(); assert.equal(g.state, 'idle');
});

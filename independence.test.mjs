// Independence suite (PLAN.md "Three independent systems"). Grows each session: S8 starts it with the mask system; the glitch (S10-S11) and atmosphere (S12) systems join their checks here when their files exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createMaskGesture } from './mask.js';
import { createFaceTracker, normalizeFaceResult, fromHead } from './facelm.js';
import { createFrameGesture } from './gesture.js';
import { createHandTracker } from './hands.js';
import { makeFace } from './synthface.mjs';
import { fistHand } from './synthfist.mjs';
import { frameHands, rect, rng } from './synth.mjs';

// The three systems and their files. A system file may import ONLY: its own system's files and these shared inputs / neutral helpers.
const SYSTEMS = { mask: ['mask.js', 'maskgl.js'], glitch: ['glitch.js', 'glitchgl.js'], atmosphere: ['atmosphere.js', 'atmospheregl.js'] };
const SHARED = ['config.js', 'facelm.js', 'hands.js', 'filters.js', 'homography.js', 'rng.js', 'rng.mjs', 'compositor.js'];
const files = Object.entries(SYSTEMS).flatMap(([sys, fs]) => fs.filter(existsSync).map(f => ({ sys, f })));
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');   // comments out
const importsOf = src => [...strip(src).matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*['"]\.\/([^'"]+)['"]|import\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map(m => m[1] || m[2]);

test('import graph: no system file imports another system, the looks, the window, main.js or the window gesture', () => {
  assert.ok(files.length >= 1, 'at least the mask system exists');
  for (const { sys, f } of files) {
    const own = SYSTEMS[sys];
    for (const imp of importsOf(readFileSync(f, 'utf8')))
      assert.ok(SHARED.includes(imp) || own.includes(imp), `${f} (${sys}) must not import ${imp}`);
  }
});
test('no wall clock, no random numbers, no timers in the system files (each system runs only on the time it is given)', () => {
  for (const { f } of files) {
    const src = strip(readFileSync(f, 'utf8'));
    assert.ok(!/Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/.test(src), `${f} reads a clock or random source`);
  }
});
test('no shared mutable module state: a system file exports functions and constants only', async () => {
  for (const { f } of files) {
    const m = await import('./' + f);
    for (const [k, v] of Object.entries(m)) assert.ok(typeof v === 'function' || typeof v === 'string' || (v && typeof v === 'object' && Object.isFrozen(v)) || (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string')), `${f}: export ${k} is mutable state`);
  }
});

// ---- state-hash replays: the mask state depends on the hand gesture and nothing else ----
const DT = 1000 / 30, A = 16 / 9;
function frames(ms = 3400) {
  const out = [], tr = createFaceTracker();
  for (let i = 0; i * DT <= ms; i++) {
    const t = i * DT, fs = tr.update(normalizeFaceResult(makeFace({ cx: 0.5, cy: 0.5, height: 0.3 }).result), t, { mirror: false, aspect: A });
    const k = Math.min(1, Math.max(0, (t - 500) / 900)), tt = t < 500 ? 1.9 : 1.9 - 1.9 * k, c = fromHead(fs.head, 0, tt);
    out.push({ t, face: fs, hands: [fistHand({ x: c.x, y: c.y, aspect: A })], frame: frameHands(rect(0.5, 0.5, 0.3, 0.45)) });
  }
  return out;
}
const hashOf = (fr, { windowGesture = false, burn = null, twoInstances = false } = {}) => {
  const m = createMaskGesture(), m2 = twoInstances ? createMaskGesture() : null, g = windowGesture ? createFrameGesture() : null, ht = windowGesture ? createHandTracker() : null, r = burn;
  const states = [];
  for (const f of fr) {
    if (g) g.update(ht.process(f.frame, f.t, true), f.t, A);                          // the window system watches other frames at the same time
    if (r) for (let i = 0; i < (r() * 5 | 0); i++) r();                                // a "glitch scheduler" eating random numbers in between
    if (m2) m2.update({ hands: [], face: null, t: f.t, aspect: A });
    const s = m.update({ hands: f.hands, face: f.face, t: f.t, aspect: A });
    states.push(`${s.state}|${s.progress.toFixed(9)}|${s.phase}`);
  }
  return states.join('\n');
};
test('mask state is identical with the window gesture running alongside (no shared state with the two-C gesture)', () => {
  const fr = frames(); assert.equal(hashOf(fr, { windowGesture: true }), hashOf(fr));
});
test('mask state is identical whatever other systems do with their own random numbers or instances (any seed)', () => {
  const fr = frames(), base = hashOf(fr);
  for (const seed of [1, 2, 3, 99]) assert.equal(hashOf(fr, { burn: rng(seed) }), base, `seed ${seed}`);
  assert.equal(hashOf(fr, { twoInstances: true }), base, 'a second mask instance does not interfere');
});
test('mask state changes only on its own gesture: without the fist nothing ever changes, whatever else is in view', () => {
  const fr = frames().map(f => ({ ...f, hands: [] }));
  assert.ok(hashOf(fr).split('\n').every(l => l.startsWith('hidden|0.000000000|idle')));
});

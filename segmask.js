// Segmentation helpers (Session 4). Pure functions, no DOM, no MediaPipe, no GL: everything here is unit-tested in node.
// A "mask" in this project is { w, h, data: Uint8Array RGBA, seq } in DISPLAY orientation, row 0 = top.
// Channels: R person, G hair, B skin (body + face), A clothes. A layer that is not switched on stays 0.
import { SEG, SEG_LABELS } from './config.js';

export const CHANNEL = { person: 0, hair: 1, skin: 2, clothes: 3 };
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- 1. category self-test, part 1: do the model's labels look like the model we expect? ----
export function checkLabels(labels, expected = SEG_LABELS) {
  if (!Array.isArray(labels) || labels.length === 0) return { ok: false, reason: 'no labels reported', unknown: true };
  if (labels.length !== expected.length) return { ok: false, reason: `expected ${expected.length} labels, got ${labels.length}` };
  if (!/background/i.test(String(labels[0]))) return { ok: false, reason: `label 0 is "${labels[0]}", not background` };
  return { ok: true, reason: 'labels ok' };
}

// ---- 2. category self-test, part 2: a flat grey picture has no person in it ----
// stats: { w, h, expectW, expectH, bgMean, personCoverage, finite }
export function evaluateFlatTest(s, cfg = SEG.selfTest) {
  if (!s.finite) return { ok: false, reason: 'mask has NaN or out-of-range values' };
  if (s.w !== s.expectW || s.h !== s.expectH) return { ok: false, reason: `mask is ${s.w}x${s.h}, expected ${s.expectW}x${s.expectH}` };
  if (s.bgMean < cfg.flatBgMin) return { ok: false, reason: `flat picture is only ${(s.bgMean * 100).toFixed(0)}% background (need ${(cfg.flatBgMin * 100).toFixed(0)}%)` };
  if (s.personCoverage > cfg.flatPersonMax) return { ok: false, reason: `flat picture shows ${(s.personCoverage * 100).toFixed(0)}% person (max ${(cfg.flatPersonMax * 100).toFixed(0)}%)` };
  return { ok: true, reason: 'flat picture is background' };
}

// Summary of a background-confidence array for the flat test. Values must be finite and inside [-0.01, 1.01].
export function flatStats(bg, w, h, expectW, expectH) {
  let sum = 0, person = 0, finite = true;
  for (let i = 0; i < bg.length; i++) { const v = bg[i]; if (!(v >= -0.01 && v <= 1.01)) { finite = false; break; } sum += v; if (1 - v > 0.5) person++; }
  const n = Math.max(1, bg.length);
  return { w, h, expectW, expectH, bgMean: sum / n, personCoverage: person / n, finite };
}

// ---- 3. read the layers out of a MediaPipe result ----
// confidenceMasks: array of objects with getAsFloat32Array() (MPMask). Data is COPIED, because MediaPipe owns the
// originals only for the duration of the callback. Only the masks a layer needs are read (each read can be a GPU readback).
export function readLayers(confidenceMasks, layers = SEG.layers) {
  const get = i => confidenceMasks[i].getAsFloat32Array();
  const out = {};
  if (layers.includes('person')) { const bg = get(0), p = new Float32Array(bg.length); for (let i = 0; i < bg.length; i++) p[i] = clamp01(1 - bg[i]); out.person = p; }
  if (layers.includes('hair')) out.hair = Float32Array.from(get(1), clamp01);
  if (layers.includes('skin')) { const a = get(2), b = get(3), p = new Float32Array(a.length); for (let i = 0; i < a.length; i++) p[i] = clamp01(a[i] + b[i]); out.skin = p; }
  if (layers.includes('clothes')) out.clothes = Float32Array.from(get(4), clamp01);
  return out;
}

// ---- 4. temporal smoothing ----
// Per pixel exponential smoothing with a change-adaptive weight: small differences (edge flicker between frames) are
// smoothed with time constant tauMs; big differences (a real movement) are followed immediately, so there are no ghost trails.
export function createMaskSmoother({ tauMs = SEG.tauMs, jumpLo = SEG.jumpLo, jumpHi = SEG.jumpHi, resetGapMs = SEG.resetGapMs } = {}) {
  let state = null, w = 0, h = 0, lastT = -Infinity, seq = 0;
  const reset = () => { state = null; lastT = -Infinity; };

  // channels: { person?: Float32Array, hair?, skin?, clothes? } all w*h, values 0..1. Returns a packed mask.
  function update(channels, width, height, tMs) {
    const n = width * height;
    const fresh = !state || width !== w || height !== h || tMs - lastT > resetGapMs || tMs < lastT;
    if (fresh) { w = width; h = height; state = {}; }
    const dt = fresh ? 0 : Math.min(Math.max(tMs - lastT, 1), 250);
    lastT = tMs;
    const base = 1 - Math.exp(-dt / tauMs), span = Math.max(jumpHi - jumpLo, 1e-6);
    const data = new Uint8Array(n * 4);
    for (const [name, ch] of Object.entries(CHANNEL)) {
      const src = channels[name]; if (!src) { state[name] = null; continue; }
      if (src.length !== n) throw new Error(`layer ${name} has ${src.length} values, expected ${n}`);
      let s = state[name];
      if (!s || fresh) { s = state[name] = Float32Array.from(src, clamp01); }
      else {
        for (let i = 0; i < n; i++) {
          const x = clamp01(src[i]), d = Math.abs(x - s[i]);
          const r = d <= jumpLo ? 0 : d >= jumpHi ? 1 : (d - jumpLo) / span, k = r * r * (3 - 2 * r);   // smoothstep release
          s[i] += (x - s[i]) * (base + (1 - base) * k);
        }
      }
      for (let i = 0, o = ch; i < n; i++, o += 4) data[o] = Math.round(clamp01(s[i]) * 255);
    }
    return { w, h, data, seq: ++seq };
  }
  return { update, reset };
}

// A mask older than maxAgeMs is not trusted any more.
export const maskFresh = (now, stamp, maxAgeMs = SEG.staleMs) => stamp != null && now - stamp <= maxAgeMs;

// ---- 5. category self-test, part 3: live cross-check with the hand model ----
// If HandLandmarker sees a hand, the palm centre must be inside the person mask. Sampled while the app runs.
const PALM = [0, 5, 9, 13, 17];
export function palmCentre(hand) {
  let x = 0, y = 0; for (const k of PALM) { x += hand.pts[k].x; y += hand.pts[k].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}
export function sampleMask(mask, x, y, channel = 0) {
  const ix = Math.min(mask.w - 1, Math.max(0, Math.floor(x * mask.w))), iy = Math.min(mask.h - 1, Math.max(0, Math.floor(y * mask.h)));
  return mask.data[(iy * mask.w + ix) * 4 + channel] / 255;
}
export function createHandAgreement({ minSamples = SEG.selfTest.handSamples, agreeMin = SEG.selfTest.handAgreeMin, window: win = SEG.selfTest.handWindow } = {}) {
  let ring = [], total = 0;
  return {
    add(mask, hands) {
      for (const hd of hands || []) {
        if (!hd.pts || hd.pts.length < 21 || hd.score < 0.6) continue;
        const c = palmCentre(hd); if (c.x < 0.02 || c.x > 0.98 || c.y < 0.02 || c.y > 0.98) continue;
        ring.push(sampleMask(mask, c.x, c.y) >= 0.5 ? 1 : 0); total++;
        if (ring.length > win) ring.shift();
      }
    },
    get rate() { return ring.length ? ring.reduce((a, b) => a + b, 0) / ring.length : null; },
    get samples() { return ring.length; },
    get verdict() {
      if (ring.length < minSamples) return 'unknown';
      return ring.reduce((a, b) => a + b, 0) / ring.length >= agreeMin ? 'ok' : 'suspect';
    },
    reset() { ring = []; total = 0; },
  };
}

// ---- 6. cadence governor: run the model every Nth camera frame; N rises when inference is slow ----
export function createGovernor({ budgetMs = SEG.governor.budgetMs, maxEvery = SEG.governor.maxEvery, minSamples = SEG.governor.minSamples } = {}) {
  let every = 1, ema = 0, n = 0, counter = 0;
  return {
    // Call once per camera frame; true = run the model on this frame.
    tick() { const run = counter % every === 0; counter++; return run; },
    report(ms) {
      ema = n === 0 ? ms : ema * 0.85 + ms * 0.15; n++;
      if (n < minSamples) return;
      const want = Math.min(maxEvery, Math.max(1, Math.ceil(ema / budgetMs)));
      if (want > every) every = want;                                   // slow: back off at once
      else if (want < every && ema < budgetMs * (every - 1) * 0.8) every = Math.max(want, every - 1); // fast again: step down with hysteresis
    },
    reset() { counter = 0; },
    get every() { return every; }, get avgMs() { return ema; },
  };
}

import { GESTURE, FRAME_LANDMARKS } from './config.js';

export const STATE = { IDLE: 'idle', ARMING: 'arming', ACTIVE: 'active', LOST: 'lost' };

const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Judges one frame of hands. Returns { ok, reason, corners (TL,TR,BR,BL in normalized display coords), area }.
// Geometry is done in aspect-corrected space so angles and areas are not distorted by a 16:9 picture.
export function evaluate(hands, th, aspect = 16 / 9) {
  if (hands.length < 2) return { ok: false, reason: hands.length ? 'one-hand' : 'no-hands' };
  if (Math.min(hands[0].score, hands[1].score) < th.minScore) return { ok: false, reason: 'low-confidence' };
  const pts = [];
  hands.slice(0, 2).forEach((h, hi) => FRAME_LANDMARKS.forEach(k => {
    const p = h.pts[k]; pts.push({ x: p.x * aspect, y: p.y, n: { x: p.x, y: p.y }, hand: hi });
  }));
  // Order clockwise around the centroid (screen y points down), then start at the top-left corner.
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  let q = pts.map(p => ({ ...p, a: Math.atan2(p.y - c.y, p.x - c.x) })).sort((a, b) => a.a - b.a);
  const start = q.reduce((bi, p, i) => (p.x + p.y < q[bi].x + q[bi].y ? i : bi), 0);
  q = q.slice(start).concat(q.slice(0, start));
  const out = { corners: q.map(p => p.n), area: 0 };
  const fail = reason => ({ ...out, ok: false, reason });

  for (let hi = 0; hi < 2; hi++) {
    const [a, b] = pts.filter(p => p.hand === hi);
    if (dist(a, b) < th.minTipGap) return fail('tips-together');
  }
  // Each hand forms one side of the frame, so its two tips must be neighbours; interleaved tips = crossed hands.
  const idx = hi => q.map((p, i) => (p.hand === hi ? i : -1)).filter(i => i >= 0);
  const [i0, i1] = idx(0);
  if (((i1 - i0 + 4) % 4) === 2) return fail('crossed');

  let area2 = 0, minE = Infinity, maxE = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], d = q[(i + 2) % 4];
    area2 += a.x * b.y - b.x * a.y;
    const e = dist(a, b); minE = Math.min(minE, e); maxE = Math.max(maxE, e);
    const sin = cross(a, b, d) / ((e * dist(b, d)) || 1);
    if (sin < th.minSin) { out.area = Math.abs(area2) / 2 / aspect; return fail('not-convex'); }
  }
  out.area = Math.abs(area2) / 2 / aspect;
  if (out.area < th.minArea) return fail('too-small');
  if (out.area > th.maxArea) return fail('too-large');
  if (minE / maxE < th.minEdgeRatio) return fail('degenerate');
  return { ...out, ok: true, reason: 'ok' };
}

// Keeps corner identity stable between frames: pick the rotation of the 4 corners closest to the previous ones.
function alignTo(prev, cs) {
  let best = 0, bd = Infinity;
  for (let s = 0; s < 4; s++) {
    let d = 0;
    for (let i = 0; i < 4; i++) d += dist(cs[(i + s) % 4], prev[i]);
    if (d < bd) { bd = d; best = s; }
  }
  return [0, 1, 2, 3].map(i => cs[(i + best) % 4]);
}

// IDLE -> ARMING (valid, strict thresholds) -> ACTIVE (held steady for holdMs; looser thresholds to stay)
// ACTIVE -> LOST (invalid; last corners held) -> ACTIVE (back in time, no re-hold) or IDLE (after graceMs).
export function createFrameGesture(cfg = GESTURE, onChange) {
  let state = STATE.IDLE, armStart = 0, lastOk = 0, good = null;
  const set = (s, t, info) => { if (s !== state) { const prev = state; state = s; onChange && onChange(s, prev, info); } };

  function update(hands, t, aspect = 16 / 9) {
    const live = state === STATE.ACTIVE || state === STATE.LOST;
    const res = evaluate(hands, live ? cfg.exit : cfg.enter, aspect);
    if (res.ok && good && live) res.corners = alignTo(good.corners, res.corners);
    if (res.ok) lastOk = t;
    switch (state) {
      case STATE.IDLE:
        if (res.ok) { armStart = t; set(STATE.ARMING, t, res); }
        break;
      case STATE.ARMING:
        if (res.ok && t - armStart >= cfg.holdMs) { good = res; set(STATE.ACTIVE, t, res); }
        else if (!res.ok && t - lastOk > cfg.armTolMs) set(STATE.IDLE, t, res);
        break;
      case STATE.ACTIVE:
        if (res.ok) good = res; else set(STATE.LOST, t, res);
        break;
      case STATE.LOST:
        if (res.ok) { good = res; set(STATE.ACTIVE, t, res); }
        else if (t - lastOk > cfg.graceMs) { good = null; set(STATE.IDLE, t, res); }
        break;
    }
    const live2 = state === STATE.ACTIVE || state === STATE.LOST;
    return {
      state, reason: res.reason, area: res.area ?? 0,
      corners: live2 && good ? good.corners : null,     // TL,TR,BR,BL, normalized display coords; held while LOST
      candidate: res.corners || null,                   // this frame's raw guess (for the debug overlay)
      progress: state === STATE.ARMING ? Math.min(1, (t - armStart) / cfg.holdMs) : live2 ? 1 : 0,
    };
  }
  return { update, reset() { state = STATE.IDLE; good = null; }, get state() { return state; } };
}

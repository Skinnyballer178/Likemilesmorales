// Suit look, pure geometry (Session 6): measures the body from the packed person mask and turns hand landmarks into wrist bands.
// No WebGL here, so it is fully testable. All results are in DISPLAY coordinates normalised to 0..1 (x right, y down).
import { SUIT } from './config.js';

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

// mask: { w, h, data: Uint8Array RGBA }  (R person, A clothes). Returns null when nobody is there.
export function analyzeBody(mask, cfg = SUIT) {
  if (!mask || !mask.data || !mask.w || !mask.h) return null;
  const { w, h, data } = mask, minPx = Math.max(2, cfg.personMin * w);
  const pc = new Int32Array(h), cc = new Int32Array(h), minX = new Int32Array(h).fill(w), maxX = new Int32Array(h).fill(-1);
  const cMin = new Int32Array(h).fill(w), cMax = new Int32Array(h).fill(-1), px = new Float64Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i] >= 128) { pc[y]++; px[y] += x; if (x < minX[y]) minX[y] = x; if (x > maxX[y]) maxX[y] = x; }
    if (data[i] >= 128 && data[i + 3] >= 128) { cc[y]++; if (x < cMin[y]) cMin[y] = x; if (x > cMax[y]) cMax[y] = x; }
  }
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) if (pc[y] >= minPx) { if (top < 0) top = y; bottom = y; }
  if (top < 0 || bottom - top < 6) return null;
  const personH = bottom - top + 1;
  let maxC = 0; for (let y = 0; y < h; y++) if (cc[y] > maxC) maxC = cc[y];
  // torso top: first run of rows (not too near the top of the person) with plenty of clothes
  const T = cfg.torso; let torso = -1;
  if (maxC >= minPx) {
    const from = Math.max(top, Math.round(top + T.startFrac * personH));
    for (let y = from; y <= bottom - T.rows + 1 && torso < 0; y++) {
      let ok = true; for (let k = 0; k < T.rows; k++) if (cc[y + k] < T.minRowFrac * maxC) { ok = false; break; }
      if (ok) torso = y;
    }
  }
  const usedClothes = torso >= 0;
  if (!usedClothes) torso = Math.round(top + T.fallbackFrac * personH);
  torso = Math.min(Math.max(torso, top + 3), bottom);
  // head: rows from the person's top down to the torso
  const headRows = []; for (let y = top; y < torso; y++) if (pc[y] >= minPx) headRows.push(y);
  const widths = headRows.slice(Math.floor(headRows.length * 0.3), Math.ceil(headRows.length * 0.8) || 1).map(y => maxX[y] - minX[y] + 1);
  let sx = 0, sn = 0; for (const y of headRows) { sx += px[y]; sn += pc[y]; }
  const headSpan = torso - top, H = cfg.head;
  const head = { cx: (sn ? sx / sn : w / 2) / w, cy: (top + 0.5 * H.heightFrac * headSpan) / h, rx: (median(widths) * H.rxScale) / w, ry: (0.5 * H.heightFrac * headSpan * H.ryScale) / h };
  // chest: below the torso top; centre and width measured on the clothes at that row
  const bodyH = Math.max(bottom - torso, 1), chestY = Math.min(Math.round(torso + cfg.chestDrop * bodyH), h - 1);
  let lo = w, hi = -1;
  for (let y = Math.max(chestY - 2, 0); y <= Math.min(chestY + 2, h - 1); y++) {
    const a = usedClothes && cc[y] ? cMin[y] : minX[y], b = usedClothes && cc[y] ? cMax[y] : maxX[y];
    if (b >= 0) { if (a < lo) lo = a; if (b > hi) hi = b; }
  }
  const chestW = hi >= lo ? (hi - lo + 1) / w : 4 * head.rx;
  const chest = { x: hi >= lo ? (lo + hi + 1) / 2 / w : head.cx, y: chestY / h, s: Math.max(chestW, 0.05) };
  return { head, chest, top: top / h, torso: torso / h, usedClothes };
}

// Exponential smoothing of the measured numbers. update(null) = nobody / stale: forget everything.
export function createBodyTracker({ tauMs = SUIT.tauMs, resetGapMs = SUIT.resetGapMs } = {}) {
  let cur = null, lastT = -Infinity;
  const mix = (a, b, k) => a + (b - a) * k;
  function update(body, tMs) {
    if (!body) { cur = null; lastT = -Infinity; return null; }
    if (!cur || tMs - lastT > resetGapMs || tMs < lastT) cur = JSON.parse(JSON.stringify(body));
    else {
      const k = 1 - Math.exp(-Math.min(tMs - lastT, 250) / tauMs);
      for (const g of ['head', 'chest']) for (const f of Object.keys(body[g])) cur[g][f] = mix(cur[g][f], body[g][f], k);
      cur.top = mix(cur.top, body.top, k); cur.torso = mix(cur.torso, body.torso, k); cur.usedClothes = body.usedClothes;
    }
    lastT = tMs; return cur;
  }
  return { update, get body() { return cur; }, reset() { cur = null; lastT = -Infinity; } };
}

// Hands (display coordinates, normalised) -> wrist bands + hand regions, in ASPECT space (x multiplied by the picture aspect), as the shader wants them.
export function wristBands(hands, aspect, cfg = SUIT) {
  const out = [];
  for (const hd of (hands || []).slice(0, 2)) {
    const p = hd.pts || hd.lm; if (!p || p.length < 10) continue;
    const wx = p[0].x * aspect, wy = p[0].y, mx = p[9].x * aspect, my = p[9].y;
    const size = Math.hypot(mx - wx, my - wy); if (size < 1e-4) continue;
    const dx = (wx - mx) / size, dy = (wy - my) / size;        // wrist -> elbow direction (away from the fingers)
    out.push({
      band: { x: wx + dx * cfg.band.along * size, y: wy + dy * cfg.band.along * size, dx, dy, half: cfg.band.half * size, across: cfg.band.across * size },
      hand: { x: wx + (mx - wx) * cfg.hand.centre, y: wy + (my - wy) * cfg.hand.centre, r: cfg.hand.radius * size },
    });
  }
  return out;
}

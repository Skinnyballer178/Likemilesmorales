// Synthetic landmark generator for tests: builds fake hands whose thumb/index tips sit where we say.
export function rng(seed = 1) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// Raw (unmirrored) hand: all 21 points near the wrist except tips 4 and 8.
export function makeHand({ thumb, index, wrist, score = 0.95, label = 'Left' }) {
  const lm = Array.from({ length: 21 }, () => ({ x: wrist.x, y: wrist.y, z: 0 }));
  lm[4] = { ...thumb, z: 0 }; lm[8] = { ...index, z: 0 };
  return { label, score, lm };
}

// Corners {tl,tr,br,bl} in DISPLAY coords -> list of two raw hands (screen-left hand: thumb bl, index tl; screen-right: index tr, thumb br).
export function frameHands(c, { mirror = true, noise = 0, r = rng(7), swapOrder = false, scoreA = 0.95, scoreB = 0.95, interleave = false } = {}) {
  const jit = p => ({ x: p.x + noise * gauss(r), y: p.y + noise * gauss(r) });
  const raw = p => (mirror ? { x: 1 - p.x, y: p.y } : p);
  const A = interleave ? { thumb: c.br, index: c.tl } : { thumb: c.bl, index: c.tl };
  const B = interleave ? { thumb: c.bl, index: c.tr } : { thumb: c.br, index: c.tr };
  const mk = (h, w, score, label) => makeHand({ thumb: raw(jit(h.thumb)), index: raw(jit(h.index)), wrist: raw({ x: w.x + (noise ? 0 : 0), y: w.y }), score, label });
  const hands = [
    mk(A, { x: c.tl.x - 0.1, y: (c.tl.y + c.bl.y) / 2 }, scoreA, 'Left'),
    mk(B, { x: c.tr.x + 0.1, y: (c.tr.y + c.br.y) / 2 }, scoreB, 'Right'),
  ];
  return swapOrder ? hands.reverse() : hands;
}

// Rectangle (center, size as fraction of height/width) rotated by deg, in display coords for a given aspect.
export function rect(cx = 0.5, cy = 0.5, w = 0.3, h = 0.4, deg = 0, aspect = 16 / 9) {
  const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  const pt = (dx, dy) => { const X = dx * aspect * w, Y = dy * h; return { x: cx + (X * co - Y * si) / aspect, y: cy + X * si + Y * co }; };
  return { tl: pt(-0.5, -0.5), tr: pt(0.5, -0.5), br: pt(0.5, 0.5), bl: pt(-0.5, 0.5) };
}

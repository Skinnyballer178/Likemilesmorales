/**
 * Session 9 — helpers that tie the suit to the dotted wall.
 *
 * edgeDistance: for every body pixel, how far it is from the wall (in pixels).
 * dressedFlags: which wall dots touch painted suit, so they can wear the suit trim.
 */

import type { Box, Pt } from "./shell.ts";

const FAR = 1e20;

let cache = new Float32Array(0);
let lineIn = new Float64Array(0);
let lineOut = new Float64Array(0);
let hull = new Int32Array(0);
let cuts = new Float64Array(0);

/**
 * Exact distance (Felzenszwalb–Huttenlocher) from each body pixel centre to the nearest
 * non-body pixel. Image borders count as outside, matching where traceWall puts the wall.
 * Returns a shared buffer: read it right away, do not keep it between calls.
 * Values are only valid for body pixels inside `box`; the wall itself sits at 0.
 */
export function edgeDistance(bin: Uint8Array, w: number, h: number, box: Box): Float32Array {
  if (cache.length !== w * h) cache = new Float32Array(w * h);

  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  // One pixel of padding on every side so the outside is always present.
  const rw = bw + 2;
  const rh = bh + 2;
  const grid = new Float64Array(rw * rh);

  const need = Math.max(rw, rh) + 2;
  if (lineIn.length < need) {
    lineIn = new Float64Array(need);
    lineOut = new Float64Array(need);
    hull = new Int32Array(need);
    cuts = new Float64Array(need + 1);
  }

  for (let y = 0; y < bh; y++) {
    const src = (box.y0 + y) * w + box.x0;
    const dst = (y + 1) * rw + 1;
    for (let x = 0; x < bw; x++) grid[dst + x] = bin[src + x] ? FAR : 0;
  }
  for (let x = 0; x < rw; x++) {
    grid[x] = 0;
    grid[(rh - 1) * rw + x] = 0;
  }
  for (let y = 0; y < rh; y++) {
    grid[y * rw] = 0;
    grid[y * rw + rw - 1] = 0;
  }

  for (let x = 0; x < rw; x++) {
    for (let y = 0; y < rh; y++) lineIn[y] = grid[y * rw + x];
    squaredPass(rh);
    for (let y = 0; y < rh; y++) grid[y * rw + x] = lineOut[y];
  }
  for (let y = 0; y < rh; y++) {
    const row = y * rw;
    for (let x = 0; x < rw; x++) lineIn[x] = grid[row + x];
    squaredPass(rw);
    for (let x = 0; x < rw; x++) grid[row + x] = lineOut[x];
  }

  for (let y = 0; y < bh; y++) {
    const src = (y + 1) * rw + 1;
    const dst = (box.y0 + y) * w + box.x0;
    for (let x = 0; x < bw; x++) {
      cache[dst + x] = bin[dst + x] ? Math.max(0, Math.sqrt(grid[src + x]) - 0.5) : 0;
    }
  }
  return cache;
}

function squaredPass(n: number) {
  let k = 0;
  hull[0] = 0;
  cuts[0] = -FAR;
  cuts[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = crossing(q, hull[k]);
    while (s <= cuts[k]) {
      k--;
      s = crossing(q, hull[k]);
    }
    k++;
    hull[k] = q;
    cuts[k] = s;
    cuts[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (cuts[k + 1] < q) k++;
    const dx = q - hull[k];
    lineOut[q] = dx * dx + lineIn[hull[k]];
  }
}

function crossing(q: number, p: number): number {
  return (lineIn[q] + q * q - (lineIn[p] + p * p)) / (2 * q - 2 * p);
}

/**
 * A dot is "dressed" when a painted suit pixel touches it. Dots on the bare face,
 * or outside the frame, stay plain so the suit visibly ends where the cloth window ends.
 */
export function dressedFlags(dots: Pt[], px: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(dots.length);
  for (let n = 0; n < dots.length; n++) {
    const ix = Math.floor(dots[n].x);
    const iy = Math.floor(dots[n].y);
    let hit = 0;
    for (let dy = -1; dy <= 0 && !hit; dy++) {
      const yy = iy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 0; dx++) {
        const xx = ix + dx;
        if (xx < 0 || xx >= w) continue;
        if (px[(yy * w + xx) * 4 + 3]) {
          hit = 1;
          break;
        }
      }
    }
    out[n] = hit;
  }
  return out;
}

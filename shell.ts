/** One-person cell wall: select the largest body, walk its exact outer edge. */

export type Pt = { x: number; y: number };
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Ellipse = { cx: number; cy: number; rx: number; ry: number };

const LIMB_FRACTION = 0.1;
const LIMB_GAP = 6;

/** Keep the largest body. Absorb small nearby fragments (hands). Ignore everyone else. */
export function selectPrimary(
  src: Uint8Array,
  w: number,
  h: number,
): { mask: Uint8Array; ignored: number } {
  const labels = new Int32Array(w * h);
  const sizes: number[] = [0];
  const boxes: Box[] = [{ x0: 0, y0: 0, x1: 0, y1: 0 }];
  let next = 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!src[i] || labels[i]) continue;
      const id = next++;
      sizes[id] = 0;
      boxes[id] = { x0: x, y0: y, x1: x, y1: y };
      const stack = [i];
      labels[i] = id;
      while (stack.length) {
        const cur = stack.pop()!;
        sizes[id]++;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        if (cx < boxes[id].x0) boxes[id].x0 = cx;
        if (cy < boxes[id].y0) boxes[id].y0 = cy;
        if (cx > boxes[id].x1) boxes[id].x1 = cx;
        if (cy > boxes[id].y1) boxes[id].y1 = cy;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!src[ni] || labels[ni]) continue;
          labels[ni] = id;
          stack.push(ni);
        }
      }
    }
  }

  let primary = 0;
  let best = 0;
  const area = w * h;
  for (let id = 1; id < next; id++) {
    if (sizes[id] > best && sizes[id] > area * 0.02) {
      best = sizes[id];
      primary = id;
    }
  }

  const mask = new Uint8Array(w * h);
  if (!primary) return { mask, ignored: Math.max(0, next - 1) };

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === primary) mask[i] = 1;
  }

  const pb = boxes[primary];
  let ignored = 0;
  for (let id = 1; id < next; id++) {
    if (id === primary) continue;
    const frac = sizes[id] / best;
    if (frac > LIMB_FRACTION) {
      ignored++;
      continue;
    }
    const b = boxes[id];
    const gap =
      Math.max(0, b.x0 - pb.x1 - 1, pb.x0 - b.x1 - 1) +
      Math.max(0, b.y0 - pb.y1 - 1, pb.y0 - b.y1 - 1);
    const near =
      gap <= LIMB_GAP &&
      b.y1 - b.y0 + 1 < (pb.y1 - pb.y0 + 1) * 0.55;
    if (near) {
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] === id) mask[i] = 1;
      }
    } else {
      ignored++;
    }
  }

  return { mask, ignored };
}

/**
 * Walk the outer edge of the body. Points sit on pixel corners so the wall
 * touches the skin with zero gap.
 */
export function traceWall(bin: Uint8Array, w: number, h: number): Pt[][] {
  const edges = new Map<string, Pt>();
  const dirs: Pt[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];

  function on(x: number, y: number) {
    return x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      if (!on(x, y - 1)) {
        const a = `${x},${y}`;
        const b = `${x + 1},${y}`;
        edges.set(`${a}>${b}`, { x: x + 1, y });
      }
      if (!on(x + 1, y)) {
        const a = `${x + 1},${y}`;
        const b = `${x + 1},${y + 1}`;
        edges.set(`${a}>${b}`, { x: x + 1, y: y + 1 });
      }
      if (!on(x, y + 1)) {
        const a = `${x + 1},${y + 1}`;
        const b = `${x},${y + 1}`;
        edges.set(`${a}>${b}`, { x, y: y + 1 });
      }
      if (!on(x - 1, y)) {
        const a = `${x},${y + 1}`;
        const b = `${x},${y}`;
        edges.set(`${a}>${b}`, { x, y });
      }
    }
  }

  const loops: Pt[][] = [];
  while (edges.size) {
    const startKey = edges.keys().next().value as string;
    const [from, to] = startKey.split(">");
    const start = from;
    const loop: Pt[] = [];
    let curFrom = from;
    let curTo = to;
    let guard = edges.size + 4;
    while (guard-- > 0) {
      const key = `${curFrom}>${curTo}`;
      const next = edges.get(key);
      if (!next) break;
      edges.delete(key);
      loop.push({ x: next.x, y: next.y });
      curFrom = curTo;
      const [nx, ny] = curFrom.split(",").map(Number);
      let found = false;
      for (let turn = 0; turn < 4; turn++) {
        const d = dirs[turn];
        const cand = `${nx + d.x},${ny + d.y}`;
        if (edges.has(`${curFrom}>${cand}`)) {
          curTo = cand;
          found = true;
          break;
        }
      }
      if (!found) break;
      if (curFrom === start && loop.length > 2) break;
    }
    if (loop.length > 3) loops.push(loop);
  }

  loops.sort((a, b) => b.length - a.length);
  return loops;
}

/** Evenly spaced samples along the wall for the dotted cell. */
export function sampleWall(loops: Pt[][], spacing: number): Pt[] {
  const out: Pt[] = [];
  const step = Math.max(2, spacing);
  for (const loop of loops) {
    if (loop.length < 2) continue;
    let dist = 0;
    let next = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 1e-6) continue;
      while (next <= dist + seg) {
        const t = (next - dist) / seg;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        next += step;
      }
      dist += seg;
    }
  }
  return out;
}

export function wallLength(loops: Pt[][]): number {
  let len = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return Math.round(len);
}

export function boundsOf(bin: Uint8Array, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!bin[row + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

/** Primary-body pixels whose centers sit inside the frame polygon. */
export function clothMask(bin: Uint8Array, w: number, h: number, frame: Pt[]): Uint8Array {
  const out = new Uint8Array(w * h);
  const box = boundsOf(bin, w, h);
  if (!box) return out;
  const x0 = Math.max(0, box.x0);
  const y0 = Math.max(0, box.y0);
  const x1 = Math.min(w - 1, box.x1);
  const y1 = Math.min(h - 1, box.y1);
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      if (!bin[row + x]) continue;
      if (pointInPoly(x + 0.5, y + 0.5, frame)) out[row + x] = 1;
    }
  }
  return out;
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const hit =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Head as an ellipse on the central torso column — ignores raised hands. */
export function headEllipse(bin: Uint8Array, w: number, box: Box): Ellipse {
  const height = Math.max(1, box.y1 - box.y0 + 1);
  const torsoX = torsoCenter(bin, w, box);
  const half = Math.max(4, Math.round(height * 0.12));
  const xL = Math.max(0, Math.floor(torsoX - half));
  const xR = Math.min(w - 1, Math.ceil(torsoX + half));

  let top = -1;
  for (let y = box.y0; y <= box.y1; y++) {
    if (rowCount(bin, w, y, xL, xR) > 0) {
      top = y;
      break;
    }
  }
  if (top < 0) {
    return { cx: torsoX, cy: box.y0 + height * 0.1, rx: height * 0.08, ry: height * 0.1 };
  }

  const cap = Math.min(box.y1, top + Math.round(height * 0.28));
  let peak = 0;
  let bot = top;
  let prev = 0;
  let falling = false;
  for (let y = top; y <= cap; y++) {
    const c = rowCount(bin, w, y, xL, xR);
    if (c === 0) break;
    if (!falling) {
      if (c >= peak) peak = c;
      else if (peak > 3 && c < peak * 0.9) falling = true;
    }
    if (falling && peak > 3 && c < peak * 0.72 && Math.abs(c - prev) <= 1 && y > top + 2) break;
    if (falling && c > prev * 1.35 && c > peak * 0.8 && prev > 0) break;
    prev = c;
    bot = y;
  }

  let minX = w;
  let maxX = 0;
  let minY = box.y1;
  let maxY = box.y0;
  let cnt = 0;
  for (let y = top; y <= bot; y++) {
    for (let x = xL; x <= xR; x++) {
      if (!bin[y * w + x]) continue;
      cnt++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!cnt) {
    return { cx: torsoX, cy: top + 4, rx: height * 0.08, ry: height * 0.1 };
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: Math.max(3, (maxX - minX + 1) / 2 * 1.05),
    ry: Math.max(3, (maxY - minY + 1) / 2 * 1.08),
  };
}

export function inEllipse(x: number, y: number, e: Ellipse): boolean {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

export function measure(
  bin: Uint8Array,
  w: number,
  h: number,
  loops: Pt[][],
  others: number,
) {
  const box = boundsOf(bin, w, h);
  if (!box) return { height: 0, chest: 0, shell: 0, others };
  const height = box.y1 - box.y0 + 1;
  const midY = box.y0 + Math.floor(height * 0.42);
  let chest = 0;
  let run = 0;
  for (let x = box.x0; x <= box.x1 + 1; x++) {
    const on = x <= box.x1 && bin[midY * w + x] === 1;
    if (on) run++;
    else if (run) {
      if (run > chest) chest = run;
      run = 0;
    }
  }
  return {
    height,
    chest,
    shell: wallLength(loops),
    others,
  };
}

function torsoCenter(bin: Uint8Array, w: number, box: Box): number {
  const height = box.y1 - box.y0 + 1;
  const y = box.y0 + Math.floor(height * 0.48);
  const row = y * w;
  let best = 0;
  let bestMid = (box.x0 + box.x1) / 2;
  let run = 0;
  let runStart = 0;
  for (let x = box.x0; x <= box.x1 + 1; x++) {
    const on = x <= box.x1 && bin[row + x] === 1;
    if (on) {
      if (run === 0) runStart = x;
      run++;
    } else if (run) {
      if (run > best) {
        best = run;
        bestMid = runStart + (run - 1) / 2;
      }
      run = 0;
    }
  }
  return bestMid;
}

function rowCount(bin: Uint8Array, w: number, y: number, x0: number, x1: number): number {
  let n = 0;
  const row = y * w;
  for (let x = x0; x <= x1; x++) if (bin[row + x]) n++;
  return n;
}

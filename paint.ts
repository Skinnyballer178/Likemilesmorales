import { edgeDistance } from "./fit.ts";
import { boundsOf, clothMask, headEllipse, inEllipse, type Ellipse, type Pt } from "./shell.ts";

export type Look = "suit" | "jacket";

const SUIT = [14, 16, 20];
const SUIT_LIFT = [14, 16, 20];
const WEB = [196, 42, 58];
const MARK = [214, 48, 64];
const LENS = [236, 240, 244];
const QUILT_A = [16, 92, 104];
const QUILT_B = [12, 70, 82];
const COLLAR = [168, 36, 52];
const ZIP = [236, 214, 196];

/** Trim colour: the piping sewn on the wall, and the dots that sit on it. */
export const TRIM = [255, 61, 82];
export const TRIM_HEX = "#ff3d52";

const STRANDS = 16;
const TAU = Math.PI * 2;

/**
 * Opaque cloth on primary-body pixels inside the frame.
 * Session 9: the suit is built from its distance to the dotted wall, so the
 * piping, shading and web rings all follow the exact body edge.
 * Face stays clear unless the suit mask is on. Jacket never masks.
 */
export function paintOutfit(
  bin: Uint8Array,
  w: number,
  h: number,
  frame: Pt[],
  look: Look,
  maskOn: boolean,
): Uint8ClampedArray {
  const cloth = clothMask(bin, w, h, frame);
  const px = new Uint8ClampedArray(w * h * 4);
  const box = boundsOf(bin, w, h);
  if (!box) return px;

  const head = headEllipse(bin, w, box);
  const dist = edgeDistance(bin, w, h, box);
  const s = Math.min(2.2, Math.max(0.6, (box.y1 - box.y0 + 1) / 540));
  const pipe = 1.8 * s;
  const pitch = 17 * s;
  const half = 0.9 * s;
  const masked = look === "suit" && maskOn;
  const chestX = torsoMidX(bin, w, box);
  const chestY = head.cy + head.ry + Math.max(6, head.ry * 0.85);

  const y0 = Math.max(0, box.y0);
  const y1 = Math.min(h - 1, box.y1);
  const x0 = Math.max(0, box.x0);
  const x1 = Math.min(w - 1, box.x1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!cloth[i]) continue;
      const o = i * 4;
      const d = dist[i];
      const face = inEllipse(x + 0.5, y + 0.5, head);

      if (look === "jacket") {
        if (face) continue;
        if (collar(x, y, head)) {
          write(px, o, COLLAR);
        } else {
          const q = (Math.floor(x / 11) + Math.floor(y / 9)) % 2 === 0 ? QUILT_A : QUILT_B;
          write(px, o, q);
          if (y % 9 === 0) write(px, o, [q[0] + 26, q[1] + 30, q[2] + 26]);
          if (Math.abs(x - chestX) < 1.2) write(px, o, ZIP);
          // Tight-fit shade: slightly darker right at the wall, easing off inward.
          shade(px, o, 0.78 + 0.22 * smooth(d / (10 * s)));
        }
        blend(px, o, COLLAR, cover(d, pipe));
        continue;
      }

      if (face) {
        if (masked) {
          paintMaskPixel(px, o, x, y, head);
          blend(px, o, TRIM, cover(d, pipe));
        }
        continue;
      }

      // Suit: deepest black at the wall, lifting gently inward so the body reads as round.
      const depth = smooth(d / (18 * s));
      write(px, o, [
        SUIT[0] + SUIT_LIFT[0] * depth,
        SUIT[1] + SUIT_LIFT[1] * depth,
        SUIT[2] + SUIT_LIFT[2] * depth,
      ]);

      // Web rings: lines of equal distance to the wall, so they bend with every limb.
      if (d > pipe + 2 * s) {
        const m = mod(d - pipe - 3 * s, pitch);
        const ring = Math.min(m, pitch - m);
        const fade = 1 - 0.5 * Math.min(1, d / (pitch * 4));
        blend(px, o, WEB, cover(ring, half) * fade);
      }

      // Web strands: spokes from the chest mark out to the wall.
      const wx = x + 0.5 - chestX;
      const wy = y + 0.5 - chestY;
      const r = Math.hypot(wx, wy);
      if (r > 7 * s) {
        const u = (Math.atan2(wy, wx) * STRANDS) / TAU;
        const arc = Math.abs(u - Math.round(u)) * ((TAU * r) / STRANDS);
        blend(px, o, WEB, cover(arc, half) * 0.9);
      }

      paintMark(px, o, wx, wy, s);
      // Piping last: sewn exactly on the wall, under the dots.
      blend(px, o, TRIM, cover(d, pipe));
    }
  }
  return px;
}

function collar(x: number, y: number, head: Ellipse): boolean {
  const below = y - (head.cy + head.ry);
  if (below < 0 || below > Math.max(5, head.ry * 0.55)) return false;
  return Math.abs(x - head.cx) <= head.rx * 1.05;
}

function paintMaskPixel(px: Uint8ClampedArray, o: number, x: number, y: number, head: Ellipse) {
  write(px, o, [18, 18, 20]);
  const eyeY = head.cy - head.ry * 0.06;
  const eyeRx = head.rx * 0.3;
  const eyeRy = head.ry * 0.16;
  for (const side of [-1, 1]) {
    const ex = head.cx + side * head.rx * 0.38;
    const dx = (x + 0.5 - ex) / eyeRx;
    const dy = (y + 0.5 - eyeY) / eyeRy;
    if (dx * dx + dy * dy <= 1) write(px, o, LENS);
  }
}

function paintMark(px: Uint8ClampedArray, o: number, dx: number, dy: number, s: number) {
  const r = Math.hypot(dx, dy);
  if (r > 11 * s && r < 14 * s) write(px, o, MARK);
  if (r < 5.5 * s && (Math.abs(dx) < 1.1 * s || Math.abs(dy) < 1.1 * s)) write(px, o, MARK);
}

function torsoMidX(bin: Uint8Array, w: number, box: { x0: number; y0: number; x1: number; y1: number }): number {
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

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Soft line coverage: 1 inside `half`, fading to 0 over one pixel. */
function cover(distance: number, half: number): number {
  return Math.min(1, Math.max(0, half + 0.5 - distance));
}

function write(px: Uint8ClampedArray, o: number, rgb: number[]) {
  px[o] = rgb[0];
  px[o + 1] = rgb[1];
  px[o + 2] = rgb[2];
  px[o + 3] = 255;
}

function blend(px: Uint8ClampedArray, o: number, rgb: number[], a: number) {
  if (a <= 0) return;
  px[o] += (rgb[0] - px[o]) * a;
  px[o + 1] += (rgb[1] - px[o + 1]) * a;
  px[o + 2] += (rgb[2] - px[o + 2]) * a;
}

function shade(px: Uint8ClampedArray, o: number, k: number) {
  px[o] *= k;
  px[o + 1] *= k;
  px[o + 2] *= k;
}

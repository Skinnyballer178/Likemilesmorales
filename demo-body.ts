import type { Pt } from "./shell.ts";

const WALL = [12, 14, 18];
const FLOOR = [18, 22, 28];
const GLASS = [16, 72, 82];
const MULLION = [40, 48, 54];
const CHAIR = [58, 42, 32];
const SKIN = [232, 196, 164];
const HAIR = [42, 32, 28];
const EYE = [22, 20, 18];
const SHIRT = [58, 68, 78];
const PANTS = [48, 54, 62];
const SHIRT_B = [110, 72, 52];
const PANTS_B = [52, 58, 68];

export type Scene = {
  raw: Uint8Array;
  rgba: Uint8ClampedArray;
};

type Seg = { x0: number; y0: number; x1: number; y1: number; r: number };
type Fig = {
  hx: number;
  hy: number;
  hr: number;
  torso: { x: number; y: number; w: number; h: number };
  arms: Seg[];
  hands: { x: number; y: number; r: number }[];
  fingers: Seg[];
  legs: Seg[];
};

export function demoFigures(w: number, h: number, t: number): { primary: Fig; extra: Fig } {
  const sway = Math.sin(t * 0.0015) * Math.min(w, h) * 0.012;
  const arm = Math.sin(t * 0.0018) * 0.35;
  const primaryH = Math.min(h * 0.86, Math.min(w, h) * 1.15);
  const extraH = primaryH * 0.46;
  const primaryCx = w * 0.64 + sway;
  const extraCx = w * 0.22;
  const gap = Math.abs(primaryCx - extraCx);
  const primary = figure(primaryCx, h * 0.05, primaryH, arm, gap * 0.22);
  const extra = figure(extraCx, h * 0.46, extraH, 0.15, gap * 0.16);
  return { primary, extra };
}

function figure(cx: number, top: number, height: number, arm: number, reachCap: number): Fig {
  const hr = height * 0.09;
  const hy = top + hr + 1;
  const torsoW = height * 0.27;
  const torsoH = height * 0.32;
  const torsoY = hy + hr * 0.62;
  const hipY = torsoY + torsoH;
  const reach = Math.min(height * 0.3, Math.max(hr * 2.2, reachCap));
  const shoulderY = torsoY + torsoH * 0.16;
  const leftA = Math.PI - 0.05 + arm * 0.55;
  const rightA = 0.18 - arm * 0.4;
  const leftHand = {
    x: cx - torsoW * 0.36 + Math.cos(leftA) * reach,
    y: shoulderY + Math.sin(leftA) * reach,
  };
  const rightHand = {
    x: cx + torsoW * 0.36 + Math.cos(rightA) * reach,
    y: shoulderY + Math.sin(rightA) * reach,
  };
  const armR = height * 0.042;
  const handR = armR * 1.45;
  return {
    hx: cx,
    hy,
    hr,
    torso: { x: cx - torsoW / 2, y: torsoY, w: torsoW, h: torsoH },
    arms: [
      { x0: cx - torsoW * 0.36, y0: shoulderY, x1: leftHand.x, y1: leftHand.y, r: armR },
      { x0: cx + torsoW * 0.36, y0: shoulderY, x1: rightHand.x, y1: rightHand.y, r: armR },
    ],
    hands: [
      { x: leftHand.x, y: leftHand.y, r: handR },
      { x: rightHand.x, y: rightHand.y, r: handR },
    ],
    fingers: [...fingers(leftHand.x, leftHand.y, leftA, handR), ...fingers(rightHand.x, rightHand.y, rightA, handR)],
    legs: [
      { x0: cx - torsoW * 0.18, y0: hipY - 2, x1: cx - torsoW * 0.22, y1: top + height, r: height * 0.05 },
      { x0: cx + torsoW * 0.18, y0: hipY - 2, x1: cx + torsoW * 0.24, y1: top + height, r: height * 0.05 },
    ],
  };
}

function fingers(x: number, y: number, angle: number, handR: number): Seg[] {
  const len = handR * 2.15;
  const thick = Math.max(1.4, handR * 0.28);
  return [-0.62, -0.22, 0.18, 0.55].map((spread) => ({
    x0: x + Math.cos(angle) * handR * 0.15,
    y0: y + Math.sin(angle) * handR * 0.15,
    x1: x + Math.cos(angle + spread) * (handR * 0.2 + len),
    y1: y + Math.sin(angle + spread) * (handR * 0.2 + len),
    r: thick,
  }));
}

export function buildScene(w: number, h: number, t: number): Scene {
  const rgba = new Uint8ClampedArray(w * h * 4);
  fillRect(rgba, w, h, 0, 0, w, h, WALL);
  fillRect(rgba, w, h, 0, Math.floor(h * 0.64), w, h, FLOOR);
  const wx = Math.floor(w * 0.08);
  const wy = Math.floor(h * 0.1);
  const ww = Math.floor(w * 0.16);
  const wh = Math.floor(h * 0.22);
  fillRect(rgba, w, h, wx, wy, ww, wh, GLASS);
  fillRect(rgba, w, h, wx + Math.floor(ww / 2) - 1, wy, 2, wh, MULLION);
  fillRect(rgba, w, h, wx, wy + Math.floor(wh / 2) - 1, ww, 2, MULLION);
  fillRect(rgba, w, h, Math.floor(w * 0.08), Math.floor(h * 0.58), Math.floor(w * 0.14), Math.floor(h * 0.1), CHAIR);

  const { primary, extra } = demoFigures(w, h, t);
  const raw = new Uint8Array(w * h);
  paintFig(rgba, raw, w, h, extra, false);
  paintFig(rgba, raw, w, h, primary, true);
  return { raw, rgba };
}

function paintFig(rgba: Uint8ClampedArray, raw: Uint8Array, w: number, h: number, f: Fig, primary: boolean) {
  const shirt = primary ? SHIRT : SHIRT_B;
  const pants = primary ? PANTS : PANTS_B;
  for (const leg of f.legs) capsule(rgba, raw, w, h, leg, pants);
  for (const arm of f.arms) capsule(rgba, raw, w, h, arm, shirt);
  const t = f.torso;
  block(rgba, raw, w, h, t.x, t.y, t.w, t.h, shirt);
  block(rgba, raw, w, h, f.hx - f.hr * 0.42, f.hy + f.hr * 0.35, f.hr * 0.84, f.hr * 0.85, SKIN);
  for (const hand of f.hands) disk(rgba, raw, w, h, hand.x, hand.y, hand.r, SKIN);
  for (const finger of f.fingers) capsule(rgba, raw, w, h, finger, SKIN);
  disk(rgba, raw, w, h, f.hx, f.hy, f.hr, SKIN);
  diskAbove(rgba, raw, w, h, f.hx, f.hy, f.hr, f.hy - f.hr * 0.12, HAIR);
  const eyeR = Math.max(1.2, f.hr * 0.11);
  disk(rgba, raw, w, h, f.hx - f.hr * 0.36, f.hy - f.hr * 0.02, eyeR, EYE);
  disk(rgba, raw, w, h, f.hx + f.hr * 0.36, f.hy - f.hr * 0.02, eyeR, EYE);
}

function blit(
  rgba: Uint8ClampedArray,
  raw: Uint8Array,
  w: number,
  y: number,
  x0: number,
  x1: number,
  rgb: number[],
) {
  const h = rgba.length / (w * 4);
  if (y < 0 || y >= h || x1 < x0) return;
  const a = Math.max(0, x0);
  const b = Math.min(w - 1, x1);
  const row = y * w;
  for (let x = a; x <= b; x++) {
    raw[row + x] = 1;
    const o = (row + x) * 4;
    rgba[o] = rgb[0];
    rgba[o + 1] = rgb[1];
    rgba[o + 2] = rgb[2];
    rgba[o + 3] = 255;
  }
}

function disk(
  rgba: Uint8ClampedArray,
  raw: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  rgb: number[],
  yMax = Infinity,
) {
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.floor(cy + r), Math.floor(yMax));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const rest = r2 - dy * dy;
    if (rest < 0) continue;
    const dx = Math.sqrt(rest);
    blit(rgba, raw, w, y, Math.ceil(cx - dx - 0.5), Math.floor(cx + dx - 0.5), rgb);
  }
}

function diskAbove(
  rgba: Uint8ClampedArray,
  raw: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  yCut: number,
  rgb: number[],
) {
  disk(rgba, raw, w, h, cx, cy, r, rgb, yCut);
}

function capsule(rgba: Uint8ClampedArray, raw: Uint8Array, w: number, h: number, s: Seg, rgb: number[]) {
  const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.75, s.r * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    disk(rgba, raw, w, h, s.x0 + (s.x1 - s.x0) * u, s.y0 + (s.y1 - s.y0) * u, s.r, rgb);
  }
}

function block(
  rgba: Uint8ClampedArray,
  raw: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  rgb: number[],
) {
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(h - 1, Math.ceil(y + rh) - 1);
  const x0 = Math.ceil(x);
  const x1 = Math.floor(x + rw) - 1;
  for (let yy = y0; yy <= y1; yy++) blit(rgba, raw, w, yy, x0, x1, rgb);
}

function fillRect(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  rgb: number[],
) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(w, x + rw);
  const y1 = Math.min(h, y + rh);
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx < x1; xx++) {
      const o = (row + xx) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
  }
}

/** Crown stays above the top edge; face and chest sit inside. Second person can still stand in the frame. */
export function defaultFrame(w: number, h: number): Pt[] {
  return [
    { x: w * 0.14, y: h * 0.1 },
    { x: w * 0.84, y: h * 0.08 },
    { x: w * 0.86, y: h * 0.72 },
    { x: w * 0.12, y: h * 0.76 },
  ];
}

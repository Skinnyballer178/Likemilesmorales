import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScene, defaultFrame } from "./demo-body.ts";
import { paintOutfit } from "./paint.ts";
import {
  boundsOf,
  clothMask,
  headEllipse,
  inEllipse,
  pointInPoly,
  selectPrimary,
  traceWall,
  wallLength,
  type Pt,
} from "./shell.ts";

describe("cell wall", () => {
  it("sits on the exact outer edge of a solid body", () => {
    const w = 40;
    const h = 30;
    const bin = rect(w, h, 8, 6, 28, 22);
    const loops = traceWall(bin, w, h);
    assert.ok(loops.length >= 1);
    const box = boundsOf(bin, w, h)!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const loop of loops) {
      for (const p of loop) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    assert.equal(minX, box.x0);
    assert.equal(minY, box.y0);
    assert.equal(maxX, box.x1 + 1);
    assert.equal(maxY, box.y1 + 1);
  });

  it("keeps only the body that fills the most of the screen", () => {
    const w = 80;
    const h = 60;
    const bin = new Uint8Array(w * h);
    for (let y = 5; y < 50; y++) for (let x = 10; x < 40; x++) bin[y * w + x] = 1;
    for (let y = 20; y < 35; y++) for (let x = 55; x < 70; x++) bin[y * w + x] = 1;
    const picked = selectPrimary(bin, w, h);
    assert.equal(picked.mask[10 * w + 20], 1);
    assert.equal(picked.mask[25 * w + 60], 0);
    assert.equal(picked.ignored, 1);
  });

  it("joins a cracked hand and ignores a nearby person", () => {
    const w = 100;
    const h = 80;
    const bin = rect(w, h, 20, 10, 50, 60);
    for (let y = 25; y <= 35; y++) for (let x = 52; x <= 58; x++) bin[y * w + x] = 1;
    for (let y = 12; y <= 40; y++) for (let x = 75; x <= 90; x++) bin[y * w + x] = 1;
    const picked = selectPrimary(bin, w, h);
    assert.equal(picked.mask[30 * w + 55], 1);
    assert.equal(picked.mask[20 * w + 80], 0);
    assert.ok(picked.ignored >= 1);
  });

  it("does not call a raised side hand the face", () => {
    const w = 160;
    const h = 180;
    const bin = new Uint8Array(w * h);
    fillCircle(bin, w, 80, 36, 16);
    for (let y = 50; y <= 62; y++) for (let x = 74; x <= 86; x++) bin[y * w + x] = 1;
    for (let y = 62; y <= 120; y++) for (let x = 58; x <= 102; x++) bin[y * w + x] = 1;
    for (let y = 18; y <= 36; y++) for (let x = 18; x <= 34; x++) bin[y * w + x] = 1;
    const box = boundsOf(bin, w, h);
    assert.ok(box);
    const head = headEllipse(bin, w, box);
    assert.ok(Math.abs(head.cx - 80) < 8, `cx ${head.cx}`);
    assert.ok(head.cy < 52, `cy ${head.cy}`);
    assert.ok(head.cy + head.ry < 70, `bottom ${head.cy + head.ry}`);
    assert.equal(inEllipse(24, 26, head), false);
  });
});

describe("cloth window", () => {
  it("paints the main body only where it sits inside the frame", () => {
    const w = 480;
    const h = 270;
    const scene = buildScene(w, h, 0);
    const picked = selectPrimary(scene.raw, w, h);
    assert.equal(picked.ignored, 1);
    const frame = defaultFrame(w, h);
    const cloth = clothMask(picked.mask, w, h, frame);
    let clothPx = 0;
    let outside = 0;
    let headBare = 0;
    const box = boundsOf(picked.mask, w, h);
    assert.ok(box);
    const head = headEllipse(picked.mask, w, box);
    for (let i = 0; i < picked.mask.length; i++) {
      if (cloth[i] && !picked.mask[i]) assert.fail("cloth left the body");
      if (cloth[i]) clothPx++;
      if (picked.mask[i] && !cloth[i]) outside++;
      const x = i % w;
      const y = (i - x) / w;
      if (picked.mask[i] && inEllipse(x + 0.5, y + 0.5, head) && y < frame[0].y) headBare++;
    }
    assert.ok(clothPx > 200, `cloth ${clothPx}`);
    assert.ok(outside > 200, `outside ${outside}`);
    assert.ok(headBare > 20, `bare head ${headBare}`);

    let extraInside = 0;
    const rawOnly = scene.raw;
    for (let i = 0; i < rawOnly.length; i++) {
      if (rawOnly[i] && !picked.mask[i]) {
        const x = i % w;
        const y = (i - x) / w;
        if (pointInPoly(x + 0.5, y + 0.5, frame)) extraInside++;
        assert.equal(cloth[i], 0);
      }
    }
    assert.ok(extraInside > 30, `second person inside frame ${extraInside}`);

    const loops = traceWall(picked.mask, w, h);
    const extremes = boundsOf(picked.mask, w, h)!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const loop of loops) {
      for (const p of loop) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    assert.equal(minX, extremes.x0);
    assert.equal(minY, extremes.y0);
    assert.equal(maxX, extremes.x1 + 1);
    assert.equal(maxY, extremes.y1 + 1);
    assert.ok(wallLength(loops) > (extremes.x1 - extremes.x0) * 2);

    const suit = paintOutfit(picked.mask, w, h, frame, "suit", false);
    for (let i = 0; i < cloth.length; i++) {
      if (!cloth[i]) assert.equal(suit[i * 4 + 3], 0);
    }
  });

  it("masks the face only for the suit, and only inside the frame", () => {
    const w = 80;
    const h = 100;
    const bin = new Uint8Array(w * h);
    fillCircle(bin, w, 40, 24, 12);
    for (let y = 34; y <= 44; y++) for (let x = 35; x <= 45; x++) bin[y * w + x] = 1;
    for (let y = 44; y <= 80; y++) for (let x = 24; x <= 56; x++) bin[y * w + x] = 1;
    const box = boundsOf(bin, w, h);
    assert.ok(box);
    const head = headEllipse(bin, w, box);
    const frame: Pt[] = [
      { x: 10, y: 8 },
      { x: 70, y: 8 },
      { x: 70, y: 90 },
      { x: 10, y: 90 },
    ];
    const open = paintOutfit(bin, w, h, frame, "suit", false);
    const covered = paintOutfit(bin, w, h, frame, "suit", true);
    const jacket = paintOutfit(bin, w, h, frame, "jacket", true);
    let openFace = 0;
    let maskFace = 0;
    let jacketFace = 0;
    let jacketBody = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!bin[i]) {
          assert.equal(covered[i * 4 + 3], 0);
          continue;
        }
        const face = inEllipse(x + 0.5, y + 0.5, head);
        if (face) {
          if (open[i * 4 + 3]) openFace++;
          if (covered[i * 4 + 3]) maskFace++;
          if (jacket[i * 4 + 3]) jacketFace++;
        } else if (jacket[i * 4 + 3]) jacketBody++;
      }
    }
    assert.equal(openFace, 0);
    assert.equal(jacketFace, 0);
    assert.ok(maskFace > 20, `mask ${maskFace}`);
    assert.ok(jacketBody > 40, `jacket ${jacketBody}`);
  });
});

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const bin = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bin[y * w + x] = 1;
  return bin;
}

function fillCircle(bin: Uint8Array, w: number, cx: number, cy: number, r: number) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) bin[y * w + x] = 1;
    }
  }
}

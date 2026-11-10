import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScene, defaultFrame } from "./demo-body.ts";
import { dressedFlags, edgeDistance } from "./fit.ts";
import { paintOutfit } from "./paint.ts";
import { boundsOf, sampleWall, selectPrimary, traceWall } from "./shell.ts";

describe("edge distance", () => {
  it("is half a pixel on the wall and grows exactly inward", () => {
    const w = 40;
    const h = 30;
    const bin = new Uint8Array(w * h);
    for (let y = 6; y <= 22; y++) for (let x = 8; x <= 28; x++) bin[y * w + x] = 1;
    const box = boundsOf(bin, w, h)!;
    const dist = edgeDistance(bin, w, h, box);
    assert.equal(dist[6 * w + 8], 0.5);
    assert.equal(dist[6 * w + 18], 0.5);
    assert.equal(dist[7 * w + 18], 1.5);
    assert.equal(dist[14 * w + 18], 8.5);
  });

  it("treats the image border as outside, like the wall does", () => {
    const w = 20;
    const h = 20;
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 10; x++) bin[y * w + x] = 1;
    const box = boundsOf(bin, w, h)!;
    const dist = edgeDistance(bin, w, h, box);
    assert.equal(dist[10 * w + 0], 0.5);
    assert.equal(dist[0 * w + 5], 0.5);
    assert.equal(dist[10 * w + 9], 0.5);
  });

  it("measures diagonal distance exactly, not in city blocks", () => {
    const w = 30;
    const h = 30;
    const bin = new Uint8Array(w * h);
    for (let y = 5; y <= 24; y++) for (let x = 5; x <= 24; x++) bin[y * w + x] = 1;
    bin[5 * w + 5] = 0;
    const box = boundsOf(bin, w, h)!;
    const dist = edgeDistance(bin, w, h, box);
    assert.ok(Math.abs(dist[6 * w + 6] - (Math.SQRT2 - 0.5)) < 1e-4, `${dist[6 * w + 6]}`);
  });
});

describe("suit on the wall", () => {
  const w = 480;
  const h = 270;
  const scene = buildScene(w, h, 0);
  const picked = selectPrimary(scene.raw, w, h);
  const frame = defaultFrame(w, h);
  const loops = traceWall(picked.mask, w, h);
  const dots = sampleWall(loops, 3);

  it("sews trim piping on every dressed pixel that touches the wall", () => {
    const suit = paintOutfit(picked.mask, w, h, frame, "suit", false);
    const box = boundsOf(picked.mask, w, h)!;
    const dist = edgeDistance(picked.mask, w, h, box);
    let piped = 0;
    let inner = 0;
    for (let i = 0; i < suit.length / 4; i++) {
      if (!suit[i * 4 + 3]) continue;
      const o = i * 4;
      const reddish = suit[o] > 150 && suit[o + 1] < 90;
      if (dist[i] < 0.6 && reddish) piped++;
      if (dist[i] > 30 && suit[o] > 150 && suit[o + 1] > 150) inner++;
    }
    assert.ok(piped > 100, `piped ${piped}`);
    assert.equal(inner, 0);
  });

  it("dresses dots only where cloth is painted", () => {
    const suit = paintOutfit(picked.mask, w, h, frame, "suit", false);
    const flags = dressedFlags(dots, suit, w, h);
    let dressed = 0;
    let plain = 0;
    dots.forEach((p, n) => {
      if (flags[n]) {
        dressed++;
        const near = [-1, 0].some((dy) =>
          [-1, 0].some((dx) => suit[(Math.floor(p.y + dy) * w + Math.floor(p.x + dx)) * 4 + 3] > 0),
        );
        assert.ok(near, "dressed dot with no cloth next to it");
      } else plain++;
    });
    assert.ok(dressed > 30, `dressed ${dressed}`);
    assert.ok(plain > 30, `plain ${plain}`);
  });

  it("leaves every dot plain when there is no suit", () => {
    const empty = new Uint8ClampedArray(w * h * 4);
    const flags = dressedFlags(dots, empty, w, h);
    assert.equal(flags.reduce((a, b) => a + b, 0), 0);
  });

  it("keeps a bare face and its dots plain; the mask dresses them", () => {
    const open = paintOutfit(picked.mask, w, h, frame, "suit", false);
    const masked = paintOutfit(picked.mask, w, h, frame, "suit", true);
    const a = dressedFlags(dots, open, w, h).reduce((x, y) => x + y, 0);
    const b = dressedFlags(dots, masked, w, h).reduce((x, y) => x + y, 0);
    assert.ok(b >= a, `masked ${b} open ${a}`);
  });
});

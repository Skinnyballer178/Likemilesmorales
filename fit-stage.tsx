import { useEffect, useRef, useState } from "react";
import { buildScene, defaultFrame } from "@/lib/demo-body";
import { dressedFlags } from "@/lib/fit";
import { paintOutfit, TRIM_HEX, type Look } from "@/lib/paint";
import {
  measure,
  sampleWall,
  selectPrimary,
  traceWall,
  type Pt,
} from "@/lib/shell";

type Status = {
  mode: string;
  height: number;
  chest: number;
  shell: number;
  others: number;
  note: string;
};

const EMPTY: Status = {
  mode: "Sample",
  height: 0,
  chest: 0,
  shell: 0,
  others: 0,
  note: "Locking the wall to the largest body.",
};

export function FitStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lookRef = useRef<Look>("suit");
  const maskRef = useRef(false);
  const liveRef = useRef(false);
  const [look, setLook] = useState<Look>("suit");
  const [maskOn, setMaskOn] = useState(false);
  const [live, setLive] = useState(false);
  const [camError, setCamError] = useState("");
  const [status, setStatus] = useState<Status>(EMPTY);

  useEffect(() => {
    lookRef.current = look;
  }, [look]);
  useEffect(() => {
    maskRef.current = maskOn;
  }, [maskOn]);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const stage: HTMLCanvasElement = canvas;
    const g: CanvasRenderingContext2D = ctx;

    let raf = 0;
    let stopped = false;
    const view = { w: 960, h: 540 };
    let frame = defaultFrame(view.w, view.h);
    let drag = -1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let video: HTMLVideoElement | null = null;
    let stream: MediaStream | null = null;
    let plate: HTMLCanvasElement | null = null;
    let segmenter: Segmenter | null = null;
    let hands: Hands | null = null;
    let segTimer: ReturnType<typeof setTimeout> | null = null;
    let suitCanvas: HTMLCanvasElement | null = null;
    let suitPx: Uint8ClampedArray | null = null;
    let plateCanvas: HTMLCanvasElement | null = null;
    let lastKey = "";
    let hudAt = 0;
    let builtAt = 0;
    let booting = false;
    let camOn = false;
    let camBin: Uint8Array | null = null;
    let camLoops: Pt[][] = [];
    let camIgnored = 0;
    let segAt = 0;

    function resize() {
      const parent = stage.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const fit = Math.min(1, 960 / Math.max(320, rect.width));
      const w = Math.max(320, Math.round(rect.width * fit));
      const h = Math.max(240, Math.round(rect.height * fit));
      if (Math.abs(stage.width - w) < 3 && Math.abs(stage.height - h) < 3) return;
      const sx = w / view.w;
      const sy = h / view.h;
      frame = frame.map((p) => ({ x: p.x * sx, y: p.y * sy }));
      stage.width = w;
      stage.height = h;
      view.w = w;
      view.h = h;
      builtAt = 0;
      lastKey = "";
      plateCanvas = null;
      camBin = null;
    }

    function hitHandle(x: number, y: number) {
      const r = Math.max(18, view.w * 0.03);
      for (let i = 0; i < frame.length; i++) {
        const p = frame[i];
        if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) return i;
      }
      return -1;
    }

    function localPoint(ev: PointerEvent): Pt {
      const rect = stage.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / rect.width) * view.w,
        y: ((ev.clientY - rect.top) / rect.height) * view.h,
      };
    }

    function onDown(ev: PointerEvent) {
      const p = localPoint(ev);
      drag = hitHandle(p.x, p.y);
      if (drag >= 0) stage.setPointerCapture(ev.pointerId);
    }
    function onMove(ev: PointerEvent) {
      if (drag < 0) return;
      const p = localPoint(ev);
      frame[drag] = {
        x: Math.max(0, Math.min(view.w, p.x)),
        y: Math.max(0, Math.min(view.h, p.y)),
      };
    }
    function onUp() {
      drag = -1;
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", resize);
    resize();

    function publish(bin: Uint8Array, loops: Pt[][], others: number, mode: string) {
      const now = performance.now();
      if (now - hudAt < 180) return;
      hudAt = now;
      const m = measure(bin, view.w, view.h, loops, others);
      const maskNote =
        lookRef.current === "jacket"
          ? "Jacket keeps the face clear. No mask."
          : maskRef.current
            ? "Suit with the mask, only inside the frame."
            : "Suit with the face clear, only inside the frame.";
      const crowd = others
        ? ` ${others} other ${others === 1 ? "person" : "people"} ignored.`
        : "";
      setStatus({
        mode,
        height: m.height,
        chest: m.chest,
        shell: m.shell,
        others,
        note: `${maskNote}${crowd}`,
      });
    }

    function ensureSuit(bin: Uint8Array) {
      const key = `${lookRef.current}:${maskRef.current ? 1 : 0}:${frame.map((p) => `${p.x | 0},${p.y | 0}`).join(";")}:${checksum(bin)}:${view.w}x${view.h}`;
      if (key === lastKey && suitCanvas) return;
      lastKey = key;
      const px = paintOutfit(bin, view.w, view.h, frame, lookRef.current, maskRef.current);
      suitPx = px;
      if (!suitCanvas) suitCanvas = document.createElement("canvas");
      putPixels(suitCanvas, px, view.w, view.h);
    }

    function renderDemo(now: number) {
      if (now - builtAt > 90 || !plateCanvas) {
        builtAt = now;
        const scene = buildScene(view.w, view.h, reduce ? 0 : now);
        const picked = selectPrimary(scene.raw, view.w, view.h);
        const loops = traceWall(picked.mask, view.w, view.h);
        if (!plateCanvas) plateCanvas = document.createElement("canvas");
        putPixels(plateCanvas, scene.rgba, view.w, view.h);
        const held = plateCanvas as Held;
        held.bin = picked.mask;
        held.loops = loops;
        held.ignored = picked.ignored;
        publish(picked.mask, loops, picked.ignored, "Sample");
      }
      const held = plateCanvas as Held | null;
      if (!held?.bin || !held.loops) return;
      g.drawImage(plateCanvas as HTMLCanvasElement, 0, 0);
      ensureSuit(held.bin);
      if (suitCanvas) g.drawImage(suitCanvas, 0, 0);
      drawWall(g, held.loops, view.w, view.h, suitPx);
      drawFrame(g, frame, view.w);
    }

    function loop(now: number) {
      if (stopped) return;
      resize();
      if (liveRef.current && !camOn && !booting) {
        booting = true;
        startCamera()
          .catch(() => undefined)
          .finally(() => {
            booting = false;
          });
      }
      if (!liveRef.current && camOn) {
        stopCamera();
      }
      if (liveRef.current && video && video.readyState >= 2 && plate) {
        if (plate.width !== view.w || plate.height !== view.h) {
          plate.width = view.w;
          plate.height = view.h;
        }
        const pctx = plate.getContext("2d");
        if (pctx) {
          pctx.save();
          pctx.translate(view.w, 0);
          pctx.scale(-1, 1);
          coverDraw(pctx, video, view.w, view.h);
          pctx.restore();
          g.drawImage(plate, 0, 0);
          if (segmenter && now - segAt > 90) {
            segAt = now;
            try {
              const result = segmenter.segmentForVideo(plate, now);
              const src = maskToPerson(result.categoryMask, view.w, view.h);
              const picked = selectPrimary(src, view.w, view.h);
              camBin = picked.mask;
              camIgnored = picked.ignored;
              camLoops = traceWall(camBin, view.w, view.h);
              result.close?.();
            } catch {
              /* keep the last wall */
            }
          }
          if (camBin) {
            ensureSuit(camBin);
            if (suitCanvas) g.drawImage(suitCanvas, 0, 0);
            drawWall(g, camLoops, view.w, view.h, suitPx);
            publish(camBin, camLoops, camIgnored, "Camera");
          }
          if (hands && drag < 0) {
            try {
              const hr = hands.detectForVideo(plate, now);
              const quad = quadsFromHands(hr, view.w, view.h);
              if (quad) frame = quad;
            } catch {
              /* gesture is optional */
            }
          }
          drawFrame(g, frame, view.w);
        }
      } else {
        renderDemo(now);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    async function startCamera() {
      try {
        if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
          throw new Error("Camera needs HTTPS or localhost. Open via http://127.0.0.1:5173 after npm run dev.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped || !liveRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }
        video = document.createElement("video");
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
        plate = document.createElement("canvas");
        plate.width = view.w;
        plate.height = view.h;
        camOn = true;
        setCamError("");
        if (!segmenter) {
          segTimer = setTimeout(() => {
            loadVision().catch((err: unknown) => {
              setCamError(
                err instanceof Error
                  ? err.message
                  : "Vision model failed. The sample body is still here.",
              );
            });
          }, 30);
        }
      } catch (err) {
        setCamError(err instanceof Error ? err.message : "Camera blocked.");
        setLive(false);
      }
    }

    function stopCamera() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video = null;
      camOn = false;
      camBin = null;
      camLoops = [];
    }

    async function loadVision() {
      const spec = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";
      const vision = (await import(/* @vite-ignore */ spec)) as {
        FilesetResolver: { forVisionTasks: (p: string) => Promise<unknown> };
        ImageSegmenter: { createFromOptions: (v: unknown, o: unknown) => Promise<Segmenter> };
        HandLandmarker: { createFromOptions: (v: unknown, o: unknown) => Promise<Hands> };
      };
      const wasm = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm",
      );
      const segModel =
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
      const handModel =
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
      segmenter = await createModel(vision.ImageSegmenter, wasm, segModel, { outputCategoryMask: true });
      hands = await createModel(vision.HandLandmarker, wasm, handModel, { numHands: 2 });
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (segTimer) clearTimeout(segTimer);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", resize);
      stream?.getTracks().forEach((track) => track.stop());
      segmenter?.close?.();
      hands?.close?.();
    };
  }, []);

  function pickLook(next: Look) {
    setLook(next);
    if (next === "jacket") setMaskOn(false);
  }

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">Cell wall · Session 9</p>
        <h1>The suit, sewn onto the dotted line</h1>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} aria-label="Body wall preview" />
      </div>

      <section className="panel">
        <div className="controls">
          <div className="chips">
            <button type="button" className={chip(look === "suit")} onClick={() => pickLook("suit")}>
              Suit
            </button>
            <button type="button" className={chip(look === "jacket")} onClick={() => pickLook("jacket")}>
              Jacket
            </button>
            {look === "suit" ? (
              <button
                type="button"
                className={chip(maskOn)}
                onClick={() => setMaskOn((v) => !v)}
                aria-pressed={maskOn}
              >
                {maskOn ? "Mask on" : "Mask off"}
              </button>
            ) : null}
            <button
              type="button"
              className={chip(live)}
              onClick={() => {
                setCamError("");
                setLive((v) => !v);
              }}
            >
              {live ? "Back to sample" : "Use camera"}
            </button>
          </div>
          <ul className="legend">
            <li>
              <span className="dot" /> Dots on the skin
            </li>
            <li>
              <span className="dot trim" /> Dots turn red where the suit covers them
            </li>
            <li>
              <span className="line" /> Frame
            </li>
            <li>Cloth only where that body is inside the frame</li>
          </ul>
          <p className="note">
            {camError ? camError : status.note} Drag a corner. Two C-hands move the frame on camera.
          </p>
        </div>
        <dl
          className="stats"
          data-others={status.others}
          data-shell={status.shell}
          data-look={look}
          data-mask={look === "suit" && maskOn ? "on" : "off"}
        >
          <dt>Source</dt>
          <dd>{status.mode}</dd>
          <dt>Height</dt>
          <dd>{status.height}px</dd>
          <dt>Chest</dt>
          <dd>{status.chest}px</dd>
          <dt>Wall</dt>
          <dd>{status.shell}px</dd>
          <dt>Others ignored</dt>
          <dd>{status.others}</dd>
        </dl>
      </section>
    </div>
  );
}

type Held = HTMLCanvasElement & { bin?: Uint8Array; loops?: Pt[][]; ignored?: number };

function putPixels(target: HTMLCanvasElement, px: Uint8ClampedArray, w: number, h: number) {
  target.width = w;
  target.height = h;
  const dest = target.getContext("2d");
  if (!dest) return;
  const img = dest.createImageData(w, h);
  img.data.set(px);
  dest.putImageData(img, 0, 0);
}

function chip(on: boolean) {
  return on ? "chip on" : "chip";
}

function checksum(bin: Uint8Array) {
  let s = 0;
  const step = Math.max(1, (bin.length / 500) | 0);
  for (let i = 0; i < bin.length; i += step) s = (s + bin[i] * (i + 1)) % 1000003;
  return s;
}

/**
 * Dots sit on the exact skin edge. Where suit cloth touches a dot, the dot wears the
 * suit trim (red); dots outside the cloth window or on a bare face stay teal.
 */
function drawWall(
  ctx: CanvasRenderingContext2D,
  loops: Pt[][],
  w: number,
  h: number,
  suit: Uint8ClampedArray | null,
) {
  const dots = sampleWall(loops, Math.max(4, w / 180));
  if (!dots.length) return;
  const flags = suit && suit.length === w * h * 4 ? dressedFlags(dots, suit, w, h) : null;
  const r = Math.max(1.7, w / 460);
  ctx.save();
  paintDots(ctx, dots, flags, 0, r, "#06241e", "#3ee0c5");
  paintDots(ctx, dots, flags, 1, r, "#2a0710", TRIM_HEX);
  ctx.restore();
}

function paintDots(
  ctx: CanvasRenderingContext2D,
  dots: Pt[],
  flags: Uint8Array | null,
  want: number,
  r: number,
  ring: string,
  core: string,
) {
  const inner = r * 0.62;
  ctx.fillStyle = ring;
  ctx.beginPath();
  for (let n = 0; n < dots.length; n++) {
    if ((flags ? flags[n] : 0) !== want) continue;
    ctx.moveTo(dots[n].x + r, dots[n].y);
    ctx.arc(dots[n].x, dots[n].y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = core;
  ctx.beginPath();
  for (let n = 0; n < dots.length; n++) {
    if ((flags ? flags[n] : 0) !== want) continue;
    ctx.moveTo(dots[n].x + inner, dots[n].y);
    ctx.arc(dots[n].x, dots[n].y, inner, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawFrame(ctx: CanvasRenderingContext2D, frame: Pt[], w: number) {
  ctx.save();
  ctx.strokeStyle = "#e7ebf0";
  ctx.lineWidth = Math.max(1.5, w / 520);
  ctx.beginPath();
  ctx.moveTo(frame[0].x, frame[0].y);
  for (let i = 1; i < frame.length; i++) ctx.lineTo(frame[i].x, frame[i].y);
  ctx.closePath();
  ctx.stroke();
  for (const p of frame) {
    ctx.fillStyle = "#0c0e12";
    ctx.strokeStyle = "#e7ebf0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(7, w / 90), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function coverDraw(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

type SegMask = {
  width: number;
  height: number;
  getAsUint8Array?: () => Uint8Array;
  getAsFloat32Array?: () => Float32Array;
};
type SegResult = { categoryMask: SegMask; close?: () => void };
type HandResult = { landmarks?: { x: number; y: number }[][] };
type Segmenter = { segmentForVideo: (img: CanvasImageSource, t: number) => SegResult; close?: () => void };
type Hands = { detectForVideo: (img: CanvasImageSource, t: number) => HandResult; close?: () => void };

function maskToPerson(mask: SegMask, w: number, h: number) {
  const raw = mask.getAsUint8Array?.() ?? null;
  const floats = raw ? null : (mask.getAsFloat32Array?.() ?? null);
  const mw = mask.width;
  const mh = mask.height;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mh - 1, Math.floor((y / h) * mh));
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mw - 1, Math.floor((x / w) * mw));
      const i = sy * mw + sx;
      const person = raw ? raw[i] === 1 : (floats?.[i] ?? 0) > 0.5;
      if (person) out[row + x] = 1;
    }
  }
  return out;
}

function quadsFromHands(result: HandResult, w: number, h: number): Pt[] | null {
  const found = result.landmarks;
  if (!found || found.length < 2) return null;
  const corners: Pt[] = [];
  for (const lm of found.slice(0, 2)) {
    if (!isC(lm)) return null;
    corners.push({ x: lm[4].x * w, y: lm[4].y * h });
    corners.push({ x: lm[8].x * w, y: lm[8].y * h });
  }
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4;
  return [...corners].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function isC(lm: { x: number; y: number }[]) {
  if (lm.length < 21) return false;
  if (Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) < 0.05) return false;
  for (const tip of [12, 16, 20]) {
    const curled = Math.hypot(lm[tip].x - lm[0].x, lm[tip].y - lm[0].y);
    const open = Math.hypot(lm[8].x - lm[0].x, lm[8].y - lm[0].y);
    if (curled > open * 0.92) return false;
  }
  return true;
}

async function createModel<T>(
  kind: { createFromOptions: (v: unknown, o: unknown) => Promise<T> },
  wasm: unknown,
  modelAssetPath: string,
  extra: Record<string, unknown>,
): Promise<T> {
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: "VIDEO",
    ...extra,
  });
  try {
    return await kind.createFromOptions(wasm, options("GPU"));
  } catch {
    return kind.createFromOptions(wasm, options("CPU"));
  }
}

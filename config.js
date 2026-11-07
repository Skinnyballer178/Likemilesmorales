// Single place for pinned versions and URLs. Never use @latest.
export const TASKS_VISION_VERSION = '0.10.14';
export const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;
export const WASM_BASE = `${CDN}/wasm`;          // WASM from jsDelivr (saves GitHub Pages bandwidth)
export const BUNDLE_URL = `${CDN}/vision_bundle.mjs`;
const GS = 'https://storage.googleapis.com/mediapipe-models'; // models from Google storage
export const MODELS = {
  hand: `${GS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  face: `${GS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  pose: `${GS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  seg:  `${GS}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`,
};
export const CAMERA = { width: 1280, height: 720, fps: 30 };
export const LOOKS = ['suit', 'jacket'];

// ---- Session 2: hands + frame gesture ----
// The frame gesture: both hands held up as "C" shapes (thumb + index of each hand), left hand
// forming the left edge and right hand the right edge. The four fingertips are the frame corners.
export const FRAME_LANDMARKS = [4, 8]; // thumb tip, index tip (MediaPipe hand landmark ids)
export const HAND_OPTIONS = { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
// One Euro filter on landmark x/y (normalized units). Raise minCutoff = steadier but laggier; raise beta = less lag when moving fast.
export const FILTER = { minCutoff: 1.0, beta: 4.0, dCutoff: 1.0 };
export const GESTURE = {
  holdMs: 250,    // frame must stay valid this long before it locks
  armTolMs: 120,  // invalid blips tolerated while arming
  graceMs: 350,   // dropout allowed after locking (corners are held) before the frame ends
  // Hysteresis: strict thresholds to start, looser ones to keep. Area is a fraction of the whole picture.
  enter: { minScore: 0.5, minArea: 0.03, maxArea: 0.85, minSin: 0.35, minEdgeRatio: 0.2, minTipGap: 0.04 },
  exit:  { minScore: 0.3, minArea: 0.015, maxArea: 0.95, minSin: 0.2, minEdgeRatio: 0.1, minTipGap: 0.02 },
};

// ---- Session 3: frame window renderer ----
// The window is drawn by WebGL on its own canvas (#fx) in its own requestAnimationFrame loop. Detection only
// sets a TARGET; the render loop glides toward it every display frame (so motion stays smooth at 60 fps
// even though the camera/detector run at ~30 fps).
export const WINDOW = {
  smoothTimeMs: 45,   // critically damped follow time. Lower = snappier but shows detector steps; higher = laggier
  maxDtMs: 100,       // a long pause (tab switch, slow frame) never makes the window jump
  openMs: 420,        // closed -> fully open (line, then unfold). Reversible mid-way
  closeMs: 260,       // fully open -> closed (collapses to a line, then a dot)
  flashMs: 320,       // bright edge pulse when the window opens (off in reduced-flash mode)
  fxMaxWidth: 960,    // fx canvas width cap in pixels; CSS scales it to match the video canvas
  fillAlpha: 1,       // 1 = placeholder fill fully hides the camera inside the window (S4 replaces the fill with the neon background)
  edge: { core: 0.0035, halo: 0.03 },          // glow widths in picture-height units
  bolts: { amp: 0.02, hz: 12, flipHz: 3 },      // lightning wobble (position) 12 Hz; on/off gating at most 3 Hz (<= 3 flashes per second)
  colors: { edge: [0.10, 0.90, 0.77], bolt: [1.0, 0.22, 0.34] }, // teal neon edge, red lightning (linear 0..1 rgb)
};

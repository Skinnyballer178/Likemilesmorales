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

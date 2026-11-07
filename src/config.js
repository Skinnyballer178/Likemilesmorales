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

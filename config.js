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

// ---- Session 4: person segmentation + neon window background ----
// ImageSegmenter (selfie_multiclass_256x256). Labels: 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others.
// The model is fed a SMALL copy of the already-mirrored display canvas, so its masks come back small (cheap to read
// back) and already in display orientation (mirror toggling needs no extra work anywhere).
export const SEG_LABELS = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'];
export const SEG = {
  inputWidth: 384, inputHeight: 216, // size of the picture given to the model; masks come back this size. Smaller = faster, blockier
  layers: ['person', 'skin', 'clothes'], // channels packed into the mask texture: person (R) = 1 - background; optional hair (G), skin (B), clothes (A). S6 (Suit) uses skin + clothes; S11 may add more
  tauMs: 70,                // temporal smoothing time constant for small changes (edge flicker). Lower = livelier, higher = steadier
  jumpLo: 0.15, jumpHi: 0.6, // |change| per pixel where smoothing is released: below jumpLo full smoothing, above jumpHi it follows instantly (no ghost trails)
  resetGapMs: 1000,         // a gap longer than this between masks restarts the smoother from the new mask
  edge: [0.30, 0.70],       // shader soft threshold on the smoothed person value: below = background, above = person
  staleMs: 1000,            // a mask older than this stops being used (the window then simply covers the picture)
  idleOffMs: 1500,          // segmentation pauses this long after the window has closed
  governor: { budgetMs: 12, maxEvery: 3, minSamples: 8 }, // run the model every Nth camera frame; N rises when inference is slow
  selfTest: {
    flatBgMin: 0.6, flatPersonMax: 0.3, // a flat grey picture must come back as (mostly) background
    handSamples: 40, handAgreeMin: 0.3, handWindow: 90, // live check: the palm of a detected hand must be inside the person mask
    maxErrors: 3,           // consecutive model errors before falling back / giving up
  },
};

// ---- Session 4: neon window background (procedural, in the window shader) ----
// Colours are linear 0..1 rgb. Spider-Verse-style: deep purple sky, magenta/red horizon sun, two skyline layers,
// teal + pink lit windows, halftone dots with print misregistration, diagonal speed streaks, a thin neon rim light on the person.
export const NEON = {
  sky: { top: [0.04, 0.02, 0.16], mid: [0.30, 0.05, 0.50], horizon: [0.95, 0.12, 0.45] },
  sun: { x: 0.68, y: 0.43, r: 0.2, inner: [1.0, 0.35, 0.25], outer: [0.85, 0.08, 0.45] },
  teal: [0.10, 0.90, 0.77], pink: [1.0, 0.25, 0.65], red: [0.95, 0.10, 0.20],
  driftFar: 0.012, driftNear: 0.03,  // skyline drift in picture heights per second (0 in reduced mode)
  windowFlipHz: 1.5,                 // lit-window changes per second (<= 3, off in reduced mode)
  halftoneScale: 34,                 // dots per picture height
  misreg: 0.004,                     // print misregistration offset of the second dot layer
  rim: { strength: 0.9, color: [0.10, 0.90, 0.77], warm: [1.0, 0.25, 0.55] }, // light spill on the person's edge, inside the window only
};

// ---- Session 5: face tracking + hair/neck seam ----
// FaceLandmarker (478 points, 1 face) runs on the camera video (like the hand model); points are turned into DISPLAY
// coordinates (x flipped when mirrored) and smoothed. S8 (mask gesture) and S9 (mask render) read the result.
// The face model costs real time, so it only runs when asked for: ?face=on (S8/S9 will flip FACE.enabled to true). ?face=off always disables.
export const FACE = {
  enabled: false,
  options: { numFaces: 1, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true },
  filter: { minCutoff: 1.5, beta: 12, dCutoff: 1.0 }, // One Euro on every landmark x/y (display units). Raise minCutoff = steadier but laggier
  minHeight: 0.07, maxHeight: 1.6,   // plausible face height (landmark 10 to chin) in picture-height units; outside = ignored as a false detection
  jumpDist: 0.25,                    // the face centre moving farther than this in one detection (picture heights) restarts the smoothing (no smearing)
  holdMs: 250,                       // detection dropout tolerated: last pose is held at full confidence
  fadeMs: 400,                       // after the hold, confidence falls to 0 over this long (the mask fades, it never snaps)
  resetGapMs: 600,                   // a gap longer than this restarts the smoothing from the new detection
  headTopAllow: 0.45,                // head top (hair included) sits this far above landmark 10, as a fraction of the face height (chin to landmark 10)
  noseDepth: 1.1,                    // nose-tip depth in front of the cheek points / half face width (about 1 for real faces: tune from the debug yaw lines). Only used for the landmark yaw estimate: tan(yaw) = offset / noseDepth
  pose: { window: 90, minAngle: 12, agreeMin: 0.6, minSamples: 30, rollTolDeg: 20 }, // cross-check of the transformation matrix against the landmarks
  governor: { budgetMs: 14, maxEvery: 3, minSamples: 8 },   // run the model every Nth camera frame; N rises when inference is slow
  maxErrors: 3,                                              // consecutive model errors before falling back to CPU / giving up
  idleOffMs: 3000,                                           // nobody asked for the face for this long: the detector pauses
};

// Hair/neck seam: the soft edge of the face region (the part the S9 mask covers) where it meets hair, ears and neck.
// All widths are fractions of the face height. `bias` = how much of the fade lies OUTSIDE the face oval (0 = fade fully inside).
export const SEAM = {
  grid: { w: 192, h: 108 },                  // alpha map resolution (picture is stretched over it); cheap to upload as a texture in S9
  feather: [                                  // [t, width, bias]: t = height on the face (0 chin, 1 landmark 10); values are blended smoothly between rows
    [1.00, 0.050, 0.15],                      // hairline: tight, so the mask meets the hair crisply
    [0.55, 0.070, 0.20],                      // temples, ears, cheeks
    [0.15, 0.100, 0.35],                      // jaw line
    [0.00, 0.180, 0.55],                      // chin and neck: long soft fade into the neck / collar
  ],
  hair: { keep: 0.9, from: 0.55, to: 0.85 },  // hair in front of the forehead: removes up to `keep` of the mask between face heights `from`..`to` (0 below `from`)
  person: [0.30, 0.70],                       // the mask never leaves the person silhouette: soft threshold on the person value (same as SEG.edge)
};

// ---- Sessions 6-7: Suit and Jacket looks (body) ----
// A WebGL layer (#suit) between the camera picture and the window layer. It lays the REAL Grok fabric (assets/suit.webp, assets/jacket.webp, made by tools/make_textures.py)
// over the person's clothes and skin below the head, hands included. The face and hair are left alone (the mask is S8/S9). Nothing is drawn by code.
// The textures are front views of a standing figure; each body pixel looks up the texture like this: the shoulder line of the user (measured from the mask) is pinned to the
// figure's shoulder line and the user's chest width to the figure's width (set a bit NARROWER than the figure so the user's outline never runs off the picture's edge); sleeves follow the user's arms (towards the wrist when a hand is raised); the hood is stretched
// from the head. All measurements below are in pixels of the ORIGINAL Grok picture (see crop).
export const SUIT = {
  enabled: true,
  tauMs: 120, resetGapMs: 600,            // smoothing of the measured body numbers (head, chest). Lower = livelier, higher = steadier
  alpha: 0.96, alphaJacket: 0.98,         // fabric opacity on the body (the live camera shading is multiplied in, so the real folds and light still show)
  shadeK: 1.1, grain: 0.035, lumW: 160, lumH: 90, // live-video shading: strength, film grain, size of the small luminance picture the shader reads (about 1/8 of the camera picture)
  personMin: 0.02,                        // a row counts as "person" when this share of its width is person (ignores specks)
  torso: { minRowFrac: 0.4, rows: 3, startFrac: 0.10, fallbackFrac: 0.30 },  // torso top = first run of rows with >= 40% of the widest clothes row, no sooner than 10% down the person
  head: { heightFrac: 0.8, rxScale: 0.7, ryScale: 1.2, maxRxToSpan: 0.48 },  // head ellipse: heightFrac = share of (person top -> torso top) that is head, rxScale = width factor on the median head width; maxRxToSpan caps the half-width so an arm touching the head cannot blow the hood up
  chestDrop: 0.2,                         // chest centre = torso top + this share of the body height below it
  band: { along: 0.45, half: 0.22, across: 0.62 },                           // wrist band point used for arm direction: distance from the wrist, x hand size (wrist to middle knuckle)
  hand: { centre: 1.1, radius: 1.35 },                                       // hand region that is always suited, even above the neck line
  jacket: { bulk: 0.04, shoulderX: 0.42, shoulderDrop: 0.08 },               // jacket: silhouette grows this far past the body (chest-width units); sleeve start of the arm axis
};
export const TEX = {
  suit: { url: 'assets/suit.webp', crop: [170, 70, 270, 600],
    cx: 300.5, shoulderY: 198, cw: 158,                                     // figure centre line, shoulder line, and the width that matches the user's chest width
    armL: { s: [225.5, 212], d: [-0.173, 0.985] }, armR: { s: [375.5, 212], d: [0.166, 0.986] } },   // shoulder point and arm direction in the figure
  jacket: { url: 'assets/jacket.webp', crop: [235, 90, 375, 860],
    cx: 420, shoulderY: 252, cw: 296,
    armL: { s: [284, 278], d: [0.066, 0.998] }, armR: { s: [556, 278], d: [-0.045, 0.999] },
    hood: { c: [420, 195], r: [36, 55] } },                                  // face opening of the hood in the figure: centre and half-size
  glove: [300, 285],                                                         // a patch of plain suit fabric (suit texture, belly) used for the hands in both looks
};

// ---- Outfit reveal (S7 fix): nothing is worn until the hand frame has locked and the window is open; then the outfit glitches in, slice by slice, like the reference video ----
export const OUTFIT = { revealMs: 900, slices: 36, neon: [0.25, 0.9, 1.0] };

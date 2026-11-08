# Plan (S1-S21)
S1 assets+scaffold | S2 hands+gesture | S3 window renderer | S4 segmentation+window background | S5 face |
S6 body (Suit) | S7 Jacket look | S8 Mask: gesture | S9 Mask: render | S10 Glitch: scheduler+frame effects |
S11 Glitch: body effects+safety | S12 Atmosphere (real-background look) | S13 Integration+independence tests |
S14 realism | S15 ending+performance | S16 robustness+accessibility | S17 UI+share | S18 caching+deploy |
S19 live test 1 | S20 live test 2 | S21 polish+launch.
Each session = Task A + Task B + test/debug. Resume with "Start Session N".
(Added after S3: the three independent systems below. S1-S7 are unchanged; old S8-S15 moved to S14-S21.)

Standing rules: pin tasks-vision version (config.js), never @latest; WASM from jsDelivr, models from Google storage;
never display:none on the camera element; segmenter on CPU delegate (iOS) with category self-test;
all processing on device; non-commercial, original art; fan-project notice; never paste GitHub tokens in chat.

## Three independent systems (S8-S13), the most important architectural rule
Looks: "coat" = Jacket look (S7), "no coat" = Suit look (S6); both keep working. The new systems are layered on top, never rewrite them.
Shared INPUTS only (read-only): camera frame, hands, face, segmentation masks, time. Shared OUTPUT only: one compositor with a fixed pass order
(camera > window/background > look (suit/jacket) > mask > glitch post-process). Nothing else is shared.
- A. Mask system (mask.js + maskgl.js): controlled ONLY by the hand gesture. Owns its own state (hidden > revealing > worn), its own gesture recogniser, its own render pass.
- B. Glitch system (glitch.js + glitchgl.js): own seeded random scheduler driven only by time. Needs no user action. Never reads mask state, never writes any state but its own.
  Its pass is a pure function of (frame, time, current glitch event): nothing accumulates, so nothing can be permanently distorted.
- C. Atmosphere system (atmosphere.js + atmospheregl.js): own slow clock for red/purple light, comic colour shifts, halftone, background colour displacement. Independent of A and B.
Rules (enforced by tests from S8 on, `independence.test.mjs`):
1. No system file imports another system's file (static import-graph check). Shared code only in neutral files (config, rng, compositor, homography).
2. Mask state is identical with glitch on/off, any seed, any timing (state-hash replay test). Glitch schedule is identical with the mask on/off/revealing.
3. Each scheduler uses only its own seeded RNG and dt, never wall-clock coupling or another system's output. Seeds are configurable so tests are reproducible.
4. Glitch never starts, stops, resets or edits the mask. It only distorts final pixels for a moment, including the mask's pixels, so the mask shifts with the body and looks natural.
5. Mask only changes on its own gesture. Atmosphere never touches mask or glitch state.
6. Every effect has a hard cap (intensity, duration, share of time) and a reduced-flash mode (<= 3 flashes per second, big-area flicker off). Glitch can be turned off entirely.

## Sessions for the new features
- S8 Mask gesture. A: independent recogniser (mask gesture state machine): ONE closed fist (finger-curl geometry, cross-checked against GestureRecognizer Closed_Fist if needed),
  starts above the top of the head (head top = forehead landmark + hair allowance from S5 face size), then a continuous downward path through the face to the chin, in HEAD-relative coordinates
  (so head position/tilt does not matter). Must be steady, monotonic and long enough: a hand merely passing near the face never counts. Own thresholds in config.js (MASK_GESTURE), hysteresis, timeout, cancel on opening hand.
  Coexists with the two-C window gesture (different hand shape, no shared state). B. mask state machine hidden > revealing(progress 0..1) > worn, "worn" persists after the hand lowers,
  progress follows the fist (reveal front sweeps down the face) then completes with an ease. Tests: synthetic fist/path replays (full pull, half pull, pass-by, swipe up, two hands, fast/slow, jitter).
- S9 Mask render. A: 3D face-mesh pass (FaceLandmarker 478 points + transform matrix): the mask is a textured mesh on the canonical face UVs, so it follows rotation, scale and perspective (no flat sticker).
  Black and red design, original art (see ASSET_SPEC item 10), plus eye lenses. The coat/hood stays visible: the mask is drawn after the look and only covers the face region (mask over face, hood edge over the mask edge).
  B. Lighting from the live video (average colour/brightness around the face, soft normal shading, matte), hand occlusion (hand pixels stay on top), reveal animation clipped along the face's vertical axis.
  Tests: synthetic face replays with yaw/pitch/roll/shift/scale, landmark reprojection error in px, mask stays when the hand lowers, works in Jacket look; Suit look uses its own head (gesture does nothing there).
- S10 Glitch scheduler + frame effects. A: scheduler (own seeded RNG, irregular gaps via a heavy-tailed distribution, e.g. mean 6-14 s, min gap, per-event duration 80-900 ms, intensity classes: faint 60%, medium 30%, strong 10%).
  Configurable GLITCH = { enabled, seed, minGapMs, maxGapMs, durationMs, intensityWeights, maxActiveShare }. B. Full-frame post pass: RGB channel split, horizontal displacement, broken horizontal slices, flicker,
  frame skip (hold the previous frame 1-2 frames only), occasional pixelation. Each effect is a function of (time since event start, event params), so it fades out and leaves nothing behind.
  Tests: scheduler statistics (no regular rhythm, bounded active share), effects return to identity after the event, runs with no hands/no face/no mask.
- S11 Glitch body effects + safety. A: segmentation-based effects (needs S4 masks): brief body-part misalignment (clothes/hair/skin layers shifted a few px against each other) and dimensional fragmentation
  (a few displaced, colour-split tiles of the person). Identity and proportions kept: offset caps in % of body size. B. Safety: reduced-flash mode, global cap on glitch time, "watchable" limit (never above X% of frames),
  panic off switch (key G and URL ?glitch=0), automatic backoff if the frame rate drops. Tests: offsets stay under caps, no accumulation over a long run (10 minutes simulated), reduced-flash flash count.
- S12 Atmosphere. A: slow red/purple lighting ramp (gradual over ~20-30 s, capped so the room stays recognisable), occasional comic colour shifts (palette tint pulses), driven by its own clock.
  B. Halftone dot texture and dimensional colour displacement (channel offsets) applied to the BACKGROUND region only (inverse of the person mask), so the real environment stays recognisable. No generated city or replacement background.
  Tests: strength caps, person pixels untouched, runs without mask or glitch, identical output when mask/glitch states change.
- S13 Integration + independence tests. A: compositor pass order, performance budget per pass (four models + three systems: face and segmenter may run at lower rate), debug panel per system.
  B. Full independence suite (`independence.test.mjs`) with the six mandatory scenarios as automated tests where possible (1 coat + glitches, no mask; 2 coat + mask, no glitch; 3 coat + mask + a glitch;
  4 coat, no gesture, glitches continue; 5 mask tracking under head movement; 6 atmosphere on, mask state unchanged) plus the import-graph check and the state-hash replays. Fix any interaction found.

## Notes and limits (honest)
- Mask quality depends on FaceLandmarker stability and lighting; very fast head turns beyond ~60 deg will drop the mask edge softly (fade out, never snap).
- Fist above the head needs the hand inside the camera frame: the head top may be cropped on close webcams. Fallback: allow the start zone to be the top edge of the picture.
- The original footage ending is preserved: no AI-generated ending, no artificial body movement. Live camera only.
- All art is original and inspired by, not copied from, official art (standing rule). Mask texture is made from the ASSET_SPEC item 10.
- Performance is the main risk (hands + face + pose + segmenter + 3 render passes). S13 and S15 set per-model frame rates and a quality ladder.

## Status
- S1 done. S2 done: HandLandmarker (2 hands) + One Euro smoothing + mirror/handedness (hands.js, filters.js),
  frame-gesture state machine idle > arming > active > lost (gesture.js), debug overlay + recorder (?debug=1, press R).
  Tests: `npm test` (node --test, 12 tests, synthetic landmark replays). Gesture = two "C" hands; the 4 fingertips (thumb 4, index 8 of each hand) are the corners.
- S3 done: window renderer. WebGL1 canvas #fx stacked over #stage, own requestAnimationFrame loop (windowgl.js), decoupled from detection:
  detection only sets a target (fx.setTarget(snap)); windowctl.js glides corners toward it every display frame (critically damped, 45 ms)
  and runs the open/close animation (line -> unfold, 420 ms open / 260 ms close, reversible). homography.js = unit square -> quad maps.
  Placeholder fill = grid + corner markers (TL red, TR green, BR blue, BL yellow) through the inverse homography; neon teal edge + red lightning;
  reduced-flash hook: fx.setReducedFlash(bool) (defaults to OS reduce-motion; ?calm=1 forces it). Debug: ?debug=1 shows window phase/fps/ms; ?fx=mask or ?fx=uv for geometry views.
  Tests: `npm test` (25 tests; 6 GPU tests skip without headless GL), `npm run test:gl` (needs `npm i` + xvfb; 31 tests incl. mask-vs-polygon corner accuracy, uv decode, frame time).
  Files are flat in the repo root (no src/ or tools/ folders).
- S4 done: person segmentation + neon window background.
  segmask.js (pure: layers, temporal smoothing, self-test checks, hand cross-check, cadence governor), segmenter.js (ImageSegmenter glue: CPU on iOS, GPU elsewhere with CPU fallback, self-test),
  neonbg.js (procedural neon city in GLSL), windowgl.js (mask texture, person cut-out, rim light, ?fx=grid / ?fx=circle test modes), main.js (runs only while the window is wanted).
  The model sees a 384x216 copy of the already-mirrored display canvas, so masks are in display orientation (mirror toggle needs nothing). Mask = packed RGBA (R person; G hair, B skin, A clothes when SEG.layers asks for them: S6/S11).
  Self-test: labels (6, label 0 = background) + flat grey picture must be background + live check that detected palms lie inside the person mask. URL flags: ?seg=off, ?segdelegate=cpu|gpu, ?segtest=off, ?fx=grid, ?fx=circle, ?debug=1 (seg line).
  NOT yet verified: the real model (no access to its host from the build sandbox). Thresholds in SEG.selfTest and SEG.edge are first guesses to tune from the S4 live check. Tests: `npm test` (63 tests, 15 GPU ones skip without headless GL), `npm run test:gl`.
- S5 done: face tracking + hair/neck seam. Runs only with `?face=on` (FACE.enabled in config.js is false until S8/S9 consume it; `?face=off` always disables).
  facelm.js (pure): landmark ids + FACE_OVAL, result normalising, HEAD FRAME (origin chin, up = chin -> landmark 10; head coordinates s sideways / t height: 0 chin, 1 landmark 10,
  headTop = 1 + FACE.headTopAllow) with toHead/fromHead (S8 uses this: head-relative fist path), pose (landmark yaw; matrix yaw/pitch/roll with a run-time agreement check:
  ok / flipped (yaw negated) / suspect (matrix ignored) / unknown), createFaceTracker (One Euro on all 478 points, display coordinates, mirror-aware, hold 250 ms then fade 400 ms,
  false-detection and jump rejection). facetracker.js (glue): FaceLandmarker VIDEO mode, GPU -> CPU fallback, iOS = CPU, cadence governor, error handling.
  faceseam.js (pure): buildSeam({ face, mask, aspect, out }) -> 192x108 alpha map = face oval with per-height feather (tight hairline, soft jaw/neck), x hair in front of the forehead
  (needs the S4 hair layer: switched on automatically with ?face=on), x person silhouette (bilinear), x face confidence. S9 uploads it as a texture and multiplies the mask by it.
  faceoverlay.js: debug view (?face=on&debug=1): outline, head axis and head top, pose text, red seam tint. Debug lines: face, face pose, seam, face model.
  Tests: `npm test` (face geometry/tracker, seam, glue with a fake model, overlay), `npm run test:smoke` (main.js end to end with fake DOM, camera and MediaPipe), `npm run preview:s5` (PNG previews).
  NOT yet verified: the real FaceLandmarker (no access to its host from the build sandbox). To check in the S5 live test: matrix check verdict (turn the head > 12 degrees), landmark yaw vs matrix yaw,
  FACE.noseDepth (1.1 is a first guess), hair cut on a real fringe, seam softness at the neck, face ms on your machine.
- S6 done: Suit look (body). suitmodel.js (pure): analyzeBody(mask) measures head ellipse, torso top and chest (centre + width) from the packed mask (person R, clothes A),
  createBodyTracker (exponential smoothing, restart after a gap), wristBands(hands) (band past the wrist, hand region that is always suited). suitgl.js: WebGL1 canvas #suit
  (between the camera picture and the window layer), own rAF loop, paints skin + clothes below the head and the hands with a dark suit at 90% opacity (real folds show through), fine red web (spokes + sagging rings,
  anchored to the chest so it follows the body), ringed geometric spider emblem on the chest, red wrist bands. Face and hair are never painted (S9). Head ellipse is skipped for hands, so a raised hand is suited.
  Jacket look leaves the suit layer off (S7). SEG.layers now = person + skin + clothes. FPS counter top right of the picture (cam = pictures processed/s, screen = page redraws/s; checkbox "Show FPS", ?fps=off).
  URL: ?suit=off disables the suit. Debug (?debug=1) line `suit`. Config: SUIT in config.js (alpha, web, emblemR, band, head, chestDrop).
  Tests: `npm test` (108, GL ones skip), `npm run test:gl` (needs `npm i` + xvfb; suitgl.test.mjs: face/background untouched, emblem red + follows chest, raised hand suited, frame time), `npm run preview:s6` writes preview-s6/suit.png.
  NOT yet verified on the real model: the clothes/skin layers of selfie_multiclass (labels 2,3,4) and the head-ellipse sizes on a real face; check in the S6 live test: shirt coverage, neck line, hands above the head, emblem placement, suit ms.
  (S6 catch-up, done in S7) FPS counter now also shows hands ms, seg ms, worst redraw gap and a freeze count (gaps over 500 ms), for diagnosing the random ~5 s freezes; start-up lag fix = loading screen, all models loaded in order and warmed up BEFORE the camera opens (main.js boot()). The freeze fix itself stays with the performance governor.
- S7 done: Jacket look. Same layer/shader as the suit (suitgl.js, uLook). Blue quilted puffer over clothes + arms (skin below the head), bulk = silhouette grows by SUIT.jacket.bulk, quilting rows across the torso and along each sleeve (armSides() in suitmodel.js points a sleeve at its wrist when a hand is raised), zip, darker bulk rim; red inner hoodie at the neckline with two drawstrings; red hood up (outer ellipse + cowl to the shoulders, face opening cut out, dark lining next to the face); hands (skin inside the tracked hand regions) stay in front as black suit gloves; cuffs replace the red wrist bands; no emblem under the jacket.
  Head measurement is now robust: per-row run nearest the head, tracked hand regions ignored, head half-width capped (SUIT.head.maxRxToSpan). Suit/Jacket selector: radio buttons call suit.setLook(); both looks use the same mask and body layer.
  Tests: 115 (`npm test`), 9 GL tests (`npm run test:gl`: includes jacket colours, hood, face opening, bulk, quilting direction, no suit/jacket mixing, previews in preview-s6/ and preview-s7/).
  Not verified on real video: hood size/placement on a real head, sleeve quilting direction on real arms, bulk amount, jacket colour. Check in the S7 live test.
- S7 fix (after the user's live test: "cartoon", worn before framing): (1) the outfit is NOT worn until the hand frame has locked and the window is open (fx phase 'open'); then it glitches in slice by slice with neon leading edges (OUTFIT in config.js, uReveal); "Take it off" button / Escape / mirror toggle / look change away reset it; segmentation only runs for the outfit once it is worn. (2) Colours and shapes re-sampled from the Grok images: near-black suit with a FINE dim-red web, strong red emblem (ring radius 0.2 chest widths) and wrist bands; jacket = teal-blue puffer with wide baffles, OPEN front (suit + emblem in the middle, red hoodie strips, zip tape), muted red hood. (3) Live-video shading: the shader multiplies in the camera picture's own light/shadow (160x90 luminance + 16x9 local average, uploaded every 2nd camera frame) plus film grain, so real folds/lighting carry over. Removed the wrist-cuff slabs on the jacket sleeves.
  (S7 texture version, supersedes the code-drawn suit/jacket) The shader draws NOTHING by itself any more: it lays the real Grok fabric on the person. assets/suit.webp + assets/jacket.webp are built by tools/make_textures.py from the two Grok front views (crop, cut-out of the grey backdrop, partial removal of baked studio light, 2x upscale, background replaced by smooth fabric colour so edges never show grey/streaks). TEX in config.js holds the crop rectangles and the figure measurements (centre line, shoulder line, matching width, arm axes, hood opening, glove patch), all in original Grok pixels. Lookup per body pixel: the user's shoulder line (from the mask) is pinned to the figure's shoulder line and the user's chest width to the figure's (set a bit narrower than the figure), sleeves follow the user's arm axis (towards the wrist when a hand is raised), the jacket hood is the figure's own hood stretched from its face opening to the user's head with a cowl down to the shoulders, hands = a plain suit-fabric patch. Until both pictures are loaded nothing is drawn (debug shows `fabric loading/ready/failed`).
  Tests: suitgl.test.mjs uses position-map textures (red = texel x, green = texel y) so each test proves WHICH texel a screen pixel shows (shoulder pin, width, sleeves, raised arm, hood, glove, bulk). Visual check: `xvfb-run -a node prev_s7b.mjs` (needs the .rgba dumps of the two webp files in /tmp, see the file header) writes preview-s7b/*.png.
  Still open: the Grok head is only ~55 px wide, so the white-eyed mask must be drawn/vectorised (S8/S9 with the face mesh) - the user's face shows through the hood until then. Anchor/width numbers (TEX.*.shoulderY, cw) are estimates: tune them in the live test.
- S7 fix 2 (live test: "no suit pops up even inside the frame"): ROOT CAUSE = TEX urls pointed at `assets/suit.webp` / `assets/jacket.webp` but the repo is flat (no assets/ folder), so both pictures 404'd, `fabric` stayed `failed` and the shader drew nothing. Now `suit.webp` / `jacket.webp` (config.js TEX, make_textures.py output). Regression test `assets.test.mjs` (files exist next to index.html, size = 2x the crop). NOTE: `suit.png` / `jacket.png` in the repo root are PREVIEW renders (from prev_s7b.mjs), not textures; the app does not use them.
- S8 done: Mask gesture (system A, part 1). `mask.js` (pure, no clock/random): fist detection by finger-curl ratio (tip-to-wrist / knuckle-to-wrist, enter 1.25 all four fingers, keep 1.45 with three; thumb ignored), palm centre tracked in HEAD coordinates (facelm toHead: t 0 chin, 1 forehead, 1.45 head top; s sideways), phases idle > armed (fist rests above the head >= 150 ms) > pulling (fist leaves the zone downward, progress = distance fallen / zone edge to chin, only ever forwards) > completing (ease to 1) > worn; mask state hidden > revealing(progress) > worn.
  Cancels (progress melts back to 0 in 350 ms): fist opened (> 120 ms), hand lost (> 180 ms), two closed fists, face lost (> 300 ms after the tracker's own hold/fade), left the corridor (|s| > 1.0), moved up > 0.2 face heights, too fast (< 220 ms), too slow (> 3.5 s), stalled (1.2 s without 0.03 progress). Cropped head top: the start zone becomes the top strip of the picture. All numbers in MASK_GESTURE (config.js).
  Wiring (main.js): the gesture only watches once the outfit has FINISHED glitching in (reveal done), in BOTH looks (mask state is independent of the look; S9 decides what is drawn in the Suit look). The face model is part of boot (FACE.enabled = true) but only RUNS while the outfit is worn and the mask is not on yet (or ?debug=1 / ?face=on); the hair layer is only read when the seam is shown (debug). Hints: maskidle / maskarmed / maskpull / maskworn. Debug: `mask` line + overlay (start line, corridor, chin line, fist dot, progress bar, reveal front). Reset button / Escape / mirror toggle / camera stop = mask off. NOTHING IS DRAWN FOR THE MASK YET (S9): worn only changes the hint text and the debug line.
  Tests: mask.test.mjs (24: fist geometry, full pull, half pull, pass-by, swipe up, two hands, fast/slow, jitter, head tilt/move/scale, 4:3, cropped head top, face and hand dropouts, enabled=false, determinism), independence.test.mjs (6: import graph, no clock/random, no shared state, state-hash replays with the window gesture and other random consumers running alongside), assets.test.mjs. `npm test`, `npm run test:smoke` (5 variants).
  NOT verified on the real model/camera: finger-curl thresholds on a real fist (check the debug `mask` line), the zone/corridor numbers on a real head, and how it feels at 30 fps. Tune MASK_GESTURE from the S8 live test.
- Next per the saved plan: S6.5 Backgrounds (orange portal for Suit, inverted city + Gwen cutout for Jacket) is STILL NOT DONE; then S9 Mask render.

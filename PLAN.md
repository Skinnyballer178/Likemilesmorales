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
- Next: S4 segmentation + window background (ImageSegmenter masks, neon background inside the window: replaces the placeholder fill via the uv in the shader). Segmentation masks are also reused by S11 (glitch body effects) and S12 (atmosphere).

# Plan (S1-S15)
S1 assets+scaffold | S2 hands+gesture | S3 window renderer | S4 segmentation+background | S5 face |
S6 body (Suit) | S7 Jacket look | S8 realism | S9 ending+performance | S10 robustness+accessibility |
S11 UI+share | S12 caching+deploy | S13 live test 1 | S14 live test 2 | S15 polish+launch.
Each session = Task A + Task B + test/debug. Resume with "Start Session N".

Standing rules: pin tasks-vision version (config.js), never @latest; WASM from jsDelivr, models from Google storage;
never display:none on the camera element; segmenter on CPU delegate (iOS) with category self-test;
all processing on device; non-commercial, original art; fan-project notice; never paste GitHub tokens in chat.

## Status
- S1 done. S2 done: HandLandmarker (2 hands) + One Euro smoothing + mirror/handedness (src/hands.js, src/filters.js),
  frame-gesture state machine idle > arming > active > lost (src/gesture.js), debug overlay + recorder (?debug=1, press R).
  Tests: `npm test` (node --test, 12 tests, synthetic landmark replays). Gesture = two "C" hands; the 4 fingertips (thumb 4, index 8 of each hand) are the corners.
- Next: S3 window renderer (consumes `snap.corners` = TL,TR,BR,BL in normalized display coords, available while state is active/lost).

# Asset spec (S1, Task A)

## Unified design decisions (both Grok images differ, so these are the single source of truth)
- Canonical base = the Suit image: ringed spider emblem, red wrist bands, red boot bands, fine red web lines on black.
- Emblem: ONE emblem, red spider inside a thin red ring, on the chest, in both looks. The Jacket image has no ring, so redraw it with the ring.
- Eyes: ONE shape, the angular white lenses from the Suit image, same size and tilt in both looks.
- Web pattern: ONE fine red web tile, same line weight, in both looks.
- Jacket look = Suit + blue quilted puffer + red hood up + red inner hoodie. The suit under it stays identical.
- Jacket sleeves cover the wrist bands, so the wrist bands only show in Suit.

## Texture checklist (what to send me or regenerate)
All textures are flat and unlit: no baked studio shadows, no highlights. Lighting comes from the live video. Format webp, plain black or transparent background.
1. Mask close-up, front view, straight-on, 1024px+ tall, flat colour (needed: head is only ~55-95px wide in the current images).
2. Mask eyes close-up, both lenses on their own, 512px+.
3. Suit web tile, seamless, 512x512.
4. Emblem alone, ringed spider, transparent background, 512x512.
5. Wrist band and boot band, flat red strips (or I make them from code).
6. Jacket quilting tile, seamless, 512x512, blue, flat.
7. Hood pieces: red hood outside, inside lining, flat, 1024px.
8. Inner red hoodie, flat, 1024px.
9. Neon background plate in Miles colours (red, teal, purple), 1920x1080, can be generated in code if you prefer.
The current images (front + two profiles, no back view) are fine, the camera only sees your front.

## Budget
- Total assets under 3 MB (webp, quality ~80). Mask close-up under 400 KB, tiles under 150 KB each.
- Models load from Google storage and WASM from jsDelivr, so only your assets use GitHub Pages bandwidth.

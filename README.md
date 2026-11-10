# Session 9 — suit on the dotted wall

Unofficial fan project: a tight **cell wall** (teal dots) around the one person who fills the most of the screen, plus a draggable frame where a suit or jacket paints **only** on that body inside the frame.

## What changed in Session 9

The suit is now built **from the dotted wall inward**, so cloth and dots read as one garment:

- **Wall piping** — a thin red trim sewn exactly on the wall (exact distance field, `src/lib/fit.ts`)
- **Web follows the body** — rings are lines of equal distance to the wall, so they bend around every finger, arm and leg; spokes fan out from the chest mark
- **Tight-fit shading** — deepest black at the wall, lifting gently inward, so nothing looks puffy
- **Dots wear the suit** — a dot turns red when suit cloth touches it. Outside the frame, or on a bare face, dots stay teal, so you can see exactly where the suit starts and stops
- **Mask on** — the masked face gets the same trim; **Jacket** gets the shading and trim too
- **Fixes** — `npm test` and `npm run build` both work now (Session 8 imports lacked `.ts`; `tsc` was type-checking test files)

## What Session 8 shipped

- **One person only** — largest body wins; everyone else is ignored
- **Zero-gap wall** — dotted contour sits on the exact skin edge (head, hands, fingers)
- **Frame clip** — suit / jacket only where that body is inside the frame; outside stays normal
- **Suit** — optional mask (white lenses). **Jacket** — no mask option, face always open
- **Sample scene** works offline. **Camera** uses MediaPipe selfie segmenter + hand landmarker from CDN

## Run locally

```bash
npm install
npm run dev
npm test      # 13 tests
```

Open **http://127.0.0.1:5173** (or the URL Vite prints).

### Camera notes

Browsers only allow `getUserMedia` on a **secure context**:

- `http://localhost` / `http://127.0.0.1` ✅
- `https://…` (GitHub Pages, Vercel, etc.) ✅
- plain `http://192.168.…` or a random host ❌

Allow the camera permission when prompted. The first camera run downloads MediaPipe models from Google / jsDelivr (needs network).

## Push to GitHub

```bash
cd session-9-suit-on-the-wall
git init
git add .
git commit -m "Session 9: suit sewn onto the dotted wall"
gh repo create session-9-suit-on-the-wall --public --source=. --push
```

Optional static host:

```bash
npm run build
# deploy the dist/ folder (GitHub Pages, Netlify, Vercel, …)
```

## Controls

| Control | Action |
|--------|--------|
| Suit / Jacket | Outfit type |
| Mask on/off | Suit only |
| Use camera | Live person segmentation |
| Drag frame corners | Change the cloth window |
| Two C-hands (camera) | Move the frame with gestures |

## Layout

```
src/
  components/fit-stage.tsx   # canvas loop, camera, HUD
  lib/shell.ts               # selectPrimary, traceWall, clothMask, headEllipse
  lib/paint.ts               # suit / jacket paint, driven by distance to the wall
  lib/fit.ts                 # edgeDistance (exact), dressedFlags (which dots wear the suit)
  lib/demo-body.ts           # offline sample scene
```

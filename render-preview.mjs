// Dev tool: renders sample frames of the window to PNG with headless WebGL.  xvfb-run -a node render-preview.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import createGL from 'gl';
import { createWindowRenderer } from './windowgl.js';
import { createWindowController } from './windowctl.js';
import { rect } from './synth.mjs';
import { encodePNG, compositeOverCamera } from './png.mjs';

const out = process.argv[2] || 'preview', W = 960, H = 540, A = W / H;
mkdirSync(out, { recursive: true });
const gl = createGL(W, H, { preserveDrawingBuffer: true, premultipliedAlpha: true });
if (!gl) { console.error('No GL context (try xvfb-run -a)'); process.exit(1); }
const r = createWindowRenderer({ gl, width: W, height: H });
const q = rect(0.5, 0.5, 0.32, 0.5, 8, A), quad = [q.tl, q.tr, q.br, q.bl];
const shot = (name, tMs, reduced) => {
  const c = createWindowController(); c.setTarget(quad); let f;
  for (let t = 0; t <= tMs; t += 1000 / 60) f = c.step(t);
  r.draw(f, { aspect: A, timeS: 10 + tMs / 1000, reduced });
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  writeFileSync(`${out}/${name}.png`, encodePNG(W, H, compositeOverCamera(W, H, px)));
};
shot('1-opening-100ms', 100); shot('2-opening-250ms', 250); shot('3-open', 900); shot('4-open-reduced', 900, true);
console.log('wrote', out);

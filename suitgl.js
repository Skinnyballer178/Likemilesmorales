// Suit look renderer (Session 6). WebGL1 on its own canvas (#suit), own requestAnimationFrame loop, same pattern as windowgl.js.
// Inputs (all read-only): the packed person mask (R person, B skin, A clothes), the measured body (suitmodel.js) and the wrist bands.
// Output: premultiplied RGBA, transparent everywhere except the suit on the body. The face/hair are never painted (S9 owns the face).
import { SUIT, SEG } from './config.js';
import { analyzeBody, createBodyTracker, wristBands } from './suitmodel.js';
import { maskFresh } from './segmask.js';

const VS = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uAspect, uMaskOn, uLo, uHi, uAlpha, uAlphaRed;
uniform sampler2D uMask;
uniform vec4 uHead;      // cx, cy, rx, ry   (aspect space)
uniform vec3 uChest;     // x, y, width      (aspect space)
uniform vec4 uBand0, uBand1;   // cx, cy, dirx, diry
uniform vec3 uBandSz0, uBandSz1; // half, across, on
uniform vec3 uHand0, uHand1;     // x, y, radius (0 = off)
uniform vec3 uRed, uBase;
uniform vec4 uWeb;       // spokes, line width, rings, sag
uniform float uEmblem;   // ring radius (chest-width units)

float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
float handMask(vec2 p, vec3 hd){ return hd.z > 0.0 ? 1.0 - smoothstep(hd.z * 0.85, hd.z * 1.1, length(p - hd.xy)) : 0.0; }
float bandMask(vec2 p, vec4 b, vec3 sz){
  if (sz.z < 0.5) return 0.0;
  vec2 d = p - b.xy; float along = dot(d, b.zw), across = dot(d, vec2(-b.w, b.z));
  float e = 1.5 / uRes.y;
  return (1.0 - smoothstep(sz.x - e, sz.x + e, abs(along))) * (1.0 - smoothstep(sz.y - e, sz.y + e, abs(across)));
}

void main(){
  vec2 pn = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = vec2(pn.x * uAspect, pn.y);
  vec4 m = texture2D(uMask, pn);
  float person = smoothstep(uLo, uHi, m.r) * uMaskOn;
  float cover = clamp(m.b + m.a, 0.0, 1.0) * person;                       // skin or clothes; hair is never covered
  float head = 1.0 - smoothstep(0.85, 1.1, length((p - uHead.xy) / uHead.zw));
  float hand = max(handMask(p, uHand0), handMask(p, uHand1));
  float a = cover * (1.0 - head * (1.0 - hand));
  if (a <= 0.003) { gl_FragColor = vec4(0.0); return; }

  // web: spokes + sagging rings around the chest, in chest-width units
  vec2 q = (p - uChest.xy) / uChest.z; float r = length(q), ang = atan(q.y, q.x);
  float pxq = 1.5 / uRes.y / uChest.z;
  float u = ang * uWeb.x / 6.2831853, fu = fract(u);
  float sp = min(fu, 1.0 - fu) * 6.2831853 / uWeb.x * r;                       // arc distance to the nearest spoke
  float t = abs(fu - 0.5) * 2.0;                                              // 1 on a spoke, 0 half way between two spokes
  float r2 = r * (1.0 + uWeb.w * (1.0 - t));                                  // rings sag between the spokes
  float v = log(r2 * 5.0 + 1.0) * uWeb.z, fv = fract(v);
  float rg = min(fv, 1.0 - fv) * (r2 * 5.0 + 1.0) / (5.0 * uWeb.z);
  float lw = uWeb.y;
  float web = max(1.0 - smoothstep(lw, lw + pxq, sp), 1.0 - smoothstep(lw * 0.8, lw * 0.8 + pxq, rg)) * smoothstep(0.03, 0.09, r);

  // emblem: ring + simple geometric spider (original, drawn from ellipses and segments)
  float ER = uEmblem;
  float ring = 1.0 - smoothstep(0.011, 0.011 + pxq, abs(r - ER));
  vec2 s = vec2(abs(q.x), q.y);
  float body = max(1.0 - smoothstep(1.0, 1.0 + pxq / 0.03, length(vec2(q.x / 0.032, (q.y - 0.03) / 0.045))), 1.0 - smoothstep(1.0, 1.0 + pxq / 0.02, length(vec2(q.x / 0.02, (q.y + 0.03) / 0.02))));
  float lg = 1e3;
  lg = min(lg, min(segD(s, vec2(0.012, -0.03), vec2(0.06, -0.075)), segD(s, vec2(0.06, -0.075), vec2(0.1, -0.06))));
  lg = min(lg, min(segD(s, vec2(0.015, -0.01), vec2(0.07, -0.035)), segD(s, vec2(0.07, -0.035), vec2(0.108, -0.01))));
  lg = min(lg, min(segD(s, vec2(0.015, 0.02), vec2(0.07, 0.03)), segD(s, vec2(0.07, 0.03), vec2(0.1, 0.06))));
  lg = min(lg, min(segD(s, vec2(0.012, 0.045), vec2(0.055, 0.08)), segD(s, vec2(0.055, 0.08), vec2(0.075, 0.115))));
  float legs = 1.0 - smoothstep(0.006, 0.006 + pxq, lg);
  float emb = max(ring, max(body, legs));
  web *= smoothstep(ER, ER + 0.03, r);                                         // keep the emblem clear of web lines

  float band = max(bandMask(p, uBand0, uBandSz0), bandMask(p, uBand1, uBandSz1));
  float red = clamp(max(max(web * 0.85, emb), band), 0.0, 1.0);
  vec3 col = mix(uBase, uRed, red);
  float al = a * mix(uAlpha, uAlphaRed, red);
  gl_FragColor = vec4(col * al, al);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Suit shader compile failed: ' + gl.getShaderInfoLog(s));
  return s;
}

// Pass { canvas } in the browser, or { gl, width, height } (tests).
export function createSuitRenderer({ canvas, gl: ext, width, height, config = SUIT, seg = SEG } = {}) {
  const gl = ext || canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Suit program link failed: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  const U = {}; for (const n of ['uRes', 'uAspect', 'uMaskOn', 'uLo', 'uHi', 'uAlpha', 'uAlphaRed', 'uMask', 'uHead', 'uChest', 'uBand0', 'uBand1', 'uBandSz0', 'uBandSz1', 'uHand0', 'uHand1', 'uRed', 'uBase', 'uWeb', 'uEmblem']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uMask, 0); gl.uniform1f(U.uLo, seg.edge[0]); gl.uniform1f(U.uHi, seg.edge[1]);
  gl.uniform1f(U.uAlpha, config.alpha); gl.uniform1f(U.uAlphaRed, config.alphaRed);
  gl.uniform3fv(U.uRed, config.red); gl.uniform3fv(U.uBase, config.base);
  gl.uniform4f(U.uWeb, config.web.spokes, config.web.line, config.web.rings, config.web.sag); gl.uniform1f(U.uEmblem, config.emblemR);

  const tex = gl.createTexture(); let texW = 1, texH = 1, maskOn = false, dirty = true;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  function setMask(mask) {
    if (!mask || !mask.data) { maskOn = false; return; }
    if (mask.data.length !== mask.w * mask.h * 4) throw new Error('mask data does not match its size');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    if (mask.w !== texW || mask.h !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mask.w, mask.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask.data); texW = mask.w; texH = mask.h; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.w, mask.h, gl.RGBA, gl.UNSIGNED_BYTE, mask.data);
    maskOn = true;
  }
  const size = () => ({ w: width || gl.drawingBufferWidth, h: height || gl.drawingBufferHeight });
  function clear() { const { w, h } = size(); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); dirty = false; }

  // body: from the body tracker (normalised). bands: wristBands() output (aspect space). Returns true if something was drawn.
  function draw({ body, bands = [], aspect = 16 / 9 }) {
    if (!maskOn || !body) { if (dirty) clear(); return false; }
    const { w, h } = size(); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uAspect, aspect); gl.uniform1f(U.uMaskOn, 1);
    gl.uniform4f(U.uHead, body.head.cx * aspect, body.head.cy, Math.max(body.head.rx * aspect, 1e-3), Math.max(body.head.ry, 1e-3));
    gl.uniform3f(U.uChest, body.chest.x * aspect, body.chest.y, body.chest.s * aspect);
    const [b0, b1] = [bands[0], bands[1]];
    gl.uniform4f(U.uBand0, b0 ? b0.band.x : 0, b0 ? b0.band.y : 0, b0 ? b0.band.dx : 1, b0 ? b0.band.dy : 0);
    gl.uniform3f(U.uBandSz0, b0 ? b0.band.half : 0, b0 ? b0.band.across : 0, b0 ? 1 : 0);
    gl.uniform4f(U.uBand1, b1 ? b1.band.x : 0, b1 ? b1.band.y : 0, b1 ? b1.band.dx : 1, b1 ? b1.band.dy : 0);
    gl.uniform3f(U.uBandSz1, b1 ? b1.band.half : 0, b1 ? b1.band.across : 0, b1 ? 1 : 0);
    gl.uniform3f(U.uHand0, b0 ? b0.hand.x : 0, b0 ? b0.hand.y : 0, b0 ? b0.hand.r : 0);
    gl.uniform3f(U.uHand1, b1 ? b1.hand.x : 0, b1 ? b1.hand.y : 0, b1 ? b1.hand.r : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = true; return true;
  }
  return { gl, draw, clear, setMask };
}

// Browser glue. suit.setMask(mask) <- every new mask (or null); suit.setHands(hands) <- every detection; suit.setActive(bool); start/stop/resize.
export function createSuitFx({ canvas, config = SUIT } = {}) {
  let renderer = null;
  try { renderer = createSuitRenderer({ canvas, config }); } catch (e) { console.error(e); }
  const tracker = createBodyTracker(config);
  const stats = { ok: !!renderer, fps: 0, ms: 0, body: '-' };
  let raf = 0, running = false, active = true, aspect = 16 / 9, bands = [], rawHands = [], stamp = null, frames = 0, msAcc = 0, lastFps = 0, shown = false;

  function loop(now) {
    if (!running) return;
    const t0 = performance.now();
    if (!active || !maskFresh(now, stamp)) { if (shown && renderer) { renderer.clear(); shown = false; } }   // off, or a stalled segmenter: show the plain camera picture
    else if (renderer) shown = renderer.draw({ body: tracker.body, bands, aspect });
    msAcc += performance.now() - t0; frames++;
    if (now - lastFps >= 1000) { stats.fps = frames; stats.ms = msAcc / frames; frames = 0; msAcc = 0; lastFps = now; }
    raf = requestAnimationFrame(loop);
  }
  return {
    stats,
    setActive(v) { active = !!v; },
    setMask(mask) {
      if (!renderer) return;
      if (!mask) { stamp = null; tracker.reset(); renderer.setMask(null); stats.body = '-'; return; }
      stamp = performance.now();
      const b = tracker.update(analyzeBody(mask, config), stamp);
      stats.body = b ? `head ${b.head.cx.toFixed(2)},${b.head.cy.toFixed(2)} · chest ${b.chest.x.toFixed(2)},${b.chest.y.toFixed(2)} w ${b.chest.s.toFixed(2)} · ${b.usedClothes ? 'clothes' : 'fallback'}` : 'nobody';
      try { renderer.setMask(mask); } catch (e) { console.error(e); stamp = null; }
    },
    setHands(hands) { rawHands = hands || []; bands = wristBands(rawHands, aspect, config); },
    resize(w, h) { aspect = w / h; canvas.width = Math.min(w, 960); canvas.height = Math.round(canvas.width * h / w); canvas.style.aspectRatio = `${w} / ${h}`; },
    start() { if (running) return; running = true; lastFps = performance.now(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); renderer && (renderer.clear(), renderer.setMask(null)); tracker.reset(); stamp = null; shown = false; },
    get ok() { return !!renderer; },
  };
}

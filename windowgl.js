// WebGL renderer for the frame window + the render loop that drives it (Session 3).
// WebGL1 / GLSL ES 1.00 on purpose: widest support (old iPhones, headless-gl in tests). One fullscreen triangle,
// everything is computed per pixel: inside-test of the (possibly still opening) quad, perspective-correct placeholder
// fill through the inverse homography, neon edge glow and lightning.
import { WINDOW } from './config.js';
import { windowGeometry } from './homography.js';
import { createWindowController } from './windowctl.js';

const VS = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uAspect; uniform mat3 uHinv; uniform vec2 uQ[4];
uniform float uTime, uFlash, uReduced, uFill, uMode, uCore, uHalo, uBoltAmp, uBoltHz, uFlipHz;
uniform vec3 uEdgeCol, uBoltCol;

float hash11(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float vnoise(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }

// p, a, b in aspect space. d = distance to the segment, s = position along it (0..1), side = signed distance from the
// segment's line (+ outside, clockwise quad, y down), line = same but measured to the infinite line (for the inside test).
void edgeInfo(vec2 p, vec2 a, vec2 b, out float d, out float s, out float side, out float len) {
  vec2 ab = b - a; float l2 = max(dot(ab, ab), 1e-9); len = sqrt(l2);
  s = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  vec2 c = a + ab * s; d = length(p - c);
  vec2 n = vec2(ab.y, -ab.x) / len;
  side = dot(p - a, n);
}

vec3 edgeLight(float d, float s, float side, float len, float seed) {
  bool calm = uReduced > 0.5;
  float tq = calm ? uTime : floor(uTime * uBoltHz) / uBoltHz;            // crackle steps 12x/s; calm mode glides
  float x = s * len * 28.0;
  float amp = uBoltAmp * (calm ? 0.35 : 1.0);
  float off = 0.006 + amp * ((vnoise(x * 0.7 + seed * 17.0 + tq * 9.0) - 0.5) * 2.0 + 0.4 * (vnoise(x * 2.9 + seed * 5.0 + tq * 21.0) - 0.5) * 2.0);
  float bd = sqrt((side - off) * (side - off) + max(d * d - side * side, 0.0)); // distance to the wobbling bolt, which stops at the corners
  float f = fract(s * 0.9 - uTime * 0.45 + seed * 0.37);                // comet travelling along the edge
  float env = smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(0.04, 0.38, f));
  float gate = calm ? 1.0 : step(0.35, hash11(floor(uTime * uFlipHz) + seed * 11.0)); // on/off at most uFlipHz times per second
  vec3 col = uEdgeCol * (exp(-(d * d) / (uCore * uCore)) + 0.3 * exp(-d / uHalo));
  col += uBoltCol * env * gate * (1.4 * exp(-(bd * bd) / (uCore * uCore * 2.25)) + 0.4 * exp(-bd / (uHalo * 0.6)));
  return col;
}

vec3 placeholder(vec2 uv) {
  vec3 base = mix(vec3(0.015, 0.02, 0.05), vec3(0.03, 0.16, 0.20), clamp(uv.y, 0.0, 1.0));
  vec2 g = abs(fract(uv * 10.0) - 0.5);
  float line = max(smoothstep(0.45, 0.5, g.x), smoothstep(0.45, 0.5, g.y));
  base += vec3(0.10, 0.45, 0.45) * line * 0.5;
  if (uReduced < 0.5) base += vec3(0.02, 0.08, 0.09) * (0.5 + 0.5 * sin((uv.x + uv.y) * 8.0 - uTime * 1.5)) * 0.6;
  // corner markers prove the corner order TL red, TR green, BR blue, BL yellow
  if (uv.x + uv.y < 0.14) base = vec3(0.9, 0.1, 0.15);
  else if ((1.0 - uv.x) + uv.y < 0.14) base = vec3(0.1, 0.8, 0.3);
  else if ((1.0 - uv.x) + (1.0 - uv.y) < 0.14) base = vec3(0.15, 0.3, 0.95);
  else if (uv.x + (1.0 - uv.y) < 0.14) base = vec3(0.95, 0.85, 0.1);
  return base;
}

void main() {
  vec2 pn = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);  // normalized display coords, y down
  vec2 p = vec2(pn.x * uAspect, pn.y);
  float d0, s0, k0, l0, d1, s1, k1, l1, d2, s2, k2, l2, d3, s3, k3, l3;
  edgeInfo(p, uQ[0], uQ[1], d0, s0, k0, l0);
  edgeInfo(p, uQ[1], uQ[2], d1, s1, k1, l1);
  edgeInfo(p, uQ[2], uQ[3], d2, s2, k2, l2);
  edgeInfo(p, uQ[3], uQ[0], d3, s3, k3, l3);
  // Signed distance to each edge's infinite line (+ outside). Convex quad: inside when all are <= 0.
  float m = max(max(k0, k1), max(k2, k3));
  float px = 1.0 / uRes.y;
  float inside = 1.0 - smoothstep(-px, px, m);
  float dmin = min(min(d0, d1), min(d2, d3));
  if (uMode > 0.5) {                                       // test modes: 1 = flat mask, 2 = uv as colour
    vec3 h = uHinv * vec3(pn, 1.0); vec2 uv = h.xy / h.z;
    gl_FragColor = uMode < 1.5 ? vec4(vec3(inside), inside) : vec4(vec3(uv, 0.0) * inside, inside);
    return;
  }
  if (inside <= 0.0 && dmin > uHalo * 8.0) { gl_FragColor = vec4(0.0); return; }
  vec3 h = uHinv * vec3(pn, 1.0); vec2 uv = h.xy / h.z;
  vec3 glow = edgeLight(d0, s0, k0, l0, 0.0) + edgeLight(d1, s1, k1, l1, 1.0) + edgeLight(d2, s2, k2, l2, 2.0) + edgeLight(d3, s3, k3, l3, 3.0);
  glow *= 1.0 + 2.2 * uFlash;
  glow += vec3(1.0) * uFlash * exp(-(dmin * dmin) / (uCore * uCore * 4.0)) * 0.6;
  float fa = uFill * inside;
  vec3 rgb = placeholder(uv) * fa + glow;
  float a = clamp(fa + max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
  gl_FragColor = vec4(min(rgb, vec3(a)), a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
  return s;
}

// Pass { canvas } in the browser or { gl, width, height } for an existing context (tests).
export function createWindowRenderer({ canvas, gl: ext, width, height, config = WINDOW, preserveDrawingBuffer = false } = {}) {
  const gl = ext || canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL not available');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  const U = {}; for (const n of ['uRes', 'uAspect', 'uHinv', 'uQ', 'uTime', 'uFlash', 'uReduced', 'uFill', 'uMode', 'uCore', 'uHalo', 'uBoltAmp', 'uBoltHz', 'uFlipHz', 'uEdgeCol', 'uBoltCol']) U[n] = gl.getUniformLocation(prog, n === 'uQ' ? 'uQ[0]' : n);
  let dirty = true;

  const size = () => ({ w: width || gl.drawingBufferWidth, h: height || gl.drawingBufferHeight });
  function clear() { const { w, h } = size(); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); dirty = false; }

  // frame: from windowctl.step(). opts: { aspect, timeS, reduced, mode: 'normal' | 'mask' | 'uv', fill }
  // Returns true if something was drawn.
  function draw(frame, { aspect = 16 / 9, timeS = 0, reduced = false, mode = 'normal', fill = config.fillAlpha } = {}) {
    const geo = frame && frame.visible ? windowGeometry(frame.corners, frame.hu, frame.hv, aspect) : null;
    if (!geo) { if (dirty) clear(); return false; }
    const { w, h } = size(); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uAspect, aspect);
    gl.uniformMatrix3fv(U.uHinv, false, geo.hinv); gl.uniform2fv(U.uQ, geo.quad);
    gl.uniform1f(U.uTime, timeS % 3600); gl.uniform1f(U.uFlash, reduced ? 0 : frame.flash);
    gl.uniform1f(U.uReduced, reduced ? 1 : 0); gl.uniform1f(U.uFill, fill);
    gl.uniform1f(U.uMode, mode === 'mask' ? 1 : mode === 'uv' ? 2 : 0);
    gl.uniform1f(U.uCore, config.edge.core); gl.uniform1f(U.uHalo, config.edge.halo);
    gl.uniform1f(U.uBoltAmp, config.bolts.amp); gl.uniform1f(U.uBoltHz, config.bolts.hz); gl.uniform1f(U.uFlipHz, config.bolts.flipHz);
    gl.uniform3fv(U.uEdgeCol, config.colors.edge); gl.uniform3fv(U.uBoltCol, config.colors.bolt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = true; return true;
  }
  return { gl, draw, clear };
}

// Browser glue: owns the controller and a requestAnimationFrame loop that is INDEPENDENT of the detector.
//   fx.setTarget(snap)  <- call with the gesture snapshot whenever detection runs (any rate)
//   fx.start() / fx.stop() / fx.resize(videoW, videoH) / fx.setReducedFlash(bool)
// Reduced-flash hook: no open flash, no on/off bolt gating, much smaller wobble, no moving fill sweep.
// It defaults to the OS "reduce motion" setting; S10 adds the visible toggle.
export function createWindowFx({ canvas, config = WINDOW, mode = 'normal', reducedFlash } = {}) {
  let renderer = null;
  try { renderer = createWindowRenderer({ canvas, config }); } catch (e) { console.error(e); }
  const ctl = createWindowController(config);
  const stats = { ok: !!renderer, fps: 0, ms: 0, phase: 'closed' };
  let reduced = reducedFlash ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let raf = 0, running = false, aspect = 16 / 9, frames = 0, msAcc = 0, lastFps = 0;

  function loop(now) {
    if (!running) return;
    const frame = ctl.step(now), t0 = performance.now();
    if (renderer) renderer.draw(frame, { aspect, timeS: now / 1000, reduced, mode });
    msAcc += performance.now() - t0; frames++;
    if (now - lastFps >= 1000) { stats.fps = frames; stats.ms = msAcc / frames; frames = 0; msAcc = 0; lastFps = now; }
    stats.phase = frame.phase;
    raf = requestAnimationFrame(loop);
  }
  return {
    stats,
    setTarget: snap => ctl.setTarget(snap && snap.corners ? snap.corners : null),
    setReducedFlash(v) { reduced = !!v; },
    get reducedFlash() { return reduced; },
    resize(w, h) {
      aspect = w / h; const s = Math.min(1, config.fxMaxWidth / w);
      canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
      canvas.style.aspectRatio = `${w} / ${h}`;
    },
    start() { if (running) return; running = true; ctl.reset(); lastFps = performance.now(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); ctl.reset(); renderer && renderer.clear(); stats.phase = 'closed'; },
  };
}

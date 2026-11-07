// Suit + Jacket look renderer (Sessions 6 and 7). WebGL1 on its own canvas (#suit), own requestAnimationFrame loop, same pattern as windowgl.js.
// Inputs (all read-only): the packed person mask (R person, B skin, A clothes), the measured body (suitmodel.js) and the wrist bands.
// Output: premultiplied RGBA, transparent everywhere except the suit on the body. The face/hair are never painted (S9 owns the face).
import { SUIT, SEG, OUTFIT } from './config.js';
import { analyzeBody, createBodyTracker, wristBands, armSides } from './suitmodel.js';
import { maskFresh } from './segmask.js';

const VS = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uAspect, uMaskOn, uLo, uHi, uAlpha, uAlphaRed, uLook;   // uLook: 0 = Suit, 1 = Jacket
uniform sampler2D uMask, uLum, uAvg;     // person mask; small live camera picture; very small blurred copy of it (local average light)
uniform float uShadeK, uGrain, uReveal, uSeed, uLumOn;
uniform vec3 uNeon;
uniform vec4 uHead;      // cx, cy, rx, ry   (aspect space)
uniform vec3 uChest;     // x, y, width      (aspect space)
uniform vec4 uBand0, uBand1;   // cx, cy, dirx, diry
uniform vec3 uBandSz0, uBandSz1; // half, across, on
uniform vec3 uHand0, uHand1;     // x, y, radius (0 = off)
uniform vec3 uRed, uEmRed, uBase;
uniform vec4 uWeb;       // spokes, line width, rings, sag
uniform float uEmblem;   // ring radius (chest-width units)
uniform vec4 uJac;       // bulk, baffle spacing, torso top y, jacket alpha
uniform vec4 uArmL, uArmR;   // sleeve start x, y and direction x, y
uniform vec3 uBlue, uBlueDk, uHoodRed, uHoodie;
uniform float uOpen;     // jacket front opening half-width (chest-width units)

float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
float handMask(vec2 p, vec3 hd){ return hd.z > 0.0 ? 1.0 - smoothstep(hd.z * 0.85, hd.z * 1.1, length(p - hd.xy)) : 0.0; }
float bandMask(vec2 p, vec4 b, vec3 sz){
  if (sz.z < 0.5) return 0.0;
  vec2 d = p - b.xy; float along = dot(d, b.zw), across = dot(d, vec2(-b.w, b.z));
  float e = 1.5 / uRes.y;
  return (1.0 - smoothstep(sz.x - e, sz.x + e, abs(along))) * (1.0 - smoothstep(sz.y - e, sz.y + e, abs(across)));
}
vec4 over(vec4 top, vec4 bot){ return top + bot * (1.0 - top.a); }   // premultiplied
float hash(vec2 v){ return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }

// Light on the fabric = the live camera picture's own light and shadow: its brightness against the local average around it, so real folds,
// shadows and highlights on the person's clothes carry over to the suit. Plus film grain, so the fabric is as noisy as the camera.
float camShade(vec2 pn){
  if (uLumOn < 0.5) return 1.0;
  float l = dot(texture2D(uLum, pn).rgb, vec3(0.299, 0.587, 0.114)), a = dot(texture2D(uAvg, pn).rgb, vec3(0.299, 0.587, 0.114));
  return clamp(1.0 + (l - a) / (a + 0.10) * uShadeK, 0.55, 1.5);
}

// Suit fabric: near-black with a fine web (spokes + sagging rings around the chest). mode 0 = web only (gloves); 1 = Suit look (+ emblem + wrist bands); 2 = under the open jacket (+ emblem)
vec3 suitRGB(vec2 p, float mode, out float redOut){
  vec2 q = (p - uChest.xy) / uChest.z; float r = length(q), ang = atan(q.y, q.x);
  float pxq = 1.5 / uRes.y / uChest.z;
  float u = ang * uWeb.x / 6.2831853, fu = fract(u);
  float sp = min(fu, 1.0 - fu) * 6.2831853 / uWeb.x * r;
  float t = abs(fu - 0.5) * 2.0;
  float r2 = r * (1.0 + uWeb.w * (1.0 - t));
  float v = log(r2 * 5.0 + 1.0) * uWeb.z, fv = fract(v);
  float rg = min(fv, 1.0 - fv) * (r2 * 5.0 + 1.0) / (5.0 * uWeb.z);
  float lw = uWeb.y;
  float web = max(1.0 - smoothstep(lw, lw + pxq, sp), 1.0 - smoothstep(lw * 0.8, lw * 0.8 + pxq, rg)) * smoothstep(0.03, 0.09, r);
  float emb = 0.0, band = 0.0;
  if (mode > 0.5) {
    float ER = uEmblem, k = 0.14 / ER;                                        // the spider is drawn for a 0.14 ring; k scales it to the real ring
    vec2 qe = q * k; float pxe = pxq * k;
    float ring = 1.0 - smoothstep(0.011, 0.011 + pxe, abs(length(qe) - 0.14));
    vec2 s = vec2(abs(qe.x), qe.y);
    float body = max(1.0 - smoothstep(1.0, 1.0 + pxe / 0.03, length(vec2(qe.x / 0.032, (qe.y - 0.03) / 0.045))), 1.0 - smoothstep(1.0, 1.0 + pxe / 0.02, length(vec2(qe.x / 0.02, (qe.y + 0.03) / 0.02))));
    float lg = 1e3;
    lg = min(lg, min(segD(s, vec2(0.012, -0.03), vec2(0.06, -0.075)), segD(s, vec2(0.06, -0.075), vec2(0.1, -0.06))));
    lg = min(lg, min(segD(s, vec2(0.015, -0.01), vec2(0.07, -0.035)), segD(s, vec2(0.07, -0.035), vec2(0.108, -0.01))));
    lg = min(lg, min(segD(s, vec2(0.015, 0.02), vec2(0.07, 0.03)), segD(s, vec2(0.07, 0.03), vec2(0.1, 0.06))));
    lg = min(lg, min(segD(s, vec2(0.012, 0.045), vec2(0.055, 0.08)), segD(s, vec2(0.055, 0.08), vec2(0.075, 0.115))));
    float legs = 1.0 - smoothstep(0.006, 0.006 + pxe, lg);
    emb = max(ring, max(body, legs));
    web *= smoothstep(ER, ER + 0.03, r);
    if (mode < 1.5) band = max(bandMask(p, uBand0, uBandSz0), bandMask(p, uBand1, uBandSz1));
  }
  float strong = max(emb, band);
  redOut = clamp(max(web * 0.7, strong), 0.0, 1.0);
  vec3 lineCol = mix(uRed, uEmRed, strong);
  return mix(uBase, lineCol, redOut);
}

// ---- Jacket look ----
float pillow(float v){ float f = fract(v); return 0.55 + 0.45 * pow(max(sin(3.14159265 * f), 0.0), 0.7); }
float seamLine(float v){ float f = fract(v); return 1.0 - smoothstep(0.0, 0.05, min(f, 1.0 - f)); }
float coverAt(vec2 t){
  vec4 s = texture2D(uMask, t);
  return smoothstep(uLo, uHi, s.r) * clamp(s.a + s.b * step(uHead.y + uHead.w * 0.9, t.y), 0.0, 1.0);
}
vec3 jacketRGB(vec2 p, float cov0){
  float cw = uChest.z; vec2 q = (p - uChest.xy) / cw;
  float sw = smoothstep(0.40, 0.52, abs(q.x));
  vec4 arm = q.x > 0.0 ? uArmR : uArmL;
  float vT = q.y / uJac.y, vA = dot((p - arm.xy) / cw, arm.zw) / uJac.y;
  float shade = mix(pillow(vT), pillow(vA), sw), sm = mix(seamLine(vT), seamLine(vA), sw);
  vec3 c = mix(uBlue * shade, uBlueDk, sm * 0.85);
  float zip = (1.0 - smoothstep(0.004, 0.009, abs(abs(q.x) - uOpen - 0.005))) * (1.0 - sw);   // zip tape along both jacket edges
  c = mix(c, uBlueDk * 0.5, zip);
  return c * (0.75 + 0.25 * cov0);
}
vec4 jacketLook(vec2 p, vec2 pn, vec4 m, float person){
  float cw = uChest.z; vec2 q = (p - uChest.xy) / cw;
  float cov0 = clamp(m.b + m.a, 0.0, 1.0) * person;
  float R = uJac.x * cw; vec2 o = vec2(R / uAspect, R); vec2 d = o * 0.7071;
  float t1 = coverAt(pn + vec2(o.x, 0.0)), t2 = coverAt(pn - vec2(o.x, 0.0)), t3 = coverAt(pn + vec2(0.0, o.y)), t4 = coverAt(pn - vec2(0.0, o.y));
  float t5 = coverAt(pn + d), t6 = coverAt(pn - d), t7 = coverAt(pn + vec2(d.x, -d.y)), t8 = coverAt(pn + vec2(-d.x, d.y));
  float mx = max(max(max(t1, t2), max(t3, t4)), max(max(t5, t6), max(t7, t8))), av = (t1 + t2 + t3 + t4 + t5 + t6 + t7 + t8) / 8.0;
  float cov1 = smoothstep(0.15, 0.85, max(cov0, mx * 0.7 + av * 0.3));
  float head = 1.0 - smoothstep(0.85, 1.1, length((p - uHead.xy) / uHead.zw));
  float hand = max(handMask(p, uHand0), handMask(p, uHand1));
  float glove = hand * clamp(m.b, 0.0, 1.0) * person;
  float below = smoothstep(uJac.z - 0.01, uJac.z + 0.02, p.y);                  // the open front only exists below the neckline
  float inside = 1.0 - smoothstep(uOpen - 0.012, uOpen + 0.012, abs(q.x));       // 1 between the jacket edges
  float openFront = inside * below;

  float aj = cov1 * (1.0 - head) * (1.0 - openFront) * uJac.w;
  vec4 res = vec4(jacketRGB(p, cov0) * aj, aj);

  // inside the open front: red hoodie strips either side, the suit with its emblem in the middle
  float inner = cov1 * (1.0 - head) * openFront;
  float redW = 1.0 - smoothstep(0.13, 0.15, abs(q.x));
  float hoodieMask = inner * (1.0 - redW);
  vec3 hcol = uHoodie * (0.7 + 0.3 * pillow(q.y / (uJac.y * 0.8)));
  res = over(vec4(hcol * hoodieMask, hoodieMask), res);
  float sRed; vec3 sc = suitRGB(p, 2.0, sRed);
  float suitMask = inner * redW;
  res = over(vec4(sc * suitMask, suitMask), res);

  // red hood up: outer shape = ellipse around the head + a cowl down to the shoulders, face opening cut out of it
  vec2 hc = uHead.xy, hr = uHead.zw;
  float e2 = length((p - hc - vec2(0.0, -0.10 * hr.y)) / (hr * vec2(1.45, 1.30)));
  float yEnd = uJac.z + 0.10 * cw, capeT = clamp((p.y - hc.y) / max(yEnd - hc.y, 1e-3), 0.0, 1.0);
  float capeW = hr.x * mix(1.45, 2.1, capeT) * (1.0 - 0.3 * smoothstep(0.75, 1.0, capeT));
  float cape = (1.0 - smoothstep(capeW * 0.92, capeW, abs(p.x - hc.x))) * step(hc.y, p.y) * (1.0 - smoothstep(yEnd - 0.06 * cw, yEnd, p.y));
  float outer = max(1.0 - smoothstep(0.96, 1.0, e2), cape);
  float eo = length((p - hc - vec2(0.0, 0.02 * hr.y)) / (hr * vec2(0.84, 0.92)));
  float opening = 1.0 - smoothstep(0.96, 1.0, eo);
  float hoodA = outer * (1.0 - opening) * 0.98;
  float ang = atan(p.y - hc.y, p.x - hc.x);
  vec3 hdc = uHoodRed * (0.4 + 0.6 * smoothstep(1.0, 1.4, eo)) * (0.92 + 0.08 * sin(ang * 6.0));
  res = over(vec4(hdc * hoodA, hoodA), res);

  // hands in front of everything
  float rd; vec3 gc = suitRGB(p, 0.0, rd);
  float ga = glove * mix(uAlpha, uAlphaRed, rd);
  return over(vec4(gc * ga, ga), res);
}

void main(){
  vec2 pn = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = vec2(pn.x * uAspect, pn.y);
  vec4 m = texture2D(uMask, pn);
  float person = smoothstep(uLo, uHi, m.r) * uMaskOn;
  vec4 res;
  if (uLook > 0.5) res = jacketLook(p, pn, m, person);
  else {
    float cover = clamp(m.b + m.a, 0.0, 1.0) * person;
    float head = 1.0 - smoothstep(0.85, 1.1, length((p - uHead.xy) / uHead.zw));
    float hand = max(handMask(p, uHand0), handMask(p, uHand1));
    float a = cover * (1.0 - head * (1.0 - hand));
    if (a <= 0.003) { gl_FragColor = vec4(0.0); return; }
    float red; vec3 col = suitRGB(p, 1.0, red);
    float al = a * mix(uAlpha, uAlphaRed, red);
    res = vec4(col * al, al);
  }
  if (res.a <= 0.003) { gl_FragColor = vec4(0.0); return; }
  // light from the live picture + grain (colour is premultiplied, so scale rgb only)
  float sh = camShade(pn) * (1.0 + (hash(gl_FragCoord.xy + uSeed) - 0.5) * 2.0 * uGrain);
  res.rgb *= sh;
  // glitch-in: the outfit appears slice by slice (a slice shows once the reveal passes its random threshold); the newest slices flash neon
  if (uReveal < 1.0) {
    float band = floor(pn.y * 36.0), hh = hash(vec2(band, 7.0)), r = uReveal * 1.2;
    float on = step(hh, r), lead = on * step(r - 0.2, hh);
    res = res * on;
    res.rgb = mix(res.rgb, uNeon * res.a, lead * 0.6);
  }
  gl_FragColor = vec4(min(res.rgb, vec3(1.0)), res.a);
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
  const U = {}; for (const n of ['uRes', 'uAspect', 'uMaskOn', 'uLo', 'uHi', 'uAlpha', 'uAlphaRed', 'uMask', 'uHead', 'uChest', 'uBand0', 'uBand1', 'uBandSz0', 'uBandSz1', 'uHand0', 'uHand1', 'uRed', 'uBase', 'uWeb', 'uEmblem', 'uLook', 'uLum', 'uAvg', 'uShadeK', 'uGrain', 'uReveal', 'uSeed', 'uLumOn', 'uNeon', 'uEmRed', 'uOpen', 'uJac', 'uArmL', 'uArmR', 'uBlue', 'uBlueDk', 'uHoodRed', 'uHoodie']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uMask, 0); gl.uniform1i(U.uLum, 1); gl.uniform1i(U.uAvg, 2); gl.uniform1f(U.uShadeK, config.shadeK); gl.uniform1f(U.uGrain, config.grain); gl.uniform3fv(U.uNeon, OUTFIT.neon); gl.uniform3fv(U.uEmRed, config.emblemRed); gl.uniform1f(U.uOpen, config.jacket.open); gl.uniform1f(U.uReveal, 1); gl.uniform1f(U.uLumOn, 0); gl.uniform1f(U.uLo, seg.edge[0]); gl.uniform1f(U.uHi, seg.edge[1]);
  gl.uniform1f(U.uAlpha, config.alpha); gl.uniform1f(U.uAlphaRed, config.alphaRed);
  gl.uniform3fv(U.uRed, config.red); gl.uniform3fv(U.uBase, config.base);
  gl.uniform4f(U.uWeb, config.web.spokes, config.web.line, config.web.rings, config.web.sag); gl.uniform1f(U.uEmblem, config.emblemR);
  const J = config.jacket; gl.uniform3fv(U.uBlue, J.blue); gl.uniform3fv(U.uBlueDk, J.blueDark); gl.uniform3fv(U.uHoodRed, J.hoodRed); gl.uniform3fv(U.uHoodie, J.hoodie);

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
  // live camera light: two small pictures (about 1/8 and 1/60 of the camera picture) made by the caller; setLight(null) turns the shading off
  const mkTex = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255])); return t; };
  const lumTex = mkTex(1), avgTex = mkTex(2); let lightOn = 0;
  function setLight(lum, avg) {
    if (!lum || !avg) { lightOn = 0; return; }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lumTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lum);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, avgTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, avg);
    gl.activeTexture(gl.TEXTURE0); lightOn = 1;
  }
  const size = () => ({ w: width || gl.drawingBufferWidth, h: height || gl.drawingBufferHeight });
  function clear() { const { w, h } = size(); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); dirty = false; }

  // body: from the body tracker (normalised). bands: wristBands() output (aspect space). Returns true if something was drawn.
  function draw({ body, bands = [], aspect = 16 / 9, look = 'suit', reveal = 1, seed = 0 }) {
    if (!maskOn || !body) { if (dirty) clear(); return false; }
    const { w, h } = size(); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uAspect, aspect); gl.uniform1f(U.uMaskOn, 1); gl.uniform1f(U.uLook, look === 'jacket' ? 1 : 0); gl.uniform1f(U.uReveal, reveal); gl.uniform1f(U.uSeed, seed); gl.uniform1f(U.uLumOn, lightOn);
    if (look === 'jacket') {
      const arms = armSides(bands, body, aspect, config);
      gl.uniform4f(U.uJac, config.jacket.bulk, config.jacket.baffle, body.torso, config.jacket.alpha);
      gl.uniform4f(U.uArmL, arms.left.x, arms.left.y, arms.left.dx, arms.left.dy); gl.uniform4f(U.uArmR, arms.right.x, arms.right.y, arms.right.dx, arms.right.dy);
    }
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
  return { gl, draw, clear, setMask, setLight };
}

// Browser glue. suit.setMask(mask) <- every new mask (or null); suit.setHands(hands) <- every detection; suit.setActive(bool); start/stop/resize.
export function createSuitFx({ canvas, config = SUIT } = {}) {
  let renderer = null;
  try { renderer = createSuitRenderer({ canvas, config }); } catch (e) { console.error(e); }
  const tracker = createBodyTracker(config);
  const stats = { ok: !!renderer, fps: 0, ms: 0, body: '-' };
  let raf = 0, running = false, active = true, reveal = 0, frameN = 0, lumCv = null, avgCv = null, look = 'suit', aspect = 16 / 9, bands = [], rawHands = [], stamp = null, frames = 0, msAcc = 0, lastFps = 0, shown = false;

  function loop(now) {
    if (!running) return;
    const t0 = performance.now();
    if (!active || reveal <= 0 || !maskFresh(now, stamp)) { if (shown && renderer) { renderer.clear(); shown = false; } }   // off, or a stalled segmenter: show the plain camera picture
    else if (renderer) shown = renderer.draw({ body: tracker.body, bands, aspect, look, reveal, seed: Math.floor(now / 33) % 97 });
    msAcc += performance.now() - t0; frames++;
    if (now - lastFps >= 1000) { stats.fps = frames; stats.ms = msAcc / frames; frames = 0; msAcc = 0; lastFps = now; }
    raf = requestAnimationFrame(loop);
  }
  return {
    stats,
    setActive(v) { active = !!v; },
    setReveal(v) { reveal = Math.max(0, Math.min(1, v)); },                 // 0 = not worn yet (draws nothing), 1 = fully worn; in between = glitch-in
    // call with the camera canvas on each camera frame: makes the two small light pictures the shader multiplies in (every 2nd frame is enough)
    setFrame(src) {
      if (!renderer || !active || reveal <= 0 || (frameN++ & 1)) return;
      if (!lumCv) { lumCv = document.createElement('canvas'); lumCv.width = config.lumW; lumCv.height = config.lumH; avgCv = document.createElement('canvas'); avgCv.width = 16; avgCv.height = 9; }
      try { lumCv.getContext('2d').drawImage(src, 0, 0, lumCv.width, lumCv.height); avgCv.getContext('2d').drawImage(src, 0, 0, avgCv.width, avgCv.height); renderer.setLight(lumCv, avgCv); }
      catch (e) { console.warn('suit light failed', e); renderer.setLight(null); }
    },
    setLook(v) { look = v === 'jacket' ? 'jacket' : 'suit'; },
    setMask(mask) {
      if (!renderer) return;
      if (!mask) { stamp = null; tracker.reset(); renderer.setMask(null); stats.body = '-'; return; }
      stamp = performance.now();
      const b = tracker.update(analyzeBody(mask, config, { hands: bands, aspect }), stamp);
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

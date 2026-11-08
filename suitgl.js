// Suit + Jacket look renderer (Sessions 6 and 7): real Grok fabric textures laid on the person, nothing drawn by code. WebGL1 on its own canvas (#suit), own requestAnimationFrame loop, same pattern as windowgl.js.
// Inputs (all read-only): the packed person mask (R person, B skin, A clothes), the measured body (suitmodel.js) and the wrist bands.
// Output: premultiplied RGBA, transparent everywhere except the suit on the body. The face/hair are never painted (S9 owns the face).
import { SUIT, SEG, OUTFIT, TEX } from './config.js';
import { analyzeBody, createBodyTracker, wristBands, armSides } from './suitmodel.js';
import { maskFresh } from './segmask.js';

const VS = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uAspect, uMaskOn, uLo, uHi, uAlpha, uLook;   // uLook: 0 = Suit, 1 = Jacket
uniform sampler2D uMask, uLum, uAvg, uTexS, uTexJ;   // person mask; small live camera picture; blurred copy of it; suit texture; jacket texture
uniform float uShadeK, uGrain, uReveal, uSeed, uLumOn, uBulk, uTorsoY;
uniform vec3 uNeon;
uniform vec4 uHead;      // cx, cy, rx, ry   (aspect space)
uniform vec3 uChest;     // x, y, width      (aspect space)
uniform vec3 uHand0, uHand1;     // x, y, radius (0 = off)
uniform vec4 uArmL, uArmR;   // user's sleeve start x, y and direction x, y
uniform vec4 uCropS, uCropJ; // crop rectangles (x, y, w, h) of the two textures, in original Grok picture pixels
uniform vec3 uFig;       // active figure: centre x, shoulder y, matching width
uniform vec4 uFigAL, uFigAR; // active figure's arms: shoulder x, y, direction x, y
uniform vec4 uFigHood;   // jacket figure's hood opening: centre x, y, half width, half height
uniform vec3 uFigGlove;  // suit texture: glove patch x, y, and the suit's matching width

vec4 over(vec4 top, vec4 bot){ return top + bot * (1.0 - top.a); }   // premultiplied
float handMask(vec2 p, vec3 hd){ return hd.z > 0.0 ? 1.0 - smoothstep(hd.z * 0.85, hd.z * 1.1, length(p - hd.xy)) : 0.0; }
float hash(vec2 v){ return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 texS(vec2 px){ return texture2D(uTexS, (px - uCropS.xy) / uCropS.zw).rgb; }
vec3 texJ(vec2 px){ return texture2D(uTexJ, (px - uCropJ.xy) / uCropJ.zw).rgb; }

// Light on the fabric = the live camera picture's own light and shadow (its brightness against the local average around it).
float camShade(vec2 pn){
  if (uLumOn < 0.5) return 1.0;
  float l = dot(texture2D(uLum, pn).rgb, vec3(0.299, 0.587, 0.114)), a = dot(texture2D(uAvg, pn).rgb, vec3(0.299, 0.587, 0.114));
  return clamp(1.0 + (l - a) / (a + 0.10) * uShadeK, 0.55, 1.5);
}

// Where does this screen point land in the figure picture (original Grok pixels)? Torso: shoulder line and chest width pinned. Sleeves: along the user's arm axis.
vec2 figPx(vec2 p){
  float k = uFig.z / uChest.z;
  vec2 tor = vec2(uFig.x, uFig.y) + (p - vec2(uChest.x, uTorsoY)) * k;
  float qx = (p.x - uChest.x) / uChest.z;
  float sw = smoothstep(0.40, 0.52, abs(qx));
  vec4 ua = qx > 0.0 ? uArmR : uArmL, fa = qx > 0.0 ? uFigAR : uFigAL;
  vec2 rel = p - ua.xy; float along = dot(rel, ua.zw), across = dot(rel, vec2(-ua.w, ua.z));
  vec2 arm = fa.xy + (along * fa.zw + across * vec2(-fa.w, fa.z)) * k;
  return mix(tor, arm, sw);
}
float coverAt(vec2 t){                       // body coverage used for the jacket bulk (face skin above the chin does not bulk out)
  vec4 s = texture2D(uMask, t);
  return smoothstep(uLo, uHi, s.r) * clamp(s.a + s.b * step(uHead.y + uHead.w * 0.9, t.y), 0.0, 1.0);
}
vec3 gloveRGB(vec2 p){                       // hands: plain suit fabric from the belly patch of the suit texture
  vec2 hc = length(p - uHand0.xy) < length(p - uHand1.xy) ? uHand0.xy : uHand1.xy;
  return texS(uFigGlove.xy + (p - hc) / uChest.z * uFigGlove.z);
}

void main(){
  vec2 pn = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec2 p = vec2(pn.x * uAspect, pn.y);
  vec4 m = texture2D(uMask, pn);
  float person = smoothstep(uLo, uHi, m.r) * uMaskOn;
  float cw = uChest.z;
  float cov0 = clamp(m.b + m.a, 0.0, 1.0) * person;
  float head = 1.0 - smoothstep(0.85, 1.1, length((p - uHead.xy) / uHead.zw));
  float hand = max(handMask(p, uHand0), handMask(p, uHand1));
  float glove = hand * clamp(m.b, 0.0, 1.0) * person;                         // hands (skin) are always suit fabric, in front of everything
  vec4 res;
  if (uLook < 0.5) {
    float a = cov0 * (1.0 - head * (1.0 - hand)) * uAlpha;
    if (a <= 0.003) { gl_FragColor = vec4(0.0); return; }
    vec3 col = mix(texS(figPx(p)), gloveRGB(p), glove);
    res = vec4(col * a, a);
  } else {
    // puffer bulk: the silhouette grows a little past the body
    float R = uBulk * cw; vec2 o = vec2(R / uAspect, R); vec2 d = o * 0.7071;
    float t1 = coverAt(pn + vec2(o.x, 0.0)), t2 = coverAt(pn - vec2(o.x, 0.0)), t3 = coverAt(pn + vec2(0.0, o.y)), t4 = coverAt(pn - vec2(0.0, o.y));
    float t5 = coverAt(pn + d), t6 = coverAt(pn - d), t7 = coverAt(pn + vec2(d.x, -d.y)), t8 = coverAt(pn + vec2(-d.x, d.y));
    float mx = max(max(max(t1, t2), max(t3, t4)), max(max(t5, t6), max(t7, t8))), av = (t1 + t2 + t3 + t4 + t5 + t6 + t7 + t8) / 8.0;
    float cov1 = smoothstep(0.15, 0.85, max(cov0, mx * 0.7 + av * 0.3));
    float aj = cov1 * (1.0 - head) * uAlpha;
    res = vec4(texJ(figPx(p)) * aj, aj);
    // the figure's own hood, stretched from its face opening to the user's head; the face opening stays clear
    vec2 oc = uHead.xy + vec2(0.0, 0.02 * uHead.w), orad = uHead.zw * vec2(0.84, 0.92);
    vec2 hq = (p - oc) / orad;
    float opening = 1.0 - smoothstep(0.96, 1.0, length(hq));
    float cw2 = cw;
    float yEnd = uTorsoY + 0.10 * cw2, capeT = clamp((p.y - oc.y) / max(yEnd - oc.y, 1e-3), 0.0, 1.0);              // cowl: the hood drapes from the head down onto the shoulders
    float capeW = orad.x * mix(1.5, 2.3, capeT) * (1.0 - 0.3 * smoothstep(0.75, 1.0, capeT));
    float cape = (1.0 - smoothstep(capeW * 0.92, capeW, abs(p.x - oc.x))) * step(oc.y, p.y) * (1.0 - smoothstep(yEnd - 0.06 * cw2, yEnd, p.y));
    float hoodA = max(1.0 - smoothstep(0.96, 1.0, length((hq - vec2(0.0, -0.12)) / vec2(1.9, 1.75))), cape) * (1.0 - opening) * uAlpha;
    res = over(vec4(texJ(uFigHood.xy + hq * uFigHood.zw) * hoodA, hoodA), res);
    float ga = glove * uAlpha;
    res = over(vec4(gloveRGB(p) * ga, ga), res);
  }
  if (res.a <= 0.003) { gl_FragColor = vec4(0.0); return; }
  // light from the live picture + grain (colour is premultiplied, so scale rgb only)
  res.rgb *= camShade(pn) * (1.0 + (hash(gl_FragCoord.xy + uSeed) - 0.5) * 2.0 * uGrain);
  // glitch-in: the outfit appears slice by slice; the newest slices flash neon
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
export function createSuitRenderer({ canvas, gl: ext, width, height, config = SUIT, seg = SEG, tex: texCfg = TEX } = {}) {
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
  const U = {}; for (const n of ['uRes', 'uAspect', 'uMaskOn', 'uLo', 'uHi', 'uAlpha', 'uLook', 'uMask', 'uLum', 'uAvg', 'uTexS', 'uTexJ', 'uShadeK', 'uGrain', 'uReveal', 'uSeed', 'uLumOn', 'uBulk', 'uTorsoY', 'uNeon',
    'uHead', 'uChest', 'uHand0', 'uHand1', 'uArmL', 'uArmR', 'uCropS', 'uCropJ', 'uFig', 'uFigAL', 'uFigAR', 'uFigHood', 'uFigGlove']) U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1i(U.uMask, 0); gl.uniform1i(U.uLum, 1); gl.uniform1i(U.uAvg, 2); gl.uniform1i(U.uTexS, 3); gl.uniform1i(U.uTexJ, 4);
  gl.uniform1f(U.uShadeK, config.shadeK); gl.uniform1f(U.uGrain, config.grain); gl.uniform3fv(U.uNeon, OUTFIT.neon); gl.uniform1f(U.uReveal, 1); gl.uniform1f(U.uLumOn, 0);
  gl.uniform1f(U.uLo, seg.edge[0]); gl.uniform1f(U.uHi, seg.edge[1]); gl.uniform1f(U.uBulk, config.jacket.bulk);
  gl.uniform4f(U.uCropS, ...texCfg.suit.crop); gl.uniform4f(U.uCropJ, ...texCfg.jacket.crop);
  gl.uniform3f(U.uFigGlove, texCfg.glove[0], texCfg.glove[1], texCfg.suit.cw);
  const FIG = { suit: texCfg.suit, jacket: texCfg.jacket };

  const setTexParams = () => { for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); };
  const mkTex = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); setTexParams();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255])); return t; };
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const maskTex = mkTex(0), lumTex = mkTex(1), avgTex = mkTex(2), texS = mkTex(3), texJ = mkTex(4);
  let texW = 1, texH = 1, maskOn = false, dirty = true, lightOn = 0; const have = { suit: false, jacket: false };

  // source = <img>/<canvas>/ImageBitmap (browser) or { w, h, data: Uint8Array RGBA } (tests)
  const upload = (unit, t, src) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    if (src.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.activeTexture(gl.TEXTURE0); };
  function setTexture(name, src) { if (name === 'suit') upload(3, texS, src); else if (name === 'jacket') upload(4, texJ, src); else return; have[name] = true; }
  const ready = look => have.suit && (look !== 'jacket' || have.jacket);   // gloves always need the suit texture

  function setMask(mask) {
    if (!mask || !mask.data) { maskOn = false; return; }
    if (mask.data.length !== mask.w * mask.h * 4) throw new Error('mask data does not match its size');
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex);
    if (mask.w !== texW || mask.h !== texH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mask.w, mask.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask.data); texW = mask.w; texH = mask.h; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.w, mask.h, gl.RGBA, gl.UNSIGNED_BYTE, mask.data);
    maskOn = true;
  }
  // live camera light: two small pictures made by the caller; setLight(null) turns the shading off
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
    if (!maskOn || !body || !ready(look)) { if (dirty) clear(); return false; }
    const { w, h } = size(); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const jacket = look === 'jacket', F = jacket ? FIG.jacket : FIG.suit;
    gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uAspect, aspect); gl.uniform1f(U.uMaskOn, 1); gl.uniform1f(U.uLook, jacket ? 1 : 0);
    gl.uniform1f(U.uReveal, reveal); gl.uniform1f(U.uSeed, seed); gl.uniform1f(U.uLumOn, lightOn); gl.uniform1f(U.uAlpha, jacket ? config.alphaJacket : config.alpha);
    gl.uniform4f(U.uHead, body.head.cx * aspect, body.head.cy, Math.max(body.head.rx * aspect, 1e-3), Math.max(body.head.ry, 1e-3));
    gl.uniform3f(U.uChest, body.chest.x * aspect, body.chest.y, body.chest.s * aspect);
    gl.uniform1f(U.uTorsoY, body.torso);
    const arms = armSides(bands, body, aspect, config);
    gl.uniform4f(U.uArmL, arms.left.x, arms.left.y, arms.left.dx, arms.left.dy); gl.uniform4f(U.uArmR, arms.right.x, arms.right.y, arms.right.dx, arms.right.dy);
    gl.uniform3f(U.uFig, F.cx, F.shoulderY, F.cw);
    gl.uniform4f(U.uFigAL, F.armL.s[0], F.armL.s[1], F.armL.d[0], F.armL.d[1]); gl.uniform4f(U.uFigAR, F.armR.s[0], F.armR.s[1], F.armR.d[0], F.armR.d[1]);
    if (jacket) gl.uniform4f(U.uFigHood, FIG.jacket.hood.c[0], FIG.jacket.hood.c[1], FIG.jacket.hood.r[0], FIG.jacket.hood.r[1]);
    const [b0, b1] = [bands[0], bands[1]];
    gl.uniform3f(U.uHand0, b0 ? b0.hand.x : 0, b0 ? b0.hand.y : 0, b0 ? b0.hand.r : 0);
    gl.uniform3f(U.uHand1, b1 ? b1.hand.x : 0, b1 ? b1.hand.y : 0, b1 ? b1.hand.r : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = true; return true;
  }
  return { gl, draw, clear, setMask, setLight, setTexture, ready };
}

// Browser glue. suit.setMask(mask) <- every new mask (or null); suit.setHands(hands) <- every detection; suit.setActive(bool); suit.setReveal(0..1); suit.setFrame(canvas); start/stop/resize.
export function createSuitFx({ canvas, config = SUIT, tex = TEX } = {}) {
  let renderer = null;
  try { renderer = createSuitRenderer({ canvas, config, tex }); } catch (e) { console.error(e); }
  const tracker = createBodyTracker(config);
  const stats = { ok: !!renderer, fps: 0, ms: 0, body: '-', tex: renderer ? 'loading' : 'no WebGL' };
  let raf = 0, running = false, active = true, reveal = 0, frameN = 0, lumCv = null, avgCv = null, look = 'suit', aspect = 16 / 9, bands = [], rawHands = [], stamp = null, frames = 0, msAcc = 0, lastFps = 0, shown = false;

  // the two fabric pictures load once, in the background; until they are in, nothing is drawn (no code-drawn fallback)
  if (renderer && typeof Image !== 'undefined') {
    const base = typeof location !== 'undefined' ? location.href : undefined; let left = 2, failed = false;
    for (const name of ['suit', 'jacket']) {
      const img = new Image(); img.decoding = 'async';
      img.onload = () => { try { renderer.setTexture(name, img); } catch (e) { failed = true; console.error(e); } if (--left === 0) stats.tex = failed ? 'failed' : 'ready'; };
      img.onerror = () => { failed = true; console.error('fabric picture failed to load: ' + tex[name].url); if (--left === 0) stats.tex = 'failed'; };
      img.src = new URL(tex[name].url, base).href;
    }
  }

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

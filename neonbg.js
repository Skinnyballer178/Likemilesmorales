// Neon city background for the frame window (Session 4). Pure GLSL ES 1.00 text + a helper that sets its uniforms.
// It is a function of (uv, window aspect, time): uv comes from the window's inverse homography, so the picture is
// perspective-correct inside the user's frame. Everything procedural: no image assets, no loops, no derivatives.
// Reads these globals from the main shader: uTime, uReduced (1 = reduced motion/flash: static picture, no flicker).
import { NEON } from './config.js';

export const NEON_UNIFORMS = ['uSkyTop', 'uSkyMid', 'uSkyHor', 'uSun', 'uSunIn', 'uSunOut', 'uTeal', 'uPink', 'uRedN', 'uDrift', 'uNeonP'];

export const NEON_GLSL = `
uniform vec3 uSkyTop, uSkyMid, uSkyHor, uSunIn, uSunOut, uTeal, uPink, uRedN;
uniform vec3 uSun;     // x, y (picture units), radius
uniform vec2 uDrift;   // skyline drift speed far, near (picture heights per second)
uniform vec3 uNeonP;   // lit-window changes per second, halftone dots per picture height, misregistration offset

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Classic halftone: dot radius grows with 'level' (0..1) on a rotated grid.
float halftoneDot(vec2 p, float level, float scale, float ang){
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) * scale;
  float d = length(fract(q) - 0.5);
  float r = sqrt(clamp(level, 0.0, 1.0)) * 0.72;
  return 1.0 - smoothstep(r - 0.09, r + 0.09, d);
}

// One skyline layer: rgb = building colour with lit windows and roof neon, a = coverage.
vec4 skyline(vec2 uv, float asp, float cols, float baseV, float minH, float maxH, float drift, float seed, float tq, vec3 body, float winGain, float roof){
  float x = uv.x * asp * cols + drift * cols;
  float id = floor(x);
  float top = baseV - (minH + (maxH - minH) * h21(vec2(id, seed)));
  float cov = smoothstep(top - 0.002, top + 0.002, uv.y);
  vec3 c = body * (0.8 + 0.4 * h21(vec2(id, seed + 3.0)));
  vec2 g = vec2(x * 5.0, (uv.y - top) * cols * 5.0);       // square window cells in picture units
  vec2 cell = floor(g), f = fract(g);
  float rectm = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.72) * step(1.0, cell.y);
  float base = step(0.58, h21(cell + seed * 5.0));
  float tog = step(0.93, h21(cell + tq * 1.7 + 11.0));      // about 7% of the windows change at each tick
  float lit = abs(base - tog) * rectm;
  float pick = h21(cell + 7.0);
  vec3 wc = pick < 0.45 ? uTeal : (pick < 0.8 ? uPink : vec3(1.0, 0.85, 0.35));
  float line = (1.0 - smoothstep(0.0, 0.006, abs(uv.y - top))) * roof;
  vec3 lc = mix(uRedN, uTeal, step(0.5, h21(vec2(id, seed + 9.0))));
  return vec4(c + wc * lit * winGain + lc * line * 1.3, max(cov, line));
}

vec3 neonBackground(vec2 uv, float asp){
  float calm = uReduced > 0.5 ? 1.0 : 0.0;
  float t = calm > 0.5 ? 0.0 : uTime;
  float tq = calm > 0.5 ? 0.0 : floor(uTime * uNeonP.x);
  vec2 p = vec2(uv.x * asp, uv.y);
  float v = clamp(uv.y, 0.0, 1.0);

  // sky
  vec3 col = mix(uSkyTop, uSkyMid, smoothstep(0.0, 0.5, v));
  col = mix(col, uSkyHor, smoothstep(0.4, 0.78, v));

  // halftone vignette over the sky (dots grow toward the top and the sides), plus a teal layer printed slightly off-register
  float side = abs(uv.x - 0.5) * 2.0;
  float lv = clamp((1.0 - smoothstep(0.0, 0.6, v)) * 0.8 + side * side * 0.35, 0.0, 1.0);
  float ht = halftoneDot(p, lv, uNeonP.y, 0.26);
  float ht2 = halftoneDot(p + vec2(uNeonP.z, -0.7 * uNeonP.z), lv * 0.55, uNeonP.y, 1.31);
  col = mix(col, col * 0.35 + uSkyTop * 0.5, ht * 0.8);
  col += uTeal * ht2 * 0.12;

  // sun drawn over the sky dots: clean disc, soft glow, and its own coarse dots only on the upper rim
  vec2 sc = vec2(uSun.x * asp, uSun.y);
  float sd = length(p - sc);
  float sun = 1.0 - smoothstep(uSun.z - 0.006, uSun.z + 0.006, sd);
  float sg = clamp((p.y - (sc.y - uSun.z)) / (2.0 * uSun.z), 0.0, 1.0);
  col += uSunOut * 0.30 * exp(-max(sd - uSun.z, 0.0) * 6.0) * (1.0 - sun);
  vec3 sunCol = mix(uSunIn, uSunOut, sg);
  float sdots = halftoneDot(p, 0.55 * (1.0 - smoothstep(0.0, 0.55, sg)), uNeonP.y * 0.55, 0.26);
  sunCol = mix(sunCol, uSkyMid, sdots * 0.7);
  col = mix(col, sunCol, sun);

  // faint diagonal speed streaks in the sky
  float q = (p.x + p.y * 0.45) * 4.0 + t * 0.08;
  float band = fract(q);
  float streak = smoothstep(0.0, 0.01, band) * (1.0 - smoothstep(0.01, 0.03, band)) * step(0.72, h21(vec2(floor(q), 3.0)));
  col += mix(uTeal, uPink, h21(vec2(floor(q), 5.0))) * streak * 0.22 * (1.0 - v);

  // two skyline layers (far, then near) with parallax drift
  vec4 far = skyline(uv, asp, 7.0, 0.80, 0.10, 0.33, t * uDrift.x, 1.0, tq, mix(vec3(0.16, 0.04, 0.30), vec3(0.06, 0.02, 0.14), clamp(v - 0.5, 0.0, 1.0)), 0.8, 0.0);
  col = mix(col, far.rgb, far.a);
  vec4 near = skyline(uv, asp, 3.4, 1.02, 0.12, 0.38, t * uDrift.y, 7.0, tq, vec3(0.025, 0.01, 0.07), 0.9, 1.0);
  col = mix(col, near.rgb, near.a);

  // glow near the bottom edge
  col += mix(uSkyHor, uTeal, 0.5) * 0.08 * smoothstep(0.7, 1.0, v);
  return clamp(col, 0.0, 1.0);
}
`;

// Sets the uniforms of NEON_GLSL. U: map of uniform locations made with NEON_UNIFORMS.
export function applyNeon(gl, U, cfg = NEON) {
  gl.uniform3fv(U.uSkyTop, cfg.sky.top); gl.uniform3fv(U.uSkyMid, cfg.sky.mid); gl.uniform3fv(U.uSkyHor, cfg.sky.horizon);
  gl.uniform3f(U.uSun, cfg.sun.x, cfg.sun.y, cfg.sun.r); gl.uniform3fv(U.uSunIn, cfg.sun.inner); gl.uniform3fv(U.uSunOut, cfg.sun.outer);
  gl.uniform3fv(U.uTeal, cfg.teal); gl.uniform3fv(U.uPink, cfg.pink); gl.uniform3fv(U.uRedN, cfg.red);
  gl.uniform2f(U.uDrift, cfg.driftFar, cfg.driftNear);
  gl.uniform3f(U.uNeonP, Math.min(cfg.windowFlipHz, 3), cfg.halftoneScale, cfg.misreg); // flip rate is capped at 3 per second
}

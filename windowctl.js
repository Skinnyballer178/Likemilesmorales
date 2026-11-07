// Window controller: pure logic (no DOM, no GL), runs once per DISPLAY frame.
// Detection calls setTarget(corners | null) whenever it has news; step(now) is called every render frame and returns
// what to draw: smoothed corners + open/close progress. Keeping this separate from WebGL makes it testable in node.
import { WINDOW } from './config.js';

const clamp01 = x => Math.min(1, Math.max(0, x));
const easeOutCubic = x => 1 - (1 - x) ** 3;

// Critically damped spring toward `target` (Unity-style SmoothDamp): frame-rate independent, never overshoots.
export function smoothDamp(cur, target, vel, smoothTimeS, dt) {
  const omega = 2 / Math.max(smoothTimeS, 1e-4), x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, tmp = (vel + omega * change) * dt;
  return [target + (change + tmp) * k, (vel - omega * tmp) * k];
}

// Open progress p (0..1, linear in time) -> visible half-extents in uv space (0.5 = full window).
// Opens as a horizontal line that stretches, then unfolds vertically; closing runs the same curve backwards (TV-off).
export const openShape = p => ({ hu: 0.5 * easeOutCubic(clamp01(p / 0.6)), hv: 0.5 * easeOutCubic(clamp01((p - 0.3) / 0.7)) });

export function createWindowController(cfg = WINDOW) {
  let target = null, pos = null, vel = new Array(8).fill(0);
  let want = false, p = 0, flash = 0, lastT = null;

  const flat = cs => cs.flatMap(c => [c.x, c.y]);
  const valid = cs => Array.isArray(cs) && cs.length === 4 && cs.every(c => c && Number.isFinite(c.x) && Number.isFinite(c.y));

  // corners: [{x,y} x4] TL,TR,BR,BL normalized display coords, or null (no frame -> close).
  function setTarget(corners) {
    if (valid(corners)) {
      if (!want && p <= 0.001) { pos = flat(corners); vel.fill(0); flash = 1; } // opening from closed: appear in place, no fly-in
      want = true; target = flat(corners);
      if (!pos) pos = target.slice();
    } else want = false; // keep drawing from the last position while closing
  }

  function step(now) {
    const dt = lastT === null ? 0 : Math.min(Math.max(now - lastT, 0), cfg.maxDtMs);
    lastT = now;
    if (want && target && pos) for (let i = 0; i < 8; i++) { const r = smoothDamp(pos[i], target[i], vel[i], cfg.smoothTimeMs / 1000, dt / 1000); pos[i] = r[0]; vel[i] = r[1]; }
    p = clamp01(p + (want ? dt / cfg.openMs : -dt / cfg.closeMs));
    flash = Math.max(0, flash - dt / cfg.flashMs);
    const { hu, hv } = openShape(p);
    const phase = want ? (p >= 1 ? 'open' : 'opening') : p > 0 ? 'closing' : 'closed';
    const corners = pos ? [0, 1, 2, 3].map(i => ({ x: pos[i * 2], y: pos[i * 2 + 1] })) : null;
    return { phase, p, hu, hv, flash, corners, visible: p > 0 && !!corners };
  }

  function reset() { target = pos = null; vel = new Array(8).fill(0); want = false; p = 0; flash = 0; lastT = null; }
  return { setTarget, step, reset, get phase() { return want ? (p >= 1 ? 'open' : 'opening') : p > 0 ? 'closing' : 'closed'; } };
}

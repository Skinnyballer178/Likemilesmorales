// Mask system, part A (Session 8): the mask GESTURE and the mask STATE. Pure functions + one small state machine: no DOM, no MediaPipe, no GL, no clock, no random numbers.
// (Rendering is S9: maskgl.js reads the state from here. This file is controlled ONLY by the hand gesture, see PLAN.md "Three independent systems".)
//
// The gesture: ONE closed fist starts above the top of the head and travels steadily down through the face to the chin.
// Everything is measured in HEAD coordinates (facelm.js toHead): t = 0 at the chin, 1 at the forehead landmark, FACE.headTopAllow more at the head top;
// s = sideways distance from the head axis. So head position, tilt and distance to the camera do not matter.
//
// Phases:   idle > armed (fist rests in the start zone) > pulling (fist travels down, progress follows it) > completing (ease to 1) > worn
// State:    hidden > revealing (progress 0..1) > worn. "worn" persists after the hand lowers; only reset() takes it off.
// A cancelled pull (fist opened, left the corridor, moved up, too slow ...) un-reveals smoothly and goes back to idle. A hand merely passing near the face never arms.
import { MASK_GESTURE, FACE } from './config.js';
import { toHead } from './facelm.js';

export const MASK_STATE = { HIDDEN: 'hidden', REVEALING: 'revealing', WORN: 'worn' };
export const PHASE = { IDLE: 'idle', ARMED: 'armed', PULLING: 'pulling', COMPLETING: 'completing', WORN: 'worn' };

// MediaPipe hand landmark ids: wrist 0; per finger [knuckle (MCP), middle joint (PIP), tip].
const FINGERS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
const PALM = [0, 5, 9, 13, 17];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dist = (a, b, asp) => Math.hypot((a.x - b.x) * asp, a.y - b.y);

// ---- 1. fist geometry ----
// Palm size = wrist to the middle knuckle, in picture-height units (aspect corrected).
export const palmSize = (pts, aspect = 16 / 9) => dist(pts[0], pts[9], aspect);
// Palm centre (display coordinates): the mean of the wrist and the four knuckles. It barely moves when the fingers curl, so it is a steady fist position.
export function palmCenter(pts) { let x = 0, y = 0; for (const i of PALM) { x += pts[i].x; y += pts[i].y; } return { x: x / PALM.length, y: y / PALM.length }; }
// Curl ratio per finger: (fingertip to wrist) / (knuckle to wrist). About 1.8-2 for a straight finger, below about 1.1 for a finger folded into the palm.
export function curlRatios(pts, aspect = 16 / 9) {
  const w = pts[0];
  return FINGERS.map(([mcp, , tip]) => { const d = dist(pts[mcp], w, aspect); return d > 1e-6 ? dist(pts[tip], w, aspect) / d : Infinity; });
}
// Is this hand a closed fist? `wasFist` gives hysteresis: strict to start, looser to stay.
export function judgeFist(hand, aspect = 16 / 9, wasFist = false, cfg = MASK_GESTURE.fist) {
  if (!hand || !hand.pts || hand.pts.length < 21) return { fist: false, reason: 'no-hand' };
  if ((hand.score ?? 1) < cfg.minScore) return { fist: false, reason: 'low-confidence' };
  const palm = palmSize(hand.pts, aspect);
  if (!(palm >= cfg.minPalm && palm <= cfg.maxPalm)) return { fist: false, reason: 'palm-size' };
  const ratios = curlRatios(hand.pts, aspect);
  const lim = wasFist ? cfg.exitRatio : cfg.enterRatio, need = wasFist ? cfg.keepFingers : cfg.enterFingers;
  const curled = ratios.filter(r => r < lim).length;
  return { fist: curled >= need, reason: curled >= need ? 'fist' : 'open', curled, ratios, palm };
}

// ---- 2. the start zone, in head coordinates ----
// Normal case: t >= head top - startBelowTop. Head top cropped by the picture's top edge: the zone is the top strip of the picture instead (the fist cannot go above the picture).
export function startZone(face, cfg = MASK_GESTURE) {
  const f = face.head, topT = 1 + (FACE.headTopAllow);
  const top = face.headTop || null;
  if (top && top.y < cfg.topEdgeY) {
    // t where the head axis crosses y = topStripY (the axis points up on screen, so up.y < 0)
    const k = f.up.y * f.h;
    const t = Math.abs(k) > 1e-6 ? (cfg.topStripY - f.origin.y) / k : topT - cfg.startBelowTop;
    return { tMin: Math.min(topT - cfg.startBelowTop, t), s: cfg.startS, cropped: true };
  }
  return { tMin: topT - cfg.startBelowTop, s: cfg.startS, cropped: false };
}

// ---- 3. the state machine ----
// update({ hands, face, t, aspect, enabled }) -> snapshot.
//   hands: createHandTracker().process() output ({ slot, pts: 21 display points, score })   face: createFaceTracker().update() output ({ present, conf, head, headTop })
//   t: milliseconds from any monotonic clock (the CALLER's clock: this module never reads one)
//   enabled: false = the gesture is not watched (an armed or pulling gesture is dropped; "worn" is kept)
// snapshot: { state, progress (0..1, the reveal front 0 = top of the head, 1 = chin), phase, reason, debug }
export function createMaskGesture(cfg = MASK_GESTURE) {
  let phase = PHASE.IDLE, progress = 0, target = 0, lastT = null, reason = 'idle';
  let armStart = 0, tOrigin = 0, pullStart = 0, tMin = 0, tMinAt = 0, stallRef = 0;
  let lastFist = null, lastFistAt = -Infinity, lastFaceAt = -Infinity;
  const closed = [false, false, false, false];       // fist hysteresis per hand slot
  const stats = { cancels: 0, completions: 0, lastCancel: '-' };
  let dbg = { fist: null, pos: null, zone: null, fists: 0 };

  const toIdle = why => { phase = PHASE.IDLE; reason = why; };
  const cancel = why => { if (phase === PHASE.PULLING) { stats.cancels++; stats.lastCancel = why; target = 0; } toIdle(why); };

  function update({ hands = [], face = null, t, aspect = 16 / 9, enabled = true } = {}) {
    const dt = lastT === null ? 0 : clamp(t - lastT, 0, cfg.maxDtMs); lastT = t;
    const faceOk = !!(face && face.present && face.head && face.conf > 0);
    if (faceOk) lastFaceAt = t;

    // -- find THE fist: exactly one closed hand counts --
    let fist = null, fists = 0;
    hands.forEach((h, i) => {
      const slot = h.slot ?? i, j = judgeFist(h, aspect, !!closed[slot], cfg.fist);
      closed[slot] = j.fist;
      if (j.fist) { fists++; fist = { c: palmCenter(h.pts) }; }
    });
    for (let slot = 0; slot < closed.length; slot++) if (!hands.some((h, i) => (h.slot ?? i) === slot)) closed[slot] = false;
    const twoFists = fists > 1; if (twoFists) fist = null;
    if (fist) { lastFist = fist; lastFistAt = t; }
    const fistGone = !fist && t - lastFistAt > (hands.length ? cfg.openGraceMs : cfg.dropGraceMs);   // lost longer than a tracking blip
    const held = fist || (!twoFists && !fistGone ? lastFist : null);                                 // a blip holds the last fist position
    const pos = held && faceOk ? toHead(face.head, held.c) : null;
    dbg = { fist: fist ? fist.c : null, pos, zone: dbg.zone, fists };

    if (phase === PHASE.WORN || phase === PHASE.COMPLETING) return finish(dt);
    if (!enabled) { cancel('disabled'); return finish(dt); }

    if (phase === PHASE.IDLE || phase === PHASE.ARMED) {
      const zone = faceOk && face.conf >= cfg.minFaceConf ? startZone(face, cfg) : null;
      dbg.zone = zone;
      if (twoFists) toIdle('two-fists');
      else if (!zone) toIdle(faceOk ? 'face-unsure' : 'no-face');
      else if (zone.tMin - cfg.endT < cfg.minTravel) toIdle('face-too-small');
      else if (!fist || !pos) toIdle('no-fist');
      else if (pos.t >= zone.tMin && Math.abs(pos.s) <= zone.s) {                  // fist resting above the head
        if (phase === PHASE.IDLE) { phase = PHASE.ARMED; armStart = t; }
        tOrigin = zone.tMin; reason = t - armStart >= cfg.armMs ? 'armed' : 'arming';
      } else if (phase === PHASE.ARMED && t - armStart >= cfg.armMs && pos.t < zone.tMin - cfg.leaveT && Math.abs(pos.s) <= cfg.corridorS) {
        phase = PHASE.PULLING; pullStart = t; tMin = pos.t; stallRef = pos.t; tMinAt = t; target = 0; reason = 'pulling';   // left the zone downward: the pull begins
      } else toIdle('not-in-start-zone');
    }
    if (phase === PHASE.PULLING) stepPull(t, pos, fist, fistGone, twoFists, faceOk);
    return finish(dt);
  }

  function stepPull(t, pos, fist, fistGone, twoFists, faceOk) {
    if (twoFists) return cancel('two-fists');
    if (fistGone) return cancel('fist-opened');
    if (!faceOk && t - lastFaceAt > cfg.faceGraceMs) return cancel('face-lost');
    if (!pos) return;                                                              // face or fist blip: hold progress
    if (Math.abs(pos.s) > cfg.corridorS) return cancel('left-corridor');
    if (pos.t > tMin + cfg.backtrack) return cancel('moved-up');
    if (pos.t < stallRef - cfg.stallStep) { stallRef = pos.t; tMinAt = t; }   // real progress = a whole step further down than the last time
    if (pos.t < tMin) tMin = pos.t;
    if (t - pullStart > cfg.maxPullMs) return cancel('too-slow');
    if (t - tMinAt > cfg.stallMs) return cancel('stalled');
    target = Math.max(target, clamp((tOrigin - tMin) / (tOrigin - cfg.endT), 0, 1));   // only ever forwards while pulling
    reason = 'pulling';
    if (tMin <= cfg.endT) {
      if (t - pullStart < cfg.minPullMs) return cancel('too-fast');
      phase = PHASE.COMPLETING; target = 1; stats.completions++; reason = 'complete';
    }
  }

  // progress follows the target: forwards with a short smoothing while pulling, a short ease to 1 after completion, linear back to 0 after a cancel
  function finish(dt) {
    if (phase === PHASE.WORN) progress = 1;
    else if (phase === PHASE.COMPLETING) {
      progress += (1 - progress) * (1 - Math.exp(-dt / (cfg.completeMs / 4)));
      if (progress >= 0.995) { progress = 1; phase = PHASE.WORN; reason = 'worn'; }
    } else if (phase === PHASE.PULLING) progress += Math.max(0, target - progress) * (1 - Math.exp(-dt / cfg.followTauMs));
    else { progress = Math.max(0, progress - dt / cfg.cancelMs); if (progress < 0.0005) progress = 0; }
    return snapshot();
  }
  const stateNow = () => (phase === PHASE.WORN ? MASK_STATE.WORN : progress > 0 || phase === PHASE.COMPLETING ? MASK_STATE.REVEALING : MASK_STATE.HIDDEN);
  const snapshot = () => ({ state: stateNow(), progress, phase, reason, target, tOrigin, tMin, stats: { ...stats }, debug: dbg });
  return {
    update,
    reset() { phase = PHASE.IDLE; progress = 0; target = 0; lastT = null; lastFist = null; lastFistAt = -Infinity; lastFaceAt = -Infinity; closed.fill(false); reason = 'idle'; dbg = { fist: null, pos: null, zone: null, fists: 0 }; },
    get state() { return stateNow(); }, get progress() { return progress; }, get phase() { return phase; },
  };
}

// Mask gesture debug overlay (?debug=1). Drawn on the display canvas after the segmenter has read it. Shows where the gesture is measured: the start zone line (above the head),
// the corridor the fist must stay in, the finish line at the chin, the fist (green = counted as THE fist, red = a closed hand that is not allowed, e.g. two fists), and the progress bar.
// Everything is drawn through the head frame, so it tilts and scales with the head exactly like the gesture does.
import { fromHead } from './facelm.js';
import { MASK_GESTURE as M, FACE } from './config.js';

export function drawMaskOverlay(ctx, w, h, face, snap) {
  if (!snap) return;
  ctx.save();
  if (face && face.present && face.head) {
    const f = face.head, P = (s, t) => { const p = fromHead(f, s, t); return [p.x * w, p.y * h]; }, line = (a, b) => { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); };
    const top = 1 + FACE.headTopAllow, z = snap.debug.zone, t0 = z ? z.tMin : top - M.startBelowTop;
    ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
    ctx.strokeStyle = snap.phase === 'armed' ? '#ffc83d' : '#8888aa'; line(P(-M.startS, t0), P(M.startS, t0));       // start zone: the fist rests ABOVE this line
    ctx.strokeStyle = '#8888aa'; ctx.setLineDash && ctx.setLineDash([6, 6]);
    line(P(-M.corridorS, t0), P(-M.corridorS, M.endT)); line(P(M.corridorS, t0), P(M.corridorS, M.endT));          // corridor walls
    ctx.setLineDash && ctx.setLineDash([]); ctx.strokeStyle = '#19e3c4'; line(P(-M.corridorS, M.endT), P(M.corridorS, M.endT));   // finish line
    if (snap.phase === 'pulling' || snap.phase === 'completing') { ctx.strokeStyle = '#e11d2e'; ctx.lineWidth = 3; const tf = snap.tOrigin - snap.progress * (snap.tOrigin - M.endT); line(P(-0.6, tf), P(0.6, tf)); }   // the reveal front
  }
  const d = snap.debug;
  if (d && d.fist) { ctx.globalAlpha = 1; ctx.fillStyle = d.fists > 1 ? '#e11d2e' : '#7CFC00'; ctx.beginPath(); ctx.arc(d.fist.x * w, d.fist.y * h, 10, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1; ctx.fillStyle = '#000a'; ctx.fillRect(12, h - 150, 14, 130);                                   // progress bar (left edge)
  ctx.fillStyle = snap.state === 'worn' ? '#19e3c4' : '#e11d2e'; const bh = 130 * snap.progress; ctx.fillRect(12, h - 20 - bh, 14, bh);
  ctx.fillStyle = '#19e3c4'; ctx.font = '14px ui-monospace,monospace';
  ctx.fillText(`mask ${snap.state} ${Math.round(snap.progress * 100)}% · ${snap.phase} · ${snap.reason}`, 34, h - 20);
  ctx.restore();
}

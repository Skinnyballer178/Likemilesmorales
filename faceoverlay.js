// Face debug overlay (?face=on&debug=1): the face outline, the head frame (chin -> head top), pose text, and the hair/neck seam alpha as a red tint.
// Drawn on the display canvas AFTER the segmenter has read it, like the hand overlay. All coordinates are display-normalized.
import { FACE_OVAL, LM } from './facelm.js';

let tint = null;
export function drawFaceOverlay(ctx, w, h, face, seam, makeCanvas = () => document.createElement('canvas')) {
  if (!face || !face.present) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0.25, face.conf);
  if (seam && seam.bbox) {                                   // seam alpha as a red tint (what the S9 mask will be multiplied by)
    if (!tint || tint.width !== seam.w || tint.height !== seam.h) { tint = makeCanvas(); tint.width = seam.w; tint.height = seam.h; }
    const tc = tint.getContext('2d'), img = tc.createImageData(seam.w, seam.h), d = img.data;
    for (let i = 0; i < seam.data.length; i++) { d[i * 4] = 255; d[i * 4 + 1] = 40; d[i * 4 + 2] = 60; d[i * 4 + 3] = Math.round(seam.data[i] * 0.55); }
    tc.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(tint, 0, 0, w, h);
  }
  const P = i => [face.pts[i].x * w, face.pts[i].y * h];
  ctx.lineWidth = 2; ctx.strokeStyle = '#19e3c4'; ctx.beginPath();
  FACE_OVAL.forEach((id, k) => { const [x, y] = P(id); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath(); ctx.stroke();
  const [cx, cy] = P(LM.CHIN), [fx, fy] = P(LM.FOREHEAD), tx = face.headTop.x * w, ty = face.headTop.y * h;
  ctx.strokeStyle = '#ffc83d'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();                 // chin -> head top (the head's "up")
  for (const [x, y, c] of [[cx, cy, '#ffffff'], [fx, fy, '#ffc83d'], [tx, ty, '#e11d2e']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
  const [nx, ny] = P(LM.NOSE); ctx.fillStyle = '#19e3c4'; ctx.beginPath(); ctx.arc(nx, ny, 4, 0, 7); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = '#19e3c4'; ctx.font = '14px ui-monospace,monospace';
  ctx.fillText(`yaw ${face.yaw.toFixed(0)}° pitch ${face.pitch.toFixed(0)}° roll ${face.roll.toFixed(0)}° · ${face.poseSource} · conf ${face.conf.toFixed(2)}`, 16, 24);
  ctx.restore();
}

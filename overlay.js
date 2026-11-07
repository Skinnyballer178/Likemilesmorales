// Debug overlay (?debug=1): hand skeletons, the candidate frame and the locked frame, drawn on the display canvas.
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const COLORS = { idle: '#9a9aa5', arming: '#ffc83d', active: '#19e3c4', lost: '#e11d2e' };

export function drawOverlay(ctx, w, h, hands, snap) {
  ctx.save();
  ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff88'; ctx.fillStyle = '#fff';
  for (const hand of hands) {
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(hand.pts[a].x * w, hand.pts[a].y * h); ctx.lineTo(hand.pts[b].x * w, hand.pts[b].y * h); }
    ctx.stroke();
    for (const k of [4, 8]) { ctx.beginPath(); ctx.arc(hand.pts[k].x * w, hand.pts[k].y * h, 6, 0, 7); ctx.fill(); }
  }
  const poly = (cs, color, dash) => {
    if (!cs) return;
    ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
    cs.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = '14px ui-monospace,monospace';
    cs.forEach((p, i) => ctx.fillText(['TL', 'TR', 'BR', 'BL'][i], p.x * w + 8, p.y * h - 8));
  };
  poly(snap.candidate, COLORS[snap.state], [6, 6]);
  poly(snap.corners, COLORS[snap.state], []);
  ctx.setLineDash([]); ctx.fillStyle = COLORS[snap.state]; ctx.font = '18px ui-monospace,monospace';
  ctx.fillText(`${snap.state} · ${snap.reason} · area ${snap.area.toFixed(3)}`, 16, h - 16);
  ctx.restore();
}

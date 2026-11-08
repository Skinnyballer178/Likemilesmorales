// Synthetic hands for the mask-gesture tests (tracker output format: { slot, label, score, pts: 21 display points }).
// A hand pointing up with its PALM CENTRE (mean of wrist + 4 knuckles, what mask.js tracks) exactly at (x, y).
// open: 0 = tight fist ... 1 = fully open; one number, or four (index..pinky). size = wrist to middle knuckle in picture heights.
const mix = (a, b, k) => a + (b - a) * k;
export function fistHand({ x, y, size = 0.09, open = 0, score = 0.95, slot = 0, aspect = 16 / 9, angle = 0 } = {}) {
  const P = size, op = Array.isArray(open) ? open : [open, open, open, open];
  const wrist = [0, 0.8 * P], mcp = [[-0.3, -0.2], [-0.1, -0.2], [0.1, -0.2], [0.3, -0.2]].map(([a, b]) => [a * P, b * P]);
  const pts = Array.from({ length: 21 }, () => [0, 0]);
  pts[0] = wrist;
  [5, 9, 13, 17].forEach((id, k) => {
    const m = mcp[k], L = mix(0.75, 1.9, op[k]);                      // fingertip distance from the wrist as a multiple of the knuckle distance (the curl ratio)
    const at = f => [wrist[0] + (m[0] - wrist[0]) * f, wrist[1] + (m[1] - wrist[1]) * f];
    pts[id] = m; pts[id + 1] = at(mix(0.9, 1.35, op[k])); pts[id + 2] = at(mix(0.85, 1.65, op[k])); pts[id + 3] = at(L);
  });
  const th = mix(0.3, 1.1, (op[0] + op[1]) / 2);                      // thumb: tucked against the palm, or stretched out sideways
  pts[1] = [-0.35 * P, 0.55 * P]; pts[2] = [-0.5 * P * th, 0.4 * P]; pts[3] = [-0.6 * P * th, 0.3 * P]; pts[4] = [-0.7 * P * th, 0.2 * P];
  const a = angle * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  return { slot, label: 'Left', rawLabel: 'Left', score, pts: pts.map(([px, py]) => ({ x: x + (px * co - py * si) / aspect, y: y + px * si + py * co, z: 0 })) };
}

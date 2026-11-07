// Replay a landmark recording (made with ?debug=1 and the R key) or any frame list through tracker + gesture.
// Usage: node replay.mjs recording.json   (prints a state timeline)
import { readFileSync } from 'node:fs';
import { createHandTracker, fromRecorded } from './hands.js';
import { createFrameGesture } from './gesture.js';

export function replay(frames, { mirror = true, aspect = 16 / 9, onFrame } = {}) {
  const events = [], tracker = createHandTracker();
  let t = 0;
  const gesture = createFrameGesture(undefined, (s, prev) => events.push({ t, from: prev, to: s }));
  const snaps = frames.map(f => {
    t = f.t;
    const snap = gesture.update(tracker.process(f.hands, f.t, mirror), f.t, aspect);
    onFrame && onFrame(snap, f);
    return snap;
  });
  return { events, snaps };
}

if (process.argv[2]) {
  const rec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const frames = rec.frames.map(f => ({ t: f.t, hands: fromRecorded(f.hands) }));
  const { events, snaps } = replay(frames, { mirror: rec.mirror ?? true, aspect: rec.aspect ?? 16 / 9 });
  const count = {}; snaps.forEach(s => (count[s.reason] = (count[s.reason] || 0) + 1));
  console.log(`${frames.length} frames, ${(frames.at(-1).t - frames[0].t) / 1000 | 0}s`);
  events.forEach(e => console.log(`${(e.t / 1000).toFixed(2)}s  ${e.from} -> ${e.to}`));
  console.log('per-frame reasons:', count);
}

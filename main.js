import { createCamera } from './camera.js';
import { createDebug } from './debug.js';
import { LOOKS } from './config.js';
import { loadHandLandmarker, createHandTracker, toRecorded } from './hands.js';
import { createFrameGesture } from './gesture.js';
import { drawOverlay } from './overlay.js';
import { createWindowFx } from './windowgl.js';

const $ = id => document.getElementById(id);
const dbg = createDebug();
let look = LOOKS[0], mirror = true;

// Window layer (WebGL on #fx, own render loop). ?fx=mask or ?fx=uv shows the geometry test modes; ?calm=1 forces reduced-flash.
const qs = new URLSearchParams(location.search);
const fx = createWindowFx({ canvas: $('fx'), mode: qs.get('fx') || 'normal', reducedFlash: qs.has('calm') ? true : undefined });

const MESSAGES = {
  idle: 'Allow the camera to begin. Nothing is uploaded; everything runs on your device.',
  requesting: 'Waiting for camera permission…',
  running: '',
  denied: 'Camera access was blocked. Allow it in the browser’s site settings, then press Start again.',
  notfound: 'No camera found. Connect one and press Start again.',
  error: 'Something went wrong starting the camera.',
};
const HINTS = {
  loading: 'Loading hand tracking…',
  failed: 'Hand tracking could not load. Check your connection and reload the page.',
  idle: 'Make a frame with both hands: thumb and index finger of each hand, like two “C” shapes facing each other.',
  arming: 'Hold it steady…',
  active: 'Frame locked.',
  lost: 'Hold on, finding your hands…',
};
const setHint = key => { const el = $('hint'); if (el.dataset.k !== key) { el.dataset.k = key; el.textContent = HINTS[key] || ''; } };

// ---- hands + gesture ----
const tracker = createHandTracker();
const gesture = createFrameGesture(undefined, (s, prev) => { dbg.set('gesture', `${prev} → ${s}`); setHint(s); });
let detector = null, loading = false, lastVT = -1, lastTs = 0, errors = 0;
let hands = [], snap = { state: 'idle', reason: '-', area: 0, corners: null, candidate: null, progress: 0 };
let rec = null; // debug recorder: press R to start/stop, downloads a replay JSON

async function loadDetector(delegate) {
  loading = true; setHint('loading');
  try {
    detector = await loadHandLandmarker({ delegate });
    dbg.set('hands', `${detector.delegate} delegate`); errors = 0; setHint(gesture.state);
  } catch (e) { console.error(e); detector = null; setHint('failed'); dbg.set('hands', 'load failed'); }
  loading = false;
}

function detect(video, canvas) {
  if (!detector || video.currentTime === lastVT) return;
  lastVT = video.currentTime;
  const ts = lastTs = Math.max(performance.now(), lastTs + 1);
  let raw;
  try { raw = detector.detect(video, ts); errors = 0; }
  catch (e) {
    console.error(e);
    if (++errors >= 3 && !loading) { const d = detector.delegate; detector.close(); detector = null; if (d !== 'CPU') loadDetector('CPU'); else setHint('failed'); }
    return;
  }
  hands = tracker.process(raw, ts, mirror);
  snap = gesture.update(hands, ts, canvas.width / canvas.height);
  if (rec) rec.frames.push({ t: Math.round(ts), hands: toRecorded(raw) });
  dbg.set('hands seen', hands.length);
  dbg.set('frame', `${snap.state} (${snap.reason})`);
}

const cam = createCamera({
  video: $('cam'), canvas: $('stage'),
  onState(s, detail) {
    document.body.dataset.state = s;
    $('status').textContent = (MESSAGES[s] || '') + (detail && s !== 'running' ? ` ${detail}` : '');
    $('start').hidden = s === 'running' || s === 'requesting';
    dbg.set('state', s); dbg.set('video', detail);
    if (s === 'running') { const st = $('stage'); st.style.aspectRatio = `${st.width} / ${st.height}`; fx.resize(st.width, st.height); fx.start(); }
    else fx.stop();
    if (s === 'running') { tracker.reset(); gesture.reset(); lastVT = -1; if (!detector && !loading) loadDetector(); else if (detector) setHint('idle'); }
  },
  onFrame(canvas, ms, video) {
    const t0 = performance.now();
    detect(video, canvas);
    fx.setTarget(snap);
    if (dbg.on) drawOverlay(canvas.getContext('2d'), canvas.width, canvas.height, hands, snap);
    dbg.set('draw+detect ms', (ms + performance.now() - t0).toFixed(1));
    dbg.set('window', fx.stats.ok ? `${fx.stats.phase} · ${fx.stats.fps} fps · ${fx.stats.ms.toFixed(2)} ms/draw${fx.reducedFlash ? ' · calm' : ''}` : 'WebGL unavailable'); dbg.tick();
  },
});

$('start').addEventListener('click', () => cam.start());
$('mirror').addEventListener('change', e => { mirror = e.target.checked; cam.setMirror(mirror); tracker.reset(); gesture.reset(); fx.setTarget(null); });
document.querySelectorAll('[name=look]').forEach(r =>
  r.addEventListener('change', e => { look = e.target.value; dbg.set('look', look); }));
dbg.set('look', look);

if (dbg.on) {
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'r') return;
    if (!rec) { rec = { mirror, aspect: $('stage').width / $('stage').height, frames: [] }; dbg.set('recording', 'ON (press R to stop and save)'); }
    else {
      const a = Object.assign(document.createElement('a'), { download: 'landmarks-replay.json', href: URL.createObjectURL(new Blob([JSON.stringify(rec)], { type: 'application/json' })) });
      a.click(); dbg.set('recording', `saved ${rec.frames.length} frames`); rec = null;
    }
  });
  dbg.render();
}

import { createCamera } from './camera.js';
import { createDebug } from './debug.js';
import { LOOKS, SEG, FACE } from './config.js';
import { loadHandLandmarker, createHandTracker, toRecorded } from './hands.js';
import { createFrameGesture } from './gesture.js';
import { drawOverlay } from './overlay.js';
import { createWindowFx } from './windowgl.js';
import { createSegmenter } from './segmenter.js';
import { createFaceTracker } from './facelm.js';
import { createFaceDetector } from './facetracker.js';
import { buildSeam } from './faceseam.js';
import { drawFaceOverlay } from './faceoverlay.js';
import { maskFresh } from './segmask.js';
import { createSuitFx } from './suitgl.js';
import { SUIT } from './config.js';

const $ = id => document.getElementById(id);
const dbg = createDebug();
let look = LOOKS[0], mirror = true;

// Window layer (WebGL on #fx, own render loop). ?fx=mask or ?fx=uv shows the geometry test modes; ?calm=1 forces reduced-flash.
const qs = new URLSearchParams(location.search);
// Suit look (S6): its own canvas + render loop. ?suit=off disables it.
const suitOff = qs.get('suit') === 'off' || !SUIT.enabled;
const suit = createSuitFx({ canvas: $('suit') });
const suitWanted = () => !suitOff && (look === 'suit' || look === 'jacket') && suit.ok;   // the body layer draws both looks (S7)
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

// ---- person segmentation (S4): runs only while the window is (about to be) open. ?seg=off disables it, ?segdelegate=cpu|gpu forces a delegate, ?segtest=off skips the self-test.
const segOff = qs.get('seg') === 'off';
// ---- face (S5): runs only with ?face=on (S8/S9 switch FACE.enabled on). ?face=off always disables. The hair channel is read from the segmenter only when the face seam needs it.
const faceOn = qs.get('face') === 'off' ? false : qs.get('face') === 'on' || FACE.enabled;
const seg = createSegmenter({ onStatus: (s, n) => dbg.set('seg', `${s}${n ? ' · ' + n : ''}`), config: faceOn ? { ...SEG, layers: [...new Set([...SEG.layers, 'hair'])] } : SEG });
let lastMask = null, lastMaskT = 0;
let segLoading = false, segActive = false, segIdleSince = null;
async function loadSeg() { if (segOff || segLoading) return; segLoading = true; await seg.load(); }
function runSeg(canvas, hands) {
  const windowWanted = snap.state !== 'idle' || fx.stats.phase !== 'closed';   // arming counts, so the mask is ready by the time the frame locks
  const now = performance.now();
  if (windowWanted || suitWanted()) {
    segIdleSince = null;
    const m = seg.process(canvas, now, hands);                                  // call BEFORE the debug overlay is drawn on the canvas
    if (m) { fx.setMask(m); suit.setMask(m); segActive = true; lastMask = m; lastMaskT = now; }
  } else if (segActive) {
    if (segIdleSince === null) segIdleSince = now;
    else if (now - segIdleSince > SEG.idleOffMs) { seg.pause(); fx.setMask(null); suit.setMask(null); segActive = false; segIdleSince = null; lastMask = null; }
  }
  if (dbg.on) dbg.set('seg stats', `${seg.delegate} · every ${seg.every} · ${seg.avgMs.toFixed(1)} ms · hands agree ${seg.agreement === null ? '-' : Math.round(seg.agreement * 100) + '%'} (${seg.agreementSamples}) ${seg.verdict}`);
}

// ---- face tracking + hair/neck seam (S5) ----
const faceDet = createFaceDetector({ onStatus: (s, n) => dbg.set('face model', `${s}${n ? ' · ' + n : ''}`) });
const faceTrack = createFaceTracker();
let face = { present: false, conf: 0 }, seam = null, faceLoading = false, lastFaceVT = -1;
async function loadFace() { if (!faceOn || faceLoading) return; faceLoading = true; await faceDet.load(); }
function runFace(video, canvas) {
  if (!faceOn) return;
  const now = performance.now(), aspect = canvas.width / canvas.height;
  let raw;                                                  // undefined = no new detection this frame (model not ready, cadence skip, same video frame)
  if (faceDet.status === 'ready' && video.currentTime !== lastFaceVT) { lastFaceVT = video.currentTime; raw = faceDet.detect(video); }
  face = faceTrack.update(raw, now, { mirror, aspect });
  if (dbg.on) {                                             // nothing but the debug view uses the seam yet (S9 will), so it is only built here
    seam = buildSeam({ face, mask: lastMask && maskFresh(now, lastMaskT) ? lastMask : null, aspect, out: seam, hairLayer: true });
    dbg.set('face', `${face.present ? 'tracking' : 'no face'} · conf ${face.conf.toFixed(2)} · ${faceDet.delegate} · every ${faceDet.every} · ${faceDet.avgMs.toFixed(1)} ms`);
    if (face.present) dbg.set('face pose', `yaw ${face.yaw.toFixed(0)} (landmarks ${face.yawLandmarks.toFixed(0)}) pitch ${face.pitch.toFixed(0)} roll ${face.roll.toFixed(0)} · ${face.poseSource} · matrix check ${face.poseVerdict}`);
    dbg.set('seam', `coverage ${(seam.stats.coverage * 100).toFixed(1)}% · hair cut ${(seam.stats.hairCut * 100).toFixed(2)}% · person clip ${(seam.stats.personClip * 100).toFixed(2)}% · mask ${seam.stats.maskUsed ? 'yes' : 'no'} · hair ${seam.stats.hairUsed ? 'yes' : 'no'}`);
  }
}

// ---- hands + gesture ----
const tracker = createHandTracker();
const gesture = createFrameGesture(undefined, (s, prev) => { dbg.set('gesture', `${prev} → ${s}`); setHint(s); });
let handsMs = 0;   // rolling average of one hand detection, shown in the FPS counter
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
  const dt0 = performance.now();
  try { raw = detector.detect(video, ts); errors = 0; handsMs += (performance.now() - dt0 - handsMs) * 0.1; }
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
    if (s === 'running') { const st = $('stage'); st.style.aspectRatio = `${st.width} / ${st.height}`; fx.resize(st.width, st.height); fx.start(); suit.resize(st.width, st.height); suit.setLook(look); suit.setActive(suitWanted()); suit.start(); }
    else { fx.stop(); suit.stop(); }
    if (s === 'running') { tracker.reset(); gesture.reset(); lastVT = -1; lastFaceVT = -1; faceTrack.reset(); if (!detector && !loading) loadDetector(); else if (detector) setHint('idle'); }
  },
  onFrame(canvas, ms, video) {
    const t0 = performance.now();
    detect(video, canvas);
    fx.setTarget(snap);
    suit.setHands(hands);
    camFrames++;
    runSeg(canvas, hands);
    runFace(video, canvas);
    if (dbg.on) { const g = canvas.getContext('2d'); drawOverlay(g, canvas.width, canvas.height, hands, snap); if (faceOn) drawFaceOverlay(g, canvas.width, canvas.height, face, seam); }
    if (dbg.on) dbg.set('suit', `${suit.ok ? (suitWanted() ? 'on' : 'off') : 'WebGL unavailable'} · ${suit.stats.fps} fps · ${suit.stats.ms.toFixed(2)} ms/draw · ${suit.stats.body}`);
    dbg.set('draw+detect ms', (ms + performance.now() - t0).toFixed(1));
    dbg.set('window', fx.stats.ok ? `${fx.stats.phase} · ${fx.stats.fps} fps · ${fx.stats.ms.toFixed(2)} ms/draw${fx.reducedFlash ? ' · calm' : ''}` : 'WebGL unavailable'); dbg.tick();
  },
});

// Start button (S6 startup fix): load every model and warm it up BEHIND a loading screen first, then open the camera, so the picture never freezes while models compile.
let booting = false;
const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
async function boot() {
  if (booting) return; booting = true;
  const say = t => { $('status').textContent = t; }, steps = 1 + (segOff ? 0 : 1) + (faceOn ? 1 : 0); let n = 0;
  document.body.dataset.state = 'loading'; $('start').hidden = true;
  const step = async (label, fn) => { say(`Loading ${label}… (${++n}/${steps}) The first visit takes a few seconds; later visits are quicker.`); await nextPaint(); await fn(); };
  try {
    await step('hand tracking', async () => { if (!detector) await loadDetector(); });
    if (!detector) { say('Hand tracking could not load. Check your connection, then press Start again.'); document.body.dataset.state = 'idle'; $('start').hidden = false; return; }
    if (!segOff) await step('body outline', () => loadSeg());
    if (faceOn) await step('face tracking', () => loadFace());
    say('Warming up…'); await nextPaint();
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); if (g) { g.fillStyle = '#667'; g.fillRect(0, 0, 320, 180); }
    try { detector.detect(c, (lastTs = Math.max(performance.now(), lastTs + 1))); detector.detect(c, (lastTs = Math.max(performance.now(), lastTs + 1))); } catch (e) { console.warn('hand warm-up failed', e); }
    if (faceOn) faceDet.warmUp(c);
    await nextPaint();
    cam.start();
  } finally { booting = false; }
}
$('start').addEventListener('click', boot);
$('mirror').addEventListener('change', e => { mirror = e.target.checked; cam.setMirror(mirror); tracker.reset(); gesture.reset(); fx.setTarget(null); seg.pause(); fx.setMask(null); suit.setMask(null); segActive = false; lastMask = null; faceTrack.reset(); faceDet.pause(); seam = null; });
document.querySelectorAll('[name=look]').forEach(r =>
  r.addEventListener('change', e => { look = e.target.value; dbg.set('look', look); suit.setLook(look); suit.setActive(suitWanted()); if (!suitWanted()) suit.setMask(null); }));
dbg.set('look', look);

// FPS counter (top right of the picture): camera = pictures processed per second, screen = how often the browser redraws the page (drops when the page is lagging). ?fps=off hides it, the checkbox toggles it.
let camFrames = 0, scrFrames = 0, fpsT = performance.now(), lastScr = performance.now(), worstGap = 0, freezes = 0;
const fpsEl = $('fps'), fpsBox = $('showfps');
fpsEl.hidden = qs.get('fps') === 'off'; fpsBox.checked = !fpsEl.hidden;
fpsBox.addEventListener('change', () => { fpsEl.hidden = !fpsBox.checked; });
(function scr(t) {
  scrFrames++;
  const gap = t - lastScr; lastScr = t; if (gap > worstGap) worstGap = gap; if (gap > 500) freezes++;   // a long gap between redraws = the page froze
  if (t - fpsT >= 1000) {
    const s = (t - fpsT) / 1000;
    if (!fpsEl.hidden) fpsEl.textContent = `cam ${Math.round(camFrames / s)} · screen ${Math.round(scrFrames / s)} fps · hands ${handsMs.toFixed(0)} ms${segOff ? '' : ` · seg ${seg.avgMs.toFixed(0)} ms`} · worst gap ${Math.round(worstGap)} ms${freezes ? ` · freezes ${freezes}` : ''}`;
    dbg.set('freezes', `${freezes} (gaps over 500 ms since start)`);
    camFrames = scrFrames = 0; worstGap = 0; fpsT = t;
  }
  requestAnimationFrame(scr);
})(performance.now());

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

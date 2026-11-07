import { createCamera } from './camera.js';
import { createDebug } from './debug.js';
import { LOOKS } from './config.js';

const $ = id => document.getElementById(id);
const dbg = createDebug();
let look = LOOKS[0];

const MESSAGES = {
  idle: 'Allow the camera to begin. Nothing is uploaded; everything runs on your device.',
  requesting: 'Waiting for camera permission…',
  running: '',
  denied: 'Camera access was blocked. Allow it in the browser’s site settings, then press Start again.',
  notfound: 'No camera found. Connect one and press Start again.',
  error: 'Something went wrong starting the camera.',
};

const cam = createCamera({
  video: $('cam'), canvas: $('stage'),
  onState(s, detail) {
    document.body.dataset.state = s;
    $('status').textContent = (MESSAGES[s] || '') + (detail && s !== 'running' ? ` ${detail}` : '');
    $('start').hidden = s === 'running' || s === 'requesting';
    dbg.set('state', s); dbg.set('video', detail);
  },
  onFrame(_c, ms) { dbg.set('draw ms', ms.toFixed(1)); dbg.tick(); },
});

$('start').addEventListener('click', () => cam.start());
$('mirror').addEventListener('change', e => cam.setMirror(e.target.checked));
document.querySelectorAll('[name=look]').forEach(r =>
  r.addEventListener('change', e => { look = e.target.value; dbg.set('look', look); }));
dbg.set('look', look);
if (dbg.on) dbg.render();

import { CAMERA } from './config.js';

// States: idle | requesting | running | denied | notfound | error
export function createCamera({ video, canvas, onState, onFrame }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let stream = null, running = false, mirror = true, handle = 0;

  const setState = (s, detail = '') => onState && onState(s, detail);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) return setState('error', 'Camera needs HTTPS and a modern browser.');
    setState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, frameRate: { ideal: CAMERA.fps } },
      });
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return setState('denied');
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return setState('notfound');
      return setState('error', e.message);
    }
    video.srcObject = stream;
    video.muted = true; video.playsInline = true;
    await video.play();
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    running = true; setState('running', `${video.videoWidth}x${video.videoHeight}`);
    stream.getVideoTracks()[0].addEventListener('ended', () => { stop(); setState('notfound', 'Camera disconnected'); });
    loop();
  }

  function loop() {
    if (!running) return;
    const t0 = performance.now();
    if (video.readyState >= 2) {
      // Draw the camera to a canvas (the <video> stays in the DOM, never display:none).
      ctx.save();
      if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      onFrame && onFrame(canvas, performance.now() - t0);
    }
    handle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle); else cancelAnimationFrame(handle);
    stream?.getTracks().forEach(t => t.stop()); stream = null;
  }

  // Pause when the tab is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) { stop(); setState('idle', 'paused'); }
  });

  return { start, stop, setMirror: v => (mirror = v), get running() { return running; } };
}

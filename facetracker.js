// FaceLandmarker glue (Session 5): loads the model, picks the delegate, runs it on the camera video at a governed cadence
// and hands back plain data for the tracker in facelm.js. All MediaPipe access goes through `api` so tests can inject a fake.
//   const det = createFaceDetector({ onStatus });  await det.load();
//   const raw = det.detect(video);          // undefined = skipped / not ready, null = no face, { pts, matrix } = a face
import { FACE, MODELS, WASM_BASE, BUNDLE_URL } from './config.js';
import { createGovernor } from './segmask.js';
import { normalizeFaceResult } from './facelm.js';
import { isIOS } from './segmenter.js';

// ?facedelegate=cpu|gpu overrides everything (for testing). iOS and iPadOS use the CPU delegate (the GPU path is unreliable there).
export function pickFaceDelegate({ nav = {}, search = '' } = {}) {
  const o = new URLSearchParams(search).get('facedelegate');
  if (o === 'cpu') return 'CPU'; if (o === 'gpu') return 'GPU';
  return isIOS(nav) ? 'CPU' : 'GPU';
}

// Real MediaPipe: a tiny wrapper so the rest of the code only sees { create(delegate) -> model }.
export async function loadFaceApi() {
  const { FilesetResolver, FaceLandmarker } = await import(BUNDLE_URL);
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return { create: delegate => FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODELS.face, delegate }, runningMode: 'VIDEO', ...FACE.options }) };
}

// status: idle | loading | ready | switching | failed
export function createFaceDetector({ loadApi = loadFaceApi, config = FACE, delegate, nav = (typeof navigator !== 'undefined' ? navigator : {}), search = (typeof location !== 'undefined' ? location.search : ''), onStatus = () => {}, now = () => performance.now() } = {}) {
  let api = null, model = null, status = 'idle', used = delegate || pickFaceDelegate({ nav, search }), note = '';
  let lastTs = 0, errors = 0, lastMs = 0, switched = false, detections = 0, empty = 0;
  const gov = createGovernor(config.governor);
  const setStatus = (s, n = '') => { status = s; note = n; onStatus(s, n); };
  const nextTs = () => (lastTs = Math.max(now(), lastTs + 1));   // MediaPipe VIDEO mode needs strictly increasing timestamps

  async function open(d) {
    if (!api) api = await loadApi();
    if (model) { try { model.close && model.close(); } catch { /* ignore */ } model = null; }
    setStatus('loading', `${d} delegate`);
    model = await api.create(d); used = d; errors = 0; gov.reset();
    setStatus('ready', `${d} delegate`);
  }
  // GPU that fails to start falls back to CPU once; CPU failing = failed.
  async function load() {
    let d = used;
    for (;;) {
      try { await open(d); return true; }
      catch (e) { console.error(e); if (d !== 'CPU') { console.warn('face model failed on', d, '- trying CPU'); d = 'CPU'; continue; } setStatus('failed', 'load failed'); return false; }
    }
  }
  async function fallbackToCPU(why) {
    if (switched || used === 'CPU') { setStatus('failed', why); try { model && model.close && model.close(); } catch { /* ignore */ } model = null; return; }
    switched = true; setStatus('switching', 'GPU -> CPU');
    const keep = model; model = null; try { keep && keep.close && keep.close(); } catch { /* ignore */ }
    try { await open('CPU'); setStatus('ready', `CPU delegate · after ${why}`); } catch (e) { console.error(e); setStatus('failed', 'CPU load failed'); }
  }

  function detect(video) {
    if (status !== 'ready' || !model) return undefined;
    if (!gov.tick()) return undefined;
    const t0 = now();
    let res;
    try { res = model.detectForVideo(video, nextTs()); }
    catch (e) { console.error(e); if (++errors >= config.maxErrors) fallbackToCPU('errors'); return undefined; }
    lastMs = now() - t0; gov.report(lastMs);
    if (res && res.faceLandmarks && res.faceLandmarks.length && !(res.faceLandmarks[0] && res.faceLandmarks[0].length >= 468)) {   // landmarks came back in a shape we do not understand
      if (++errors >= config.maxErrors) fallbackToCPU('bad output'); return undefined;
    }
    errors = 0;
    const out = normalizeFaceResult(res);
    if (out) detections++; else empty++;
    return out;                                    // null = the model ran and saw no face
  }

  // warm-up: run the model twice on a flat picture before the camera opens, so GPU shaders are compiled behind the loading screen (does not touch the governor or counters)
  function warmUp(source) { if (status !== 'ready' || !model) return; try { model.detectForVideo(source, nextTs()); model.detectForVideo(source, nextTs()); } catch (e) { console.warn('face warm-up failed', e); } }

  return {
    load, detect, warmUp,
    pause() { gov.reset(); },                      // nobody needs the face for a while: next detection starts a fresh cadence
    close() { try { model && model.close && model.close(); } catch { /* ignore */ } model = null; setStatus('idle'); },
    get status() { return status; }, get note() { return note; }, get delegate() { return used; },
    get every() { return gov.every; }, get avgMs() { return lastMs; }, get detections() { return detections; }, get empty() { return empty; },
  };
}

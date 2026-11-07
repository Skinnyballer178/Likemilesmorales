// ImageSegmenter glue (Session 4): loads the model, picks the delegate, runs the category self-test, and turns each
// camera frame into a smoothed, packed person mask. All MediaPipe access goes through `api` so tests can inject a fake.
//   const seg = createSegmenter({ onStatus });  await seg.load();
//   const mask = seg.process(displayCanvas, nowMs, hands);   // null when not ready / skipped by the governor
import { SEG, MODELS, WASM_BASE, BUNDLE_URL } from './config.js';
import { checkLabels, evaluateFlatTest, flatStats, readLayers, createMaskSmoother, createHandAgreement, createGovernor } from './segmask.js';

// iOS and iPadOS (which reports itself as a Mac with a touch screen) get the CPU delegate: the GPU path is unreliable there.
export function isIOS({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
// ?segdelegate=cpu|gpu overrides everything (for testing).
export function pickDelegate({ nav = {}, search = '' } = {}) {
  const o = new URLSearchParams(search).get('segdelegate');
  if (o === 'cpu') return 'CPU'; if (o === 'gpu') return 'GPU';
  return isIOS(nav) ? 'CPU' : 'GPU';
}

// Real MediaPipe: a tiny wrapper so the rest of the code only sees { create(delegate) -> model }.
export async function loadMediaPipeApi() {
  const { FilesetResolver, ImageSegmenter } = await import(BUNDLE_URL);
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return {
    create: delegate => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS.seg, delegate },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    }),
  };
}

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

// status: idle | loading | testing | ready | switching | suspect | failed
export function createSegmenter({ loadApi = loadMediaPipeApi, makeCanvas = defaultCanvas, config = SEG, delegate, nav = (typeof navigator !== 'undefined' ? navigator : {}), search = (typeof location !== 'undefined' ? location.search : ''), onStatus = () => {}, now = () => performance.now() } = {}) {
  const W = config.inputWidth, H = config.inputHeight, st = config.selfTest;
  const params = new URLSearchParams(search);
  let api = null, model = null, status = 'idle', used = delegate || pickDelegate({ nav, search }), note = '';
  let canvas = null, ctx = null, lastTs = 0, errors = 0, seq = 0, lastMs = 0, lastMask = null, switched = false;
  const smoother = createMaskSmoother(config), agree = createHandAgreement({ minSamples: st.handSamples, agreeMin: st.handAgreeMin, window: st.handWindow }), gov = createGovernor(config.governor);

  const setStatus = (s, n = '') => { status = s; note = n; onStatus(s, n); };
  const nextTs = () => (lastTs = Math.max(now(), lastTs + 1)); // MediaPipe VIDEO mode needs strictly increasing timestamps

  function segment(source, ts) {                // one inference. Returns { layers, w, h } (data copied out of the callback)
    let out = null;
    model.segmentForVideo(source, ts, res => {
      const m = res && res.confidenceMasks;
      if (!m || !m.length) return;
      out = { layers: readLayers(m, config.layers), w: m[0].width, h: m[0].height };
      if (out.layers.person === undefined && config.layers.length) out = null;
    });
    return out;
  }

  // Category self-test. Returns { ok, reason }.
  function selfTest() {
    if (params.get('segtest') === 'off') return { ok: true, reason: 'self-test skipped (?segtest=off)' };
    const lab = typeof model.getLabels === 'function' ? checkLabels(model.getLabels()) : { ok: true, unknown: true, reason: 'labels not available' };
    if (!lab.ok && !lab.unknown) return lab;
    // flat grey picture: must come back as background (catches a wrong category order or a broken GPU path)
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
    let res;
    try { res = segment(canvas, nextTs()); } catch (e) { return { ok: false, reason: 'model error: ' + (e && e.message || e) }; }
    if (!res) return { ok: false, reason: 'model returned no masks' };
    // person = 1 - bg, so bg = 1 - person
    const bg = Float32Array.from(res.layers.person, v => 1 - v);
    return evaluateFlatTest(flatStats(bg, res.w, res.h, W, H), st);
  }

  async function open(d) {
    if (!api) api = await loadApi();
    if (model) { try { model.close && model.close(); } catch { /* ignore */ } model = null; }
    setStatus('loading', `${d} delegate`);
    model = await api.create(d); used = d;
    canvas = canvas || makeCanvas(W, H); ctx = ctx || canvas.getContext('2d');
    smoother.reset(); agree.reset(); errors = 0; lastMask = null;
    setStatus('testing', `${d} delegate`);
    return selfTest();
  }

  // Load with the self-test. GPU that fails the test or fails to start falls back to CPU once; CPU failing = failed.
  async function load() {
    let d = used;
    for (;;) {
      let r;
      try { r = await open(d); } catch (e) { console.error(e); r = { ok: false, reason: 'load failed: ' + (e && e.message || e) }; }
      if (r.ok) { setStatus('ready', `${used} delegate · ${r.reason}`); return true; }
      if (d !== 'CPU') { console.warn('segmenter self-test failed on', d, '-', r.reason, '- trying CPU'); d = 'CPU'; continue; }
      setStatus('failed', r.reason); return false;
    }
  }

  async function fallbackToCPU(why) {            // used at run time (errors, or the hand cross-check disagrees)
    if (switched || used === 'CPU') { setStatus(why === 'suspect' ? 'suspect' : 'failed', why === 'suspect' ? 'mask does not agree with the hand model' : 'model errors'); model && model.close && model.close(); model = null; return; }
    switched = true; setStatus('switching', 'GPU -> CPU');
    const keep = model; model = null; try { keep && keep.close && keep.close(); } catch { /* ignore */ }
    used = 'CPU'; api = api || await loadApi();
    try { const r = await open('CPU'); if (r.ok) setStatus('ready', `CPU delegate · after ${why}`); else setStatus('failed', r.reason); }
    catch (e) { console.error(e); setStatus('failed', 'CPU load failed'); }
  }

  // source: the display canvas (already mirrored). hands: tracker output (display coordinates). Returns the packed mask or null.
  function process(source, tMs, hands) {
    if (status !== 'ready' || !model) return null;
    if (!gov.tick()) return null;
    ctx.drawImage(source, 0, 0, W, H);
    const t0 = now();
    let res;
    try { res = segment(canvas, nextTs()); errors = 0; }
    catch (e) {
      console.error(e);
      if (++errors >= st.maxErrors) fallbackToCPU('errors');
      return null;
    }
    lastMs = now() - t0; gov.report(lastMs);
    if (!res) return null;
    const mask = smoother.update(res.layers, res.w, res.h, tMs);
    agree.add(mask, hands);
    if (agree.verdict === 'suspect') { fallbackToCPU('suspect'); return null; }
    lastMask = mask; return mask;
  }

  return {
    load, process,
    pause() { smoother.reset(); gov.reset(); lastMask = null; },     // window closed for a while: next mask starts fresh
    close() { try { model && model.close && model.close(); } catch { /* ignore */ } model = null; setStatus('idle'); },
    get status() { return status; }, get note() { return note; }, get delegate() { return used; },
    get every() { return gov.every; }, get avgMs() { return lastMs; }, get agreement() { return agree.rate; }, get agreementSamples() { return agree.samples; }, get verdict() { return agree.verdict; },
  };
}

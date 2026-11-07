// Debug panel: enable with ?debug=1
export function createDebug() {
  const on = new URLSearchParams(location.search).has('debug');
  const el = document.getElementById('debug');
  const data = {};
  let last = performance.now(), frames = 0, fps = 0;
  return {
    on,
    set(k, v) { data[k] = v; },
    tick() {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) { fps = frames; frames = 0; last = now; if (on) this.render(); }
    },
    render() {
      el.hidden = false;
      el.textContent = `fps ${fps}\n` + Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
    },
  };
}

// Node loader hook for smoke-main.mjs: the CDN MediaPipe bundle import is redirected to a local fake.
export async function resolve(specifier, context, next) {
  if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@[\d.]+\/vision_bundle\.mjs$/.test(specifier)) {
    return { url: new URL('./smoke-fakebundle.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}

// Regression test for the "no suit appears" bug: config.js pointed at assets/suit.webp while the files live in the repo root, so the fabric request 404'd and nothing was ever drawn.
// Every picture the app loads must exist next to index.html, and the textures must have the size the crop rectangles in TEX say (the shader maps crop -> whole picture).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { TEX } from './config.js';

function webpSize(buf) {                                   // RIFF/WEBP: lossy (VP8), lossless (VP8L) or extended (VP8X)
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF'); assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  throw new Error('unknown webp chunk ' + kind);
}
for (const name of ['suit', 'jacket']) {
  test(`texture ${name}: the url in TEX points at a real file next to index.html, at 2x its crop size`, () => {
    const url = TEX[name].url;
    assert.ok(!/^(\/|[a-z]+:)/i.test(url), 'relative url (works on GitHub Pages project sites)');
    assert.ok(existsSync(new URL('./' + url, import.meta.url)), `${url} must exist (flat repo: no assets/ folder)`);
    const { w, h } = webpSize(readFileSync(new URL('./' + url, import.meta.url)));
    assert.deepEqual([w, h], [TEX[name].crop[2] * 2, TEX[name].crop[3] * 2], `${url} is ${w}x${h}`);
  });
}
test('index.html loads main.js and every file main.js imports exists', () => {
  assert.match(readFileSync(new URL('./index.html', import.meta.url), 'utf8'), /src="main\.js"/);
  for (const m of readFileSync(new URL('./main.js', import.meta.url), 'utf8').matchAll(/from '\.\/([^']+)'/g)) assert.ok(existsSync(new URL('./' + m[1], import.meta.url)), `${m[1]} missing`);
});

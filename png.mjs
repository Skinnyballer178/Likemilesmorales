// Tiny PNG writer for test/preview output (RGBA8, no dependencies).
import { deflateSync, crc32 } from 'node:zlib';
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Premultiplied GL pixels (bottom-up) -> opaque PNG pixels (top-down) composited over a fake "camera" gradient.
export function compositeOverCamera(w, h, px) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, o = (y * w + x) * 4, a = px[s + 3] / 255;
    const bg = [60 + 50 * (x / w), 62 + 40 * (y / h), 70 + 30 * (x / w)];
    for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, px[s + c] + bg[c] * (1 - a));
    out[o + 3] = 255;
  }
  return out;
}

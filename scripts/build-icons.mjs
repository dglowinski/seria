// Draws the app icons as PNG with no dependencies: three bars (the sets) and
// a lime dot. Run: node scripts/build-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x11, 0x14, 0x11]; const INK = [0xf3, 0xf6, 0xed]; const LIME = [0xd0, 0xfa, 0x77];

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

const inRound = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r); const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function draw(size, { maskable }) {
  const S = 4; // samples per axis
  const k = maskable ? 0.74 : 0.92; // content scale inside the 512 design grid
  const px = Buffer.alloc(size * size * 4);
  const shapes = (u, v) => {
    // u, v in the 512 design grid, content centred
    const x = (u - 256) / k + 256; const y = (v - 256) / k + 256;
    if ((x - 344) ** 2 + (y - 362) ** 2 <= 34 * 34) return LIME;
    if (inRound(x, y, 134, 128, 244, 46, 23) || inRound(x, y, 134, 234, 244, 46, 23) || inRound(x, y, 134, 339, 150, 46, 23)) return INK;
    return null;
  };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) {
      const u = ((i + (si + 0.5) / S) / size) * 512; const v = ((j + (sj + 0.5) / S) / size) * 512;
      const inside = maskable || inRound(u, v, 0, 0, 512, 512, 116);
      if (!inside) continue;
      const c = shapes(u, v) || BG;
      r += c[0]; g += c[1]; b += c[2]; a += 1;
    }
    const o = (j * size + i) * 4; const n = S * S;
    px[o] = a ? Math.round(r / a) : 0; px[o + 1] = a ? Math.round(g / a) : 0; px[o + 2] = a ? Math.round(b / a) : 0; px[o + 3] = Math.round((a / n) * 255);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) { raw[j * (size * 4 + 1)] = 0; px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = (name, buf) => { writeFileSync(new URL(`../icons/${name}`, import.meta.url), buf); console.log(name, buf.length, 'bytes'); };
out('icon-192.png', draw(192, {}));
out('icon-512.png', draw(512, {}));
out('icon-maskable-512.png', draw(512, { maskable: true }));
out('icon.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#111411"/><g transform="translate(256 256) scale(.92) translate(-256 -256)"><rect x="134" y="128" width="244" height="46" rx="23" fill="#f3f6ed"/><rect x="134" y="234" width="244" height="46" rx="23" fill="#f3f6ed"/><rect x="134" y="339" width="150" height="46" rx="23" fill="#f3f6ed"/><circle cx="344" cy="362" r="34" fill="#d0fa77"/></g></svg>\n`));

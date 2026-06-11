// Generate AceCue extension icons (16/48/128) as PNGs with no deps.
// Draws the brand gradient rounded square + white chevron, matching favicon.svg.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
// brand gradient endpoints (indigo → teal), matching --brand-gradient
const C1 = [109, 134, 255], C2 = [79, 182, 224];

function render(size) {
  const r = Math.round(size * 0.28); // corner radius
  const px = (x, y) => {
    // rounded-rect mask
    const inX = x >= r && x < size - r, inY = y >= r && y < size - r;
    let inside = true;
    if (!inX && !inY) {
      const cx = x < r ? r : size - 1 - r, cy = y < r ? r : size - 1 - r;
      inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    if (!inside) return [0, 0, 0, 0];
    // diagonal gradient
    const t = (x + y) / (2 * size);
    let col = [lerp(C1[0], C2[0], t), lerp(C1[1], C2[1], t), lerp(C1[2], C2[2], t)];
    // white chevron: two strokes forming ^ ; thickness scales with size
    const th = Math.max(1.2, size * 0.1);
    const apexX = size / 2, apexY = size * 0.30, baseY = size * 0.70;
    // left + right legs of the chevron
    const onLeg = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
      let tt = ((x - x0) * dx + (y - y0) * dy) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const px2 = x0 + tt * dx, py2 = y0 + tt * dy;
      return (x - px2) ** 2 + (y - py2) ** 2 <= (th / 2) ** 2;
    };
    if (onLeg(size * 0.22, baseY, apexX, apexY) || onLeg(apexX, apexY, size * 0.78, baseY)) {
      col = [255, 255, 255];
    }
    return [col[0], col[1], col[2], 255];
  };

  // raw RGBA rows with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r1, g, b, a] = px(x, y);
      raw[o++] = r1; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  return encodePNG(size, size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}
function encodePNG(w, h, raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("extension/icons", { recursive: true });
for (const s of [16, 48, 128]) {
  writeFileSync(`extension/icons/icon${s}.png`, render(s));
  console.log(`wrote extension/icons/icon${s}.png`);
}

// Generates a 1024x1024 PNG app icon (rounded-square, gradient waveform)
// with zero dependencies, then `npx tauri icon` produces all sizes.
import zlib from "node:zlib";
import fs from "node:fs";

const S = 1024;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// gradient: top-left violet -> bottom-right sky blue
const C1 = [167, 139, 250];
const C2 = [56, 189, 248];
const BG = [18, 18, 28];

const radius = 224; // rounded corner radius
const margin = 24; // inner stroke margin

// waveform bars (x-center, half-height) normalized to icon space
const bars = [
  [0.24, 0.11],
  [0.36, 0.22],
  [0.5, 0.34],
  [0.64, 0.22],
  [0.76, 0.11],
];
const barHalfWidth = 0.031;

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    const px = row + 1 + x * 4;
    // rounded-rect mask
    const inX = Math.min(x, S - 1 - x);
    const inY = Math.min(y, S - 1 - y);
    let inside = true;
    if (inX < radius && inY < radius) {
      const dx = radius - inX;
      const dy = radius - inY;
      inside = dx * dx + dy * dy <= radius * radius;
    }
    if (!inside) {
      raw[px + 3] = 0;
      continue;
    }
    // base bg
    let [r, g, b] = BG;
    // diagonal gradient factor
    const t = (x + y) / (2 * S);
    const gr = Math.round(C1[0] + (C2[0] - C1[0]) * t);
    const gg = Math.round(C1[1] + (C2[1] - C1[1]) * t);
    const gb = Math.round(C1[2] + (C2[2] - C1[2]) * t);
    // border ring (margin..margin+10px)
    const edgeX = Math.min(x, S - 1 - x);
    const edgeY = Math.min(y, S - 1 - y);
    const ringD = Math.min(edgeX, edgeY);
    const inRing = ringD >= margin && ringD < margin + 10;
    // waveform bars
    let inBar = false;
    for (const [cx, hh] of bars) {
      if (Math.abs(x / S - cx) <= barHalfWidth && Math.abs(y / S - 0.5) <= hh) {
        inBar = true;
        break;
      }
    }
    if (inRing || inBar) {
      r = gr;
      g = gg;
      b = gb;
    }
    raw[px] = r;
    raw[px + 1] = g;
    raw[px + 2] = b;
    raw[px + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync("app-icon.png", png);
console.log("wrote app-icon.png", png.length, "bytes");

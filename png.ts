// png.ts — a small deterministic PNG encoder, written from scratch.
//
// The entry paints into an RGB buffer (render.ts) and this module turns
// those bytes into a complete PNG: signature, IHDR, one IDAT chunk holding
// zlib-compressed scanlines, and IEND. Every chunk carries its CRC-32.
//
// Determinism notes: the CRC table is built once from the standard
// polynomial; scanline filters are chosen per row by a fixed scoring rule
// (smallest sum of absolute signed bytes, ties broken toward the lower
// filter number); zlib runs at level 9 with a fixed strategy. Given the
// same pixels, the same bytes come out every time — no clock, no random
// source, no environment input anywhere in this module.

import { deflateSync } from 'node:zlib';

// Build the CRC-32 table (polynomial 0xEDB88320) once at module load.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// One PNG chunk: 4-byte big-endian length, 4-byte type, data, 4-byte CRC
// computed over type + data.
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  out.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return out;
}

// Score a filtered scanline the way the PNG spec suggests: sum of the
// absolute values of its bytes read as signed. Lower is better.
function filterScore(row: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < row.length; i++) {
    const signed = row[i] < 128 ? row[i] : row[i] - 256;
    total += signed < 0 ? -signed : signed;
  }
  return total;
}

// Apply one of the five PNG scanline filters to a row (bpp = bytes per
// pixel = 3 for RGB). `prev` is the previous unfiltered row (all zeros
// for the first row).
function applyFilter(filter: number, row: Uint8Array, prev: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    out[i] = (row[i] - predictor) & 0xff;
  }
  return out;
}

// Encode an RGB buffer (width * height * 3 bytes, row-major, no alpha)
// as a complete PNG file.
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const rowBytes = width * 3;
  const filtered = new Uint8Array(height * (rowBytes + 1));
  const zeroRow = new Uint8Array(rowBytes);
  let prev = zeroRow;
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * rowBytes, (y + 1) * rowBytes);
    let bestFilter = 0;
    let bestRow = applyFilter(0, row, prev, 3);
    let bestScore = filterScore(bestRow);
    for (let f = 1; f <= 4; f++) {
      const candidate = applyFilter(f, row, prev, 3);
      const score = filterScore(candidate);
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        bestRow = candidate;
      }
    }
    const offset = y * (rowBytes + 1);
    filtered[offset] = bestFilter;
    filtered.set(bestRow, offset + 1);
    prev = row;
  }

  const compressed = deflateSync(filtered, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour RGB
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

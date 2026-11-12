import { deflateSync } from 'node:zlib';

/** RGBA pixel buffer, row-major, 4 bytes per pixel. */
export interface Bitmap {
  size: number;
  data: Uint8Array;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const ARM_COUNT = 6;
const BRANCH_POSITIONS = [0.45, 0.68] as const;
const BRANCH_LENGTHS = [0.26, 0.18] as const;
const BRANCH_ANGLE = Math.PI / 4;
const SUPERSAMPLE = 4;

function snowflakeSegments(cx: number, cy: number, radius: number): Segment[] {
  const segments: Segment[] = [];
  for (let arm = 0; arm < ARM_COUNT; arm++) {
    const angle = (arm / ARM_COUNT) * Math.PI * 2 - Math.PI / 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    segments.push({ ax: cx, ay: cy, bx: cx + ux * radius, by: cy + uy * radius });
    BRANCH_POSITIONS.forEach((pos, idx) => {
      const px = cx + ux * radius * pos;
      const py = cy + uy * radius * pos;
      const len = radius * BRANCH_LENGTHS[idx];
      for (const side of [-1, 1]) {
        const a = angle + side * BRANCH_ANGLE;
        segments.push({ ax: px, ay: py, bx: px + Math.cos(a) * len, by: py + Math.sin(a) * len });
      }
    });
  }
  return segments;
}

function distanceToSegment(px: number, py: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / lengthSq));
  const qx = s.ax + dx * t - px;
  const qy = s.ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function coverage(px: number, py: number, segments: Segment[], halfWidth: number): number {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const x = px + (sx + 0.5) / SUPERSAMPLE;
      const y = py + (sy + 0.5) / SUPERSAMPLE;
      if (segments.some((s) => distanceToSegment(x, y, s) <= halfWidth)) hits++;
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

function blend(data: Uint8Array, i: number, rgb: readonly [number, number, number], alpha: number): void {
  const dstA = data[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    const v = (rgb[c] * alpha + data[i + c] * dstA * (1 - alpha)) / outA;
    data[i + c] = Math.round(v);
  }
  data[i + 3] = Math.round(outA * 255);
}

/** Small white snowflake on a transparent background (tray icon). */
export function renderTrayIcon(size: number): Bitmap {
  const data = new Uint8Array(size * size * 4);
  const c = size / 2;
  const flake = snowflakeSegments(c, c, size * 0.46);
  const halfWidth = Math.max(0.9, size * 0.055);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const shadow = coverage(x - 0.6, y - 0.8, flake, halfWidth * 1.4);
      if (shadow > 0) blend(data, i, [20, 40, 80], shadow * 0.45);
      const cov = coverage(x, y, flake, halfWidth);
      if (cov > 0) blend(data, i, [255, 255, 255], cov);
    }
  }
  return { size, data };
}

const APP_RADIUS_RATIO = 0.22;
const SNOW_LINE_RATIO = 0.8;

/** Rounded-square application icon: night sky, snowflake, snow drift. */
export function renderAppIcon(size: number): Bitmap {
  const data = new Uint8Array(size * size * 4);
  const radius = size * APP_RADIUS_RATIO;
  const flake = snowflakeSegments(size / 2, size * 0.44, size * 0.3);
  const halfWidth = size * 0.028;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = roundedCoverage(x, y, size, radius);
      if (inside <= 0) continue;
      const t = y / size;
      blend(data, i, [Math.round(22 + 30 * t), Math.round(48 + 50 * t), Math.round(110 + 70 * t)], inside);
      const drift = size * SNOW_LINE_RATIO + Math.sin((x / size) * Math.PI * 2.2) * size * 0.035;
      if (y >= drift) blend(data, i, [236, 243, 252], inside * Math.min(1, (y - drift) / 1.5));
      const cov = coverage(x, y, flake, halfWidth);
      if (cov > 0) blend(data, i, [250, 252, 255], cov * inside);
    }
  }
  return { size, data };
}

function roundedCoverage(x: number, y: number, size: number, radius: number): number {
  const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
  const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return Math.max(0, Math.min(1, radius - d + 0.5));
}

/** Converts RGBA to BGRA (Electron nativeImage.createFromBitmap). */
export function toBgra(bitmap: Bitmap): Buffer {
  const out = Buffer.from(bitmap.data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    out[i] = out[i + 2];
    out[i + 2] = r;
  }
  return out;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BIT_DEPTH = 8;
const PNG_COLOR_RGBA = 6;

export function encodePng(bitmap: Bitmap): Buffer {
  const { size, data } = bitmap;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = PNG_BIT_DEPTH;
  header[9] = PNG_COLOR_RGBA;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

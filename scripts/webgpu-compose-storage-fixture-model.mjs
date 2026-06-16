import { DataUtils } from 'three';

export const WORLD_W = 1600;
export const WORLD_H = 1064;
export const VIEW_W = 525;
export const VIEW_H = 357;
export const SCALE = 2;
export const COMPOSE_PAD = 64;
export const WIN_W = VIEW_W + COMPOSE_PAD * 2;
export const WIN_H = VIEW_H + COMPOSE_PAD * 2;
export const LIGHT_W = (VIEW_W >> 1) + 1;
export const LIGHT_H = (VIEW_H >> 1) + 1;
export const VIG_CX = VIEW_W / 2;
export const VIG_CY = VIEW_H / 2;
export const VIG_MAXR2 = VIG_CX * VIG_CX + VIG_CY * VIG_CY;

export const Cell = {
  Empty: 0,
  Water: 2,
  Lava: 11,
  Stone: 12,
  Metal: 13,
  Crystal: 29,
  Glowshroom: 33,
};

export function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

export function padRows(data, rowBytes, height, paddedRowBytes = align(rowBytes, 256)) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (rowBytes === paddedRowBytes) return bytes;
  const padded = new Uint8Array(paddedRowBytes * height);
  for (let row = 0; row < height; row++) {
    padded.set(bytes.subarray(row * rowBytes, (row + 1) * rowBytes), row * paddedRowBytes);
  }
  return padded;
}

export function unpackPaddedRows(padded, rowBytes, height, paddedRowBytes = align(rowBytes, 256)) {
  if (rowBytes === paddedRowBytes) return new Uint8Array(padded);
  const out = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row++) {
    out.set(padded.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes), row * rowBytes);
  }
  return out;
}

export function setHalf(data, pixelOffset, r, g, b, a) {
  const o = pixelOffset * 4;
  data[o] = DataUtils.toHalfFloat(r);
  data[o + 1] = DataUtils.toHalfFloat(g);
  data[o + 2] = DataUtils.toHalfFloat(b);
  data[o + 3] = DataUtils.toHalfFloat(a);
}

export function putCell(win, x, y, type, color, charged = false) {
  const o = (y * WIN_W + x) * 4;
  win[o] = (color >> 16) & 0xff;
  win[o + 1] = (color >> 8) & 0xff;
  win[o + 2] = color & 0xff;
  win[o + 3] = type | (charged ? 0x80 : 0);
}

export function fixtureCell(vx, vy) {
  if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) {
    return { type: Cell.Empty, color: 0x05070c, charged: false };
  }
  if (vy > 238) return { type: Cell.Stone, color: 0x646b72, charged: false };
  if (vx >= 54 && vx <= 126 && vy >= 132 && vy <= 220) {
    return { type: Cell.Metal, color: 0x607080, charged: vx >= 82 && vx <= 112 && vy >= 164 && vy <= 190 };
  }
  if (vx >= 142 && vx <= 198 && vy >= 172 && vy <= 236) {
    return { type: Cell.Lava, color: 0xfc3c08, charged: false };
  }
  if (vx >= 226 && vx <= 268 && vy >= 118 && vy <= 202) {
    return { type: Cell.Water, color: 0x1e8ce6, charged: false };
  }
  if (((vx - 320) * (vx - 320)) / 1600 + ((vy - 178) * (vy - 178)) / 900 < 1) {
    return { type: Cell.Crystal, color: 0x7fd4e8, charged: false };
  }
  if (vx >= 388 && vx <= 430 && vy >= 184 && vy <= 236) {
    return { type: Cell.Glowshroom, color: 0x59d98f, charged: false };
  }
  return { type: Cell.Empty, color: 0x05070c, charged: false };
}

export function makeWorldWindow() {
  const win = new Uint8Array(WIN_W * WIN_H * 4);
  for (let y = 0; y < WIN_H; y++) {
    for (let x = 0; x < WIN_W; x++) {
      const vx = x - COMPOSE_PAD;
      const vy = y - COMPOSE_PAD;
      const cell = fixtureCell(vx, vy);
      putCell(win, x, y, cell.type, cell.color, cell.charged);
    }
  }
  return win;
}

export function makeLightField() {
  const data = new Float32Array(LIGHT_W * LIGHT_H * 4);
  for (let y = 0; y < LIGHT_H; y++) {
    for (let x = 0; x < LIGHT_W; x++) {
      const dx = x - 90;
      const dy = y - 80;
      const hot = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 80);
      const o = (y * LIGHT_W + x) * 4;
      data[o] = 0.28 + hot * 1.45 + (x / LIGHT_W) * 0.18;
      data[o + 1] = 0.24 + hot * 0.72 + (y / LIGHT_H) * 0.12;
      data[o + 2] = 0.31 + hot * 0.28;
      data[o + 3] = 1;
    }
  }
  return data;
}

export function makeLut() {
  const data = new Float32Array(256);
  data[Cell.Lava] = 1.25;
  data[Cell.Crystal] = 0.8;
  data[Cell.Glowshroom] = 0.9;
  return data;
}

export function makeOverlay() {
  const data = new Uint16Array(VIEW_W * VIEW_H * 4);
  for (let y = 70; y < 104; y++) {
    for (let x = 40; x < 116; x++) setHalf(data, y * VIEW_W + x, 1.0, 0.16, 0.04, 1.0);
  }
  for (let y = 120; y < 154; y++) {
    for (let x = 182; x < 310; x++) setHalf(data, y * VIEW_W + x, 0.02, 0.12, 0.42, 0.0);
  }
  return data;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

export function composePixelCpu(win, light, lut, overlay, col, rowB) {
  const vx = col;
  const vy = VIEW_H - 1 - rowB;
  const overlayOffset = (rowB * VIEW_W + col) * 4;
  const ovR = DataUtils.fromHalfFloat(overlay[overlayOffset]);
  const ovG = DataUtils.fromHalfFloat(overlay[overlayOffset + 1]);
  const ovB = DataUtils.fromHalfFloat(overlay[overlayOffset + 2]);
  const ovA = DataUtils.fromHalfFloat(overlay[overlayOffset + 3]);
  let r = 0;
  let g = 0;
  let b = 0;

  if (ovA <= 0.5) {
    const winOffset = ((vy + COMPOSE_PAD) * WIN_W + (vx + COMPOSE_PAD)) * 4;
    const typeByte = win[winOffset + 3];
    const type = typeByte & 0x7f;
    const charged = (typeByte & 0x80) !== 0;
    const li = ((vy >> 1) * LIGHT_W + (vx >> 1)) * 4;
    const lr = light[li];
    const lg = light[li + 1];
    const lb = light[li + 2];
    const dx = vx - VIG_CX;
    const dy = vy - VIG_CY;
    const vg = 1 - 0.52 * ((dx * dx + dy * dy) / VIG_MAXR2);

    if (type === Cell.Empty) {
      r = 0.004;
      g = 0.005;
      b = 0.009;
      const depthShade = 0.78 + 0.22 * (1 - (480 + vy) / WORLD_H);
      r *= depthShade;
      g *= depthShade;
      b *= depthShade;
      let lf0 = Math.min(2.2, lr) * vg;
      r = (r * 0.62 + 0.16 * 0.022) * vg + r * lf0 * lf0 * 0.72;
      lf0 = Math.min(2.2, lg) * vg;
      g = (g * 0.62 + 0.16 * 0.022) * vg + g * lf0 * lf0 * 0.72;
      lf0 = Math.min(2.2, lb) * vg;
      b = (b * 0.62 + 0.16 * 0.032) * vg + b * lf0 * lf0 * 0.72;
      r += Math.max(0, lr - 0.25) * 0.045 * vg;
      g += Math.max(0, lg - 0.25) * 0.04 * vg;
      b += Math.max(0, lb - 0.25) * 0.035 * vg;
    } else {
      r = win[winOffset] / 255;
      g = win[winOffset + 1] / 255;
      b = win[winOffset + 2] / 255;
      const scalar = lut[type] ?? 0;
      let intensity = 1 + (1.65 - 1) * scalar;
      if (charged) {
        r = 0.2;
        g = 0.75;
        b = 1.0;
        intensity = 1.65 * 1.2;
      }
      const floor = 0.06 * vg;
      const selfGlow = scalar > 0 ? 0.45 + scalar * 1.55 : 0;
      let lf = (0.16 + Math.min(2.2, lr)) * vg;
      let lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      r = r * Math.max(lit, selfGlow) + r * floor;
      lf = (0.16 + Math.min(2.2, lg)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      g = g * Math.max(lit, selfGlow) + g * floor;
      lf = (0.16 + Math.min(2.2, lb)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = Math.min(2.0, 1.25 + (lit - 1.25) * 0.3);
      b = b * Math.max(lit, selfGlow) + b * floor;
      r *= intensity;
      g *= intensity;
      b *= intensity;
    }
  }

  return [toByte(r + ovR), toByte(g + ovG), toByte(b + ovB), 255];
}

export function composeReference(win, light, lut, overlay) {
  const out = new Uint8Array(VIEW_W * VIEW_H * 4);
  const start = performance.now();
  for (let rowB = 0; rowB < VIEW_H; rowB++) {
    for (let col = 0; col < VIEW_W; col++) {
      out.set(composePixelCpu(win, light, lut, overlay, col, rowB), (rowB * VIEW_W + col) * 4);
    }
  }
  return { data: out, ms: performance.now() - start };
}

export function compareReadback(expected, actual, tolerance = 2) {
  let exact = 0;
  let big = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  const samples = [];
  for (let i = 0; i < expected.length; i += 4) {
    const d0 = Math.abs(expected[i] - actual[i]);
    const d1 = Math.abs(expected[i + 1] - actual[i + 1]);
    const d2 = Math.abs(expected[i + 2] - actual[i + 2]);
    const d3 = Math.abs(expected[i + 3] - actual[i + 3]);
    const m = Math.max(d0, d1, d2, d3);
    if (m === 0) exact++;
    if (m > tolerance) {
      big++;
      if (samples.length < 12) {
        const p = i / 4;
        samples.push({
          x: p % VIEW_W,
          y: Math.floor(p / VIEW_W),
          expected: Array.from(expected.slice(i, i + 4)),
          actual: Array.from(actual.slice(i, i + 4)),
          maxDelta: m,
        });
      }
    }
    maxDelta = Math.max(maxDelta, m);
    sumDelta += d0 + d1 + d2 + d3;
  }
  const pixels = expected.length / 4;
  return {
    exactPct: (exact / pixels) * 100,
    bigPct: (big / pixels) * 100,
    meanDelta: sumDelta / expected.length,
    maxDelta,
    samples,
  };
}

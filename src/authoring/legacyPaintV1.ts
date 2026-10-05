import { clamp, hash2, valueNoise } from '@/core/math';
import { Cell } from '@/sim/CellType';
import type { ColorOverrides } from '@/sim/ColorOverrides';
import { EMPTY_COLOR, packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';
import { materialColorAt, type LegacyPaintV1, type PaintGrid } from '@/sim/worldPaint';

/**
 * PAINT VERSION 1, FROZEN. The repaint the world-layer codec used before the
 * shared paint (sim/worldPaint) existed, kept so a layer captured then (a Builder
 * document, a saved share code) decodes to the colours it was captured against:
 * its sparse overrides were computed relative to exactly this.
 *
 * Nothing here may change, and nothing here may import code that can: the
 * biome palette, the crown stage and the walk-surface dressing are copied as
 * they were on 2026-10-04 (config/biomes, world/crownPalette,
 * world/surfaceDress at 6cba7e8). tests/world-layer-legacy.test.ts decodes
 * layers recorded by the version-1 codec and checks every colour.
 *
 * One deliberate difference: version 1 drew the colour of a cell that was not
 * rock from the fx stream, so it was never reproducible and every such cell in
 * a version-1 layer travelled as an override. Here it is the material's natural
 * colour by position: the same where an override covers it (always, but for a
 * chance match), deterministic where none does.
 */

type Rgb = readonly [number, number, number];
type Crown = 'moss' | 'frost' | 'ember';

const V1_BIOMES: Record<string, { bands: readonly [Rgb, Rgb, Rgb, Rgb]; crown: Crown; flowerChance: number }> = {
  earthen: { bands: [[130, 90, 50], [104, 80, 50], [84, 102, 138], [132, 140, 158]], crown: 'moss', flowerChance: 0.02 },
  frozen: { bands: [[78, 96, 126], [150, 166, 190], [96, 134, 184], [192, 206, 226]], crown: 'frost', flowerChance: 0.015 },
  flooded: { bands: [[92, 76, 48], [72, 62, 42], [70, 92, 106], [82, 108, 88]], crown: 'moss', flowerChance: 0.035 },
  timber: { bands: [[116, 84, 48], [126, 96, 60], [96, 86, 70], [86, 112, 76]], crown: 'moss', flowerChance: 0.05 },
  fungal: { bands: [[64, 84, 62], [52, 72, 58], [48, 96, 88], [88, 128, 104]], crown: 'moss', flowerChance: 0.04 },
  crystal: { bands: [[58, 66, 86], [44, 50, 68], [78, 96, 120], [96, 82, 116]], crown: 'frost', flowerChance: 0.012 },
  volcanic: { bands: [[48, 40, 40], [66, 44, 38], [96, 48, 34], [120, 66, 40]], crown: 'ember', flowerChance: 0 },
  scorched: { bands: [[62, 56, 52], [42, 38, 35], [88, 62, 45], [112, 72, 40]], crown: 'ember', flowerChance: 0 },
  gilded: { bands: [[96, 78, 44], [70, 56, 34], [124, 96, 48], [148, 118, 62]], crown: 'ember', flowerChance: 0.01 },
};

/** A version-1 biome id the frozen table knows. */
export function isLegacyBiome(value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(V1_BIOMES, value);
}

/** Version 1's paint seed for a layer that carried none. */
export function legacyFallbackSeed(seed: number | undefined, biome: string): number {
  const s = Number.isFinite(seed) ? (seed as number) >>> 0 : 0;
  return Math.floor(hash2(s & 0xffff, (s >>> 16) ^ biome.length, 0x51f15e) * 100000);
}

/**
 * Version 1's repaint of `grid` into `out`. Like version 1, the dressed walk
 * surface is registered in `scars` when one is given (the live world on a
 * decode; version 1 flagged those cells, and a capture re-sent them).
 */
export function paintLegacyV1(grid: PaintGrid, paint: LegacyPaintV1, out: Uint32Array, scars: ColorOverrides | null): void {
  const { types, width: W, height: H } = grid;
  const B = V1_BIOMES[paint.biome] ?? V1_BIOMES.earthen;
  const seed = Math.floor(paint.seed);
  const n = W * H;
  const dist = new Uint8Array(n).fill(99);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = x + y * W;
      if (types[i] !== Cell.Wall) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
  }
  const enqueue = (i: number, d: number): void => {
    if (types[i] !== Cell.Wall || dist[i] <= d) return;
    dist[i] = d;
    queue[tail++] = i;
  };
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    if (d > 13) continue;
    const x = i % W;
    if (x + 1 < W) enqueue(i + 1, d);
    if (x > 0) enqueue(i - 1, d);
    if (i + W < n) enqueue(i + W, d);
    if (i >= W) enqueue(i - W, d);
  }

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = x + y * W;
      const t = types[i];
      if (t === Cell.Empty) out[i] = EMPTY_COLOR;
      else if (t === Cell.Wall) out[i] = wallColorV1(x, y, dist[i], seed, B.bands);
      else out[i] = materialColorAt(t, x, y, seed);
    }
  }

  for (let x = 0; x < W; x++) {
    for (let y = 1; y < H - 1; y++) {
      const i = x + y * W;
      if (types[i] !== Cell.Wall) continue;
      const topish = types[i - W] === Cell.Empty && (y < 2 || types[i - 2 * W] === Cell.Empty);
      const nbTop = (xx: number): boolean =>
        xx >= 0 && xx < W && types[xx + y * W] === Cell.Wall && types[xx + (y - 1) * W] === Cell.Empty;
      if (topish && (nbTop(x - 1) || nbTop(x + 1))) {
        out[i] = crownTopV1(x, y, seed, B.crown, B.flowerChance);
        if (B.crown === 'moss') {
          if (types[i + W] === Cell.Wall) out[i + W] = mossUnderV1(x, seed);
          if (y + 2 < H && types[i + 2 * W] === Cell.Wall) {
            const c = crownDeepV1(out[i + 2 * W], x, y, seed, B.crown);
            if (c !== null) out[i + 2 * W] = c;
          }
        } else if (B.crown === 'frost' && types[i + W] === Cell.Wall) {
          const c = crownDeepV1(out[i + W], x, y, seed, B.crown);
          if (c !== null) out[i + W] = c;
        }
      } else if (types[i + W] === Cell.Empty && types[x + Math.min(H - 1, y + 2) * W] === Cell.Empty) {
        const c = crownFringeV1(out[i], x, y, seed, B.crown);
        if (c !== null) out[i] = c;
      }
    }
  }

  // The walk-surface dressing (minY 2, floor band H - 52).
  if (B.crown === 'ember') return;
  const maxY = Math.min(H - 52, H - 1);
  for (let x = 0; x < W; x++) {
    for (let y = 3; y < maxY; y++) {
      const i = x + y * W;
      if (types[i] !== Cell.Wall) continue;
      if (types[i - W] !== Cell.Empty || types[i - 2 * W] !== Cell.Empty) continue;
      if (B.crown === 'frost') {
        out[i] = packRGB(206, 220, 238);
        scars?.add(i);
        continue;
      }
      const hr = hash2(x, y, seed + 131);
      if (hr < B.flowerChance) out[i] = packRGB(214, 96, 150);
      else if (hr < B.flowerChance + 0.06) out[i] = packRGB(206, 186, 84);
      else
        out[i] = packRGB(
          48 + Math.floor(hash2(x, 7, seed) * 30),
          120 + Math.floor(hash2(x, 8, seed) * 56),
          40 + Math.floor(hash2(x, 9, seed) * 26),
        );
      scars?.add(i);
      for (let d = 1; d <= 3; d++) {
        const ii = i + d * W;
        if (types[ii] !== Cell.Wall) break;
        const v = hash2(x, y + d, seed + 211);
        const k = Math.min(3, Math.max(0, (y + d) % 4)) * 6;
        out[ii] = packRGB(96 + Math.floor(v * 24) - k, 64 + Math.floor(v * 16) - k, 40 + Math.floor(v * 12) - k);
        scars?.add(ii);
      }
    }
  }
}

function wallColorV1(x: number, y: number, dist: number, seed: number, bands: readonly [Rgb, Rgb, Rgb, Rgb]): number {
  let m = valueNoise(x, y, 0.014, seed);
  m = clamp((m - 0.5) * 2.1 + 0.5, 0, 1);
  const grain = 0.85 + valueNoise(x, y, 0.12, seed + 5) * 0.3;
  const band = m < 0.4 ? bands[0] : m < 0.58 ? bands[1] : m < 0.84 ? bands[2] : bands[3];
  const shade = dist <= 2 ? 1.08 : dist <= 4 ? 0.88 : dist <= 6 ? 0.7 : dist <= 8 ? 0.58 : dist <= 10 ? 0.5 : 0.44;
  const jit = 0.92 + hash2(x, y, seed + 11) * 0.16;
  return packRGB(
    Math.min(255, Math.floor(band[0] * grain * shade * jit)),
    Math.min(255, Math.floor(band[1] * grain * shade * jit)),
    Math.min(255, Math.floor(band[2] * grain * shade * jit)),
  );
}

function crownTopV1(x: number, y: number, seed: number, crown: Crown, flowerChance: number): number {
  const t = hash2(x, y, seed + 21);
  if (crown === 'frost') {
    if (t < flowerChance) return packRGB(165, 215, 255);
    return packRGB(
      192 + Math.floor(hash2(x, 0, seed) * 40),
      206 + Math.floor(hash2(x, 1, seed) * 34),
      228 + Math.floor(hash2(x, 2, seed) * 27),
    );
  }
  if (crown === 'ember') {
    if (t < 0.06) return packRGB(255, 110 + Math.floor(hash2(x, 1, seed) * 70), 22);
    return packRGB(
      68 + Math.floor(hash2(x, 0, seed) * 22),
      60 + Math.floor(hash2(x, 1, seed) * 16),
      54 + Math.floor(hash2(x, 2, seed) * 12),
    );
  }
  if (t < flowerChance) return packRGB(212, 118, 166);
  if (t < flowerChance + 0.05) return packRGB(194, 176, 86);
  return packRGB(
    54 + Math.floor(hash2(x, 0, seed) * 26),
    126 + Math.floor(hash2(x, 1, seed) * 48),
    42 + Math.floor(hash2(x, 2, seed) * 22),
  );
}

function mossUnderV1(x: number, seed: number): number {
  return packRGB(
    44 + Math.floor(hash2(x, 3, seed) * 22),
    104 + Math.floor(hash2(x, 4, seed) * 40),
    36 + Math.floor(hash2(x, 5, seed) * 18),
  );
}

function crownDeepV1(c: number, x: number, y: number, seed: number, crown: Crown): number | null {
  if (crown === 'frost') {
    if (hash2(x, y, seed + 23) >= 0.5) return null;
    return packRGB(
      Math.floor(unpackR(c) * 0.85 + 18),
      Math.floor(unpackG(c) * 0.88 + 22),
      Math.min(255, Math.floor(unpackB(c) * 0.9 + 32)),
    );
  }
  if (crown === 'moss') {
    if (hash2(x, y, seed + 23) >= 0.6) return null;
    return packRGB(
      Math.floor(unpackR(c) * 0.7),
      Math.min(255, Math.floor(unpackG(c) * 0.85 + 26)),
      Math.floor(unpackB(c) * 0.7),
    );
  }
  return null;
}

function crownFringeV1(c: number, x: number, y: number, seed: number, crown: Crown): number | null {
  if (crown === 'ember') return null;
  if (hash2(x, y, seed + 29) >= 0.22) return null;
  if (crown === 'frost') {
    return packRGB(
      Math.floor(unpackR(c) * 0.9 + 14),
      Math.floor(unpackG(c) * 0.92 + 18),
      Math.min(255, Math.floor(unpackB(c) * 0.95 + 28)),
    );
  }
  return packRGB(
    Math.floor(unpackR(c) * 0.75),
    Math.min(255, Math.floor(unpackG(c) * 0.9 + 18)),
    Math.floor(unpackB(c) * 0.75),
  );
}

import type { BiomeCrown } from '@/core/types';
import { clamp, hash2, valueNoise } from '@/core/math';
import { blocksEntity, Cell } from '@/sim/CellType';
import {
  COLOR_FN,
  EMPTY_COLOR,
  TINT_PALETTES,
  packRGB,
  setTintSource,
  unpackB,
  unpackG,
  unpackR,
} from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * WORLD PAINT (docs/split/SPLIT-PLAN.md D14): the colour every cell is born
 * with, as a pure function of the final grid and a small descriptor.
 *
 * The generator and the receiver of a world call the SAME `paintCells`. The
 * generator paints the finished grid once, at the very end (settleGenerationPaint),
 * so its output is this function's output by construction; the world-layer codec
 * (authoring/worldLayer) paints the received grid with it and applies only the
 * cells that differ: authored colours, scars, cells the sim has moved since. A
 * world therefore travels as its cells (~75 KB), and the two sides cannot drift,
 * because there is no second copy of the paint to drift from.
 *
 * What the paint may read: the cell types, the cell's position, and the
 * descriptor. Never an intermediate generation state, never a random stream.
 * A colour feature that once came from generation state is re-expressed here:
 * rock shading uses the distance to open space in the FINAL grid, and the
 * cobbled texture the old porous skeleton left in the rock comes from a
 * seeded pore field (`pores`), a function of position and seed alone.
 *
 * Materials other than rock wear their own palette from sim/colors, drawn from
 * a per-cell position hash instead of the fx stream (`materialColorAt`), so a
 * pool of water or a pocket of gold is reproducible too, and there is still one
 * palette definition.
 *
 * The descriptor carries the biome's palette data (bands, crown, pores), not a
 * biome id, so a world saved today repaints the same after a biome is retuned.
 * Changing what this module paints for a given descriptor changes every saved
 * world's base colours: bump PAINT_VERSION and keep the old version decodable
 * (authoring/legacyPaintV1 is how version 1 is kept).
 */

export const PAINT_VERSION = 2;

export type PaintRgb = readonly [number, number, number];

/** Generated cave rock: biome bands, rim light, crowns and dressed ground. */
export interface StrataPaint {
  v: 2;
  style: 'strata';
  seed: number;
  bands: readonly [PaintRgb, PaintRgb, PaintRgb, PaintRgb];
  crown: BiomeCrown;
  flowerChance: number;
  /** The seeded pore texture (a porous skeleton's look), or none for smooth rock. */
  pores: { density: number; smooth: number } | null;
  /** Metal in the bottom rows is bedrock (campaign floors): 0 for none. */
  bedrockRows: number;
}

/** Matte mineral beds with seams and chalk lips (the Breathing Works): Stone, and Metal in the frame. */
export interface BedsPaint {
  v: 2;
  style: 'beds';
  seed: number;
  /** Width of the metal frame round the world, painted as rock. */
  frame: number;
}

/** No generated rock: every material wears its natural palette. */
export interface PlainPaint {
  v: 2;
  style: 'plain';
  seed: number;
}

export type WorldPaint = StrataPaint | BedsPaint | PlainPaint;

/** A world restored from a version-1 layer keeps that layer's repaint (authoring/legacyPaintV1). */
export interface LegacyPaintV1 {
  v: 1;
  seed: number;
  biome: string;
}

export type AnyWorldPaint = WorldPaint | LegacyPaintV1;

export const PLAIN_PAINT: PlainPaint = { v: 2, style: 'plain', seed: 0 };

/** The grid a paint reads: types and size. A World satisfies it. */
export interface PaintGrid {
  types: Uint8Array;
  width: number;
  height: number;
}

/** Air, gas, fire, liquids and soft growth: what a face is open to. */
const OPEN = new Uint8Array(256);
for (let t = 0; t < 256; t++) OPEN[t] = blocksEntity(t) ? 0 : 1;

/** Rim light: open space within 13 cells lights the rock. */
const RIM_REACH = 13;

/* ------------------------------------------------------------------------ */
/* The per-cell tint stream: the palettes' draws, from position and seed.   */
/* ------------------------------------------------------------------------ */

let streamX = 0;
let streamY = 0;
let streamSeed = 0;
let streamK = 0;

function cellStream(): number {
  let h = Math.imul(streamX, 0x27d4eb2d) ^ Math.imul(streamY, 0x165667b1) ^ Math.imul(streamSeed, 0x9e3779b1);
  h ^= Math.imul(++streamK, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Natural colour of a material at a cell; the cell stream must be the tint source. */
function naturalAt(type: number, x: number, y: number, seed: number): number {
  if (type === Cell.Empty) return EMPTY_COLOR;
  const fn = COLOR_FN[type];
  if (!fn) return EMPTY_COLOR;
  streamX = x;
  streamY = y;
  streamSeed = seed;
  streamK = 0;
  return fn();
}

/** A material's natural colour at (x, y): its sim/colors palette, drawn from the position. */
export function materialColorAt(type: number, x: number, y: number, seed: number): number {
  const restore = setTintSource(cellStream);
  try {
    return naturalAt(type, x, y, seed);
  } finally {
    setTintSource(restore);
  }
}

/* ------------------------------------------------------------------------ */
/* The paint.                                                               */
/* ------------------------------------------------------------------------ */

/** Paint every cell of `grid` into `out` (length width*height). Pure: reads only the types and the descriptor. */
export function paintCells(grid: PaintGrid, paint: WorldPaint, out: Uint32Array): void {
  const restore = setTintSource(cellStream);
  try {
    if (paint.style === 'strata') paintStrata(grid, paint, out);
    else if (paint.style === 'beds') paintBeds(grid, paint, out);
    else paintMaterials(grid, paint.seed, out);
  } finally {
    setTintSource(restore);
  }
}

function paintMaterials(grid: PaintGrid, seed: number, out: Uint32Array): void {
  const { types, width: W, height: H } = grid;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = x + y * W;
      out[i] = naturalAt(types[i], x, y, seed);
    }
  }
}

function paintStrata(grid: PaintGrid, p: StrataPaint, out: Uint32Array): void {
  const { types, width: W, height: H } = grid;
  const n = W * H;
  const seed = p.seed;
  const pore = p.pores ? poreField(W, H, seed, p.pores.density, p.pores.smooth) : null;

  // Distance to open space or a pore, capped: the rim light. A pore is the
  // ghost of the porous skeleton's air, so the rock between them reads cobbled
  // and lit the way it did before the skeleton's holes were filled.
  const dist = new Uint8Array(n).fill(99);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (OPEN[types[i]] || (pore !== null && pore[i])) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    if (d > RIM_REACH) continue;
    const x = i % W;
    if (x + 1 < W && dist[i + 1] > d) { dist[i + 1] = d; queue[tail++] = i + 1; }
    if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; queue[tail++] = i - 1; }
    if (i + W < n && dist[i + W] > d) { dist[i + W] = d; queue[tail++] = i + W; }
    if (i >= W && dist[i - W] > d) { dist[i - W] = d; queue[tail++] = i - W; }
  }

  const bedTop = H - p.bedrockRows;
  const bands = p.bands;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = x + y * W;
      const t = types[i];
      if (t === Cell.Wall) out[i] = rockColor(x, y, dist[i], seed, bands);
      else if (t === Cell.Metal && y >= bedTop) out[i] = bedrockColor(x, y, seed);
      else if (t === Cell.Wood) out[i] = plankColor(types, i, x, W);
      else out[i] = naturalAt(t, x, y, seed);
    }
  }

  // Crowns and ceiling fringe, against open space OR a pore (the old crown
  // stage ran on the porous skeleton, so moss and flowers fleck the rock).
  const air = (i: number): boolean => OPEN[types[i]] === 1 || (pore !== null && pore[i] === 1);
  const rock = (i: number): boolean => !air(i);
  const paintable = (i: number): boolean => types[i] === Cell.Wall && (pore === null || pore[i] === 0);
  /** A neighbouring top: rock at (xx, y) with air over it. */
  const nbTop = (xx: number, y: number): boolean => xx >= 0 && xx < W && rock(xx + y * W) && air(xx + (y - 1) * W);
  const crown = p.crown;
  for (let x = 0; x < W; x++) {
    for (let y = 1; y < H - 1; y++) {
      const i = x + y * W;
      if (!paintable(i)) continue;
      const topish = air(i - W) && (y < 2 || air(i - 2 * W));
      if (topish && (nbTop(x - 1, y) || nbTop(x + 1, y))) {
        out[i] = crownTopColor(x, y, seed, crown, p.flowerChance);
        if (crown === 'moss') {
          if (paintable(i + W)) out[i + W] = mossUnderColor(x, seed);
          if (y + 2 < H && paintable(i + 2 * W)) {
            const c = crownDeepTint(out[i + 2 * W], x, y, seed, crown);
            if (c !== null) out[i + 2 * W] = c;
          }
        } else if (crown === 'frost' && paintable(i + W)) {
          const c = crownDeepTint(out[i + W], x, y, seed, crown);
          if (c !== null) out[i + W] = c;
        }
      } else if (air(i + W) && air(x + Math.min(H - 1, y + 2) * W)) {
        const c = crownFringeTint(out[i], x, y, seed, crown);
        if (c !== null) out[i] = c;
      }
    }
  }

  // The pores fill the way the polish passes filled the skeleton's holes: ring
  // by ring from the rock round them, each cell the weighted average of its
  // solid neighbours (heaviest below), so a crown bleeds into the cobble over it.
  if (pore !== null) fillPores(types, W, H, pore, seed, out);

  // Dressed ground on every real walkable ledge (rock with two open cells above).
  if (crown === 'ember') return;
  for (let x = 0; x < W; x++) {
    for (let y = 3; y < H - 1; y++) {
      const i = x + y * W;
      if (types[i] !== Cell.Wall) continue;
      if (!OPEN[types[i - W]] || !OPEN[types[i - 2 * W]]) continue;
      if (crown === 'frost') {
        out[i] = packRGB(206, 220, 238); // snow cap
        continue;
      }
      const hr = hash2(x, y, seed + 131);
      if (hr < p.flowerChance) out[i] = packRGB(214, 96, 150); // pink flower
      else if (hr < p.flowerChance + 0.06) out[i] = packRGB(206, 186, 84); // yellow flower
      else out[i] = grassTopColor(x, seed);
      for (let d = 1; d <= 3; d++) {
        const ii = i + d * W;
        if (ii >= n || types[ii] !== Cell.Wall) break;
        out[ii] = dirtColor(x, y + d, seed);
      }
    }
  }
}

/** Banded rock, grained, lit by its distance to open space. */
function rockColor(x: number, y: number, d: number, seed: number, bands: StrataPaint['bands']): number {
  let m = valueNoise(x, y, 0.014, seed);
  m = clamp((m - 0.5) * 2.1 + 0.5, 0, 1);
  const grain = 0.85 + valueNoise(x, y, 0.12, seed + 5) * 0.3;
  const band = m < 0.4 ? bands[0] : m < 0.58 ? bands[1] : m < 0.84 ? bands[2] : bands[3];
  const shade = d <= 2 ? 1.08 : d <= 4 ? 0.88 : d <= 6 ? 0.7 : d <= 8 ? 0.58 : d <= 10 ? 0.5 : 0.44;
  const jit = 0.92 + hash2(x, y, seed + 11) * 0.16;
  return packRGB(
    Math.min(255, Math.floor(band[0] * grain * shade * jit)),
    Math.min(255, Math.floor(band[1] * grain * shade * jit)),
    Math.min(255, Math.floor(band[2] * grain * shade * jit)),
  );
}

/** The terrain a filled hole samples (terrainPolish's solid set). */
const FILL_SOLID = new Uint8Array(256);
for (const t of [Cell.Wall, Cell.Stone, Cell.Ice, Cell.Moss, Cell.Fungus, Cell.Glowshroom, Cell.Crystal, Cell.Glass]) FILL_SOLID[t] = 1;

/** [dx, dy, weight]: below weighs most, as in terrainPolish's sampler. */
const FILL_SAMPLES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 4], [-1, 0, 3], [1, 0, 3], [-1, 1, 2], [1, 1, 2], [0, -1, 1], [-1, -1, 1], [1, -1, 1],
];

/** How much of its own rock colour a filled pore keeps, against up to 17 of its neighbours. */
const FILL_SELF = 6;

function fillPores(types: Uint8Array, W: number, H: number, pore: Uint8Array, seed: number, out: Uint32Array): void {
  const n = W * H;
  // 1 = may be sampled: solid terrain that is not an unfilled pore.
  const solid = new Uint8Array(n);
  let pending: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!FILL_SOLID[types[i]]) continue;
    if (pore[i] && types[i] === Cell.Wall) pending.push(i);
    else solid[i] = 1;
  }
  const ring: number[] = [];
  const colors: number[] = [];
  for (let pass = 0; pass < 64 && pending.length > 0; pass++) {
    ring.length = 0;
    colors.length = 0;
    const next: number[] = [];
    for (const i of pending) {
      const x = i % W;
      const y = (i - x) / W;
      let r = 0, g = 0, b = 0, weight = 0;
      for (const [dx, dy, w] of FILL_SAMPLES) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || X >= W || Y < 0 || Y >= H) continue;
        const j = X + Y * W;
        if (!solid[j]) continue;
        const c = out[j];
        r += unpackR(c) * w;
        g += unpackG(c) * w;
        b += unpackB(c) * w;
        weight += w;
      }
      if (weight === 0) {
        next.push(i);
        continue;
      }
      // The cell keeps some of its own rock: a crown flecks the cobble over it, it does not flood it.
      const own = out[i];
      r += unpackR(own) * FILL_SELF;
      g += unpackG(own) * FILL_SELF;
      b += unpackB(own) * FILL_SELF;
      weight += FILL_SELF;
      const shade = 0.94 + hash2(x, y, seed + 911) * 0.12;
      ring.push(i);
      colors.push(packRGB(
        Math.min(255, Math.floor((r / weight) * shade)),
        Math.min(255, Math.floor((g / weight) * shade)),
        Math.min(255, Math.floor((b / weight) * shade)),
      ));
    }
    if (ring.length === 0) break;
    for (let k = 0; k < ring.length; k++) {
      out[ring[k]] = colors[k];
      solid[ring[k]] = 1;
    }
    pending = next;
  }
}

/**
 * Timber in a cave is planked: lit on top, darker a row at a time down to the
 * fourth, grained along x (the cave generator's floating platforms, which this
 * reproduces exactly; any other wood in the caves wears it too).
 */
function plankColor(types: Uint8Array, i: number, x: number, W: number): number {
  let row = 0;
  while (row < 3 && i - (row + 1) * W >= 0 && types[i - (row + 1) * W] === Cell.Wood) row++;
  const plank = (row === 0 ? 1.0 : row === 1 ? 0.9 : row === 2 ? 0.78 : 0.66) * (0.88 + hash2(x, row, 77) * 0.24);
  return packRGB(Math.floor(132 * plank), Math.floor(88 * plank), Math.floor(44 * plank));
}

function bedrockColor(x: number, y: number, seed: number): number {
  const j = Math.floor(hash2(x, y, seed + 997) * 9) - 4;
  return packRGB(30 + j, 28 + j, 36 + j);
}

/**
 * The pore field: a porous skeleton's air, as a function of position and seed.
 * Noise on 2x2 blocks (`density` = chance of rock), then `smooth` passes of the
 * skeleton's majority rule (5+ rock neighbours: rock; 3-: open; out of bounds is
 * rock). Returns 1 for a pore.
 */
export function poreField(W: number, H: number, seed: number, density: number, smooth: number): Uint8Array {
  const n = W * H;
  let cur = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) cur[x + y * W] = hash2(x >> 1, y >> 1, seed + 7919) < density ? 1 : 0;
  }
  let next = new Uint8Array(n);
  const col = new Int32Array(W + 2);
  for (let pass = 0; pass < smooth; pass++) {
    for (let y = 0; y < H; y++) {
      const mid = y * W;
      const up = y > 0 ? mid - W : -1;
      const dn = y < H - 1 ? mid + W : -1;
      col[0] = 3;
      col[W + 1] = 3;
      for (let x = 0; x < W; x++) {
        col[x + 1] = (up < 0 ? 1 : cur[up + x]) + cur[mid + x] + (dn < 0 ? 1 : cur[dn + x]);
      }
      for (let x = 0; x < W; x++) {
        const s = col[x] + col[x + 1] + col[x + 2] - cur[mid + x];
        next[mid + x] = s >= 5 ? 1 : s <= 3 ? 0 : cur[mid + x];
      }
    }
    const swap = cur;
    cur = next;
    next = swap;
  }
  for (let i = 0; i < n; i++) cur[i] = cur[i] ? 0 : 1;
  return cur;
}

function paintBeds(grid: PaintGrid, p: BedsPaint, out: Uint32Array): void {
  const { types, width: W, height: H } = grid;
  const f = p.frame;
  const seed = p.seed;
  const hash = (x: number, y: number): number => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  };
  // Matte, clustered rock: colour follows mineral beds, never per-cell static.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = x + y * W;
      const t = types[i];
      const framed = x < f || x >= W - f || y < f || y >= H - f;
      if (t === Cell.Stone || (t === Cell.Metal && framed)) {
        const bed = hash(x >> 4, y >> 3) % 7;
        const seam = (y + ((hash(x >> 6, 0) % 11) - 5)) % 47 < 2;
        out[i] = seam ? packRGB(64, 88, 89) : packRGB(48 + bed * 2, 66 + bed * 2, 70 + bed * 2);
      } else {
        out[i] = naturalAt(t, x, y, seed);
      }
    }
  }
  // Chalk lips face walkable space; sparse oxidation faces the walls.
  for (let y = f + 4; y < H - (f + 1); y++) {
    for (let x = f + 2; x < W - (f + 2); x++) {
      const i = x + y * W;
      if (types[i] !== Cell.Stone) continue;
      if (!blocksEntity(types[i - W])) {
        out[i] = packRGB(105, 119, 111);
        if (types[i + W] === Cell.Stone) out[i + W] = packRGB(61, 78, 75);
      } else if (types[i + 1] === Cell.Empty || types[i - 1] === Cell.Empty) {
        out[i] = packRGB(55, 71, 70);
      }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Crown and ground palettes (the cave generator's crown stage, and the     */
/* Builder's crownTint pass, which skins authored rock the same way).       */
/* ------------------------------------------------------------------------ */

/**
 * Crown colour for a top-surface rock cell. Rolls `t = hash2(x, y, seed + 21)`:
 *  - frost: flower (165,215,255) under flowerChance, else pale frosted rock
 *  - ember: rare hot fleck under 0.06, else charred grey-brown
 *  - moss:  pink wildflower under flowerChance, straw tuft in the next 0.05, else mossy green
 */
export function crownTopColor(x: number, y: number, seed: number, crown: BiomeCrown, flowerChance: number): number {
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

/** Moss underlayer: the deep green on the rock directly below a moss crown. */
export function mossUnderColor(x: number, seed: number): number {
  return packRGB(
    44 + Math.floor(hash2(x, 3, seed) * 22),
    104 + Math.floor(hash2(x, 4, seed) * 40),
    36 + Math.floor(hash2(x, 5, seed) * 18),
  );
}

/**
 * A deeper tint of an existing colour under a crown, or null when the roll
 * says leave it: frost one row down (hash < 0.5), moss two rows down (< 0.6).
 */
export function crownDeepTint(c: number, x: number, y: number, seed: number, crown: BiomeCrown): number | null {
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

/** Ceiling fringe: rock over a two-cell drop greens (moss) or frosts (hash < 0.22); never ember. */
export function crownFringeTint(c: number, x: number, y: number, seed: number, crown: BiomeCrown): number | null {
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

function grassTopColor(x: number, seed: number): number {
  return packRGB(
    48 + Math.floor(hash2(x, 7, seed) * 30),
    120 + Math.floor(hash2(x, 8, seed) * 56),
    40 + Math.floor(hash2(x, 9, seed) * 26),
  );
}

function dirtColor(x: number, y: number, seed: number): number {
  const v = hash2(x, y, seed + 211);
  const d = Math.min(3, Math.max(0, y % 4)) * 6; // slight darken with depth
  return packRGB(96 + Math.floor(v * 24) - d, 64 + Math.floor(v * 16) - d, 40 + Math.floor(v * 12) - d);
}

/* ------------------------------------------------------------------------ */
/* Generation: natural tints become tokens, and the end paints the grid.     */
/* ------------------------------------------------------------------------ */

/** The draw every palette sees while a world generates. */
const TOKEN_DRAW = (): number => 0.5;
let tokenDepth = 0;
let tokenRestore: (() => number) | null = null;
let tokens: Set<number> | null = null;

/**
 * Enter a generation. Until the matching endGenerationTint, every sim/colors
 * palette returns its TOKEN (the colour it gives a constant draw), so at the
 * end the generator can tell a natural tint (paint it from the position) from a
 * colour a stamp chose (keep it: it travels as an authored colour). Types never
 * depend on tint (the fx stream feeds no decision), so this changes no cell.
 * Nests: generateLevel generates its caves inside its own scope.
 */
export function beginGenerationTint(): void {
  if (tokenDepth++ === 0) tokenRestore = setTintSource(TOKEN_DRAW);
}

export function endGenerationTint(): void {
  if (tokenDepth === 0) return;
  tokenDepth--;
  if (tokenDepth === 0 && tokenRestore) {
    setTintSource(tokenRestore);
    tokenRestore = null;
  }
}

/** Every palette's token. */
function naturalTokens(): Set<number> {
  if (tokens) return tokens;
  const restore = setTintSource(TOKEN_DRAW);
  try {
    tokens = new Set(TINT_PALETTES.map((palette) => palette()));
  } finally {
    setTintSource(restore);
  }
  return tokens;
}

/** True when the token of some palette is `color` (exported for tests). */
export function isNaturalToken(color: number): boolean {
  return naturalTokens().has(color);
}

/** Cells a style paints whatever colour they were given (rock is never authored). */
function ownedByStyle(paint: WorldPaint, t: number, x: number, y: number, W: number, H: number): boolean {
  if (t === Cell.Empty) return true;
  if (paint.style === 'strata') return t === Cell.Wall || (t === Cell.Metal && y >= H - paint.bedrockRows);
  if (paint.style === 'beds') {
    const f = paint.frame;
    return t === Cell.Stone || (t === Cell.Metal && (x < f || x >= W - f || y < f || y >= H - f));
  }
  return false;
}

/**
 * The end of a generation: paint the finished grid, then give it to every cell
 * the paint owns: the style's rock, empty space, and every natural tint (a
 * token). A colour a stamp chose, or one flagged as an authored scar, stays,
 * and is what the codec ships as a difference. Records the descriptor on the
 * world, so a capture of it paints the same.
 */
export function settleGenerationPaint(world: World, paint: WorldPaint): void {
  const W = world.width;
  const H = world.height;
  const base = new Uint32Array(W * H);
  paintCells(world, paint, base);
  const natural = naturalTokens();
  const { types, colors } = world;
  const flagged = world.colorOverrides.mask;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = x + y * W;
      if (flagged[i]) continue;
      if (ownedByStyle(paint, types[i], x, y, W, H) || natural.has(colors[i])) colors[i] = base[i];
    }
  }
  world.paint = paint;
}

/* ------------------------------------------------------------------------ */
/* Untrusted descriptors (a saved document, a peer's snapshot).             */
/* ------------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown, lo: number, hi: number): number | null =>
  finite(v) && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

function rgb(v: unknown): PaintRgb | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [r, g, b] = v.map((c) => int(c, 0, 255));
  return r === null || g === null || b === null ? null : [r, g, b];
}

/** A version-2 descriptor rebuilt field by field, or null when anything is off. */
export function sanitizeWorldPaint(value: unknown): WorldPaint | null {
  if (!isObj(value) || value.v !== PAINT_VERSION) return null;
  const seed = int(value.seed, 0, 0xffffffff);
  if (seed === null) return null;
  if (value.style === 'plain') return { v: 2, style: 'plain', seed };
  if (value.style === 'beds') {
    const frame = int(value.frame, 0, 64);
    return frame === null ? null : { v: 2, style: 'beds', seed, frame };
  }
  if (value.style !== 'strata') return null;
  if (!Array.isArray(value.bands) || value.bands.length !== 4) return null;
  const [b0, b1, b2, b3] = value.bands.map(rgb);
  if (!b0 || !b1 || !b2 || !b3) return null;
  const crown = value.crown;
  if (crown !== 'moss' && crown !== 'frost' && crown !== 'ember') return null;
  const flowerChance = value.flowerChance;
  if (!finite(flowerChance) || flowerChance < 0 || flowerChance > 1) return null;
  const bedrockRows = int(value.bedrockRows, 0, 64);
  if (bedrockRows === null) return null;
  let pores: StrataPaint['pores'] = null;
  if (value.pores !== null) {
    if (!isObj(value.pores)) return null;
    const density = value.pores.density;
    const smooth = int(value.pores.smooth, 0, 16);
    if (!finite(density) || density < 0 || density > 1 || smooth === null) return null;
    pores = { density, smooth };
  }
  return {
    v: 2,
    style: 'strata',
    seed,
    bands: [b0, b1, b2, b3],
    crown,
    flowerChance,
    pores,
    bedrockRows,
  };
}

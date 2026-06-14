import { hash2 } from '@/core/math';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';

export interface TerrainPolishOptions {
  seed: number;
  minY?: number;
  floorBand?: number;
  surfacePits?: boolean;
}

export interface TerrainPolishStats {
  notchesFilled: number;
  surfaceCellsFilled: number;
}

const NOTCH_PASSES = 2;
const SURFACE_MAX_PIT_WIDTH = 6;
const SURFACE_MAX_PIT_DEPTH = 4;

const NEIGHBOR_SAMPLES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 4],
  [-1, 0, 3],
  [1, 0, 3],
  [-1, 1, 2],
  [1, 1, 2],
  [0, -1, 1],
  [-1, -1, 1],
  [1, -1, 1],
];

interface FillSample {
  type: number;
  color: number;
}

function isTerrainSolid(t: number): boolean {
  return (
    t === Cell.Wall ||
    t === Cell.Stone ||
    t === Cell.Ice ||
    t === Cell.Moss ||
    t === Cell.Fungus ||
    t === Cell.Glowshroom ||
    t === Cell.Crystal ||
    t === Cell.Glass
  );
}

function shadeChannel(v: number): number {
  return Math.max(0, Math.min(255, Math.floor(v)));
}

function sampleTerrainFill(world: World, x: number, y: number, seed: number): FillSample | null {
  const types = world.types;
  const colors = world.colors;
  const W = world.width;
  const H = world.height;
  let bestType = Cell.Wall as number;
  let bestWeight = -1;
  let weightTotal = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (const [dx, dy, weight] of NEIGHBOR_SAMPLES) {
    const X = x + dx;
    const Y = y + dy;
    if (X < 0 || X >= W || Y < 0 || Y >= H) continue;
    const i = X + Y * W;
    const t = types[i];
    if (!isTerrainSolid(t)) continue;
    const c = colors[i];
    r += unpackR(c) * weight;
    g += unpackG(c) * weight;
    b += unpackB(c) * weight;
    weightTotal += weight;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestType = t;
    }
  }

  if (weightTotal === 0) return null;
  const shade = 0.94 + hash2(x, y, seed + 701) * 0.12;
  return {
    type: bestType,
    color: packRGB(
      shadeChannel((r / weightTotal) * shade),
      shadeChannel((g / weightTotal) * shade),
      shadeChannel((b / weightTotal) * shade),
    ),
  };
}

function applyFills(world: World, indices: number[], fillTypes: number[], fillColors: number[]): void {
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    world.types[i] = fillTypes[n];
    world.colors[i] = fillColors[n];
    world.life[i] = 0;
    world.charge[i] = 0;
  }
}

function queueFill(
  world: World,
  x: number,
  y: number,
  seed: number,
  indices: number[],
  fillTypes: number[],
  fillColors: number[],
): boolean {
  const sample = sampleTerrainFill(world, x, y, seed);
  if (!sample) return false;
  indices.push(x + y * world.width);
  fillTypes.push(sample.type);
  fillColors.push(sample.color);
  return true;
}

function fillTinyNotches(world: World, seed: number, minY: number, maxY: number): number {
  const W = world.width;
  const types = world.types;
  let total = 0;

  for (let pass = 0; pass < NOTCH_PASSES; pass++) {
    const indices: number[] = [];
    const fillTypes: number[] = [];
    const fillColors: number[] = [];

    for (let y = minY + 1; y < maxY; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x;
        if (types[i] !== Cell.Empty) continue;

        const up = isTerrainSolid(types[i - W]);
        const down = isTerrainSolid(types[i + W]);
        const left = isTerrainSolid(types[i - 1]);
        const right = isTerrainSolid(types[i + 1]);
        const upLeft = isTerrainSolid(types[i - W - 1]);
        const upRight = isTerrainSolid(types[i - W + 1]);
        const downLeft = isTerrainSolid(types[i + W - 1]);
        const downRight = isTerrainSolid(types[i + W + 1]);
        const solidCount =
          (up ? 1 : 0) +
          (down ? 1 : 0) +
          (left ? 1 : 0) +
          (right ? 1 : 0) +
          (upLeft ? 1 : 0) +
          (upRight ? 1 : 0) +
          (downLeft ? 1 : 0) +
          (downRight ? 1 : 0);

        if (
          solidCount >= 5 ||
          (down && left && right) ||
          (down && downLeft && downRight && (left || right))
        ) {
          queueFill(world, x, y, seed + pass * 977, indices, fillTypes, fillColors);
        }
      }
    }

    if (indices.length === 0) break;
    applyFills(world, indices, fillTypes, fillColors);
    total += indices.length;
  }

  return total;
}

function isTopSurface(types: Uint8Array, W: number, x: number, y: number): boolean {
  return (
    isTerrainSolid(types[x + y * W]) &&
    types[x + (y - 1) * W] === Cell.Empty &&
    types[x + (y - 2) * W] === Cell.Empty
  );
}

function shallowPitDepth(types: Uint8Array, W: number, x: number, y: number, maxY: number): number {
  for (let depth = 1; depth <= SURFACE_MAX_PIT_DEPTH; depth++) {
    const yy = y + depth;
    if (yy >= maxY) return 0;
    const t = types[x + yy * W];
    if (isTerrainSolid(t)) return depth;
    if (t !== Cell.Empty) return 0;
  }
  return 0;
}

function fillSurfacePits(world: World, seed: number, minY: number, maxY: number): number {
  const W = world.width;
  const types = world.types;
  let filled = 0;

  for (let y = Math.max(minY + 2, 2); y < maxY - 1; y++) {
    let x = 2;
    while (x < W - 2) {
      while (x < W - 2 && types[x + y * W] !== Cell.Empty) x++;
      const start = x;
      while (x < W - 2 && types[x + y * W] === Cell.Empty) x++;
      const end = x - 1;
      const width = end - start + 1;
      if (width <= 0 || width > SURFACE_MAX_PIT_WIDTH) continue;
      if (!isTopSurface(types, W, start - 1, y) || !isTopSurface(types, W, end + 1, y)) continue;

      const depths: number[] = [];
      let maxDepth = 0;
      let shallow = true;
      for (let xx = start; xx <= end; xx++) {
        if (types[xx + (y - 1) * W] !== Cell.Empty) {
          shallow = false;
          break;
        }
        const depth = shallowPitDepth(types, W, xx, y, maxY);
        if (depth === 0) {
          shallow = false;
          break;
        }
        depths.push(depth);
        maxDepth = Math.max(maxDepth, depth);
      }
      if (!shallow) continue;

      for (let layer = maxDepth - 1; layer >= 0; layer--) {
        for (let xx = start; xx <= end; xx++) {
          const depth = depths[xx - start];
          if (layer >= depth) continue;
          const yy = y + layer;
          if (types[xx + yy * W] !== Cell.Empty) continue;
          const sample = sampleTerrainFill(world, xx, yy, seed + 1871 + layer * 31);
          if (!sample) continue;
          const i = xx + yy * W;
          types[i] = sample.type;
          world.colors[i] = sample.color;
          world.life[i] = 0;
          world.charge[i] = 0;
          filled++;
        }
      }
    }
  }

  return filled;
}

/**
 * Repairs visually noisy cave cuts after the generated cave has been painted
 * and dressed. It only fills terrain-shaped air defects: tiny enclosed
 * notches and shallow pits between two exposed floor shoulders. The pass is
 * deterministic and bounded; real shafts, rooms, and structure carves stay
 * open.
 */
export function polishCaveTerrain(world: World, options: TerrainPolishOptions): TerrainPolishStats {
  const minY = options.minY ?? 1;
  const maxY = Math.min(options.floorBand ?? world.height - 1, world.height - 1);
  const notchesFilled = fillTinyNotches(world, options.seed, minY, maxY);
  const surfaceCellsFilled =
    options.surfacePits === false ? 0 : fillSurfacePits(world, options.seed, minY, maxY);
  return { notchesFilled, surfaceCellsFilled };
}

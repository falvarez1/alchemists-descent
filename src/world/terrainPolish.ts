import { hash2 } from '@/core/math';
import { Cell } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';

/**
 * The minimal grid view the polish pass reads: the flat cell planes + dims,
 * no World methods (it indexes manually as x + y*width). A real World satisfies
 * it structurally, and the virtual ChunkGenerator hands in a lightweight scratch
 * adapter — so neither caller needs an `as unknown as World` cast.
 */
export interface PolishTarget {
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint8Array | Uint16Array;
  colorOverrides?: Set<number>;
  width: number;
  height: number;
}

export interface TerrainPolishOptions {
  seed: number;
  minY?: number;
  floorBand?: number;
  surfacePits?: boolean;
  /** Max walk-surface "sink" WIDTH to fill (cells). Default 6 — raise to smooth
   *  wider gaps between floor shoulders. */
  maxPitWidth?: number;
  /** Max sink DEPTH to fill. Default 4 — raise to fill deeper dips. */
  maxPitDepth?: number;
  /** Tiny-enclosed-notch fill passes. Default 2 — raise for a cleaner wall. */
  notchPasses?: number;
}

export interface TerrainPolishStats {
  notchesFilled: number;
  surfaceCellsFilled: number;
}

const NOTCH_PASSES = 2; // default; override via TerrainPolishOptions.notchPasses
const SURFACE_MAX_PIT_WIDTH = 6; // default; override via TerrainPolishOptions.maxPitWidth
const SURFACE_MAX_PIT_DEPTH = 4; // default; override via TerrainPolishOptions.maxPitDepth

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

function sampleTerrainFill(world: PolishTarget, x: number, y: number, seed: number): FillSample | null {
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

function applyFills(world: PolishTarget, indices: number[], fillTypes: number[], fillColors: number[]): void {
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    world.types[i] = fillTypes[n];
    world.colors[i] = fillColors[n];
    world.life[i] = 0;
    world.charge[i] = 0;
    world.colorOverrides?.add(i);
  }
}

function queueFill(
  world: PolishTarget,
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

function fillTinyNotches(world: PolishTarget, seed: number, minY: number, maxY: number, passes: number): number {
  const W = world.width;
  const types = world.types;
  let total = 0;

  for (let pass = 0; pass < passes; pass++) {
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

/**
 * Majority-rule rock consolidation — closes the small holes of a porous (swiss-cheese)
 * cave so the rock the player walks reads SOLID instead of riddled with gaps. Each pass
 * turns an Empty cell into sampled neighbour rock when >= `threshold` of its 8 neighbours
 * are solid; iterated `passes` times so filled cells feed the next pass and the network
 * consolidates. threshold 4 (majority) actually closes a 50/50 network — the notch fill's
 * >=5 stalls on it. Bounded by passes; genuinely open caverns (few solid neighbours) stay
 * open, but this DOES alter connectivity, so it's findability-gated.
 */
export function consolidateRock(
  world: PolishTarget,
  seed: number,
  minY: number,
  maxY: number,
  passes: number,
  threshold: number,
): number {
  const W = world.width;
  const types = world.types;
  let total = 0;
  for (let pass = 0; pass < passes; pass++) {
    const indices: number[] = [];
    const fillTypes: number[] = [];
    const fillColors: number[] = [];
    for (let y = minY + 1; y < maxY; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const i = row + x;
        if (types[i] !== Cell.Empty) continue;
        let s = 0;
        if (isTerrainSolid(types[i - W])) s++;
        if (isTerrainSolid(types[i + W])) s++;
        if (isTerrainSolid(types[i - 1])) s++;
        if (isTerrainSolid(types[i + 1])) s++;
        if (isTerrainSolid(types[i - W - 1])) s++;
        if (isTerrainSolid(types[i - W + 1])) s++;
        if (isTerrainSolid(types[i + W - 1])) s++;
        if (isTerrainSolid(types[i + W + 1])) s++;
        if (s >= threshold) queueFill(world, x, y, seed + pass * 419, indices, fillTypes, fillColors);
      }
    }
    if (indices.length === 0) break;
    applyFills(world, indices, fillTypes, fillColors);
    total += indices.length;
  }
  return total;
}

/**
 * Fill the swiss-cheese SPECKLE: flood-fill every open region; any region whose size
 * is <= `maxHole` cells gets packed with sampled rock, larger regions (the real
 * caverns) stay open. Connectivity-safe BY CONSTRUCTION — a region that connects two
 * caverns is large, so it is never filled; only genuinely small pockets close. This
 * is what makes the rock the player walks on read SOLID instead of porous, without
 * the threshold-based fills' habit of sealing 1-cell corridors.
 */
export function fillEnclosedHoles(
  world: PolishTarget,
  seed: number,
  minY: number,
  maxY: number,
  maxHole: number,
): number {
  if (maxHole <= 0) return 0;
  const W = world.width;
  const types = world.types;
  const visited = new Uint8Array(W * world.height);
  const stack: number[] = [];
  const region: number[] = [];
  let filled = 0;
  for (let sy = minY; sy < maxY; sy++) {
    for (let sx = 1; sx < W - 1; sx++) {
      const start = sx + sy * W;
      if (visited[start] || types[start] !== Cell.Empty) continue;
      region.length = 0;
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;
      let tooBig = false;
      while (stack.length) {
        const c = stack.pop() as number;
        if (!tooBig) {
          region.push(c);
          if (region.length > maxHole) tooBig = true; // stop collecting, keep draining to mark visited
        }
        const cx = c % W;
        const cy = (c / W) | 0;
        if (cx > 1 && !visited[c - 1] && types[c - 1] === Cell.Empty) { visited[c - 1] = 1; stack.push(c - 1); }
        if (cx < W - 2 && !visited[c + 1] && types[c + 1] === Cell.Empty) { visited[c + 1] = 1; stack.push(c + 1); }
        if (cy > minY && !visited[c - W] && types[c - W] === Cell.Empty) { visited[c - W] = 1; stack.push(c - W); }
        if (cy + 1 < maxY && !visited[c + W] && types[c + W] === Cell.Empty) { visited[c + W] = 1; stack.push(c + W); }
      }
      if (tooBig) continue; // a real cavern / passage — leave it open
      // Pack ring-by-ring from the rock boundary inward so fat pockets fill solid:
      // a cell can only sample a SOLID neighbor, so each pass converts the current
      // shell to rock, exposing the next shell for the following pass.
      let remaining = region.slice();
      while (remaining.length) {
        const next: number[] = [];
        let progress = false;
        for (const c of remaining) {
          const sample = sampleTerrainFill(world, c % W, (c / W) | 0, seed + 1543);
          if (sample) {
            world.types[c] = sample.type;
            world.colors[c] = sample.color;
            world.life[c] = 0;
            world.charge[c] = 0;
            world.colorOverrides?.add(c);
            filled++;
            progress = true;
          } else {
            next.push(c);
          }
        }
        if (!progress) break; // no solid neighbor anywhere (cannot happen for a sealed pocket)
        remaining = next;
      }
    }
  }
  return filled;
}

/**
 * Morphological CLOSE of the rock mass (dilate the non-empty cells by `radius`,
 * then erode back). The net effect: every OPEN feature thinner than 2*radius —
 * the connected swiss-cheese speckle, hairline crevices, pinhole pits — is packed
 * with rock, while caverns and tunnels WIDER than 2*radius are restored to their
 * exact original outline. Connectivity-safe by construction: a passage wider than
 * the radius survives the erode, so only sub-radius gaps (which a body can't pass
 * anyway) ever close. This is the real fix for the porous-noise look — unlike
 * fillEnclosedHoles, it reaches the speckle that is CONNECTED to the cave network.
 * Returns the number of air cells packed.
 */
export function solidifyRock(
  world: PolishTarget,
  seed: number,
  minY: number,
  maxY: number,
  radius: number,
): number {
  if (radius <= 0) return 0;
  const W = world.width;
  const H = world.height;
  const types = world.types;
  const y0 = minY + 1;
  const y1 = maxY;
  const x0 = 1;
  const x1 = W - 1;

  // Dilation of the non-empty (rock) mass. OOB / out-of-band cells contribute
  // nothing (treated open), so rock never grows out of the void.
  const dil = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let any = false;
      for (let dy = -radius; dy <= radius && !any; dy++) {
        const Y = y + dy;
        if (Y < y0 || Y >= y1) continue;
        const row = Y * W;
        for (let dx = -radius; dx <= radius; dx++) {
          const X = x + dx;
          if (X < x0 || X >= x1) continue;
          if (types[X + row] !== Cell.Empty) { any = true; break; }
        }
      }
      if (any) dil[x + y * W] = 1;
    }
  }

  // Erode the dilation; any Empty cell that stays solid is a thin gap to pack.
  // An in-band window cell that is NOT dilated-solid opens the cell back up, so
  // wide caverns (whose interiors never dilated) are restored exactly.
  const queue: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = x + y * W;
      if (types[i] !== Cell.Empty) continue; // only pack air
      let solid = true;
      for (let dy = -radius; dy <= radius && solid; dy++) {
        const Y = y + dy;
        if (Y < y0 || Y >= y1) continue;
        const row = Y * W;
        for (let dx = -radius; dx <= radius; dx++) {
          const X = x + dx;
          if (X < x0 || X >= x1) continue;
          if (!dil[X + row]) { solid = false; break; }
        }
      }
      if (solid) queue.push(i);
    }
  }

  // Ring-fill from the rock boundary inward (same sampler as the other passes).
  let filled = 0;
  let remaining = queue;
  while (remaining.length) {
    const next: number[] = [];
    let progress = false;
    for (const c of remaining) {
      const sample = sampleTerrainFill(world, c % W, (c / W) | 0, seed + 911);
      if (sample) {
        world.types[c] = sample.type;
        world.colors[c] = sample.color;
        world.life[c] = 0;
        world.charge[c] = 0;
        world.colorOverrides?.add(c);
        filled++;
        progress = true;
      } else {
        next.push(c);
      }
    }
    if (!progress) break;
    remaining = next;
  }
  return filled;
}

function isTopSurface(types: Uint8Array, W: number, x: number, y: number): boolean {
  return (
    isTerrainSolid(types[x + y * W]) &&
    types[x + (y - 1) * W] === Cell.Empty &&
    types[x + (y - 2) * W] === Cell.Empty
  );
}

function shallowPitDepth(types: Uint8Array, W: number, x: number, y: number, maxY: number, maxDepth: number): number {
  for (let depth = 1; depth <= maxDepth; depth++) {
    const yy = y + depth;
    if (yy >= maxY) return 0;
    const t = types[x + yy * W];
    if (isTerrainSolid(t)) return depth;
    if (t !== Cell.Empty) return 0;
  }
  return 0;
}

function fillSurfacePits(world: PolishTarget, seed: number, minY: number, maxY: number, maxWidth: number, maxPitDepth: number): number {
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
      if (width <= 0 || width > maxWidth) continue;
      if (!isTopSurface(types, W, start - 1, y) || !isTopSurface(types, W, end + 1, y)) continue;

      const depths: number[] = [];
      let maxDepth = 0;
      let shallow = true;
      for (let xx = start; xx <= end; xx++) {
        if (types[xx + (y - 1) * W] !== Cell.Empty) {
          shallow = false;
          break;
        }
        const depth = shallowPitDepth(types, W, xx, y, maxY, maxPitDepth);
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
          world.colorOverrides?.add(i);
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
export function polishCaveTerrain(world: PolishTarget, options: TerrainPolishOptions): TerrainPolishStats {
  const minY = options.minY ?? 1;
  const maxY = Math.min(options.floorBand ?? world.height - 1, world.height - 1);
  const notchPasses = Math.max(0, Math.round(options.notchPasses ?? NOTCH_PASSES));
  const maxWidth = Math.max(0, Math.round(options.maxPitWidth ?? SURFACE_MAX_PIT_WIDTH));
  const maxDepth = Math.max(1, Math.round(options.maxPitDepth ?? SURFACE_MAX_PIT_DEPTH));
  const notchesFilled = fillTinyNotches(world, options.seed, minY, maxY, notchPasses);
  const surfaceCellsFilled =
    options.surfacePits === false ? 0 : fillSurfacePits(world, options.seed, minY, maxY, maxWidth, maxDepth);
  return { notchesFilled, surfaceCellsFilled };
}
